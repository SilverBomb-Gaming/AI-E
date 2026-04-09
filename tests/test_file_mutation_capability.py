from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.capability_registry import get_capability_manifest
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage
from app.platform.secrets import InMemorySecretStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _report,
    _wait_until,
)


class FileMutationCapabilityTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
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

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> str:
        service._telegram_service = telegram_service
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        service.stop_telegram_loop()
        return telegram_service.sent_messages[0][1]

    def _configure_file_root(self, *, service: ControllerService, config_store: ControllerConfigStore, root: Path) -> None:
        config = config_store.load()
        config.file_allowed_roots = (str(root.resolve()),)
        config_store.save(config)
        service._config = config_store.load()

    @staticmethod
    def _extract_confirmation_id(reply: str) -> str:
        marker = "ID: "
        start = reply.index(marker) + len(marker)
        return reply[start:].splitlines()[0].split()[0].strip()

    def test_file_mutation_manifests_are_scoped_mutating_and_confirmation_gated(self) -> None:
        create_manifest = get_capability_manifest("file.create.write")
        patch_manifest = get_capability_manifest("file.patch.write")
        replace_manifest = get_capability_manifest("file.write.replace")

        self.assertEqual(create_manifest.access_kind, "mutating")
        self.assertEqual(patch_manifest.access_kind, "mutating")
        self.assertEqual(replace_manifest.access_kind, "mutating")
        self.assertEqual(create_manifest.scope_type, "filesystem")
        self.assertEqual(patch_manifest.scope_type, "filesystem")
        self.assertEqual(replace_manifest.scope_type, "filesystem")
        self.assertEqual(create_manifest.access_mode, "write")
        self.assertEqual(patch_manifest.access_mode, "write")
        self.assertEqual(replace_manifest.access_mode, "write")
        self.assertEqual(create_manifest.confirmation_sensitivity, "always")
        self.assertEqual(patch_manifest.confirmation_sensitivity, "always")
        self.assertEqual(replace_manifest.confirmation_sensitivity, "always")

    def test_createfile_requires_confirmation_creates_file_and_audits_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)

            create_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=600,
                            chat_id="chat-1",
                            text="/createfile ./scripts/test.py\nReason: add hello world\n@@ CONTENT\nprint(\"hello from AI-E\")",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            self.assertIn("Action requires confirmation.", prompt_reply)
            self.assertIn("Preview: create file with 1 lines", prompt_reply)
            self.assertIn("Will create directories: scripts", prompt_reply)
            self.assertFalse((root / "scripts" / "test.py").exists())

            confirm_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=601,
                            chat_id="chat-1",
                            text=f"/confirm {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)
            latest = service._audit_store.latest()

            self.assertEqual((root / "scripts" / "test.py").read_text(encoding="utf-8"), 'print("hello from AI-E")')
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)
            self.assertIn("Created: ./scripts/test.py", confirm_reply)
            self.assertIn("Directories created: scripts", confirm_reply)
            self.assertIn("Lines: 1", confirm_reply)
            self.assertEqual(service._last_execution_result.capability_id, "file.create.write")
            self.assertTrue(service._last_execution_result.confirmation_used)
            self.assertIsNotNone(latest)
            self.assertEqual(latest.capability_id, "file.create.write")
            self.assertIn("create", latest.action_summary)
            self.assertIn("scripts/test.py", latest.action_summary)

    def test_createfile_blocks_when_file_already_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("existing\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=613,
                            chat_id="chat-1",
                            text="/createfile docs/notes.txt\n@@ CONTENT\nreplacement",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            reply = self._run_single_update(service, telegram_service)

            self.assertEqual(service._confirmation_store.pending_count(chat_id="chat-1"), 0)
            self.assertEqual(service._last_execution_result.outcome_reason_code, "file_already_exists")
            self.assertIn("Use /writefile or /patchfile", reply)
            self.assertEqual(target.read_text(encoding="utf-8"), "existing\n")

    def test_createfile_rejects_path_traversal_before_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=614,
                            chat_id="chat-1",
                            text="/createfile ../secret.txt\n@@ CONTENT\nblocked",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            reply = self._run_single_update(service, telegram_service)

            self.assertEqual(service._confirmation_store.pending_count(chat_id="chat-1"), 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_path_not_allowed")
            self.assertEqual(
                reply,
                "Action is out of scope.\nReason: File is outside allowed directories.\nNext: Use a relative path inside the allowed directories only.",
            )

    def test_patchfile_requires_confirmation_applies_once_and_audits_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")

            create_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=601,
                            chat_id="chat-1",
                            text="/patchfile docs/notes.txt\nReason: tighten sample\n@@ FIND\nbeta\n@@ REPLACE\nbeta updated",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            self.assertIn("Action requires confirmation.", prompt_reply)
            self.assertIn("Preview: 1 replacement", prompt_reply)
            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta\ngamma\n")

            confirm_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=602,
                            chat_id="chat-1",
                            text=f"/confirm {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)
            latest = service._audit_store.latest()

            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta updated\ngamma\n")
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)
            self.assertIn("Operation: patch", confirm_reply)
            self.assertEqual(service._last_execution_result.capability_id, "file.patch.write")
            self.assertTrue(service._last_execution_result.confirmation_used)
            self.assertIsNotNone(latest)
            self.assertEqual(latest.capability_id, "file.patch.write")
            self.assertTrue(latest.confirmation_used)
            self.assertIn("docs/notes.txt", latest.action_summary)
            self.assertIn("patch", latest.action_summary)

            replay_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=603,
                            chat_id="chat-1",
                            text=f"/confirm {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            replay_reply = self._run_single_update(service, replay_tg)
            self.assertIn("already used", replay_reply)
            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta updated\ngamma\n")

    def test_deny_rejects_patch_without_writing_and_audits_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\n", encoding="utf-8")

            create_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=604,
                            chat_id="chat-1",
                            text="/patchfile docs/notes.txt\n@@ FIND\nbeta\n@@ REPLACE\nblocked",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            deny_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=605,
                            chat_id="chat-1",
                            text=f"/deny {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            deny_reply = self._run_single_update(service, deny_tg)
            latest = service._audit_store.latest()

            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta\n")
            self.assertEqual(deny_reply, f"Confirmation {confirmation_id} denied. Request not executed.")
            self.assertIsNotNone(latest)
            self.assertEqual(latest.outcome, "denied")
            self.assertIn("docs/notes.txt", latest.action_summary)
            self.assertIn("patch", latest.action_summary)

    def test_patchfile_rejects_path_traversal_before_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=606,
                            chat_id="chat-1",
                            text="/patchfile ../secret.txt\n@@ FIND\na\n@@ REPLACE\nb",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            reply = self._run_single_update(service, telegram_service)

            self.assertEqual(service._confirmation_store.pending_count(chat_id="chat-1"), 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_path_not_allowed")
            self.assertEqual(
                reply,
                "Action is out of scope.\nReason: File is outside allowed directories.\nNext: Use a relative path inside the allowed directories only.",
            )

    def test_patchfile_base_mismatch_fails_after_confirmation_without_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\n", encoding="utf-8")

            create_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=607,
                            chat_id="chat-1",
                            text="/patchfile docs/notes.txt\nBase: deadbeef\n@@ FIND\nbeta\n@@ REPLACE\ngamma",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=608,
                            chat_id="chat-1",
                            text=f"/confirm {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta\n")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "base_hash_mismatch")
            self.assertIn(f"Confirmation {confirmation_id} could not run.", confirm_reply)
            self.assertIn("Expected base deadbeef", confirm_reply)

    def test_writefile_replaces_file_after_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("old\ncontent\n", encoding="utf-8")

            create_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=609,
                            chat_id="chat-1",
                            text="/writefile docs/notes.txt\nReason: replace whole file\n@@ CONTENT\nnew\ncontent\nblock",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            self.assertIn("replace file", prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=610,
                            chat_id="chat-1",
                            text=f"/confirm {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(target.read_text(encoding="utf-8"), "new\ncontent\nblock")
            self.assertIn("Operation: replace", confirm_reply)
            self.assertEqual(service._last_execution_result.capability_id, "file.write.replace")

    def test_writefile_rejects_protected_path_on_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "Library" / "generated.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("generated\n", encoding="utf-8")

            create_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=611,
                            chat_id="chat-1",
                            text="/writefile Library/generated.txt\n@@ CONTENT\nreplace me",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_file_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[
                    (
                        TelegramInboundMessage(
                            update_id=612,
                            chat_id="chat-1",
                            text=f"/confirm {confirmation_id}",
                            sender_label="@tester",
                        ),
                    )
                ]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(target.read_text(encoding="utf-8"), "generated\n")
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "protected_path_not_allowed")
            self.assertIn("protected from Telegram-driven mutation", confirm_reply)


if __name__ == "__main__":
    unittest.main()