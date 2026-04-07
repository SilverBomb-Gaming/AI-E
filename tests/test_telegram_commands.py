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
        ask_delay_seconds: float = 0.0,
        ask_exception_message: str = "",
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
        self.ask_delay_seconds = ask_delay_seconds
        self.ask_exception_message = ask_exception_message
        self.ask_calls = 0
        self.last_ask_kwargs: dict[str, object] = {}

    def validate(self, **kwargs: object) -> ProviderStatus:
        return self.validation_status

    def ask(self, **kwargs: object) -> ProviderReply:
        self.ask_calls += 1
        self.last_ask_kwargs = dict(kwargs)
        if self.ask_delay_seconds > 0:
            time.sleep(self.ask_delay_seconds)
        if self.ask_exception_message:
            raise RuntimeError(self.ask_exception_message)
        return self.ask_reply


class _FakeOpenAIAdapter:
    def __init__(
        self,
        *,
        validation_status: ProviderStatus | None = None,
        ask_reply: ProviderReply | None = None,
        ask_delay_seconds: float = 0.0,
        ask_exception_message: str = "",
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
        self.ask_delay_seconds = ask_delay_seconds
        self.ask_exception_message = ask_exception_message
        self.ask_calls = 0
        self.last_ask_kwargs: dict[str, object] = {}

    def validate(self, **kwargs: object) -> ProviderStatus:
        return self.validation_status

    def ask(self, **kwargs: object) -> ProviderReply:
        self.ask_calls += 1
        self.last_ask_kwargs = dict(kwargs)
        if self.ask_delay_seconds > 0:
            time.sleep(self.ask_delay_seconds)
        if self.ask_exception_message:
            raise RuntimeError(self.ask_exception_message)
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

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def test_help_command_formatting_is_concise_and_lists_commands(self) -> None:
        update = TelegramInboundMessage(update_id=1, chat_id="chat-1", text="/help", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertLessEqual(len(reply), 500)
            self.assertEqual(lines[0], "Operator commands")
            self.assertIn("/capabilities - current capability gate summary", lines)
            self.assertIn("/ask <prompt> - concise provider reply", lines)
            self.assertIn("/askd <prompt> - more detailed provider reply", lines)
            self.assertEqual(lines[-1], "Plain text is not auto-routed to /ask.")

    def test_status_command_is_mobile_readable_and_shows_loop_activity(self) -> None:
        update = TelegramInboundMessage(update_id=2, chat_id="chat-1", text="/status", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertEqual(lines[0], "Status")
            self.assertIn("Runtime: running", lines)
            self.assertIn("Health: Healthy", lines)
            self.assertIn("Security: Safe", lines)
            self.assertIn("Readiness: Ready", lines)
            self.assertIn("Mode: offline", lines)
            self.assertIn("Policy: Ask Before Online", lines)
            self.assertTrue(any(line.startswith("Provider: Ollama") for line in lines))
            self.assertIn("Telegram loop: Running", lines)
            self.assertTrue(any(line.startswith("Loop activity:") for line in lines))
            self.assertLessEqual(len(lines), 11)
            self.assertEqual(snapshot.last_capability_id, "status.read")
            self.assertEqual(snapshot.last_capability_state, "allowed")

    def test_mode_command_reports_confirmation_gated_remote_use(self) -> None:
        update = TelegramInboundMessage(update_id=3, chat_id="chat-1", text="/mode", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.selected_mode = "online"
            config.current_mode = "offline"
            config.selected_provider = "openai"
            config.policy = "ask_before_online"
            config_store.save(config)
            service._config = config_store.load()
            _, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertIn("Remote use: Confirmation-gated", lines)
            self.assertIn("Reason: Online Mode is selected but not activated yet. Confirm it in the desktop app.", lines)

    def test_capabilities_command_returns_compact_summary(self) -> None:
        update = TelegramInboundMessage(update_id=4, chat_id="chat-1", text="/capabilities", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertEqual(lines[0], "Capabilities")
            self.assertIn("- status.read: Allowed", reply)
            self.assertIn("- mode.read: Allowed", reply)
            self.assertIn("- models.read: Allowed", reply)
            self.assertIn("- ask.provider_query: Allowed", reply)
            self.assertEqual(snapshot.last_capability_id, "capabilities.read")
            self.assertEqual(snapshot.last_capability_state, "allowed")

    def test_models_command_caps_long_model_lists(self) -> None:
        update = TelegramInboundMessage(update_id=4, chat_id="chat-1", text="/models", sender_label="@tester")
        models = tuple(f"model-{index}" for index in range(1, 8))
        ollama = _FakeOllamaAdapter(
            validation_status=ProviderStatus(
                provider="ollama",
                display_name="Ollama",
                configured=True,
                available=True,
                validation_state="valid",
                ready=True,
                message="Ollama is ready.",
                is_local=True,
                model="model-1",
                available_models=models,
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertIn("- model-1", reply)
            self.assertIn("- model-5", reply)
            self.assertNotIn("- model-6", reply)
            self.assertIn("... and 2 more", reply)
            self.assertEqual(snapshot.last_capability_id, "models.read")

    def test_ask_parsing_handles_extra_whitespace_and_casing(self) -> None:
        update = TelegramInboundMessage(update_id=5, chat_id="chat-1", text="  /ASK   hello there  ", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 1)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(ollama.last_ask_kwargs.get("prompt"), "hello there")
            self.assertTrue(reply.startswith("Answer (Offline | Ollama / llama3.1:latest)"))

    def test_missing_prompt_for_ask_returns_usage_hint(self) -> None:
        update = TelegramInboundMessage(update_id=6, chat_id="chat-1", text="/ask   ", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(reply, "Can't run /ask right now.\nReason: No prompt was provided.\nNext: Try /ask <prompt>.")

    def test_malformed_command_returns_short_correction(self) -> None:
        update = TelegramInboundMessage(update_id=7, chat_id="chat-1", text="/askhello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(reply, "Couldn't parse that command.\nNext: Use /ask <prompt> or /askd <prompt>.")
            self.assertIn("malformed command", snapshot.telegram_last_inbound_summary)

    def test_inflight_same_chat_second_ask_is_rejected_without_second_provider_call(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=8, chat_id="chat-1", text="/ask first", sender_label="@tester"),
            TelegramInboundMessage(update_id=9, chat_id="chat-1", text="/ask second", sender_label="@tester"),
        )
        ollama = _FakeOllamaAdapter(ask_delay_seconds=0.1)
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, local_ollama, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service._provider_ask_cooldown_seconds = 0.0
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            self.assertEqual(local_ollama.ask_calls, 1)
            self.assertTrue(telegram_service.sent_messages[0][1].startswith("Answer (Offline | Ollama / llama3.1:latest)"))
            self.assertEqual(
                telegram_service.sent_messages[1][1],
                "Can't run /ask right now.\nReason: Another provider-backed ask is still running for this chat.\nNext: Wait for the current reply before sending another ask.",
            )
            self.assertIn("blocked", snapshot.telegram_last_ask_status)

    def test_timeout_returns_one_clear_failure_and_no_duplicate_final_reply(self) -> None:
        update = TelegramInboundMessage(update_id=10, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        ollama = _FakeOllamaAdapter(ask_delay_seconds=0.2)
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, local_ollama, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service._provider_timeouts["ollama"] = 0.05
            service._provider_ask_cooldown_seconds = 0.0
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1, timeout=2.0))
            time.sleep(0.3)
            snapshot = service.stop_telegram_loop()
            self.assertEqual(local_ollama.ask_calls, 1)
            self.assertEqual(len(telegram_service.sent_messages), 1)
            self.assertEqual(
                telegram_service.sent_messages[0][1],
                "Provider request timed out.\nReason: Ollama did not finish before the timeout.\nNext: Wait a moment, then try again.",
            )
            self.assertIn("timed out via Ollama", snapshot.telegram_last_ask_status)

    def test_rate_limit_blocks_rapid_repeated_asks_but_status_still_works(self) -> None:
        updates = [
            (TelegramInboundMessage(update_id=11, chat_id="chat-1", text="/ask first", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=12, chat_id="chat-1", text="/ask second", sender_label="@tester"),),
            (TelegramInboundMessage(update_id=13, chat_id="chat-1", text="/status", sender_label="@tester"),),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=updates)
            service, _, _, _, ollama, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._provider_ask_cooldown_seconds = 30.0
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            self.assertEqual(ollama.ask_calls, 1)
            self.assertTrue(telegram_service.sent_messages[0][1].startswith("Answer (Offline | Ollama / llama3.1:latest)"))
            self.assertEqual(
                telegram_service.sent_messages[1][1],
                "Can't run /ask right now.\nReason: Provider ask rate limit is active for this chat. Wait about 30.0s.\nNext: Wait a moment, then resend your ask command.",
            )
            self.assertIn("Status", telegram_service.sent_messages[2][1])

    def test_provider_unavailable_failure_remains_clear(self) -> None:
        update = TelegramInboundMessage(update_id=14, chat_id="chat-1", text="/ask hello", sender_label="@tester")
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
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(reply, "Can't run /ask right now.\nReason: Ollama service is unavailable.\nNext: Validate Ollama in the desktop app before asking again.")
            self.assertEqual(snapshot.last_capability_id, "ask.provider_query")
            self.assertEqual(snapshot.last_capability_state, "unavailable")


    def test_policy_block_remains_clear(self) -> None:
        update = TelegramInboundMessage(update_id=15, chat_id="chat-1", text="/ask hello", sender_label="@tester")
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
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(reply, "Can't run /ask right now.\nReason: Always Offline policy is active.\nNext: Switch to Offline Mode or activate Online Mode explicitly in the desktop app.")
            self.assertEqual(snapshot.last_capability_id, "ask.provider_query")
            self.assertEqual(snapshot.last_capability_state, "blocked")


    def test_no_silent_provider_fallback_occurs(self) -> None:
        update = TelegramInboundMessage(update_id=16, chat_id="chat-1", text="/ask hello", sender_label="@tester")
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
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(remote.ask_calls, 0)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(reply, "Can't run /ask right now.\nReason: Missing OpenAI API key.\nNext: Save or validate the OpenAI configuration in the desktop app.")
            self.assertNotIn("Ollama", reply)

    def test_duplicate_suppression_still_applies_to_ask_commands(self) -> None:
        duplicate = TelegramInboundMessage(update_id=17, chat_id="chat-1", text="/askd hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(duplicate,)], ignore_offset=True)
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.telegram_last_processed_update_id = 17
            config_store.save(config)
            service._config = config_store.load()
            service.start_telegram_loop()
            time.sleep(0.15)
            snapshot = service.stop_telegram_loop()
            self.assertEqual(telegram_service.sent_messages, [])
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Duplicate update 17 skipped", snapshot.telegram_last_inbound_summary)


if __name__ == "__main__":
    unittest.main()
