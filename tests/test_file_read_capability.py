from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.capability_registry import get_capability_manifest
from app.controller.telegram_service import TelegramInboundMessage
from app.platform.secrets import InMemorySecretStore
from app.controller.profile_store import ControllerConfigStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _report,
    _wait_until,
)


class _TrackingFileReader:
    def __init__(self) -> None:
        self.calls = 0

    def read_text_preview(self, target_path: str, *, display_path: str):
        self.calls += 1
        raise AssertionError("read_text_preview should not run for blocked requests")


class FileReadCapabilityTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        runtime_state: str = "running",
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state=runtime_state),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=tg,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def test_file_manifest_is_read_only_local_and_filesystem_scoped(self) -> None:
        manifest = get_capability_manifest("file.read")
        self.assertEqual(manifest.access_kind, "read_only")
        self.assertEqual(manifest.locality, "local_only")
        self.assertEqual(manifest.data_scope, "file_system")
        self.assertEqual(manifest.scope_type, "filesystem")
        self.assertTrue(manifest.scope_uses_configured_paths)

    def test_file_command_returns_compact_preview_and_audit(self) -> None:
        update = TelegramInboundMessage(update_id=501, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            snapshot, reply = self._run_single_update(service, telegram_service)
            latest = service._audit_store.latest()

            self.assertIn("File: docs/notes.txt", reply)
            self.assertIn("Preview:", reply)
            self.assertIn("alpha", reply)
            self.assertLessEqual(len(reply), 3200)
            self.assertEqual(service._last_execution_result.capability_id, "file.read")
            self.assertEqual(service._last_execution_result.outcome, "success")
            self.assertEqual(service._last_execution_result.scope_summary, "filesystem/read target=path")
            self.assertEqual(snapshot.last_file_read, "docs/notes.txt")
            self.assertEqual(snapshot.last_file_read_status, "Preview ready.")
            self.assertIsNotNone(latest)
            self.assertEqual(latest.capability_id, "file.read")
            self.assertEqual(latest.outcome, "success")
            self.assertIn("docs/notes.txt", latest.action_summary)
            self.assertNotIn("alpha", latest.action_summary)

    def test_file_command_blocks_path_traversal_before_reader_runs(self) -> None:
        update = TelegramInboundMessage(update_id=502, chat_id="chat-1", text="/file ../secret.txt", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()
            tracker = _TrackingFileReader()
            service._file_reader = tracker

            _, reply = self._run_single_update(service, telegram_service)

            self.assertEqual(tracker.calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_path_not_allowed")
            self.assertEqual(
                reply,
                "Action is out of scope.\nReason: File is outside allowed directories.\nNext: Use a relative path inside the allowed directories only.",
            )

    def test_file_command_rejects_binary_content_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=503, chat_id="chat-1", text="/file assets/blob.bin", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "assets" / "blob.bin"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"\x00\x01\x02binary")

            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(service._last_execution_result.outcome, "failed")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "file_type_not_supported")
            self.assertEqual(
                reply,
                "Can't run /file right now.\nReason: File type not supported for safe display.\nNext: Request a supported text-based file inside the allowed scope.",
            )

    def test_file_command_returns_large_preview_with_truncation_notice(self) -> None:
        update = TelegramInboundMessage(update_id=504, chat_id="chat-1", text="/file logs/large.log", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "logs" / "large.log"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("line for large preview\n" * 20000, encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertIn("File: logs/large.log", reply)
            self.assertIn("Note: Large file preview truncated for safety.", reply)
            self.assertEqual(service._last_execution_result.outcome, "success")
            self.assertEqual(service._last_execution_result.telemetry["file_size_category"], "large")
            self.assertEqual(snapshot.last_file_read_status, "Large file preview truncated.")

    def test_file_scope_validator_rejects_out_of_scope_target_before_reader_runs(self) -> None:
        update = TelegramInboundMessage(update_id=505, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()
            tracker = _TrackingFileReader()
            service._file_reader = tracker

            service.resolve_file_request = lambda _value: (  # type: ignore[method-assign]
                "docs/notes.txt",
                str(root.parent / "outside.txt"),
                (str(root.resolve()),),
                "file_target_ready",
                "Scoped file target is ready.",
            )
            _, reply = self._run_single_update(service, telegram_service)

            self.assertEqual(tracker.calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_path_not_allowed")
            self.assertEqual(
                reply,
                "Can't run /file right now.\nReason: This capability is not allowed to access that path.\nNext: Use an allowed scope for this capability or adjust the operator-console configuration.",
            )


if __name__ == "__main__":
    unittest.main()
