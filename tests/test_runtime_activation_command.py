from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage
from app.platform.secrets import InMemorySecretStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _item,
    _report,
    _wait_until,
)


class RuntimeActivationCommandTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, _FakeTelegramService]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        ollama = _FakeOllamaAdapter()
        openai = _FakeOpenAIAdapter()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="stopped"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": ollama, "openai": openai},
            telegram_service=tg,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, tg

    @staticmethod
    def _configure_scopes(
        *,
        service: ControllerService,
        config_store: ControllerConfigStore,
        repo_root: Path,
    ) -> None:
        config = config_store.load()
        config.repo_root = str(repo_root.resolve())
        config.file_allowed_roots = (str(repo_root.resolve()),)
        config_store.save(config)
        service._config = config_store.load()

    @staticmethod
    def _run_until(service: ControllerService, telegram_service: _FakeTelegramService, expected_messages: int) -> None:
        service.start_telegram_loop()
        assert _wait_until(lambda: len(telegram_service.sent_messages) == expected_messages, timeout=2.0)
        service.stop_telegram_loop()

    def test_startruntime_enables_runtime_and_is_idempotent(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=900, chat_id="chat-1", text="/startruntime", sender_label="@tester"),
            TelegramInboundMessage(update_id=901, chat_id="chat-1", text="/startruntime", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            initial = service.snapshot()
            self.assertFalse(initial.runtime_active)
            self.assertEqual(initial.readiness_state, "not_ready")

            self._run_until(service, telegram_service, expected_messages=2)

            first_reply = telegram_service.sent_messages[0][1]
            second_reply = telegram_service.sent_messages[1][1]
            final_snapshot = service.snapshot()

            self.assertIn("Runtime started", first_reply)
            self.assertIn("Node: local", first_reply)
            self.assertIn("Execution enabled", first_reply)
            self.assertIn("- repo.read", first_reply)
            self.assertIn("- file.write", first_reply)
            self.assertIn("- run", first_reply)
            self.assertIn("- test", first_reply)
            self.assertEqual(second_reply, "Runtime already active\n\nNode: local")
            self.assertTrue(final_snapshot.runtime_active)
            self.assertEqual(final_snapshot.readiness_state, "ready")

    def test_bootstrapapprove_is_unblocked_after_startruntime(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=910, chat_id="chat-1", text="/translate Build a simple python script that prints hello.", sender_label="@tester"),
            TelegramInboundMessage(update_id=911, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=912, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
            TelegramInboundMessage(update_id=913, chat_id="chat-1", text="/bootstrapapprove", sender_label="@tester"),
            TelegramInboundMessage(update_id=914, chat_id="chat-1", text="/startruntime", sender_label="@tester"),
            TelegramInboundMessage(update_id=915, chat_id="chat-1", text="/bootstrapapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            self._run_until(service, telegram_service, expected_messages=6)

            blocked_reply = telegram_service.sent_messages[3][1]
            activation_reply = telegram_service.sent_messages[4][1]
            success_reply = telegram_service.sent_messages[5][1]

            self.assertIn("Bootstrap blocked", blocked_reply)
            self.assertIn("Runtime is not active", blocked_reply)
            self.assertIn("Runtime started", activation_reply)
            self.assertIn("Bootstrap completed", success_reply)
            proposal = service._project_bootstrap_store.get_active(chat_id="chat-1")
            self.assertIsNotNone(proposal)
            self.assertTrue((root / proposal.files[0].relative_path).exists())

    def test_status_shows_health_ok_and_readiness_ready_after_activation(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=920, chat_id="chat-1", text="/startruntime", sender_label="@tester"),
            TelegramInboundMessage(update_id=921, chat_id="chat-1", text="/status", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            self._run_until(service, telegram_service, expected_messages=2)

            status_reply = telegram_service.sent_messages[1][1]

            self.assertIn("Health: OK", status_reply)
            self.assertIn("Readiness: READY", status_reply)
            self.assertNotIn("listener", status_reply.lower())
            self.assertNotIn("liveness", status_reply.lower())

    def test_readiness_can_become_blocked_after_activation_if_health_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            service.activate_runtime_control_plane()
            ready_snapshot = service.snapshot()
            self.assertEqual(ready_snapshot.readiness_state, "ready")

            service._latest_health_report = _report(
                "health",
                "blocked",
                "error",
                "Blocked",
                items=(_item("health", "error", "health.blocked", "Readiness is not ready."),),
            )
            blocked_snapshot = service.snapshot()
            self.assertTrue(blocked_snapshot.runtime_active)
            self.assertEqual(blocked_snapshot.readiness_state, "not_ready")


if __name__ == "__main__":
    unittest.main()
