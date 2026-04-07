from __future__ import annotations

import tempfile
import time
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.channel_models import TelegramChannelStatus
from app.controller.diagnostic_models import DiagnosticReport
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage, mask_telegram_token
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderReply, ProviderStatus
from app.runtime.models import OllamaInstallation, OpenClawInstallation, RuntimeInspection, RuntimeStatus


VALID_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"


class _FakeRuntimeManager:
    def __init__(self, *, runtime_state: str = "running") -> None:
        self._status = RuntimeStatus(
            runtime_state=runtime_state,  # type: ignore[arg-type]
            status_message="OpenClaw gateway running on port 18789." if runtime_state == "running" else "Runtime stopped.",
            openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
            ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
            pid=4321 if runtime_state == "running" else None,
        )
        self._inspection = RuntimeInspection(
            configured_bind="loopback",
            configured_host="127.0.0.1",
            configured_port=18789,
            cli_reachable=True,
            process_exists=runtime_state == "running",
            process_responsive=runtime_state == "running",
            gateway_tcp_connectable=runtime_state == "running",
            gateway_listener_detected=runtime_state == "running",
            gateway_listener_owned=runtime_state == "running",
            liveness_state="responsive" if runtime_state == "running" else "indeterminate",
            liveness_message="Configured gateway listener is owned by the active OpenClaw runtime." if runtime_state == "running" else "Runtime is not expected to respond because it is not running.",
            listener_addresses=("127.0.0.1",) if runtime_state == "running" else (),
        )

    def configure(self, *, gateway_port: int | None = None, gateway_bind: str | None = None) -> None:
        if gateway_port is not None:
            self._inspection = replace(self._inspection, configured_port=gateway_port)
        if gateway_bind is not None:
            host = "127.0.0.1" if gateway_bind == "loopback" else gateway_bind
            self._inspection = replace(self._inspection, configured_bind=gateway_bind, configured_host=host)

    def refresh_status(self) -> RuntimeStatus:
        return self._status

    def get_status(self) -> RuntimeStatus:
        return self._status

    def inspect_runtime(self) -> RuntimeInspection:
        return self._inspection

    def get_recent_logs(self, *, limit: int = 200) -> tuple[str, ...]:
        return ()

    def start_runtime(self) -> RuntimeStatus:
        self._status = replace(self._status, runtime_state="running", status_message="OpenClaw gateway running on port 18789.", pid=4321)
        self._inspection = replace(
            self._inspection,
            process_exists=True,
            process_responsive=True,
            gateway_tcp_connectable=True,
            gateway_listener_detected=True,
            gateway_listener_owned=True,
            liveness_state="responsive",
            liveness_message="Configured gateway listener is owned by the active OpenClaw runtime.",
            listener_addresses=("127.0.0.1",),
        )
        return self._status

    def stop_runtime(self) -> RuntimeStatus:
        self._status = replace(self._status, runtime_state="stopped", status_message="Runtime stopped.", pid=None)
        self._inspection = replace(
            self._inspection,
            process_exists=False,
            process_responsive=False,
            gateway_tcp_connectable=False,
            gateway_listener_detected=False,
            gateway_listener_owned=False,
            liveness_state="indeterminate",
            liveness_message="Runtime is not expected to respond because it is not running.",
            listener_addresses=(),
        )
        return self._status

    def restart_runtime(self) -> RuntimeStatus:
        return self.start_runtime()

    def clear_logs(self) -> RuntimeStatus:
        return self._status


class _FakeOllamaAdapter:
    def __init__(
        self,
        *,
        validation_status: ProviderStatus | None = None,
        ask_reply: ProviderReply | None = None,
    ) -> None:
        self.validation_status = validation_status or ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama is ready.",
            is_local=True,
            model="llama3.1:latest",
            available_models=("llama3.1:latest", "qwen2.5:latest"),
        )
        self.ask_reply = ask_reply or ProviderReply(
            provider="ollama",
            ok=True,
            text="Offline answer from Ollama.",
            message="Ollama replied successfully.",
            model="llama3.1:latest",
        )
        self.ask_calls = 0

    def validate(self, **kwargs: object) -> ProviderStatus:
        return self.validation_status

    def ask(self, **kwargs: object) -> ProviderReply:
        self.ask_calls += 1
        return self.ask_reply


