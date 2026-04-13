from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.audit_models import AuditRecord
from app.controller.audit_store import AuditStore
from app.controller.capability_registry import get_capability_manifest
from app.controller.execution_models import CapabilityExecutionRequest, ProviderExecutionSnapshot
from app.controller.scope_models import ExecutionScope
from app.controller.scope_validator import ScopeValidator
from app.platform.secrets import InMemorySecretStore
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _report,
    _wait_until,
)


class ScopeAndAuditLayerTests(unittest.TestCase):
    def _provider_snapshot(self) -> ProviderExecutionSnapshot:
        return ProviderExecutionSnapshot(
            active_provider="ollama",
            selected_provider="ollama",
            active_provider_state="valid",
            active_provider_message="Ollama is ready.",
            active_provider_model="llama3.1:latest",
            offline_provider_state="valid",
            offline_provider_message="Ollama is ready.",
            offline_provider_model="llama3.1:latest",
            online_provider_state="valid",
            online_provider_message="OpenAI is ready.",
            online_provider_model="gpt-5-mini",
        )

    def _make_request(self, *, capability_id: str, scope: ExecutionScope) -> CapabilityExecutionRequest:
        return CapabilityExecutionRequest(
            request_id="REQ-TEST01",
            capability_id=capability_id,
            source="telegram",
            user_id="chat-1",
            chat_id="chat-1",
            requester_label="@tester",
            original_command="/status",
            parsed_arguments={},
            invocation_timestamp=datetime.now().astimezone().isoformat(timespec="seconds"),
            mode_snapshot="offline",
            selected_mode_snapshot="offline",
            policy_snapshot="ask_before_online",
            provider_snapshot=self._provider_snapshot(),
            confirmation_context=None,
            readiness_snapshot="ready",
            scope=scope,
            metadata={},
        )

    def _make_service(
        self,
        *,
        tmp_dir: str,
        runtime_state: str = "running",
        ollama_adapter: _FakeOllamaAdapter | None = None,
        openai_adapter: _FakeOpenAIAdapter | None = None,
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _FakeOllamaAdapter, _FakeOpenAIAdapter]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        local_ollama = ollama_adapter or _FakeOllamaAdapter()
        remote_openai = openai_adapter or _FakeOpenAIAdapter()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state=runtime_state),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": local_ollama, "openai": remote_openai},
            telegram_service=tg,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg, local_ollama, remote_openai

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def _configure_online_confirmation_mode(self, service: ControllerService, config_store: ControllerConfigStore) -> None:
        config = config_store.load()
        config.selected_mode = "online"
        config.current_mode = "offline"
        config.selected_provider = "openai"
        config.policy = "ask_before_online"
        config_store.save(config)
        service._config = config_store.load()
        service._secret_store.put_secret(service._config.openai_secret_id, "sk-test-confirmation")
        service._config.openai_has_secret = True
        service._config.openai_key_masked = "sk-...rmation"
        config_store.save(service._config)
        service.validate_provider(provider="openai")

    def _extract_confirmation_id(self, reply: str) -> str:
        marker = "ID: "
        start = reply.index(marker) + len(marker)
        return reply[start:].splitlines()[0].strip()

    def test_scope_validator_allows_valid_internal_scope(self) -> None:
        validator = ScopeValidator()
        manifest = get_capability_manifest("status.read")
        request = self._make_request(
            capability_id="status.read",
            scope=ExecutionScope(scope_type="internal", access_mode="read"),
        )
        result = validator.validate(request, manifest)
        self.assertTrue(result.allowed)
        self.assertEqual(result.reason_code, "scope_allowed")
        self.assertEqual(result.scope_summary, "internal/read")

    def test_scope_validator_rejects_network_target_outside_manifest_allowlist(self) -> None:
        validator = ScopeValidator()
        manifest = get_capability_manifest("ask.provider_query")
        request = self._make_request(
            capability_id="ask.provider_query",
            scope=ExecutionScope(
                scope_type="network",
                access_mode="execute",
                target_domain="evil.example",
                domain_allowlist=("evil.example",),
            ),
        )
        result = validator.validate(request, manifest)
        self.assertFalse(result.allowed)
        self.assertEqual(result.reason_code, "target_domain_not_allowed")
        self.assertEqual(result.scope_summary, "network/execute target=evil.example")

    def test_audit_store_is_bounded_and_recent_is_newest_first(self) -> None:
        store = AuditStore(max_records=3)
        for index in range(1, 5):
            store.append(
                AuditRecord(
                    audit_id=f"AUD-{index}",
                    request_id=f"REQ-{index}",
                    capability_id=f"capability.{index}",
                    timestamp_start=f"2026-04-07T10:00:0{index}+00:00",
                    timestamp_end=f"2026-04-07T10:00:1{index}+00:00",
                    outcome="success",
                    outcome_reason="ok",
                    user_id="chat-1",
                    chat_id="chat-1",
                    confirmation_used=False,
                    scope_summary="internal/read",
                    provider_used="",
                    duration_ms=10,
                    action_summary=f"action {index}",
                )
            )
        self.assertEqual(len(store), 3)
        self.assertEqual(store.latest().audit_id, "AUD-4")
        self.assertEqual([record.audit_id for record in store.recent(limit=3)], ["AUD-4", "AUD-3", "AUD-2"])

    def test_out_of_scope_ask_is_rejected_before_provider_call_and_audited(self) -> None:
        update = TelegramInboundMessage(update_id=201, chat_id="chat-1", text="/ask hello from telegram", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            original_builder = service._build_execution_scope

            def _out_of_scope_builder(capability_id: str, *, snapshot):
                if capability_id == "ask.provider_query":
                    return ExecutionScope(
                        scope_type="network",
                        access_mode="execute",
                        target_domain="evil.example",
                        domain_allowlist=("evil.example",),
                    )
                return original_builder(capability_id, snapshot=snapshot)

            service._build_execution_scope = _out_of_scope_builder  # type: ignore[method-assign]
            snapshot, reply = self._run_single_update(service, telegram_service)
            latest = service._audit_store.latest()

            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_domain_not_allowed")
            self.assertEqual(reply, "Can't run /ask right now.\nReason: This capability is not allowed to contact that network target.\nNext: Use an allowed scope for this capability or adjust the operator-console configuration.")
            self.assertEqual(snapshot.last_execution_scope_summary, "network/execute target=evil.example")
            self.assertIsNotNone(latest)
            self.assertEqual(latest.outcome, "out_of_scope")
            self.assertEqual(latest.capability_id, "ask.provider_query")
            self.assertEqual(latest.action_summary, "/ask [prompt hidden]")
            self.assertNotIn("hello from telegram", latest.action_summary)

    def test_audit_command_returns_recent_entries_concisely(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=202, chat_id="chat-1", text="/status", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=203, chat_id="chat-1", text="/mode", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=204, chat_id="chat-1", text="/audit 2", sender_label="@tester"),),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=updates)
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            reply = telegram_service.sent_messages[2][1]

            self.assertEqual(reply.splitlines()[0], "Audit")
            self.assertIn("mode.read | success | ok", reply)
            self.assertIn("status.read | success | ok", reply)
            self.assertLessEqual(len(reply), 220)
            self.assertEqual(snapshot.last_execution_outcome, "success")
            self.assertIn("audit.read | success | ok", snapshot.last_audit_summary)

    def test_confirmation_does_not_bypass_scope_restrictions(self) -> None:
        first_update = TelegramInboundMessage(update_id=205, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            original_builder = service._build_execution_scope

            def _out_of_scope_builder(capability_id: str, *, snapshot):
                if capability_id == "ask.provider_query":
                    return ExecutionScope(
                        scope_type="network",
                        access_mode="execute",
                        target_domain="evil.example",
                        domain_allowlist=("evil.example",),
                    )
                return original_builder(capability_id, snapshot=snapshot)

            service._build_execution_scope = _out_of_scope_builder  # type: ignore[method-assign]
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=206, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            snapshot, confirm_reply = self._run_single_update(service, confirm_service)

            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_domain_not_allowed")
            self.assertEqual(confirm_reply, "Action is out of scope.\nReason: This capability is not allowed to contact that network target.\nNext: Use an allowed scope for this capability or adjust the operator-console configuration.")
            self.assertEqual(snapshot.last_execution_scope_summary, "network/execute target=evil.example")


if __name__ == "__main__":
    unittest.main()
