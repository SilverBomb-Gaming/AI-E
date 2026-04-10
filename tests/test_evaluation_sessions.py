from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report, _wait_until


class EvaluationSessionTests(unittest.TestCase):
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

    def test_eval_session_runs_three_times_and_reports_completion(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            created = service.execute_local_chat_input(
                text='/evalcreate --title "smoke" --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --runs 3 --interval 0 --failures 3'
            )
            self.assertEqual(created.outcome, "success")
            session = service.list_evaluation_sessions()[0]

            start = service.execute_local_chat_input(text=f"/evalstart {session.session_id}")
            self.assertEqual(start.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)

            confirm = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertEqual(confirm.outcome, "success")

            completed = service.await_evaluation_session(session.session_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.runs_completed, 3)
            self.assertEqual(completed.regression_count, 0)
            self.assertIn("No regressions detected", completed.final_summary)
            self.assertEqual(len(fake_runner.calls), 3)

            status = service.execute_local_chat_input(text=f"/evalstatus {session.session_id}")
            runs = service.execute_local_chat_input(text=f"/evalruns {session.session_id} 3")

            self.assertIn("Runs completed: 3/3", status.user_message)
            self.assertIn("No regressions detected", status.user_message)
            self.assertIn("Run 3", runs.user_message)

    def test_eval_session_detects_regression_and_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 1, "Ran 1 test in 0.02s\n\nFAILED (failures=1)\n", "AssertionError\n"),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(
                text='/evalcreate --title "regression" --command "/test tests.test_execution_capability.ExecutionCapabilityTests.test_run_timeout_is_reported_concisely" --runs 3 --interval 0 --failures 3'
            )
            session = service.list_evaluation_sessions()[0]
            service.execute_local_chat_input(text=f"/evalstart {session.session_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            completed = service.await_evaluation_session(session.session_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.regression_count, 1)
            self.assertEqual(completed.recovery_count, 1)

            runs = service.evaluation_runs_for_session(session.session_id)
            self.assertEqual(runs[1].comparison_kind, "regression")
            self.assertEqual(runs[2].comparison_kind, "recovery")

    def test_eval_session_can_be_stopped_by_operator(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(
                text='/evalcreate --title "stop-me" --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --runs 5 --interval 1 --failures 5'
            )
            session = service.list_evaluation_sessions()[0]
            service.execute_local_chat_input(text=f"/evalstart {session.session_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            self.assertTrue(_wait_until(lambda: (service.get_evaluation_session(session.session_id) or session).runs_completed >= 1, timeout=2.0))
            mid_status = service.execute_local_chat_input(text=f"/evalstatus {session.session_id}")
            stop = service.execute_local_chat_input(text=f"/evalstop {session.session_id}")
            final = service.await_evaluation_session(session.session_id, timeout_seconds=2.0)

            self.assertIn("Runs completed:", mid_status.user_message)
            self.assertEqual(stop.outcome, "success")
            self.assertIsNotNone(final)
            self.assertEqual(final.status, "stopped")
            self.assertIn("Stopped by operator", final.stop_reason)


if __name__ == "__main__":
    unittest.main()