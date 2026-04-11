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