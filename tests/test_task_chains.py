from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.feature_bundle_models import FeatureBundleFile, FeatureBundleRecord, FeatureValidationPlan
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report


class TaskChainTests(unittest.TestCase):
    def _run_git(self, repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )

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

    def _initialize_git_repo(self, root: Path) -> None:
        (root / "README.md").write_text("feature bundle fixture\n", encoding="utf-8")
        self._run_git(root, "init")
        self._run_git(root, "config", "user.name", "Test User")
        self._run_git(root, "config", "user.email", "test@example.com")
        self._run_git(root, "add", ".")
        self._run_git(root, "commit", "-m", "Initial feature bundle fixture")
        (root / "README.md").write_text("feature bundle fixture\nunrelated docs change\n", encoding="utf-8")

    def _initialize_clean_git_repo(self, root: Path) -> None:
        self._run_git(root, "init")
        self._run_git(root, "config", "user.name", "Test User")
        self._run_git(root, "config", "user.email", "test@example.com")
        self._run_git(root, "add", ".")
        self._run_git(root, "commit", "-m", "Initial feature bundle fixture")

    def _write_repo_file(self, root: Path, relative_path: str, content: str) -> None:
        file_path = root / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")

    def _make_bundle(
        self,
        *,
        path: str,
        state: str,
        validation_state: str,
        validation_summary: str = "",
        risk_notes: tuple[str, ...] = (),
    ) -> FeatureBundleRecord:
        return FeatureBundleRecord(
            bundle_id="FB-TEST",
            feature_request="test bundle",
            feature_title="Test bundle",
            intended_outcome="Add scoped commit preparation coverage.",
            bundle_summary="Adds bounded commit preparation output for active feature bundles.",
            files=(
                FeatureBundleFile(
                    relative_path=path,
                    inclusion_reason="Target file for bounded milestone coverage.",
                    change_summary="Update commit preparation behavior.",
                    editable=True,
                    scope_confidence=0.95,
                ),
            ),
            assumptions=(),
            risk_notes=risk_notes,
            validation_plan=FeatureValidationPlan(command_text="pytest tests/test_task_chains.py", rationale="Validate bounded commit packaging."),
            state=state,
            validation_state=validation_state,
            created_at="2026-04-11T00:00:00+00:00",
            updated_at="2026-04-11T00:00:00+00:00",
            approval_required=True,
            applied_files=(path,),
            apply_summary="Applied 1 editable file.",
            validation_summary=validation_summary,
        )

    def test_validate_then_report_chain_runs_and_records_steps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(
                text='/chaincreate --title "smoke chain" --objective "validate then report" --type validate_then_report --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 2 --failures 2 --no-progress 1'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]

            start = service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            self.assertEqual(start.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            confirm = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertEqual(confirm.outcome, "success")

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.steps_completed, 2)
            self.assertEqual(len(fake_runner.calls), 1)

            status = service.execute_local_chat_input(text=f"/chainstatus {chain.chain_id}")
            steps = service.execute_local_chat_input(text=f"/chainsteps {chain.chain_id} 5")

            self.assertIn("Steps completed: 2/2", status.user_message)
            self.assertIn("Step 2", steps.user_message)

    def test_plain_text_validation_request_creates_and_runs_task_chain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 19 tests in 0.03s\n\nOK\n", ""),
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(text="validate the full conversational ingestion stack")

            self.assertEqual(created.outcome, "success")
            self.assertTrue(created.telemetry.get("task_execution_conversation"))
            self.assertIn("[TASK CHAIN]", created.user_message)

            chain = service.list_task_chains()[0]
            self.assertEqual(chain.chain_type, "validate_then_report")
            self.assertIn("tests.test_policy_aware_ingestion", chain.command_text)
            self.assertIn("tests.test_conversational_ingestion", chain.command_text)
            self.assertIn(f"/chainstart {chain.chain_id}", created.user_message)

            start = service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            self.assertEqual(start.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            confirm = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertEqual(confirm.outcome, "success")

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.steps_completed, 2)
            self.assertEqual(len(fake_runner.calls), 1)

    def test_plain_text_validation_request_clarifies_then_creates_targeted_chain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            clarification = service.execute_local_chat_input(text="run the validation loop")

            self.assertEqual(clarification.outcome, "success")
            self.assertTrue(clarification.telemetry.get("task_execution_conversation"))
            self.assertTrue(clarification.telemetry.get("requires_clarification"))
            self.assertIn("What should I validate", clarification.user_message)

            created = service.execute_local_chat_input(text="the conversational ingestion tests")

            self.assertEqual(created.outcome, "success")
            self.assertIn("[TASK CHAIN]", created.user_message)

            chain = service.list_task_chains()[0]
            self.assertIn("tests.test_conversational_ingestion", chain.command_text)
            self.assertNotIn("tests.test_policy_aware_ingestion tests.test_conversational_ingestion", chain.command_text)

    def test_plain_text_feature_bundle_apply_and_validate_chain_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_feature_bundle_repo(root)
            self._initialize_git_repo(root)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    0,
                    "1 passed\n",
                    "",
                ),
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            planned = service.execute_local_chat_input(text="show feature bundle id in the cli debug output")
            self.assertEqual(planned.outcome, "success")
            bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(bundle)
            self.assertEqual(bundle.state, "proposed")

            apply_request = service.execute_local_chat_input(text="apply it")
            self.assertEqual(apply_request.outcome, "confirmation_required")
            self.assertTrue(apply_request.telemetry.get("task_execution_conversation"))
            self.assertEqual(apply_request.telemetry.get("feature_bundle_action"), "apply")
            apply_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(apply_confirmation)

            apply_result = service.execute_local_chat_input(text=f"/confirm {apply_confirmation.confirmation_id}")
            self.assertEqual(apply_result.outcome, "success")
            applied_bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(applied_bundle)
            self.assertEqual(applied_bundle.state, "applied")
            self.assertIsNotNone(applied_bundle.completion_advisory)
            self.assertIn("app/cli/chat_cli.py", applied_bundle.completion_advisory.suggested_stage_paths)
            self.assertIn("README.md already has unrelated changes", applied_bundle.completion_advisory.readme_guidance)
            self.assertIn("Apply bounded feature bundle", applied_bundle.completion_advisory.suggested_commit_message)
            self.assertEqual(applied_bundle.completion_advisory.commit_readiness_status, "blocked_pending_validation")
            self.assertTrue(applied_bundle.completion_advisory.playtest_required)

            validation_preview = service.execute_local_chat_input(text="validate it")
            self.assertEqual(validation_preview.outcome, "success")
            self.assertTrue(validation_preview.telemetry.get("task_execution_conversation"))
            self.assertEqual(validation_preview.telemetry.get("feature_bundle_action"), "validate")
            self.assertIn("[TASK CHAIN]", validation_preview.user_message)

            chain = service.list_task_chains()[0]
            self.assertEqual(chain.chain_type, "feature_validate_gate")
            self.assertIn("/run pytest tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing", chain.command_text)

            start = service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            self.assertEqual(start.outcome, "confirmation_required")
            start_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(start_confirmation)

            confirm = service.execute_local_chat_input(text=f"/confirm {start_confirmation.confirmation_id}")
            self.assertEqual(confirm.outcome, "success")

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.steps_completed, 4)
            self.assertEqual(len(fake_runner.calls), 1)

            validated_bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(validated_bundle)
            self.assertEqual(validated_bundle.validation_state, "passed")
            self.assertIsNotNone(validated_bundle.completion_advisory)
            self.assertEqual(validated_bundle.completion_advisory.commit_readiness_status, "blocked_pending_playtest")
            self.assertTrue(validated_bundle.completion_advisory.playtest_required)
            self.assertIn("human review", validated_bundle.completion_advisory.playtest_reason.lower())
            status = service.execute_local_chat_input(text="/featurestatus")
            self.assertIn("Commit prep:", status.user_message)
            self.assertIn("Included paths:", status.user_message)
            self.assertIn("README status:", status.user_message)
            self.assertIn("Suggested stage:", status.user_message)
            self.assertIn("Suggested commit message:", status.user_message)
            self.assertIn("README guidance:", status.user_message)

    def test_commit_preparation_marks_validated_controller_change_safe_to_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            advisory_bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )

            advisory = advisory_bundle.completion_advisory
            self.assertIsNotNone(advisory)
            self.assertEqual(advisory.commit_readiness_status, "safe_to_commit")
            self.assertEqual(advisory.included_paths, ("app/controller/repo_inspector.py",))
            self.assertEqual(advisory.excluded_paths, ())
            self.assertFalse(advisory.playtest_required)
            self.assertEqual(advisory.readme_status, "clean")

    def test_commit_preparation_blocks_pending_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            advisory = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="applied",
                    validation_state="not_run",
                )
            ).completion_advisory

            self.assertIsNotNone(advisory)
            self.assertEqual(advisory.commit_readiness_status, "blocked_pending_validation")
            self.assertTrue(advisory.playtest_required)
            self.assertIn("validation", advisory.playtest_reason.lower())

    def test_commit_preparation_blocks_pending_playtest_for_user_facing_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/cli/chat_cli.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/cli/chat_cli.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            advisory = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/cli/chat_cli.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="CLI coverage passed.",
                )
            ).completion_advisory

            self.assertIsNotNone(advisory)
            self.assertEqual(advisory.commit_readiness_status, "blocked_pending_playtest")
            self.assertTrue(advisory.playtest_required)
            self.assertIn("human review", advisory.playtest_reason.lower())

    def test_commit_preparation_blocks_interfering_unrelated_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "app/controller/window.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")
            self._write_repo_file(root, "app/controller/window.py", "baseline\nunrelated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            advisory = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            ).completion_advisory

            self.assertIsNotNone(advisory)
            self.assertEqual(advisory.commit_readiness_status, "blocked_by_unrelated_changes")
            self.assertIn("app/controller/window.py", advisory.excluded_paths)
            self.assertIn("overlap", advisory.commit_readiness_reason.lower())

    def test_commit_preparation_excludes_dirty_readme_without_blocking_safe_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._run_git(root, "init")
            self._run_git(root, "config", "user.name", "Test User")
            self._run_git(root, "config", "user.email", "test@example.com")
            self._run_git(root, "add", ".")
            self._run_git(root, "commit", "-m", "Initial feature bundle fixture")
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")
            self._write_repo_file(root, "README.md", "clean readme\nunrelated docs change\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            advisory = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            ).completion_advisory

            self.assertIsNotNone(advisory)
            self.assertEqual(advisory.commit_readiness_status, "safe_to_commit")
            self.assertIn("README.md", advisory.excluded_paths)
            self.assertEqual(advisory.readme_status, "dirty_but_unrelated")
            self.assertIn("keep it out", advisory.readme_guidance)

    def test_dispatch_validate_recover_falls_back_to_local(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            original_resolve = service.resolve_dispatch_target

            def _fake_resolve_dispatch_target(*, selector: str, required_command_label: str, requested_command: str):
                if selector == "validator":
                    return None, "dispatch_role_unavailable", "No enabled validator node can accept /test."
                return original_resolve(selector=selector, required_command_label=required_command_label, requested_command=requested_command)

            service.resolve_dispatch_target = _fake_resolve_dispatch_target  # type: ignore[method-assign]

            created = service.execute_local_chat_input(
                text='/chaincreate --title "recover chain" --objective "dispatch then recover locally" --type dispatch_validate_recover --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 3 --failures 2 --no-progress 2 --target role:validator --fallback local'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]

            service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.steps_completed, 3)
            self.assertEqual(completed.failure_count, 1)

            recorded_steps = service.task_chain_steps(chain.chain_id)
            self.assertEqual(recorded_steps[0].family, "dispatch")
            self.assertEqual(recorded_steps[0].status, "unavailable")
            self.assertEqual(recorded_steps[1].family, "test")
            self.assertEqual(recorded_steps[1].status, "success")

    def test_feature_validate_loop_blocks_without_active_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(
                text='/chaincreate --title "bundle probe" --objective "inspect feature state before validating" --type feature_validate_loop --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 4 --failures 2 --no-progress 1'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]

            service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            blocked = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(blocked)
            self.assertEqual(blocked.status, "blocked")
            self.assertIn("max_no_progress", blocked.stop_reason)
            self.assertEqual(blocked.steps_completed, 1)

    def test_validate_with_fallback_records_supervised_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            def _fake_resolve_dispatch_target(*, selector: str, required_command_label: str, requested_command: str):
                return None, "dispatch_role_unavailable", "No enabled validator node can accept /test."

            service.resolve_dispatch_target = _fake_resolve_dispatch_target  # type: ignore[method-assign]

            created = service.execute_local_chat_input(
                text='/chaincreate --title "v2 fallback" --objective "recover with approved fallback" --type validate_with_fallback --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 3 --failures 3 --no-progress 2 --target role:validator --fallback local'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]

            service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.chain_policy_version, "v2")

            recorded_steps = service.task_chain_steps(chain.chain_id)
            self.assertEqual(recorded_steps[0].family, "dispatch")
            self.assertEqual(recorded_steps[0].matched_rule_id, "validate-primary-fallback")
            self.assertEqual(recorded_steps[1].family, "test")
            self.assertTrue(recorded_steps[1].fallback_used)
            self.assertIn("fallback", recorded_steps[1].decision_summary.lower())

    def test_dispatch_recover_resume_pauses_and_can_resume(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 1, "FAILED\n", "assertion failed"),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            def _fake_resolve_dispatch_target(*, selector: str, required_command_label: str, requested_command: str):
                return None, "dispatch_role_unavailable", "No enabled validator node can accept /test."

            service.resolve_dispatch_target = _fake_resolve_dispatch_target  # type: ignore[method-assign]

            created = service.execute_local_chat_input(
                text='/chaincreate --title "resume chain" --objective "pause and resume recovery" --type dispatch_recover_resume --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 4 --failures 4 --no-progress 3 --target role:validator --fallback local'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]

            service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            paused = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(paused)
            self.assertEqual(paused.status, "paused")
            self.assertTrue(paused.pause_reason)

            decision = service.execute_local_chat_input(text=f"/chaindecision {chain.chain_id}")
            self.assertEqual(decision.outcome, "success")
            self.assertIn("fallback", decision.user_message.lower())

            resumed = service.execute_local_chat_input(text=f"/chainresume {chain.chain_id}")
            self.assertEqual(resumed.outcome, "success")
            finished = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(finished)
            self.assertEqual(finished.status, "completed")
            self.assertEqual(finished.resume_count, 1)

    def test_feature_validate_gate_pauses_until_bundle_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(
                text='/chaincreate --title "gated chain" --objective "wait for feature bundle" --type feature_validate_gate --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 4 --failures 3 --no-progress 2'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]

            service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            paused = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(paused)
            self.assertEqual(paused.status, "paused")
            self.assertIn("feature bundle", paused.pause_reason.lower())

            bundle = FeatureBundleRecord(
                bundle_id="FB-GATE-001",
                feature_request="Add gated validation",
                feature_title="Gated validation",
                intended_outcome="Resume supervised chains once bundle exists",
                bundle_summary="Bundle present for gated chain",
                files=(
                    FeatureBundleFile(
                        relative_path="app/controller/task_chain_runner.py",
                        inclusion_reason="chain runtime",
                        change_summary="add gated resume handling",
                        editable=True,
                        scope_confidence=0.95,
                    ),
                ),
                assumptions=("bundle is local",),
                risk_notes=("bundle could change during resume",),
                validation_plan=FeatureValidationPlan(command_text="/test tests/test_task_chains.py", rationale="verify gated chain"),
                state="applied",
                validation_state="not_run",
                created_at="2026-04-10T10:00:00Z",
                updated_at="2026-04-10T10:00:00Z",
                approval_required=True,
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)

            resumed = service.execute_local_chat_input(text=f"/chainresume {chain.chain_id}")
            self.assertEqual(resumed.outcome, "success")
            finished = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(finished)
            self.assertEqual(finished.status, "completed")


if __name__ == "__main__":
    unittest.main()