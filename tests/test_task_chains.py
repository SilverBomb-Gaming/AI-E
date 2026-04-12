from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.feature_bundle_models import FeatureBundleFile, FeatureBundleRecord, FeatureValidationPlan
from app.controller.pattern_registry import PatternRegistry
from app.controller.repo_task_routing import RepoTaskRouter
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

    @staticmethod
    def _build_coding_feature_bundle_repo(root: Path) -> None:
        source_root = Path(__file__).resolve().parents[1]
        targets = (
            (source_root / "app" / "controller" / "feature_bundle_models.py", root / "app" / "controller" / "feature_bundle_models.py"),
            (source_root / "app" / "controller" / "feature_bundle_formatter.py", root / "app" / "controller" / "feature_bundle_formatter.py"),
            (source_root / "tests" / "test_task_chains.py", root / "tests" / "test_task_chains.py"),
            (source_root / "tests" / "test_cli_chat.py", root / "tests" / "test_cli_chat.py"),
        )
        for source_path, destination_path in targets:
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            destination_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")

    @staticmethod
    def _build_autonomous_dev_bundle_repo(root: Path) -> None:
        source_root = Path(__file__).resolve().parents[1]
        targets = (
            (source_root / "app" / "controller" / "autonomous_dev_models.py", root / "app" / "controller" / "autonomous_dev_models.py"),
            (source_root / "app" / "controller" / "feature_bundle_models.py", root / "app" / "controller" / "feature_bundle_models.py"),
            (source_root / "app" / "controller" / "feature_bundle_formatter.py", root / "app" / "controller" / "feature_bundle_formatter.py"),
            (source_root / "tests" / "test_task_chains.py", root / "tests" / "test_task_chains.py"),
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

    def _create_bare_remote(self, root: Path, name: str = "origin") -> Path:
        remote_root = root.parent / f"{name}.git"
        subprocess.run(
            ["git", "init", "--bare", str(remote_root)],
            capture_output=True,
            text=True,
            check=True,
        )
        self._run_git(root, "remote", "add", name, str(remote_root))
        return remote_root

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

    def test_bounded_coding_request_becomes_structured_bundle_proposal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_coding_feature_bundle_repo(root)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            planned = service.execute_local_chat_input(
                text="Add a helper that formats feature bundle commit summaries and update the related tests."
            )

            self.assertEqual(planned.outcome, "success")
            bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(bundle)
            self.assertIsNotNone(bundle.coding_task_plan)
            self.assertEqual(bundle.coding_task_plan.task_type, "formatter_output_update")
            self.assertEqual(bundle.coding_task_plan.status, "proposal_ready")
            self.assertEqual(
                bundle.coding_task_plan.target_files,
                (
                    "app/controller/feature_bundle_models.py",
                    "app/controller/feature_bundle_formatter.py",
                    "tests/test_task_chains.py",
                    "tests/test_cli_chat.py",
                ),
            )
            self.assertEqual(bundle.coding_task_plan.task_category, "helper_extraction")
            self.assertEqual(bundle.coding_task_plan.validation_command, "python -m pytest tests/test_task_chains.py tests/test_cli_chat.py")
            self.assertFalse(bundle.coding_task_plan.playtest_required)
            self.assertEqual(bundle.coding_task_plan.module_clusters, ("bundle_cluster", "test_cluster"))
            self.assertEqual(bundle.coding_task_plan.scope_type, "multi_cluster")
            self.assertEqual(bundle.coding_task_plan.risk_level, "medium")
            self.assertEqual(bundle.coding_task_plan.confidence, "high")
            self.assertEqual(bundle.coding_task_plan.pattern_used, "commit_summary_helper_v1")
            self.assertEqual(bundle.coding_task_plan.pattern_confidence, "high")
            self.assertIn("Reused commit_summary_helper_v1", bundle.coding_task_plan.pattern_summary)
            self.assertEqual(
                tuple(item.cluster_id for item in bundle.coding_task_plan.cluster_plans),
                ("bundle_cluster", "test_cluster"),
            )
            self.assertEqual(bundle.coding_task_plan.impact_analysis.upstream, ("app/controller/feature_bundle_models.py",))
            self.assertEqual(bundle.coding_task_plan.impact_analysis.downstream, ("app/controller/feature_bundle_formatter.py",))
            self.assertEqual(
                bundle.coding_task_plan.impact_analysis.tests,
                ("tests/test_task_chains.py", "tests/test_cli_chat.py"),
            )
            self.assertEqual(
                bundle.coding_task_plan.impact_analysis.interaction_points,
                ("bundle model -> formatter -> tests",),
            )
            self.assertIn("tests/test_cli_chat.py", bundle.coding_task_plan.expansion_summary)
            self.assertEqual(len(bundle.coding_task_plan.file_plans), 4)
            self.assertIn("Coding plan:", planned.user_message)
            self.assertIn("formatter_output_update", planned.user_message)
            self.assertIn("Scope: multi_cluster", planned.user_message)
            self.assertIn("Risk: medium", planned.user_message)
            self.assertIn("Category: helper_extraction", planned.user_message)
            self.assertIn("Confidence: high", planned.user_message)
            self.assertIn("Pattern: commit_summary_helper_v1", planned.user_message)
            self.assertIn("Pattern confidence: high", planned.user_message)
            self.assertIn("Clusters: bundle_cluster, test_cluster", planned.user_message)
            self.assertIn("Cluster reasoning:", planned.user_message)
            self.assertIn("Impact tests: tests/test_task_chains.py, tests/test_cli_chat.py", planned.user_message)
            self.assertIn("Interaction points: bundle model -> formatter -> tests", planned.user_message)
            self.assertIn("feature_bundle_formatter.py", planned.user_message)
            self.assertIn("Extract commit summary line formatting", planned.user_message)

    def test_bounded_coding_request_clarifies_instead_of_guessing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_coding_feature_bundle_repo(root)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            clarification = service.execute_local_chat_input(text="Update the bundle logic.")

            self.assertEqual(clarification.outcome, "success")
            self.assertEqual(clarification.outcome_reason_code, "needs_clarification")
            self.assertIn("Which bundle behavior should be updated", clarification.user_message)
            self.assertIsNone(service.active_feature_bundle_for_chat(chat_id="local-cli"))

    def test_capability_wiring_request_clarifies_with_bounded_module_cluster(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            clarification = service.execute_local_chat_input(
                text="Add a new bounded controller capability and wire it through grammar, registry, executor, and tests."
            )

            self.assertEqual(clarification.outcome, "success")
            self.assertEqual(clarification.outcome_reason_code, "needs_clarification")
            self.assertIn("capability cluster", clarification.user_message)
            self.assertIn("command_grammar.py", clarification.user_message)
            self.assertIn("capability_registry.py", clarification.user_message)
            self.assertIn("capability_executor.py", clarification.user_message)
            self.assertIn("full cluster", clarification.user_message.lower())
            self.assertIn("what command or capability name should be wired", clarification.user_message.lower())
            self.assertIsNone(service.active_feature_bundle_for_chat(chat_id="local-cli"))

    def test_autonomous_dev_refactor_request_becomes_structured_bundle_proposal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_autonomous_dev_bundle_repo(root)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            planned = service.execute_local_chat_input(
                text="Refactor the autonomous dev loop step formatting into a helper and keep the task-chain and CLI tests aligned."
            )

            self.assertEqual(planned.outcome, "success")
            bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(bundle)
            self.assertIsNotNone(bundle.coding_task_plan)
            self.assertEqual(bundle.coding_task_plan.task_type, "bounded_refactor")
            self.assertEqual(bundle.coding_task_plan.task_category, "autonomous_dev_loop_refactor")
            self.assertEqual(
                bundle.coding_task_plan.target_files,
                (
                    "app/controller/autonomous_dev_models.py",
                    "app/controller/feature_bundle_models.py",
                    "app/controller/feature_bundle_formatter.py",
                    "tests/test_task_chains.py",
                    "tests/test_cli_chat.py",
                ),
            )
            self.assertEqual(
                bundle.coding_task_plan.validation_command,
                "python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            )
            self.assertEqual(
                bundle.coding_task_plan.affected_tests,
                ("tests/test_task_chains.py", "tests/test_cli_chat.py"),
            )
            self.assertEqual(
                bundle.coding_task_plan.module_clusters,
                ("autonomous_dev_cluster", "bundle_cluster", "test_cluster"),
            )
            self.assertEqual(bundle.coding_task_plan.scope_type, "multi_cluster")
            self.assertEqual(bundle.coding_task_plan.risk_level, "medium")
            self.assertEqual(bundle.coding_task_plan.confidence, "high")
            self.assertEqual(bundle.coding_task_plan.pattern_used, "autonomous_dev_formatter_refactor_v1")
            self.assertEqual(bundle.coding_task_plan.pattern_confidence, "high")
            self.assertIn("feature_bundle_models.py", bundle.coding_task_plan.expansion_summary)
            self.assertIn("bounded_refactor", planned.user_message)
            self.assertIn("autonomous_dev_loop_refactor", planned.user_message)
            self.assertIn("Scope: multi_cluster", planned.user_message)
            self.assertIn("Risk: medium", planned.user_message)
            self.assertIn("Pattern: autonomous_dev_formatter_refactor_v1", planned.user_message)
            self.assertIn("feature_bundle_formatter.py", planned.user_message)
            self.assertIn("tests/test_cli_chat.py", planned.user_message)
            self.assertIn("Impact upstream: app/controller/autonomous_dev_models.py, app/controller/feature_bundle_models.py", planned.user_message)
            self.assertIn("Interaction points:", planned.user_message)



    def test_pattern_registry_matches_known_capability_wiring_family(self) -> None:
        registry = PatternRegistry()

        match = registry.match("Add a new capability for feature bundling")

        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.pattern.pattern_id, "capability_wiring_v1")
        self.assertEqual(match.pattern.cluster_ids, ("capability_cluster", "test_cluster"))
        self.assertEqual(match.confidence, "medium")

    def test_execution_flow_refactor_clarifies_with_execution_cluster(self) -> None:
        router = RepoTaskRouter()

        route = router.plan("Refactor execution flow")

        self.assertEqual(route.kind, "needs_clarification")
        self.assertEqual(route.task_category, "execution_flow_refactor")
        self.assertEqual(route.cluster_ids, ("execution_cluster", "bundle_cluster", "test_cluster"))
        self.assertEqual(route.scope_type, "multi_cluster")
        self.assertEqual(route.risk_level, "medium")
        self.assertEqual(route.pattern_used, "execution_output_formatting_v1")
        self.assertEqual(route.pattern_confidence, "high")
        self.assertEqual(route.confidence, "medium")
        self.assertEqual(route.impact_analysis.upstream, ("app/controller/app_service.py", "app/controller/feature_bundle_models.py"))
        self.assertIn("execution output -> bundle formatter", route.impact_analysis.interaction_points)
        self.assertIn("execution cluster", route.clarification_question)
        self.assertIn("app/controller/task_execution_conversation.py", route.clarification_question)

    def test_commit_summary_route_expands_partial_cluster_deterministically(self) -> None:
        router = RepoTaskRouter()

        route = router.plan("Add a helper that formats feature bundle commit summaries and update the related tests.")

        self.assertEqual(route.kind, "proposal_ready")
        self.assertEqual(route.cluster_ids, ("bundle_cluster", "test_cluster"))
        self.assertEqual(route.scope_type, "multi_cluster")
        self.assertEqual(route.risk_level, "medium")
        self.assertEqual(route.pattern_used, "commit_summary_helper_v1")
        self.assertEqual(route.pattern_confidence, "high")
        self.assertEqual(route.confidence, "high")
        self.assertEqual(
            tuple(item.relative_path for item in route.files),
            (
                "app/controller/feature_bundle_models.py",
                "app/controller/feature_bundle_formatter.py",
                "tests/test_task_chains.py",
                "tests/test_cli_chat.py",
            ),
        )
        self.assertIn("tests/test_cli_chat.py", route.expansion_summary)
        self.assertEqual(route.impact_analysis.tests, ("tests/test_task_chains.py", "tests/test_cli_chat.py"))
        self.assertEqual(route.impact_analysis.interaction_points, ("bundle model -> formatter -> tests",))

    def test_execution_output_formatting_route_creates_multi_cluster_proposal(self) -> None:
        router = RepoTaskRouter()

        route = router.plan("Update execution output formatting")

        self.assertEqual(route.kind, "proposal_ready")
        self.assertEqual(route.task_type, "formatter_model_executor_alignment")
        self.assertEqual(route.scope_type, "multi_cluster")
        self.assertEqual(route.risk_level, "medium")
        self.assertEqual(route.cluster_ids, ("execution_cluster", "bundle_cluster", "test_cluster"))
        self.assertEqual(
            tuple(item.cluster_id for item in route.cluster_reasons),
            ("execution_cluster", "bundle_cluster", "test_cluster"),
        )
        self.assertIn("execution output -> bundle formatter", route.impact_analysis.interaction_points)
        self.assertIn("bundle model -> formatter -> tests", route.impact_analysis.interaction_points)
        self.assertEqual(
            tuple(item.relative_path for item in route.files),
            (
                "app/controller/app_service.py",
                "app/controller/task_execution_conversation.py",
                "app/controller/multi_file_feature_planner.py",
                "app/controller/feature_bundle_models.py",
                "app/controller/feature_bundle_formatter.py",
                "tests/test_task_chains.py",
                "tests/test_cli_chat.py",
            ),
        )


    def test_capability_wiring_pattern_reuses_known_structure_for_similar_prompt(self) -> None:
        router = RepoTaskRouter()

        route = router.plan("Add a new capability for feature bundling")

        self.assertEqual(route.kind, "needs_clarification")
        self.assertEqual(route.pattern_used, "capability_wiring_v1")
        self.assertEqual(route.pattern_confidence, "medium")
        self.assertEqual(route.cluster_ids, ("capability_cluster", "test_cluster"))
        self.assertIn("What command or capability name should be wired?", route.clarification_question)

    def test_wide_scope_request_is_blocked_with_high_risk_clarification(self) -> None:
        router = RepoTaskRouter()

        route = router.plan("Refactor the entire system")

        self.assertEqual(route.kind, "needs_clarification")
        self.assertEqual(route.scope_type, "ambiguous")
        self.assertEqual(route.risk_level, "high")
        self.assertEqual(
            route.cluster_ids,
            ("capability_cluster", "execution_cluster", "bundle_cluster", "autonomous_dev_cluster", "test_cluster"),
        )
        self.assertIn("too broad", route.clarification_question.lower())

    def test_dev_loop_refactor_clarifies_scope_instead_of_guessing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            clarification = service.execute_local_chat_input(text="Refactor the dev loop.")

            self.assertEqual(clarification.outcome, "success")
            self.assertEqual(clarification.outcome_reason_code, "needs_clarification")
            self.assertIn("autonomous dev cluster", clarification.user_message)
            self.assertIn("align the full loop output and tests", clarification.user_message)
            self.assertIn("focused task-chain and CLI tests", clarification.user_message)

    def test_bounded_coding_bundle_apply_flow_reuses_existing_feature_bundle_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_coding_feature_bundle_repo(root)
            self._initialize_clean_git_repo(root)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            planned = service.execute_local_chat_input(
                text="Add a helper that formats feature bundle commit summaries and update the related tests."
            )
            self.assertEqual(planned.outcome, "success")
            bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(bundle)
            self.assertEqual(bundle.state, "proposed")

            apply_request = service.execute_local_chat_input(text="apply it")
            self.assertEqual(apply_request.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            apply_result = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertEqual(apply_result.outcome, "success")

            updated_formatter = (root / "app" / "controller" / "feature_bundle_formatter.py").read_text(encoding="utf-8")
            updated_tests = (root / "tests" / "test_task_chains.py").read_text(encoding="utf-8")
            self.assertIn("def _commit_summary_lines", updated_formatter)
            self.assertIn("Commit prep reason:", updated_tests)

    def test_autonomous_dev_refactor_bundle_apply_flow_reuses_existing_feature_bundle_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_autonomous_dev_bundle_repo(root)
            self._initialize_clean_git_repo(root)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            planned = service.execute_local_chat_input(
                text="Refactor the autonomous dev loop step formatting into a helper and keep the task-chain and CLI tests aligned."
            )
            self.assertEqual(planned.outcome, "success")
            bundle = service.active_feature_bundle_for_chat(chat_id="local-cli")
            self.assertIsNotNone(bundle)
            self.assertEqual(bundle.state, "proposed")

            apply_request = service.execute_local_chat_input(text="apply it")
            self.assertEqual(apply_request.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            apply_result = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertEqual(apply_result.outcome, "success")

            updated_formatter = (root / "app" / "controller" / "feature_bundle_formatter.py").read_text(encoding="utf-8")
            self.assertIn("def _autonomous_dev_step_lines", updated_formatter)

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

    def test_feature_commit_preview_reports_safe_package(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)

            preview = service.execute_local_chat_input(text="/featurecommit")

            self.assertEqual(preview.outcome, "success")
            self.assertEqual(preview.telemetry.get("feature_bundle_action"), "commit_preview")
            self.assertIn("[FEATURE COMMIT]", preview.user_message)
            self.assertIn("Commit readiness: safe_to_commit", preview.user_message)
            self.assertIn("Commit message:", preview.user_message)
            self.assertIn("Included paths: app/controller/repo_inspector.py", preview.user_message)

    def test_feature_commit_execute_blocks_when_bundle_not_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="applied",
                    validation_state="not_run",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)

            blocked = service.execute_local_chat_input(text="/featurecommit execute")

            self.assertEqual(blocked.outcome, "invalid_request")
            self.assertEqual(blocked.outcome_reason_code, "feature_commit_not_ready")
            self.assertIn("Commit execution is blocked", blocked.user_message)

    def test_feature_commit_execute_creates_bounded_commit_after_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")
            self._write_repo_file(root, "README.md", "clean readme\nunrelated docs change\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)

            request = service.execute_local_chat_input(text="/featurecommit execute")

            self.assertEqual(request.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            confirm = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            self.assertEqual(confirm.outcome, "success")
            self.assertIn("Push: not performed in v1.", confirm.user_message)
            self.assertIn("app/controller/repo_inspector.py", confirm.user_message)
            self.assertIsNone(service.active_feature_bundle_for_chat(chat_id="local-cli"))
            log = self._run_git(root, "log", "--oneline", "-n", "1")
            self.assertIn("Complete bounded feature bundle: Test bundle", log.stdout)
            status = self._run_git(root, "status", "--short")
            self.assertIn(" README.md", status.stdout)
            self.assertNotIn("app/controller/repo_inspector.py", status.stdout)

    def test_feature_commit_execute_detects_scope_drift_before_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)

            request = service.execute_local_chat_input(text="/featurecommit execute")
            self.assertEqual(request.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated again\n")
            confirm = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            self.assertEqual(confirm.outcome, "failed")
            self.assertEqual(confirm.outcome_reason_code, "feature_commit_scope_drifted")
            self.assertIn("refresh the bounded commit package", confirm.user_message)
            log = self._run_git(root, "log", "--oneline", "-n", "1")
            self.assertNotIn("Complete bounded feature bundle: Test bundle", log.stdout)

    def test_feature_push_preview_reports_ready_branch_and_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)
            self._create_bare_remote(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)
            commit_request = service.execute_local_chat_input(text="/featurecommit execute")
            self.assertEqual(commit_request.outcome, "confirmation_required")
            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(commit_confirmation)
            commit_result = service.execute_local_chat_input(text=f"/confirm {commit_confirmation.confirmation_id}")
            self.assertEqual(commit_result.outcome, "success")

            preview = service.execute_local_chat_input(text="/featurepush")

            self.assertEqual(preview.outcome, "success")
            self.assertEqual(preview.telemetry.get("feature_bundle_action"), "push_preview")
            self.assertIn("[FEATURE PUSH]", preview.user_message)
            self.assertIn("Status: ready_to_push", preview.user_message)
            self.assertIn("Remote: origin", preview.user_message)
            self.assertIn("Action: git push -u origin", preview.user_message)

    def test_feature_push_execute_blocks_without_commit_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)
            self._create_bare_remote(root)

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            blocked = service.execute_local_chat_input(text="/featurepush execute")

            self.assertEqual(blocked.outcome, "invalid_request")
            self.assertEqual(blocked.outcome_reason_code, "feature_push_not_ready")
            self.assertIn("No new commit to push", blocked.user_message)

    def test_feature_push_preview_blocks_on_detached_head(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)
            self._create_bare_remote(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)
            commit_request = service.execute_local_chat_input(text="/featurecommit execute")
            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertEqual(commit_request.outcome, "confirmation_required")
            self.assertIsNotNone(commit_confirmation)
            self.assertEqual(service.execute_local_chat_input(text=f"/confirm {commit_confirmation.confirmation_id}").outcome, "success")
            self._run_git(root, "checkout", "HEAD~0")

            preview = service.execute_local_chat_input(text="/featurepush")

            self.assertEqual(preview.outcome, "success")
            self.assertIn("Status: blocked", preview.user_message)
            self.assertIn("Detached HEAD", preview.user_message)

    def test_feature_push_execute_pushes_only_after_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)
            remote_root = self._create_bare_remote(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)
            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertEqual(service.execute_local_chat_input(text="/featurecommit execute").outcome, "confirmation_required")
            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(commit_confirmation)
            self.assertEqual(service.execute_local_chat_input(text=f"/confirm {commit_confirmation.confirmation_id}").outcome, "success")

            push_request = service.execute_local_chat_input(text="/featurepush execute")

            self.assertEqual(push_request.outcome, "confirmation_required")
            push_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(push_confirmation)

            confirm = service.execute_local_chat_input(text=f"/confirm {push_confirmation.confirmation_id}")

            self.assertEqual(confirm.outcome, "success")
            self.assertIn("Remote: origin", confirm.user_message)
            branch = self._run_git(root, "branch", "--show-current").stdout.strip()
            remote_head = subprocess.run(
                ["git", "--git-dir", str(remote_root), "rev-parse", f"refs/heads/{branch}"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            local_head = self._run_git(root, "rev-parse", "HEAD").stdout.strip()
            self.assertEqual(remote_head, local_head)

    def test_feature_push_execute_detects_repo_drift_before_push(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)
            self._create_bare_remote(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
                    validation_summary="Repo inspector coverage passed.",
                )
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)
            self.assertEqual(service.execute_local_chat_input(text="/featurecommit execute").outcome, "confirmation_required")
            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(commit_confirmation)
            self.assertEqual(service.execute_local_chat_input(text=f"/confirm {commit_confirmation.confirmation_id}").outcome, "success")

            push_request = service.execute_local_chat_input(text="/featurepush execute")
            self.assertEqual(push_request.outcome, "confirmation_required")
            push_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(push_confirmation)

            self._write_repo_file(root, "new_drift.txt", "drift\n")
            confirm = service.execute_local_chat_input(text=f"/confirm {push_confirmation.confirmation_id}")

            self.assertEqual(confirm.outcome, "failed")
            self.assertEqual(confirm.outcome_reason_code, "feature_push_drifted")
            self.assertIn("refresh the bounded push package", confirm.user_message)

    def test_feature_pr_preview_reports_summary_after_push(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._write_repo_file(root, "README.md", "clean readme\n")
            self._initialize_clean_git_repo(root)
            self._create_bare_remote(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
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

            preview = service.execute_local_chat_input(text="/featurepr")

            self.assertEqual(preview.outcome, "success")
            self.assertEqual(preview.telemetry.get("feature_bundle_action"), "pr_preview")
            self.assertIn("[FEATURE PR]", preview.user_message)
            self.assertIn("Merge readiness: ready_for_review", preview.user_message)
            self.assertIn("Validation summary: Repo inspector coverage passed.", preview.user_message)
            self.assertIn("Changed paths: app/controller/repo_inspector.py", preview.user_message)

    def test_autonomous_dev_chain_runs_full_supervised_workflow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_coding_feature_bundle_repo(root)
            self._initialize_git_repo(root)
            self._create_bare_remote(root)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "pytest", "tests/test_task_chains.py"],
                    0,
                    "1 passed\n",
                    "",
                ),
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(
                text="Add a helper that formats feature bundle commit summaries and update the related tests, then finish the workflow"
            )

            self.assertEqual(created.outcome, "confirmation_required")
            self.assertTrue(created.telemetry.get("autonomous_dev_chain"))
            self.assertIn("[AUTONOMOUS DEV LOOP]", created.user_message)
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.status, "awaiting_confirmation")
            self.assertEqual(chain.current_step, "feature_apply")

            apply_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(apply_confirmation)
            apply_result = service.execute_local_chat_input(text=f"/confirm {apply_confirmation.confirmation_id}")

            self.assertEqual(apply_result.outcome, "success")
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.status, "chain_ready")
            self.assertEqual(chain.current_step, "validation")

            commit_boundary = service.execute_local_chat_input(text="/devchain resume")

            self.assertEqual(commit_boundary.outcome, "confirmation_required")
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.status, "awaiting_confirmation")
            self.assertEqual(chain.current_step, "commit_execute")
            self.assertEqual(len(fake_runner.calls), 1)

            commit_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(commit_confirmation)
            commit_result = service.execute_local_chat_input(text=f"/confirm {commit_confirmation.confirmation_id}")

            self.assertEqual(commit_result.outcome, "success")
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.current_step, "push_execute")

            push_boundary = service.execute_local_chat_input(text="/devchain resume")

            self.assertEqual(push_boundary.outcome, "confirmation_required")
            push_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(push_confirmation)
            push_result = service.execute_local_chat_input(text=f"/confirm {push_confirmation.confirmation_id}")

            self.assertEqual(push_result.outcome, "success")
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.current_step, "pr_preview")

            completed = service.execute_local_chat_input(text="/devchain resume")

            self.assertEqual(completed.outcome, "success")
            self.assertIn("[FEATURE PR]", completed.user_message)
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.status, "completed")
            self.assertEqual(chain.current_step, "pr_preview")
            self.assertTrue(chain.latest_pr_title)

    def test_autonomous_dev_chain_blocks_on_validation_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._build_feature_bundle_repo(root)
            self._initialize_git_repo(root)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    1,
                    "",
                    "validation failed\n",
                ),
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(
                text="show feature bundle id in the cli debug output then finish the workflow"
            )
            self.assertEqual(created.outcome, "confirmation_required")

            apply_confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(apply_confirmation)
            self.assertEqual(
                service.execute_local_chat_input(text=f"/confirm {apply_confirmation.confirmation_id}").outcome,
                "success",
            )

            blocked = service.execute_local_chat_input(text="/devchain resume")

            self.assertEqual(blocked.outcome, "success")
            self.assertIn("Status: blocked", blocked.user_message)
            chain = service.active_autonomous_dev_chain_for_chat(chat_id="local-cli")
            self.assertIsNotNone(chain)
            self.assertEqual(chain.status, "blocked")
            self.assertEqual(chain.current_step, "validation")
            self.assertIn("validation failed", chain.blocked_reason)
            self.assertEqual(len(fake_runner.calls), 1)

    def test_conversational_dev_reply_explains_active_bundle_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            service.set_active_feature_bundle(
                chat_id="local-cli",
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="proposed",
                    validation_state="not_run",
                ),
            )

            reply = service.execute_local_chat_input(text="What are we about to change?")

            self.assertEqual(reply.outcome, "success")
            self.assertTrue(reply.telemetry.get("conversational_dev_layer"))
            self.assertIn("About to change: Test bundle.", reply.user_message)
            self.assertIn("Files: app/controller/repo_inspector.py", reply.user_message)

    def test_conversational_dev_reply_summarizes_pr_and_merge_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\n")
            self._initialize_clean_git_repo(root)
            self._create_bare_remote(root)
            self._write_repo_file(root, "app/controller/repo_inspector.py", "baseline\nupdated\n")

            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            bundle = service.attach_feature_bundle_completion_advisory(
                bundle=self._make_bundle(
                    path="app/controller/repo_inspector.py",
                    state="validated",
                    validation_state="passed",
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

            pr_reply = service.execute_local_chat_input(text="What would this PR say?")
            merge_reply = service.execute_local_chat_input(text="What still needs to happen before merge?")

            self.assertEqual(pr_reply.outcome, "success")
            self.assertTrue(pr_reply.telemetry.get("conversational_dev_layer"))
            self.assertIn("PR title:", pr_reply.user_message)
            self.assertIn("PR summary:", pr_reply.user_message)
            self.assertEqual(merge_reply.outcome, "success")
            self.assertIn("Merge readiness: ready_for_review", merge_reply.user_message)

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