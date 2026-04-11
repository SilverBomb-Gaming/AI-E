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


class ProductionOrchestrationTests(unittest.TestCase):
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

    def test_plain_text_status_uses_production_context_after_setup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "vertical slice"')
            service.execute_local_chat_input(text='Shift priority to gameplay systems.')

            result = service.execute_local_chat_input(text="Where are we at?")

            self.assertEqual(result.outcome, "success")
            self.assertIn("[PRODUCTION]", result.user_message)
            self.assertIn("AI-E Production | unity | vertical slice", result.user_message)
            self.assertEqual(result.telemetry.get("routed_capability_id"), "production.read")

    def test_plain_text_pause_and_resume_validation_effort_are_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", ""),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "validation"')
            created = service.execute_local_chat_input(
                text='/evalcreate --title "validation smoke" --purpose "validation loop" --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --runs 5 --interval 1 --failures 5'
            )
            self.assertEqual(created.outcome, "success")
            session = service.list_evaluation_sessions()[0]
            started = service.execute_local_chat_input(text=f"/evalstart {session.session_id}")
            self.assertEqual(started.outcome, "confirmation_required")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertTrue(_wait_until(lambda: (service.get_evaluation_session(session.session_id) or session).runs_completed >= 1, timeout=2.0))

            paused = service.execute_local_chat_input(text="Pause the current validation effort.")

            self.assertEqual(paused.outcome, "success")
            self.assertIn("Paused the current validation effort.", paused.user_message)
            self.assertTrue(_wait_until(lambda: (service.get_evaluation_session(session.session_id) or session).status == "stopped", timeout=2.0))

            resumed = service.execute_local_chat_input(text="Resume it.")

            self.assertEqual(resumed.outcome, "success")
            self.assertIn("Resumed validation work.", resumed.user_message)
            self.assertTrue(
                _wait_until(
                    lambda: (service.get_evaluation_session(session.session_id) or session).status in {"running", "completed"},
                    timeout=2.0,
                )
            )
            service.shutdown()

    def test_follow_up_what_changed_uses_recent_production_memory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            shifted = service.execute_local_chat_input(text="Shift priority to gameplay systems.")
            changed = service.execute_local_chat_input(text="What changed?")

            self.assertEqual(shifted.outcome, "success")
            self.assertEqual(changed.outcome, "success")
            self.assertIn("[RECENT CHANGES]", changed.user_message)
            self.assertIn("Shifted production focus to gameplay systems", changed.user_message)
            self.assertEqual(changed.telemetry.get("routed_capability_id"), "production.read")

    def test_mobile_update_is_short_and_captured_in_data_substrate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            service.execute_local_chat_input(text='Shift priority to gameplay systems.')

            result = service.execute_local_chat_input(text="Quick mobile update.")

            self.assertEqual(result.outcome, "success")
            self.assertLessEqual(len(result.user_message.splitlines()), 8)
            self.assertIn("[MOBILE] AI-E Production", result.user_message)
            records = service.list_data_records(limit=10)
            mobile_record = next(
                record
                for record in records
                if record.command_label == "plain_text"
                and record.result_payload.get("telemetry", {}).get("routed_capability_id") == "production.read"
            )
            telemetry = mobile_record.result_payload.get("telemetry", {})
            self.assertTrue(telemetry.get("production_conversation"))
            self.assertEqual(telemetry.get("routed_capability_id"), "production.read")

    def test_node_summary_uses_human_readable_work_descriptions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            service.execute_local_chat_input(text="Shift priority to gameplay systems.")
            service.execute_local_chat_input(text="What changed?")
            service.execute_local_chat_input(text="Continue that.")

            result = service.execute_local_chat_input(text="Which nodes are busy right now?")

            self.assertEqual(result.outcome, "success")
            self.assertIn("Work:", result.user_message)
            self.assertIn("Work: idle", result.user_message)
            self.assertNotIn("recognized production intent", result.user_message)
            self.assertNotIn("routed to", result.user_message)

    def test_continue_that_does_not_resume_nonexistent_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            service.execute_local_chat_input(text="Shift priority to gameplay systems.")

            result = service.execute_local_chat_input(text="Continue that.")

            self.assertEqual(result.outcome, "success")
            self.assertIn("priority shift", result.user_message)

    def test_resume_it_requires_real_paused_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            service.execute_local_chat_input(text="Quick mobile update.")

            result = service.execute_local_chat_input(text="Resume it.")

            self.assertEqual(result.outcome, "success")
            self.assertIn("There is no paused validation or chain to resume right now.", result.user_message)

    def test_repeated_priority_shift_does_not_duplicate_recent_change_noise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            service.execute_local_chat_input(text="Shift priority to gameplay systems.")
            service.execute_local_chat_input(text="Shift priority to gameplay systems.")

            result = service.execute_local_chat_input(text="What changed?")

            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.user_message.count("Shifted production focus to gameplay systems."), 1)

    def test_follow_up_assignment_without_recent_reference_requests_clarification(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "slice"')
            result = service.execute_local_chat_input(text="Move it to another node.")

            self.assertEqual(result.outcome, "success")
            self.assertIn("recently discussed priority", result.user_message)
            self.assertTrue(result.telemetry.get("production_clarification"))

    def test_slash_command_backstops_cover_project_priority_assignment_and_mobile_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            project = service.execute_local_chat_input(text='/prodproject --title "AI-E Production" --engine unity --milestone "vertical slice"')
            priority = service.execute_local_chat_input(text='/prodpriority --title "gameplay systems" --category gameplay')
            assign = service.execute_local_chat_input(text='/prodassign --target validator --category qa_validation --title "latest gameplay changes"')
            status = service.execute_local_chat_input(text='/prodstatus nodes')
            mobile = service.execute_local_chat_input(text='/prodmobile')

            self.assertEqual(project.outcome, "success")
            self.assertEqual(priority.outcome, "success")
            self.assertEqual(assign.outcome, "success")
            self.assertEqual(status.outcome, "success")
            self.assertEqual(mobile.outcome, "success")
            self.assertIn("Production project set to AI-E Production.", project.user_message)
            self.assertIn("Updated production priority to gameplay systems.", priority.user_message)
            self.assertIn("Assigned", assign.user_message)
            self.assertIn("[NODE STATUS]", status.user_message)
            self.assertIn("[MOBILE] AI-E Production", mobile.user_message)


if __name__ == "__main__":
    unittest.main()