class _FakeOpenAIAdapter:
    def __init__(
        self,
        *,
        validation_status: ProviderStatus | None = None,
        ask_reply: ProviderReply | None = None,
    ) -> None:
        self.validation_status = validation_status or ProviderStatus(
            provider="openai",
            display_name="OpenAI",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="OpenAI is ready.",
            is_local=False,
        )
        self.ask_reply = ask_reply or ProviderReply(
            provider="openai",
            ok=True,
            text="Online answer from OpenAI.",
            message="OpenAI replied successfully.",
            model="gpt-5-mini",
        )
        self.ask_calls = 0

    def validate(self, **kwargs: object) -> ProviderStatus:
        return self.validation_status

    def ask(self, **kwargs: object) -> ProviderReply:
        self.ask_calls += 1
        return self.ask_reply


class _FakeTelegramService:
    def __init__(
        self,
        *,
        update_batches: list[tuple[TelegramInboundMessage, ...]] | None = None,
        ignore_offset: bool = False,
    ) -> None:
        self._update_batches = list(update_batches or [])
        self._ignore_offset = ignore_offset
        self.sent_messages: list[tuple[str, str]] = []

    def validate(self, *, secret_store, secret_id: str, transient_token: str = "") -> TelegramChannelStatus:
        token = transient_token.strip() or secret_store.get_secret(secret_id).strip()
        if not token:
            return TelegramChannelStatus(
                configured=False,
                token_present=False,
                validation_state="invalid",
                available=False,
                ready=False,
                message="Telegram is not configured. Save a bot token before validating the channel.",
            )
        return TelegramChannelStatus(
            configured=True,
            token_present=True,
            token_masked=mask_telegram_token(token),
            validation_state="valid",
            available=True,
            ready=True,
            message="Telegram bot @test_console_bot authenticated successfully.",
            bot_id="1001",
            bot_username="test_console_bot",
            bot_display_name="Test Console",
        )

    def test_connection(self, *, secret_store, secret_id: str, existing_status: TelegramChannelStatus | None = None) -> TelegramChannelStatus:
        validated = self.validate(secret_store=secret_store, secret_id=secret_id)
        timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
        return replace(
            validated,
            last_test_result="passed",
            last_test_message="Telegram connection test passed for @test_console_bot.",
            last_test_at=timestamp,
        )

    def get_updates(self, *, secret_store, secret_id: str, offset: int = 0, timeout: int = 2) -> tuple[TelegramInboundMessage, ...]:
        if self._update_batches:
            batch = self._update_batches.pop(0)
            if self._ignore_offset:
                return batch
            return tuple(update for update in batch if update.update_id >= offset)
        time.sleep(0.02)
        return ()

    def send_text(self, *, secret_store, secret_id: str, chat_id: str, text: str) -> int:
        self.sent_messages.append((chat_id, text))
        return len(self.sent_messages)


def _report(check_type: str, overall_status: str, overall_severity: str, summary: str) -> DiagnosticReport:
    return DiagnosticReport(
        check_type=check_type,  # type: ignore[arg-type]
        overall_status=overall_status,  # type: ignore[arg-type]
        overall_severity=overall_severity,  # type: ignore[arg-type]
        ran_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        summary=summary,
        items=(),
    )


def _wait_until(predicate, timeout: float = 1.5) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


