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
from app.controller.telegram_service import TelegramApiError, TelegramInboundMessage, mask_telegram_token
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderStatus
from app.runtime.models import OllamaInstallation, OpenClawInstallation, RuntimeInspection, RuntimeStatus


VALID_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"


class _FakeRuntimeManager:
    def __init__(self, *, runtime_state: str = "running") -> None:
        pid = 4321 if runtime_state == "running" else None
        process_exists = runtime_state == "running"
        process_responsive = runtime_state == "running"
        listener_addresses = ("127.0.0.1",) if runtime_state == "running" else ()
        self._status = RuntimeStatus(
            runtime_state=runtime_state,  # type: ignore[arg-type]
            status_message="OpenClaw gateway running on port 18789." if runtime_state == "running" else "Runtime stopped.",
            openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
            ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
            pid=pid,
        )
        self._inspection = RuntimeInspection(
            configured_bind="loopback",
            configured_host="127.0.0.1",
            configured_port=18789,
            cli_reachable=True,
            process_exists=process_exists,
            process_responsive=process_responsive,
            listener_addresses=listener_addresses,
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
        self._inspection = replace(self._inspection, process_exists=True, process_responsive=True, listener_addresses=("127.0.0.1",))
        return self._status

    def stop_runtime(self) -> RuntimeStatus:
        self._status = replace(self._status, runtime_state="stopped", status_message="Runtime stopped.", pid=None)
        self._inspection = replace(self._inspection, process_exists=False, process_responsive=False, listener_addresses=())
        return self._status

    def restart_runtime(self) -> RuntimeStatus:
        return self.start_runtime()

    def clear_logs(self) -> RuntimeStatus:
        return self._status


class _ReadyOllamaAdapter:
    def validate(self, **kwargs: object) -> ProviderStatus:
        preferred_model = str(kwargs.get("preferred_model") or "llama3.1:latest")
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama is ready.",
            is_local=True,
            model=preferred_model,
            available_models=(preferred_model,),
        )


class _ReadyOpenAIAdapter:
    def validate(self, **kwargs: object) -> ProviderStatus:
        return ProviderStatus(
            provider="openai",
            display_name="OpenAI",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="OpenAI is ready.",
            is_local=False,
        )


class _FakeTelegramService:
    def __init__(
        self,
        *,
        update_batches: list[tuple[TelegramInboundMessage, ...]] | None = None,
        ignore_offset: bool = False,
        validation_state: str = "valid",
        validation_message: str = "Telegram bot @test_console_bot authenticated successfully.",
        raise_on_send: str = "",
    ) -> None:
        self._update_batches = list(update_batches or [])
        self._ignore_offset = ignore_offset
        self._validation_state = validation_state
        self._validation_message = validation_message
        self._raise_on_send = raise_on_send
        self.sent_messages: list[tuple[str, str]] = []
        self.get_updates_offsets: list[int] = []

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
        if self._validation_state == "invalid":
            return TelegramChannelStatus(
                configured=True,
                token_present=True,
                token_masked=mask_telegram_token(token),
                validation_state="invalid",
                available=False,
                ready=False,
                message=self._validation_message,
            )
        if self._validation_state == "partial":
            return TelegramChannelStatus(
                configured=True,
                token_present=True,
                token_masked=mask_telegram_token(token),
                validation_state="partial",
                available=False,
                ready=False,
                message=self._validation_message,
            )
        return TelegramChannelStatus(
            configured=True,
            token_present=True,
            token_masked=mask_telegram_token(token),
            validation_state="valid",
            available=True,
            ready=True,
            message=self._validation_message,
            bot_id="1001",
            bot_username="test_console_bot",
            bot_display_name="Test Console",
        )

    def test_connection(self, *, secret_store, secret_id: str, existing_status: TelegramChannelStatus | None = None) -> TelegramChannelStatus:
        validated = self.validate(secret_store=secret_store, secret_id=secret_id)
        timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
        if validated.ready:
            return replace(
                validated,
                last_test_result="passed",
                last_test_message="Telegram connection test passed for @test_console_bot.",
                last_test_at=timestamp,
            )
        fallback = existing_status or TelegramChannelStatus()
        return replace(
            validated,
            last_test_result="failed",
            last_test_message=validated.message or fallback.last_test_message,
            last_test_at=timestamp,
        )

    def get_updates(self, *, secret_store, secret_id: str, offset: int = 0, timeout: int = 2) -> tuple[TelegramInboundMessage, ...]:
        self.get_updates_offsets.append(offset)
        if self._update_batches:
            batch = self._update_batches.pop(0)
            if self._ignore_offset:
                return batch
            return tuple(update for update in batch if update.update_id >= offset)
        time.sleep(0.02)
        return ()

    def send_text(self, *, secret_store, secret_id: str, chat_id: str, text: str) -> int:
        if self._raise_on_send:
            raise TelegramApiError(self._raise_on_send)
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


class TelegramLoopTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        runtime_state: str = "running",
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state=runtime_state),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _ReadyOllamaAdapter(), "openai": _ReadyOpenAIAdapter()},
            telegram_service=telegram_service or _FakeTelegramService(),
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        return service, config_store, secret_store, service._telegram_service  # type: ignore[return-value]

    def test_polling_loop_start_and_stop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _, telegram_service = self._make_service(tmp_dir=tmp)
            started = service.start_telegram_loop()
            self.assertIn(started.telegram_loop_state, {"starting", "running"})
            self.assertTrue(_wait_until(lambda: service.snapshot().telegram_loop_state == "running"))
            self.assertEqual(service.snapshot().telegram_loop_activity, "polling")
            stopped = service.stop_telegram_loop()
            self.assertEqual(stopped.telegram_loop_state, "stopped")
            self.assertGreaterEqual(len(telegram_service.get_updates_offsets), 1)

    def test_update_offset_persists_across_restart(self) -> None:
        update = TelegramInboundMessage(update_id=11, chat_id="chat-1", text="/start", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertEqual(config_store.load().telegram_last_processed_update_id, 11)

            second_service_telegram = _FakeTelegramService(update_batches=[(update,)])
            second_service, second_store, second_secrets, second_telegram = self._make_service(
                tmp_dir=tmp,
                telegram_service=second_service_telegram,
            )
            second_secrets.put_secret("telegram/default", VALID_TOKEN)
            second_service.start_telegram_loop()
            time.sleep(0.15)
            second_service.stop_telegram_loop()
            self.assertEqual(second_store.load().telegram_last_processed_update_id, 11)
            self.assertEqual(second_telegram.sent_messages, [])

    def test_duplicate_update_is_suppressed(self) -> None:
        duplicate = TelegramInboundMessage(update_id=7, chat_id="chat-1", text="/start", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(duplicate,)], ignore_offset=True)
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.telegram_last_processed_update_id = 7
            config_store.save(config)
            service._config = config_store.load()
            service.start_telegram_loop()
            time.sleep(0.15)
            snapshot = service.stop_telegram_loop()
            self.assertEqual(telegram_service.sent_messages, [])
            self.assertIn("Duplicate update 7 skipped", snapshot.telegram_last_inbound_summary)

    def test_start_command_returns_confirmation(self) -> None:
        update = TelegramInboundMessage(update_id=1, chat_id="chat-1", text="/start", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report("health", "ok", "info", "Healthy")
            service._latest_security_report = _report("security", "ok", "info", "Safe")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[0][1]
            self.assertIn("Windows OpenClaw Operator Console v2.1 is connected.", reply)
            self.assertIn("Readiness: Ready", reply)
            self.assertIn("Use /help to see supported commands.", reply)

    def test_status_command_returns_runtime_and_safety_summary(self) -> None:
        update = TelegramInboundMessage(update_id=2, chat_id="chat-1", text="/status", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report("health", "ok", "info", "Healthy")
            service._latest_security_report = _report("security", "ok", "info", "Safe")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[0][1]
            self.assertIn("Runtime: running", reply)
            self.assertIn("Health: Healthy", reply)
            self.assertIn("Security: Safe", reply)
            self.assertIn("Mode: offline", reply)

    def test_readiness_not_ready_refuses_generic_reply(self) -> None:
        update = TelegramInboundMessage(update_id=3, chat_id="chat-1", text="hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report("health", "blocked", "error", "Blocked")
            service._latest_security_report = _report("security", "ok", "info", "Safe")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertIn("not ready", telegram_service.sent_messages[0][1].lower())

    def test_runtime_unavailable_returns_clear_message(self) -> None:
        update = TelegramInboundMessage(update_id=4, chat_id="chat-1", text="hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _ = self._make_service(tmp_dir=tmp, runtime_state="stopped", telegram_service=telegram_service)
            service._latest_health_report = _report("health", "ok", "info", "Healthy")
            service._latest_security_report = _report("security", "ok", "info", "Safe")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            service.stop_telegram_loop()
            self.assertIn("runtime is not available", telegram_service.sent_messages[0][1].lower())

    def test_inbound_summary_is_sanitized(self) -> None:
        raw_secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
        update = TelegramInboundMessage(update_id=5, chat_id="chat-1", text=raw_secret, sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report("health", "ok", "info", "Healthy")
            service._latest_security_report = _report("security", "ok", "info", "Safe")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
            snapshot = service.stop_telegram_loop()
            self.assertNotIn(raw_secret, snapshot.telegram_last_inbound_summary)
            self.assertIn("text message received", snapshot.telegram_last_inbound_summary)


if __name__ == "__main__":
    unittest.main()



