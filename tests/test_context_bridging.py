from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.context_store import ContextStore
from app.controller.profile_store import ControllerConfigStore
from app.controller.repo_inspector import RepoInspectionSnapshot
from app.controller.telegram_service import TelegramInboundMessage
from app.controller.web_fetcher import WebFetchSnapshot
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


class _FakeRepoInspector:
    def inspect(self, repo_root: str, *, commit_limit: int = 5) -> RepoInspectionSnapshot:
        return RepoInspectionSnapshot(
            repo_root=repo_root,
            repo_name="AI-E",
            branch="codex/home-screen-v1",
            is_dirty=True,
            changed_count=3,
            recent_commits=(
                "a1b2c3d Add capability layer",
                "d4e5f6g Improve diagnostics",
                "h7i8j9k Initial setup",
            ),
            inspected_at="2026-04-07T12:00:00-04:00",
        )


class _FakeWebFetcher:
    def fetch_text_preview(self, target_url: str, *, allowed_domains: tuple[str, ...]) -> WebFetchSnapshot:
        return WebFetchSnapshot(
            request_url=target_url,
            display_url=target_url,
            final_url=target_url,
            domain="docs.openclaw.ai",
            content_type="text/html",
            preview_text="Docs\nContext bridge overview.",
            size_bytes=128,
            truncated=False,
            oversized=False,
            redirected=False,
            fetched_at="2026-04-07T12:05:00-04:00",
        )