class TelegramCommandTests(unittest.TestCase):
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

    def test_help_command_lists_supported_commands(self) -> None:
        update = TelegramInboundMessage(update_id=1, chat_id="chat-1", text="/help", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[0][1]
            self.assertIn("/help", reply)
            self.assertIn("/models", reply)
            self.assertIn("/ask <prompt>", reply)

    def test_models_command_lists_available_models(self) -> None:
        update = TelegramInboundMessage(update_id=2, chat_id="chat-1", text="/models", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[0][1]
            self.assertIn("Local Ollama models", reply)
            self.assertIn("llama3.1:latest", reply)

    def test_models_command_reports_no_local_models(self) -> None:
        update = TelegramInboundMessage(update_id=3, chat_id="chat-1", text="/models", sender_label="@tester")
        ollama = _FakeOllamaAdapter(
            validation_status=ProviderStatus(
                provider="ollama",
                display_name="Ollama",
                configured=True,
                available=True,
                validation_state="partial",
                ready=False,
                message="Ollama is reachable, but no local models are detected yet.",
                is_local=True,
                model="",
                available_models=(),
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertIn("no local models", telegram_service.sent_messages[0][1].lower())

    def test_models_command_reports_ollama_unavailable(self) -> None:
        update = TelegramInboundMessage(update_id=4, chat_id="chat-1", text="/models", sender_label="@tester")
        ollama = _FakeOllamaAdapter(
            validation_status=ProviderStatus(
                provider="ollama",
                display_name="Ollama",
                configured=False,
                available=False,
                validation_state="invalid",
                ready=False,
                message="Ollama is not installed or was not found on PATH.",
                is_local=True,
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertIn("unavailable", telegram_service.sent_messages[0][1].lower())

    def test_offline_ask_uses_ollama_when_provider_is_valid(self) -> None:
        update = TelegramInboundMessage(update_id=5, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            snapshot = service.stop_telegram_loop()
            self.assertEqual(ollama.ask_calls, 1)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Offline answer from Ollama.", telegram_service.sent_messages[0][1])
            self.assertIn("completed via Ollama", snapshot.telegram_last_ask_status)

    def test_ask_blocks_when_provider_is_invalid(self) -> None:
        update = TelegramInboundMessage(update_id=6, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        ollama = _FakeOllamaAdapter(
            validation_status=ProviderStatus(
                provider="ollama",
                display_name="Ollama",
                configured=True,
                available=False,
                validation_state="invalid",
                ready=False,
                message="Ollama service is unavailable.",
                is_local=True,
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("offline ask is unavailable", telegram_service.sent_messages[0][1].lower())

    def test_ask_blocks_when_online_policy_disallows_remote_use(self) -> None:
        update = TelegramInboundMessage(update_id=7, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.current_mode = "online"
            config.selected_mode = "online"
            config.selected_provider = "openai"
            config.policy = "always_offline"
            config_store.save(config)
            service._config = config_store.load()
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("online ask is blocked", telegram_service.sent_messages[0][1].lower())
            self.assertIn("always offline policy", telegram_service.sent_messages[0][1].lower())

    def test_ask_blocks_when_readiness_is_not_ready(self) -> None:
        update = TelegramInboundMessage(update_id=8, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report("health", "blocked", "error", "Blocked")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("not ready", telegram_service.sent_messages[0][1].lower())

    def test_no_silent_provider_fallback_occurs(self) -> None:
        update = TelegramInboundMessage(update_id=9, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        openai = _FakeOpenAIAdapter(
            validation_status=ProviderStatus(
                provider="openai",
                display_name="OpenAI",
                configured=False,
                available=False,
                validation_state="invalid",
                ready=False,
                message="Missing OpenAI API key.",
                is_local=False,
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, ollama, remote = self._make_service(
                tmp_dir=tmp,
                telegram_service=telegram_service,
                openai_adapter=openai,
            )
            config = config_store.load()
            config.current_mode = "online"
            config.selected_mode = "online"
            config.selected_provider = "openai"
            config.policy = "always_online"
            config_store.save(config)
            service._config = config_store.load()
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertEqual(remote.ask_calls, 0)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertIn("online ask is blocked", telegram_service.sent_messages[0][1].lower())

    def test_duplicate_suppression_still_applies_to_ask_commands(self) -> None:
        duplicate = TelegramInboundMessage(update_id=10, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(duplicate,)], ignore_offset=True)
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.telegram_last_processed_update_id = 10
            config_store.save(config)
            service._config = config_store.load()
            service.start_telegram_loop()
            time.sleep(0.15)
            snapshot = service.stop_telegram_loop()
            self.assertEqual(telegram_service.sent_messages, [])
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Duplicate update 10 skipped", snapshot.telegram_last_inbound_summary)


if __name__ == "__main__":
    unittest.main()
