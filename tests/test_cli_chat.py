from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.cli.chat_cli import AiEChatCli, build_arg_parser
from app.controller.app_service import ControllerService
from app.controller.chat_command_parser import parse_chat_command
from app.controller.execution_runner import ExecutionRunner
from app.controller.feature_bundle_models import FeatureBundleFile, FeatureBundleRecord, FeatureValidationPlan
from app.controller.last_run_models import LastRunRecord
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report


class _PromptDriver:
    def __init__(self, *answers: str) -> None:
        self._answers = list(answers)
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if self._answers:
            return self._answers.pop(0)
        raise AssertionError(f"Unexpected prompt: {prompt}")


class LocalCliChatTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        command_runner: _FakeCommandRunner | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, _FakeCommandRunner]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        runner = command_runner or _FakeCommandRunner()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=_FakeTelegramService(),
            execution_runner=ExecutionRunner(command_runner=runner, default_timeout_seconds=5.0),
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        service.activate_runtime_control_plane()
        return service, config_store, runner

    @staticmethod
    def _configure_repo_root(*, service: ControllerService, config_store: ControllerConfigStore, root: Path) -> None:
        config = config_store.load()
        resolved = str(root.resolve())
        config.repo_root = resolved
        config.file_allowed_roots = (resolved,)
        config_store.save(config)
        service._config = config_store.load()

    @staticmethod
    def _build_feature_bundle_repo(root: Path) -> None:
        source_root = Path(__file__).resolve().parents[1]
        targets = (
            (source_root / "app" / "cli" / "chat.py", root / "app" / "cli" / "chat.py"),
            (source_root / "app" / "cli" / "chat_cli.py", root / "app" / "cli" / "chat_cli.py"),
            (source_root / "tests" / "test_cli_chat.py", root / "tests" / "test_cli_chat.py"),
        )
        for source_path, destination_path in targets:
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            destination_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")

    @staticmethod
    def _build_coding_feature_bundle_repo(root: Path) -> None:
        source_root = Path(__file__).resolve().parents[1]
        targets = (
            (source_root / "app" / "controller" / "feature_bundle_models.py", root / "app" / "controller" / "feature_bundle_models.py"),
            (source_root / "app" / "controller" / "feature_bundle_formatter.py", root / "app" / "controller" / "feature_bundle_formatter.py"),
            (source_root / "tests" / "test_task_chains.py", root / "tests" / "test_task_chains.py"),
        )
        for source_path, destination_path in targets:
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            destination_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")

    def test_cli_debug_shows_shared_status_routing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            prompts = _PromptDriver()
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append, debug=True)

            keep_running = cli.handle_line("what is the current status?")

            self.assertTrue(keep_running)
            joined = "\n".join(output)
            self.assertIn("[INTENT: STATUS_OR_CONTEXT]", joined)
            self.assertIn("[ROUTE: /status]", joined)
            self.assertIn("[COMMAND: plain_text]", joined)
            self.assertIn("[ROUTED CAPABILITY: status.read]", joined)
            self.assertIn("Readiness:", joined)

    def test_shared_parser_recognizes_task_chain_command_family(self) -> None:
        create = parse_chat_command(
            text='/chaincreate --title cli_validator_chain --type validate_compare_report --command "/run pytest tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing" --steps 3 --retries 1 --failures 2 --fallback local',
            has_text=True,
        )
        dispatch = parse_chat_command(
            text='/dispatch --target validator --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing"',
            has_text=True,
        )
        chains = parse_chat_command(text="/chains", has_text=True)
        status = parse_chat_command(text="/chainstatus CH-12345678", has_text=True)
        steps = parse_chat_command(text="/chainsteps CH-12345678 5", has_text=True)
        start = parse_chat_command(text="/chainstart CH-12345678", has_text=True)
        resume = parse_chat_command(text="/chainresume CH-12345678", has_text=True)
        stop = parse_chat_command(text="/chainstop CH-12345678", has_text=True)
        decision = parse_chat_command(text="/chaindecision CH-12345678", has_text=True)

        self.assertEqual(create.command_label, "/chaincreate")
        self.assertTrue(create.argument.startswith("--title cli_validator_chain"))
        self.assertEqual(dispatch.command_label, "/dispatch")
        self.assertIn("--target validator", dispatch.argument)
        self.assertEqual(chains.command_label, "/chains")
        self.assertEqual(status.command_label, "/chainstatus")
        self.assertEqual(steps.command_label, "/chainsteps")
        self.assertEqual(start.command_label, "/chainstart")
        self.assertEqual(resume.command_label, "/chainresume")
        self.assertEqual(stop.command_label, "/chainstop")
        self.assertEqual(decision.command_label, "/chaindecision")

    def test_build_arg_parser_accepts_debug_routing_alias(self) -> None:
        parser = build_arg_parser()

        args = parser.parse_args(["--debug-routing"])

        self.assertFalse(args.debug)
        self.assertTrue(args.debug_routing)

    def test_cli_execution_requests_confirmation_before_running(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            (root / "src").mkdir(parents=True, exist_ok=True)
            (root / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "src/main.py", "."], 0, "Scanning: .\n", "")
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            service.set_latest_run_for_chat(
                chat_id="local-cli",
                record=LastRunRecord(
                    command_label="main",
                    target_root=".",
                    entrypoint_path="src/main.py",
                    argv=["python", "src/main.py", "."],
                    exit_code=0,
                    stdout_preview="Scanning: .",
                    stderr_preview="",
                    summary="Completed successfully.",
                    created_at_utc="2026-04-10T10:00:00Z",
                    is_patch_relevant=True,
                ),
            )
            prompts = _PromptDriver()
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append)

            cli.handle_line("run it again")

            joined = "\n".join(output)
            self.assertIn("[RUN REQUEST]", joined)
            self.assertIn("[CONFIRMATION REQUIRED]", joined)
            self.assertIn("Action requires confirmation.", joined)
            self.assertIn("ID:", joined)
            self.assertEqual(len(fake_runner.calls), 0)
            self.assertEqual(prompts.prompts, [])

    def test_cli_chaincreate_accepts_live_flag_syntax(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    0,
                    "1 passed\n",
                    "",
                )
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append, debug=True)

            self.assertTrue(
                cli.handle_line(
                    '/chaincreate --title "cli validator chain" --type validate_then_report --command "/run pytest tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing" --steps 3 --retries 1 --failures 2'
                )
            )

            joined = "\n".join(output)
            self.assertIn("[TASK CHAIN]", joined)
            self.assertIn("ID: CH-", joined)
            self.assertNotIn("Couldn't parse that command.", joined)
            chain = service.list_task_chains()[0]
            self.assertEqual(chain.objective, "cli validator chain")
            self.assertEqual(chain.metadata.get("compat_retries"), "1")

    def test_cli_chaincreate_missing_required_fields_fails_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(cli.handle_line('/chaincreate --title only-title'))

            joined = "\n".join(output)
            self.assertIn("Couldn't create that task chain.", joined)
            self.assertIn("Missing required option --type.", joined)

    def test_cli_task_chain_family_runs_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    0,
                    "1 passed\n",
                    "",
                )
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(
                cli.handle_line(
                    '/chaincreate --title cli_validator_chain --type validate_then_report --command "/run pytest tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing" --steps 3 --retries 1 --failures 2'
                )
            )
            chain = service.list_task_chains()[0]
            self.assertTrue(cli.handle_line("/chains"))
            self.assertTrue(cli.handle_line(f"/chainstart {chain.chain_id}"))
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)
            self.assertTrue(cli.handle_line(f"/confirm {confirmation.confirmation_id}"))
            self.assertTrue(cli.handle_line(f"/chainstatus {chain.chain_id}"))
            self.assertTrue(cli.handle_line(f"/chainsteps {chain.chain_id}"))

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")

            self.assertTrue(cli.handle_line(f"/chainstatus {chain.chain_id}"))
            self.assertTrue(cli.handle_line(f"/chainsteps {chain.chain_id}"))

            joined = "\n".join(output)
            self.assertIn("[TASK CHAINS]", joined)
            self.assertIn("Confirmation", joined)
            self.assertIn("[TASK CHAIN STATUS]", joined)
            self.assertIn("[TASK CHAIN STEPS]", joined)

    def test_cli_fallback_does_not_crash_on_ambiguous_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            prompts = _PromptDriver()
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append)

            keep_running = cli.handle_line("maybe")

            self.assertTrue(keep_running)
            joined = "\n".join(output)
            self.assertIn("AI-E:", joined)
            self.assertIn("Do you want to start a new idea", joined)

    def test_cli_session_context_supports_run_it_again(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            generated_root = root / "generated" / "GP-7A31C2" / "src"
            generated_root.mkdir(parents=True, exist_ok=True)
            (generated_root / "main.py").write_text("print('generated')\n", encoding="utf-8")
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            service.set_latest_run_for_chat(
                chat_id="dev-shell",
                record=LastRunRecord(
                    command_label="main",
                    target_root="generated/GP-7A31C2",
                    entrypoint_path="src/main.py",
                    argv=["python", "src/main.py", "generated/GP-7A31C2"],
                    exit_code=0,
                    stdout_preview="Completed last run.",
                    stderr_preview="",
                    summary="Completed last run.",
                    created_at_utc="2026-04-10T10:00:00Z",
                    is_patch_relevant=True,
                ),
            )
            prompts = _PromptDriver()
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append, chat_id="dev-shell")

            cli.handle_line("run it again")

            joined = "\n".join(output)
            self.assertIn("Preview: run main generated/GP-7A31C2", joined)
            self.assertIn("ID:", joined)

    def test_cli_file_context_bootstrap_and_apply_it_bind_to_sticky_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            target = src / "main.py"
            target.write_text(
                "from pathlib import Path\n"
                "import sys\n\n\n"
                "def main() -> int:\n"
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
                "    print(f\"Scanning: {target}\")\n"
                "    return 0\n\n\n"
                "if __name__ == \"__main__\":\n"
                "    raise SystemExit(main())\n",
                encoding="utf-8",
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            cli = AiEChatCli(service=service, input_func=_PromptDriver("y"), output_func=lambda _: None)

            self.assertTrue(cli.handle_line("/file src/main.py"))
            self.assertTrue(cli.handle_line("improve the format of this file"))
            self.assertTrue(cli.handle_line("apply it"))

            updated = target.read_text(encoding="utf-8")
            self.assertIn("Scanning directory:", updated)

    def test_cli_file_context_bootstrap_supports_add_logging_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            target = src / "main.py"
            target.write_text(
                "from pathlib import Path\n"
                "import sys\n\n\n"
                "def main() -> int:\n"
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
                "    print(f\"Scanning: {target}\")\n"
                "    return 0\n\n\n"
                "if __name__ == \"__main__\":\n"
                "    raise SystemExit(main())\n",
                encoding="utf-8",
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver("y"), output_func=output.append)

            self.assertTrue(cli.handle_line("/file src/main.py"))
            self.assertTrue(cli.handle_line("add logging to this file"))

            joined = "\n".join(output)
            self.assertIn("Planned update for src/main.py", joined)
            self.assertIn("configure basic INFO logging", joined)

    def test_cli_main_bootstrap_and_context_visibility(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            generated_root = root / "generated" / "GP-123" / "src"
            generated_root.mkdir(parents=True, exist_ok=True)
            (generated_root / "main.py").write_text("print('generated')\n", encoding="utf-8")
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(cli.handle_line("/main generated/GP-123"))
            self.assertTrue(cli.handle_line("/context"))

            joined = "\n".join(output)
            self.assertIn("Run target ready: generated/GP-123", joined)
            self.assertIn("Current run target: generated/GP-123", joined)

    def test_cli_yes_without_pending_confirmation_stays_safe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(cli.handle_line("y"))

            self.assertIn("No confirmation is pending.", "\n".join(output))

    def test_cli_run_it_reuses_existing_pending_execution_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            (root / "generated" / "GP-123" / "src").mkdir(parents=True, exist_ok=True)
            (root / "generated" / "GP-123" / "src" / "main.py").write_text("print('generated')\n", encoding="utf-8")
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(cli.handle_line("/run main generated/GP-123"))
            self.assertTrue(cli.handle_line("run it"))

            joined = "\n".join(output)
            self.assertIn("Execution is already pending for generated/GP-123.", joined)
            self.assertIn("type y to approve", joined.lower())

    def test_cli_feature_bundle_plan_apply_and_validate_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            self._build_feature_bundle_repo(root)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    0,
                    "1 passed\n",
                    "",
                )
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append, debug=True)

            self.assertTrue(cli.handle_line("show feature bundle id in the cli debug output"))
            self.assertTrue(cli.handle_line("apply it"))
            self.assertTrue(cli.handle_line("y"))
            self.assertTrue(cli.handle_line("/run pytest tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"))
            self.assertTrue(cli.handle_line("y"))
            self.assertTrue(cli.handle_line("/featurestatus"))

            joined = "\n".join(output)
            self.assertIn("[FEATURE BUNDLE]", joined)
            self.assertIn("Action requires confirmation.", joined)
            self.assertIn("Feature bundle applied.", joined)
            self.assertIn("Validation: passed", joined)
            self.assertEqual(len(fake_runner.calls), 1)
            updated_cli = (root / "app" / "cli" / "chat_cli.py").read_text(encoding="utf-8")
            updated_tests = (root / "tests" / "test_cli_chat.py").read_text(encoding="utf-8")
            self.assertIn("FEATURE BUNDLE ID", updated_cli)
            self.assertIn("_feature_bundle_id_label", updated_cli)
            self.assertIn("show feature bundle id in the cli debug output", updated_tests)

    def test_cli_coding_bundle_plan_shows_structured_coding_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            self._build_coding_feature_bundle_repo(root)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append, debug=True)

            self.assertTrue(
                cli.handle_line("Add a helper that formats feature bundle commit summaries and update the related tests.")
            )

            joined = "\n".join(output)
            self.assertIn("[FEATURE BUNDLE]", joined)
            self.assertIn("Coding plan:", joined)
            self.assertIn("formatter_output_update", joined)

    def test_cli_feature_pr_preview_and_conversational_dev_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            (root / "app").mkdir(parents=True, exist_ok=True)
            (root / "app" / "controller").mkdir(parents=True, exist_ok=True)
            (root / "app" / "controller" / "repo_inspector.py").write_text("baseline\n", encoding="utf-8")
            subprocess.run(["git", "init"], cwd=root, capture_output=True, text=True, check=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=root, capture_output=True, text=True, check=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, capture_output=True, text=True, check=True)
            subprocess.run(["git", "add", "."], cwd=root, capture_output=True, text=True, check=True)
            subprocess.run(["git", "commit", "-m", "Initial"], cwd=root, capture_output=True, text=True, check=True)
            subprocess.run(["git", "init", "--bare", str(root.parent / "origin.git")], capture_output=True, text=True, check=True)
            subprocess.run(["git", "remote", "add", "origin", str(root.parent / "origin.git")], cwd=root, capture_output=True, text=True, check=True)
            (root / "app" / "controller" / "repo_inspector.py").write_text("baseline\nupdated\n", encoding="utf-8")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=FeatureBundleRecord(
                    bundle_id="FB-TEST",
                    feature_request="test bundle",
                    feature_title="Test bundle",
                    intended_outcome="Add scoped commit preparation coverage.",
                    bundle_summary="Adds bounded commit preparation output for active feature bundles.",
                    files=(
                        FeatureBundleFile(
                            relative_path="app/controller/repo_inspector.py",
                            inclusion_reason="Target file for bounded milestone coverage.",
                            change_summary="Update commit preparation behavior.",
                            editable=True,
                            scope_confidence=0.95,
                        ),
                    ),
                    assumptions=(),
                    risk_notes=(),
                    validation_plan=FeatureValidationPlan(
                        command_text="pytest tests/test_task_chains.py",
                        rationale="Validate bounded commit packaging.",
                    ),
                    state="validated",
                    validation_state="passed",
                    created_at="2026-04-11T00:00:00+00:00",
                    updated_at="2026-04-11T00:00:00+00:00",
                    approval_required=True,
                    applied_files=("app/controller/repo_inspector.py",),
                    apply_summary="Applied 1 editable file.",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)
            self.assertEqual(service.execute_local_chat_input(text="/featurecommit execute").outcome, "confirmation_required")
            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(commit_confirmation)
            self.assertEqual(service.execute_local_chat_input(text=f"/confirm {commit_confirmation.confirmation_id}").outcome, "success")
            self.assertEqual(service.execute_local_chat_input(text="/featurepush execute").outcome, "confirmation_required")
            push_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(push_confirmation)
            self.assertEqual(service.execute_local_chat_input(text=f"/confirm {push_confirmation.confirmation_id}").outcome, "success")

            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append, debug=True)

            self.assertTrue(cli.handle_line("/featurepr"))
            self.assertTrue(cli.handle_line("What would this PR say?"))

            joined = "\n".join(output)
            self.assertIn("[FEATURE PR]", joined)
            self.assertIn("PR title:", joined)