class _RecordingOllamaAdapter(_FakeOllamaAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.ask_prompts: list[str] = []

    def ask(self, **kwargs: object):
        self.ask_prompts.append(str(kwargs.get("prompt", "")))
        return super().ask(**kwargs)


class ContextBridgingTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
        ollama_adapter: _FakeOllamaAdapter | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _FakeOllamaAdapter]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        offline = ollama_adapter or _FakeOllamaAdapter()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": offline, "openai": _FakeOpenAIAdapter()},
            telegram_service=tg,
            repo_inspector=_FakeRepoInspector(),
            web_fetcher=_FakeWebFetcher(),
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg, offline

    def _run_until(self, service: ControllerService, telegram_service: _FakeTelegramService, expected_messages: int) -> object:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == expected_messages, timeout=2.0))
        return service.stop_telegram_loop()

    def test_context_store_is_bounded_and_separated_per_chat(self) -> None:
        store = ContextStore(max_contexts_per_chat=3, lifetime_seconds=120.0)
        for index in range(1, 6):
            store.create(
                source_capability_id="file.read",
                source_command="/file",
                scope_type="filesystem",
                source_summary=f"file {index}",
                content_kind="file_preview",
                content_preview=f"preview {index}",
                normalized_content=f"content {index}",
                size_class="small",
                user_id="chat-1",
                chat_id="chat-1",
                originating_request_id=f"REQ-{index}",
            )
        store.create(
            source_capability_id="repo.status.read",
            source_command="/repo",
            scope_type="repository",
            source_summary="repo state",
            content_kind="repo_summary",
            content_preview="repo state",
            normalized_content="repo state",
            size_class="summary",
            user_id="chat-2",
            chat_id="chat-2",
            originating_request_id="REQ-CHAT2",
        )
        chat_one = store.recent(chat_id="chat-1", limit=5)
        chat_two = store.recent(chat_id="chat-2", limit=5)
        self.assertEqual([item.context_id for item in chat_one], ["C5", "C4", "C3"])
        self.assertEqual(len(chat_two), 1)
        self.assertEqual(chat_two[0].context_id, "C1")
        self.assertIsNone(store.resolve(chat_id="chat-2", reference="C5"))

    def test_repo_and_file_success_create_context_and_listing(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=701, chat_id="chat-1", text="/repo", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=702, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=703, chat_id="chat-1", text="/contexts", sender_label="@tester"),),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.repo_root = str(root.resolve())
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            snapshot = self._run_until(service, telegram_service, 3)
            repo_reply = telegram_service.sent_messages[0][1]
            file_reply = telegram_service.sent_messages[1][1]
            contexts_reply = telegram_service.sent_messages[2][1]

            self.assertIn("Context: C1 ready for /asklast or /askctx C1 <prompt>.", repo_reply)
            self.assertIn("Context: C2 ready for /asklast or /askctx C2 <prompt>.", file_reply)
            self.assertEqual(contexts_reply.splitlines()[0], "Contexts (latest first)")
            self.assertIn("- C2 file.read docs/notes.txt", contexts_reply)
            self.assertIn("- C1 repo.status.read AI-E codex/home-screen-v1 Dirty (3 changes)", contexts_reply)
            self.assertEqual(snapshot.buffered_context_count, 2)
            self.assertEqual(snapshot.last_context_source, "C2 docs/notes.txt")

    def test_web_success_creates_context_in_online_mode(self) -> None:
        update = TelegramInboundMessage(update_id=704, chat_id="chat-1", text="/web https://docs.openclaw.ai/guide", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.current_mode = "online"
            config.selected_mode = "online"
            config.selected_provider = "openai"
            config.policy = "always_online"
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config.openai_has_secret = True
            config.openai_key_masked = "sk-...test"
            config_store.save(config)
            service._config = config_store.load()
            service._secret_store.put_secret(service._config.openai_secret_id, "sk-test-web")
            service.validate_provider(provider="openai")

            snapshot = self._run_until(service, telegram_service, 1)
            reply = telegram_service.sent_messages[0][1]

            self.assertIn("Web: docs.openclaw.ai", reply)
            self.assertIn("Context: C1 ready for /asklast or /askctx C1 <prompt>.", reply)
            self.assertEqual(snapshot.buffered_context_count, 1)
            self.assertEqual(snapshot.last_context_source, "C1 docs.openclaw.ai")

    def test_asklast_uses_latest_context_and_plain_ask_stays_context_free(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=705, chat_id="chat-1", text="/repo", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=706, chat_id="chat-1", text="/asklast summarize the branch state", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=707, chat_id="chat-1", text="/ask summarize directly", sender_label="@tester"),),
        ]
        ollama = _RecordingOllamaAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, offline = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service._provider_ask_cooldown_seconds = 0.0
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            config = config_store.load()
            config.repo_root = str(root.resolve())
            config_store.save(config)
            service._config = config_store.load()

            self._run_until(service, telegram_service, 3)
            asklast_reply = telegram_service.sent_messages[1][1]
            plain_ask_reply = telegram_service.sent_messages[2][1]

            self.assertIn("Answer (Offline | Ollama", asklast_reply)
            self.assertIn("Answer (Offline | Ollama", plain_ask_reply)
            self.assertEqual(offline.ask_calls, 2)
            self.assertIn("Context Source: AI-E codex/home-screen-v1 Dirty (3 changes)", offline.ask_prompts[0])
            self.assertIn("User Request:\nsummarize the branch state", offline.ask_prompts[0])
            self.assertEqual(offline.ask_prompts[1], "summarize directly")
            audit_recent = service._audit_store.recent(limit=3)
            self.assertIn("used C1", audit_recent[1].action_summary)
            self.assertNotIn("used C1", audit_recent[0].action_summary)

    def test_askctx_uses_selected_context_and_invalid_id_fails_clearly(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=708, chat_id="chat-1", text="/repo", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=709, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=710, chat_id="chat-1", text="/askctx C1 explain repo status", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=711, chat_id="chat-1", text="/askctx C9 explain repo status", sender_label="@tester"),),
        ]
        ollama = _RecordingOllamaAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, offline = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            config = config_store.load()
            config.repo_root = str(root.resolve())
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            self._run_until(service, telegram_service, 4)
            valid_reply = telegram_service.sent_messages[2][1]
            invalid_reply = telegram_service.sent_messages[3][1]

            self.assertIn("Answer (Offline | Ollama", valid_reply)
            self.assertEqual(offline.ask_calls, 1)
            self.assertIn("Context Source: AI-E codex/home-screen-v1 Dirty (3 changes)", offline.ask_prompts[0])
            self.assertNotIn("File: docs/notes.txt", offline.ask_prompts[0])
            self.assertIn("Context C9 was not found.", invalid_reply)
            self.assertEqual(service._last_execution_result.outcome, "invalid_request")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "context_not_found")

    def test_clearcontext_and_cross_chat_isolation_preserve_trust(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=712, chat_id="chat-1", text="/repo", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=713, chat_id="chat-2", text="/asklast hello", sender_label="@other"),),
            (TelegramInboundMessage(update_id=714, chat_id="chat-1", text="/clearcontext", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=715, chat_id="chat-1", text="/contexts", sender_label="@tester"),),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            config = config_store.load()
            config.repo_root = str(root.resolve())
            config_store.save(config)
            service._config = config_store.load()

            snapshot = self._run_until(service, telegram_service, 4)
            missing_reply = telegram_service.sent_messages[1][1]
            clear_reply = telegram_service.sent_messages[2][1]
            contexts_reply = telegram_service.sent_messages[3][1]
            recent_audit = service._audit_store.recent(limit=2)

            self.assertIn("No recent context is available in this chat.", missing_reply)
            self.assertEqual(clear_reply, "Cleared 1 context entry for this chat.")
            self.assertEqual(contexts_reply, "Contexts\nNo recent context is available in this chat.")
            self.assertEqual(snapshot.buffered_context_count, 0)
            self.assertEqual(snapshot.last_context_source, "No buffered context yet.")
            self.assertIn("Cleared 1 buffered context entries", recent_audit[1].action_summary)

    def test_context_audit_summaries_do_not_leak_file_contents(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=716, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=717, chat_id="chat-1", text="/asklast summarize this file", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=718, chat_id="chat-1", text="/clearcontext", sender_label="@tester"),),
        ]
        ollama = _RecordingOllamaAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("secret-token-should-not-appear\nalpha\nbeta\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            config = config_store.load()
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()
            service._provider_ask_cooldown_seconds = 0.0

            self._run_until(service, telegram_service, 3)
            recent = service._audit_store.recent(limit=3)

            self.assertIn("created C1", recent[2].action_summary)
            self.assertIn("used C1", recent[1].action_summary)
            self.assertIn("Cleared 1 buffered context entries", recent[0].action_summary)
            for record in recent:
                self.assertNotIn("secret-token-should-not-appear", record.action_summary)


if __name__ == "__main__":
    unittest.main()
