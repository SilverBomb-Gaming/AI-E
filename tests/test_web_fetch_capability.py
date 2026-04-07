from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.capability_registry import get_capability_manifest
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage
from app.controller.web_fetcher import WebFetchError, WebFetchSnapshot
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


class _FakeWebFetcher:
    def __init__(
        self,
        *,
        snapshot: WebFetchSnapshot | None = None,
        error: WebFetchError | None = None,
    ) -> None:
        self.snapshot = snapshot or WebFetchSnapshot(
            request_url="https://docs.openclaw.ai/guide",
            display_url="https://docs.openclaw.ai/guide",
            final_url="https://docs.openclaw.ai/guide",
            domain="docs.openclaw.ai",
            content_type="text/html",
            preview_text="Docs\nHello world.",
            size_bytes=128,
            truncated=False,
            oversized=False,
            redirected=False,
            fetched_at="2026-04-07T12:00:00-04:00",
        )
        self.error = error
        self.calls = 0
        self.last_url = ""
        self.last_allowed_domains: tuple[str, ...] = ()

    def fetch_text_preview(self, target_url: str, *, allowed_domains: tuple[str, ...]) -> WebFetchSnapshot:
        self.calls += 1
        self.last_url = target_url
        self.last_allowed_domains = allowed_domains
        if self.error is not None:
            raise self.error
        return self.snapshot


class WebFetchCapabilityTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        runtime_state: str = "running",
        telegram_service: _FakeTelegramService | None = None,
        web_fetcher: _FakeWebFetcher | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _FakeWebFetcher]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        fetcher = web_fetcher or _FakeWebFetcher()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state=runtime_state),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=tg,
            web_fetcher=fetcher,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg, fetcher

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def _configure_online_fetch_ready(self, service: ControllerService, config_store: ControllerConfigStore) -> None:
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
        service._secret_store.put_secret(service._config.openai_secret_id, "sk-test-web-fetch")
        service.validate_provider(provider="openai")

    @staticmethod
    def _extract_confirmation_id(reply: str) -> str:
        match = re.search(r"ID: ([A-F0-9]+)", reply)
        if match is None:
            raise AssertionError("confirmation id not found")
        return match.group(1)

    def test_web_manifest_is_network_read_only_and_domain_scoped(self) -> None:
        manifest = get_capability_manifest("web.fetch.read")
        self.assertEqual(manifest.access_kind, "read_only")
        self.assertEqual(manifest.locality, "networked")
        self.assertEqual(manifest.data_scope, "web")
        self.assertEqual(manifest.scope_type, "network")
        self.assertTrue(manifest.scope_uses_configured_domains)
        self.assertEqual(manifest.offline_safety, "requires_online")

    def test_web_command_returns_preview_and_audit_summary(self) -> None:
        update = TelegramInboundMessage(update_id=601, chat_id="chat-1", text="/web https://docs.openclaw.ai/guide", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, fetcher = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_online_fetch_ready(service, config_store)
            snapshot, reply = self._run_single_update(service, telegram_service)
            latest = service._audit_store.latest()

            self.assertEqual(fetcher.calls, 1)
            self.assertIn("Web: docs.openclaw.ai", reply)
            self.assertIn("Type: text/html", reply)
            self.assertIn("URL: https://docs.openclaw.ai/guide", reply)
            self.assertIn("Preview:", reply)
            self.assertIn("Hello world.", reply)
            self.assertEqual(service._last_execution_result.capability_id, "web.fetch.read")
            self.assertEqual(service._last_execution_result.outcome, "success")
            self.assertEqual(snapshot.last_web_fetch, "docs.openclaw.ai")
            self.assertEqual(snapshot.last_web_status, "Web preview ready.")
            self.assertEqual(snapshot.last_web_content_type, "text/html")
            self.assertIsNotNone(latest)
            self.assertEqual(latest.capability_id, "web.fetch.read")
            self.assertIn("docs.openclaw.ai | text/html", latest.action_summary)
            self.assertNotIn("Hello world.", latest.action_summary)

    def test_web_command_blocks_disallowed_domain_before_fetch_runs(self) -> None:
        update = TelegramInboundMessage(update_id=602, chat_id="chat-1", text="/web https://evil.example/data", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, fetcher = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()
            _, reply = self._run_single_update(service, telegram_service)

            self.assertEqual(fetcher.calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_domain_not_allowed")
            self.assertEqual(
                reply,
                "Can't run /web right now.\nReason: URL is not allowed by current web scope.\nNext: Use an allowed scope for this capability or adjust the operator-console configuration.",
            )

    def test_web_command_is_blocked_by_always_offline_policy(self) -> None:
        update = TelegramInboundMessage(update_id=603, chat_id="chat-1", text="/web https://docs.openclaw.ai/guide", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, fetcher = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.policy = "always_offline"
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()
            _, reply = self._run_single_update(service, telegram_service)

            self.assertEqual(fetcher.calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "blocked")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "policy_always_offline")
            self.assertEqual(
                reply,
                "Can't run /web right now.\nReason: Always Offline policy is active.\nNext: Switch out of Always Offline before retrying the web fetch.",
            )

    def test_web_command_requires_confirmation_then_executes_once(self) -> None:
        first_update = TelegramInboundMessage(update_id=604, chat_id="chat-1", text="/web https://docs.openclaw.ai/guide", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, fetcher = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            config = config_store.load()
            config.policy = "ask_before_online"
            config.current_mode = "offline"
            config.selected_mode = "offline"
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=605, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            snapshot, confirm_reply = self._run_single_update(service, confirm_service)

            self.assertEqual(fetcher.calls, 1)
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)
            self.assertIn("Web: docs.openclaw.ai", confirm_reply)
            self.assertEqual(service._last_execution_result.outcome, "success")
            self.assertEqual(snapshot.last_web_fetch, "docs.openclaw.ai")

    def test_web_timeout_returns_structured_timed_out_result(self) -> None:
        update = TelegramInboundMessage(update_id=606, chat_id="chat-1", text="/web https://docs.openclaw.ai/guide", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            fetcher = _FakeWebFetcher(error=WebFetchError("web_fetch_timeout", "Web request timed out."))
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, web_fetcher=fetcher)
            self._configure_online_fetch_ready(service, config_store)
            _, reply = self._run_single_update(service, telegram_service)

            self.assertEqual(service._last_execution_result.outcome, "timed_out")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "web_fetch_timeout")
            self.assertEqual(
                reply,
                "Web request timed out.\nReason: Web request timed out.\nNext: Try /web again in a moment.",
            )


if __name__ == "__main__":
    unittest.main()
