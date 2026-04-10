from __future__ import annotations

import re
import tempfile
import time
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.channel_models import TelegramChannelStatus
from app.controller.diagnostic_models import DiagnosticItem
from app.controller.diagnostic_models import DiagnosticReport
from app.controller.node_config import NodeConfigStore
from app.controller.node_models import NodeDescriptor
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
        prewarm_reply: ProviderReply | None = None,
        prewarm_delay_seconds: float = 0.0,
        prewarm_exception_message: str = "",
        require_prewarm_before_ask: bool = False,
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
        self.prewarm_reply = prewarm_reply or ProviderReply(
            provider="ollama",
            ok=True,
            text="pong",
            message="Ollama prewarm completed.",
            model="llama3.1:latest",
        )
        self.ask_delay_seconds = ask_delay_seconds
        self.ask_exception_message = ask_exception_message
        self.prewarm_delay_seconds = prewarm_delay_seconds
        self.prewarm_exception_message = prewarm_exception_message
        self.require_prewarm_before_ask = require_prewarm_before_ask
        self.ask_calls = 0
        self.prewarm_calls = 0
        self.last_ask_kwargs: dict[str, object] = {}
        self.last_prewarm_kwargs: dict[str, object] = {}

    def validate(self, **kwargs: object) -> ProviderStatus:
        return self.validation_status

    def ask(self, **kwargs: object) -> ProviderReply:
        self.ask_calls += 1
        self.last_ask_kwargs = dict(kwargs)
        if self.require_prewarm_before_ask and self.prewarm_calls == 0:
            return ProviderReply(
                provider="ollama",
                ok=False,
                text="",
                message="Model was not prewarmed.",
                model=self.validation_status.model,
            )
        if self.ask_delay_seconds > 0:
            time.sleep(self.ask_delay_seconds)
        if self.ask_exception_message:
            raise RuntimeError(self.ask_exception_message)
        return self.ask_reply

    def prewarm(self, **kwargs: object) -> ProviderReply:
        self.prewarm_calls += 1
        self.last_prewarm_kwargs = dict(kwargs)
        if self.prewarm_delay_seconds > 0:
            time.sleep(self.prewarm_delay_seconds)
        if self.prewarm_exception_message:
            raise RuntimeError(self.prewarm_exception_message)
        return self.prewarm_reply


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


def _report(
    check_type: str,
    overall_status: str,
    overall_severity: str,
    summary: str,
    *,
    items: tuple[DiagnosticItem, ...] = (),
) -> DiagnosticReport:
    return DiagnosticReport(
        check_type=check_type,  # type: ignore[arg-type]
        overall_status=overall_status,  # type: ignore[arg-type]
        overall_severity=overall_severity,  # type: ignore[arg-type]
        ran_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        summary=summary,
        items=items,
    )


def _item(check_type: str, severity: str, code: str, message: str) -> DiagnosticItem:
    status = "fail" if severity == "error" else "warn"
    return DiagnosticItem(
        check_type=check_type,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
        severity=severity,  # type: ignore[arg-type]
        code=code,
        message=message,
        recommended_action="Resolve in operator console.",
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
        activate_runtime: bool = True,
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
        if activate_runtime:
            service.activate_runtime_control_plane()
        return service, config_store, secret_store, tg, local_ollama, remote_openai

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def _run_until(self, service: ControllerService, telegram_service: _FakeTelegramService, expected_messages: int) -> object:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == expected_messages, timeout=2.0))
        return service.stop_telegram_loop()

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
        match = re.search(r"ID: ([A-F0-9]+)", reply)
        self.assertIsNotNone(match)
        return match.group(1)

    def _extract_workflow_id(self, reply: str) -> str:
        match = re.search(r"(WF-[A-F0-9]{6})", reply)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_help_command_formatting_is_concise_and_lists_commands(self) -> None:
        update = TelegramInboundMessage(update_id=1, chat_id="chat-1", text="/help", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertLessEqual(len(reply), 520)
            self.assertEqual(lines[0], "Operator commands")
            self.assertIn("/chat", lines[1])
            self.assertIn("/translate", lines[1])
            self.assertIn("/refine", lines[1])
            self.assertIn("/planbuild", lines[2])
            self.assertIn("/planstep", lines[2])
            self.assertIn("/bundleapprove", lines[3])
            self.assertIn("cancel", lines[3])
            self.assertIn("/bootstrapproject", lines[4])
            self.assertIn("/bootstrapapprove", lines[4])
            self.assertIn("/createfile", lines[5])
            self.assertIn("/writefile", lines[5])
            self.assertIn("/run", lines[6])
            self.assertIn("/nodes", lines[6])
            self.assertIn("/capabilities", lines[7])
            self.assertIn("/contexts", lines[7])
            self.assertIn("/ask", lines[8])
            self.assertIn("askctx", lines[8])
            self.assertIn("/explainrepo", lines[9])
            self.assertIn("summarizeweb", lines[9])
            self.assertIn("/workflows", lines[10])
            self.assertIn("cancelworkflow", lines[10])


    def test_nodes_commands_list_select_view_and_clear_registered_nodes(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=34, chat_id="chat-1", text="/nodes", sender_label="@tester"),
            TelegramInboundMessage(update_id=35, chat_id="chat-1", text="/nodeselect mock-gpu", sender_label="@tester"),
            TelegramInboundMessage(update_id=36, chat_id="chat-1", text="/nodeview mock-gpu", sender_label="@tester"),
            TelegramInboundMessage(update_id=37, chat_id="chat-1", text="/nodeclear", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            node_config_store = NodeConfigStore(config_path=Path(tmp) / "node_config.json")
            node_config = node_config_store.load()
            node_config.registry_root = str((Path(tmp) / "registry").resolve())
            node_config_store.save(node_config)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._node_registry.register_node(
                NodeDescriptor(
                    node_id="mock-gpu",
                    display_name="Bedroom GPU Rig",
                    role="executor",
                    node_type="mock",
                    status="online",
                    transport="mock",
                    summary="Simulated remote execution node for controller tests.",
                    capability_labels=("/run", "/test"),
                )
            )
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            self.assertIn("[NODES]", telegram_service.sent_messages[0][1])
            self.assertIn("mock-gpu", telegram_service.sent_messages[0][1])
            self.assertIn("Role: executor", telegram_service.sent_messages[0][1])
            self.assertEqual(
                telegram_service.sent_messages[1][1],
                "Selected node: mock-gpu | Bedroom GPU Rig | mock | online",
            )
            self.assertIn("[NODE]", telegram_service.sent_messages[2][1])
            self.assertIn("ID: mock-gpu", telegram_service.sent_messages[2][1])
            self.assertIn("Role: executor", telegram_service.sent_messages[2][1])
            self.assertIn("Commands: /run /test", telegram_service.sent_messages[2][1])
            self.assertEqual(
                telegram_service.sent_messages[3][1],
                f"Node selection cleared. Active node: local | {service.resolve_execution_node().node.display_name} | local | online",
            )
            self.assertEqual(snapshot.selected_node_id, "local")

    def test_confirmed_run_uses_selected_mock_node_without_local_execution(self) -> None:
        first_update = TelegramInboundMessage(update_id=38, chat_id="chat-1", text="/run python validate_runtime.py", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            node_config_store = NodeConfigStore(config_path=Path(tmp) / "node_config.json")
            node_config = node_config_store.load()
            node_config.registry_root = str((Path(tmp) / "registry").resolve())
            node_config_store.save(node_config)
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            config = config_store.load()
            config.repo_root = tmp
            config.file_allowed_roots = (tmp,)
            config_store.save(config)
            service._config = config_store.load()
            service._normalize_repo_root_config()
            service._normalize_file_roots_config()
            service._node_registry.register_node(
                NodeDescriptor(
                    node_id="mock-gpu",
                    display_name="Bedroom GPU Rig",
                    role="executor",
                    node_type="mock",
                    status="online",
                    transport="mock",
                    summary="Simulated remote execution node for controller tests.",
                    capability_labels=("/run", "/test"),
                    metadata={"mock_output_summary": "Mock node executed validate_runtime.py", "mock_exit_code": 0},
                )
            )
            service.select_execution_node("mock-gpu")
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            self.assertIn("Node: Bedroom GPU Rig (mock-gpu) | mock", prompt_reply)

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=39, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)
            self.assertIn("Node: Bedroom GPU Rig (mock-gpu)", confirm_reply)
            self.assertIn("Summary: Mock node executed validate_runtime.py", confirm_reply)

    def test_status_command_is_mobile_readable_and_shows_loop_activity(self) -> None:
        update = TelegramInboundMessage(update_id=2, chat_id="chat-1", text="/status", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertEqual(lines[0], "System status")
            self.assertIn("Health: OK", lines)
            self.assertIn("Security: OK", lines)
            self.assertIn("Readiness: READY", lines)
            self.assertTrue(any(line.startswith("Repo:") for line in lines))
            self.assertIn("Node: local", lines)
            self.assertTrue(any(line.startswith("Allowed:") for line in lines))
            self.assertTrue(any(line.startswith("Blocked:") for line in lines))
            self.assertLessEqual(len(lines), 12)
            self.assertEqual(snapshot.last_capability_id, "status.read")
            self.assertEqual(snapshot.last_capability_state, "allowed")
            self.assertIn("read-only | local | offline-safe", snapshot.last_capability_trust_summary)

    def test_translate_command_returns_concise_translation_without_execution_side_effects(self) -> None:
        update = TelegramInboundMessage(
            update_id=201,
            chat_id="chat-1",
            text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation", reply)
            self.assertIn("Type: website", reply)
            self.assertIn("Session: TR-", reply)
            self.assertIn("Confirmed:", reply)
            self.assertIn("Open questions:", reply)
            self.assertIn("Next:", reply)
            self.assertEqual(snapshot.last_capability_id, "intent.translate.read")
            self.assertEqual(snapshot.last_capability_state, "allowed")

    def test_translate_missing_request_returns_usage_hint(self) -> None:
        update = TelegramInboundMessage(update_id=202, chat_id="chat-1", text="/translate", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(
                reply,
                "Couldn't translate that request.\nReason: No product idea or request was provided.\nNext: Use /translate <idea or request>.",
            )

    def test_refine_updates_current_translation_draft_without_execution_side_effects(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=203, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=204, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation refined", reply)
            self.assertIn("stack: react", reply)
            self.assertIn("deployment_target: vercel", reply)
            self.assertEqual(snapshot.last_capability_id, "intent.refine.read")

    def test_refine_with_no_active_draft_fails_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=205, chat_id="chat-1", text="/refine use React", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(
                reply,
                "Couldn't refine that draft.\nReason: No active translation draft exists.\nNext: Use /translate <idea or request> first.",
            )

    def test_translateview_shows_current_draft_summary(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=206, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=207, chat_id="chat-1", text="/translateview", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation view", reply)
            self.assertIn("Session: TR-", reply)
            self.assertIn("Open questions:", reply)

    def test_translateview_with_no_active_draft_reports_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=208, chat_id="chat-1", text="/translateview", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(reply, "No active translation draft.\nNext: Use /translate <idea or request>.")

    def test_translateclear_archives_active_draft(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=209, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=210, chat_id="chat-1", text="/translateclear", sender_label="@tester"),
            TelegramInboundMessage(update_id=211, chat_id="chat-1", text="/translateview", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            clear_reply = telegram_service.sent_messages[1][1]
            view_reply = telegram_service.sent_messages[2][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation draft cleared.", clear_reply)
            self.assertEqual(view_reply, "No active translation draft.\nNext: Use /translate <idea or request>.")

    def test_translateclear_with_no_active_draft_is_clean_noop(self) -> None:
        update = TelegramInboundMessage(update_id=212, chat_id="chat-1", text="/translateclear", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(reply, "No active translation draft to clear.")

    def test_planbuild_returns_concise_build_plan_without_execution_side_effects(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=213, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=214, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React", sender_label="@tester"),
            TelegramInboundMessage(update_id=215, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Build plan", reply)
            self.assertIn("Plan: BP-", reply)
            self.assertIn("Phases: Scope contract; Experience build; Launch prep", reply)
            self.assertIn("Dependencies:", reply)
            self.assertIn("Next:", reply)
            self.assertEqual(snapshot.last_capability_id, "build.plan.read")

    def test_planbuild_with_no_active_draft_fails_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=216, chat_id="chat-1", text="/planbuild", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(
                reply,
                "Couldn't plan that build.\nReason: No active translation draft exists.\nNext: Use /translate <idea or request> first.",
            )

    def test_planview_shows_current_build_plan(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=217, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=218, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=219, chat_id="chat-1", text="/planview", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Build plan view", reply)
            self.assertIn("Plan: BP-", reply)

    def test_planview_with_no_active_plan_reports_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=220, chat_id="chat-1", text="/planview", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(reply, "No active build plan.\nNext: Use /planbuild after /translate or /refine.")

    def test_planclear_clears_active_plan(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=221, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=222, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=223, chat_id="chat-1", text="/planclear", sender_label="@tester"),
            TelegramInboundMessage(update_id=224, chat_id="chat-1", text="/planview", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            service.stop_telegram_loop()
            clear_reply = telegram_service.sent_messages[2][1]
            view_reply = telegram_service.sent_messages[3][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Build plan cleared.", clear_reply)
            self.assertEqual(view_reply, "No active build plan.\nNext: Use /planbuild after /translate or /refine.")

    def test_plan_is_invalidated_after_refinement(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=225, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=226, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=227, chat_id="chat-1", text="/refine use React and deploy to Vercel", sender_label="@tester"),
            TelegramInboundMessage(update_id=228, chat_id="chat-1", text="/planview", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            service.stop_telegram_loop()
            self.assertEqual(
                telegram_service.sent_messages[-1][1],
                "No active build plan.\nNext: Use /planbuild after /translate or /refine.",
            )

    def test_planstep_and_planapprove_progress_one_task_group_at_a_time(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=229, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=230, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=231, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=232, chat_id="chat-1", text="/planstep", sender_label="@tester"),
            TelegramInboundMessage(update_id=233, chat_id="chat-1", text="/planapprove", sender_label="@tester"),
            TelegramInboundMessage(update_id=234, chat_id="chat-1", text="/planstatus", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 6, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            planstep_reply = telegram_service.sent_messages[3][1]
            approve_reply = telegram_service.sent_messages[4][1]
            status_reply = telegram_service.sent_messages[5][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Plan step", planstep_reply)
            self.assertIn("Approve: /planapprove", planstep_reply)
            self.assertIn("Plan approval", approve_reply)
            self.assertIn("Executed: repo.status.read", approve_reply)
            self.assertIn("Outcome: success", approve_reply)
            self.assertIn("Plan status", status_reply)
            self.assertIn("Completed: 1", status_reply)
            self.assertIn("Ready: 1", status_reply)
            self.assertNotIn("Completed: 2", status_reply)
            self.assertEqual(snapshot.last_capability_id, "build.status.read")

    def test_planapprove_without_planstep_fails_cleanly(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=235, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=236, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=237, chat_id="chat-1", text="/planapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            self.assertEqual(
                telegram_service.sent_messages[-1][1],
                "Couldn't approve that plan step.\nReason: No proposed plan step exists.\nNext: Use /planstep first.",
            )

    def test_planstep_is_invalidated_when_plan_is_cleared(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=238, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=239, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=240, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=241, chat_id="chat-1", text="/planstep", sender_label="@tester"),
            TelegramInboundMessage(update_id=242, chat_id="chat-1", text="/planclear", sender_label="@tester"),
            TelegramInboundMessage(update_id=243, chat_id="chat-1", text="/planapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 6, timeout=2.0))
            service.stop_telegram_loop()
            self.assertEqual(
                telegram_service.sent_messages[-1][1],
                "Couldn't approve that plan step.\nReason: No active build plan exists.\nNext: Use /planbuild after /translate or /refine.",
            )

    def test_planstepbundle_proposes_a_bounded_three_step_bundle(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=244, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=245, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=246, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=247, chat_id="chat-1", text="/planstepbundle", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Bundle proposal", reply)
            self.assertIn("Bundle: BD-", reply)
            self.assertIn("Steps: 3 / max 3", reply)
            self.assertIn("Approve: /bundleapprove", reply)
            self.assertLessEqual(len(reply), 320)

    def test_bundleapprove_requires_a_proposed_bundle(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=248, chat_id="chat-1", text="/translate Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=249, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=250, chat_id="chat-1", text="/bundleapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            self.assertEqual(
                telegram_service.sent_messages[-1][1],
                "Couldn't approve that bundle.\nReason: No proposed bundle exists.\nNext: Use /planstepbundle first.",
            )

    def test_bundleapprove_executes_only_the_approved_slice(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=251, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=252, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=253, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=254, chat_id="chat-1", text="/planstepbundle", sender_label="@tester"),
            TelegramInboundMessage(update_id=255, chat_id="chat-1", text="/bundleapprove", sender_label="@tester"),
            TelegramInboundMessage(update_id=256, chat_id="chat-1", text="/bundlestatus", sender_label="@tester"),
            TelegramInboundMessage(update_id=257, chat_id="chat-1", text="/planstatus", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 7, timeout=2.0))
            snapshot = service.stop_telegram_loop()
            approve_reply = telegram_service.sent_messages[4][1]
            bundle_status_reply = telegram_service.sent_messages[5][1]
            plan_status_reply = telegram_service.sent_messages[6][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Bundle result", approve_reply)
            self.assertIn("Completed: 3/3", approve_reply)
            self.assertIn("Stop: approved_step_budget_reached", approve_reply)
            self.assertIn("Bundle: BD-", bundle_status_reply)
            self.assertIn("completed", bundle_status_reply)
            self.assertIn("Completed: 3/3", bundle_status_reply)
            self.assertIn("Plan status", plan_status_reply)
            self.assertIn("Completed: 3", plan_status_reply)
            self.assertNotIn("Completed: 4", plan_status_reply)
            self.assertEqual(snapshot.last_capability_id, "build.status.read")

    def test_bundle_is_invalidated_when_plan_is_cleared(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=258, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=259, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=260, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=261, chat_id="chat-1", text="/planstepbundle", sender_label="@tester"),
            TelegramInboundMessage(update_id=262, chat_id="chat-1", text="/planclear", sender_label="@tester"),
            TelegramInboundMessage(update_id=263, chat_id="chat-1", text="/bundlestatus", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 6, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertIn("Bundle status", reply)
            self.assertIn("invalidated", reply)
            self.assertIn("Stop: plan_cleared", reply)

    def test_bundlecancel_and_bundlereset_manage_bundle_state(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=264, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=265, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=266, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=267, chat_id="chat-1", text="/planstepbundle", sender_label="@tester"),
            TelegramInboundMessage(update_id=268, chat_id="chat-1", text="/bundlecancel", sender_label="@tester"),
            TelegramInboundMessage(update_id=269, chat_id="chat-1", text="/bundlestatus", sender_label="@tester"),
            TelegramInboundMessage(update_id=270, chat_id="chat-1", text="/bundlereset", sender_label="@tester"),
            TelegramInboundMessage(update_id=271, chat_id="chat-1", text="/bundlestatus", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 8, timeout=2.0))
            service.stop_telegram_loop()
            self.assertIn("Bundle cancelled.", telegram_service.sent_messages[4][1])
            self.assertIn("cancelled.", telegram_service.sent_messages[4][1])
            self.assertIn("Bundle status", telegram_service.sent_messages[5][1])
            self.assertIn("cancelled", telegram_service.sent_messages[5][1])
            self.assertIn("Bundle reset.", telegram_service.sent_messages[6][1])
            self.assertEqual(telegram_service.sent_messages[7][1], "No active bundle.\nNext: Use /planstepbundle after /planbuild.")

    def test_chat_new_product_idea_routes_to_translation_flow(self) -> None:
        update = TelegramInboundMessage(
            update_id=272,
            chat_id="chat-1",
            text="/chat I have an idea for a local desktop milestone tracker that exports CSV.",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation", reply)
            self.assertIn("Session: TR-", reply)
            self.assertLessEqual(len(reply), 700)

    def test_plain_text_new_product_idea_routes_to_translation_flow(self) -> None:
        update = TelegramInboundMessage(
            update_id=2721,
            chat_id="chat-1",
            text="I have an idea for a local desktop milestone tracker that exports CSV.",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            result = service._last_execution_result
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation", reply)
            self.assertIn("Session: TR-", reply)
            self.assertEqual(result.capability_id, "telegram.plain_text")
            self.assertEqual(result.telemetry["natural_chat_classification"]["intent_label"], "planning")
            self.assertEqual(result.telemetry["natural_chat_route"]["route_kind"], "legacy_chat")

    def test_plain_text_explanation_uses_latest_file_context(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=2722, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester"),
            TelegramInboundMessage(update_id=2723, chat_id="chat-1", text="What does this file do?", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            notes = root / "docs" / "notes.txt"
            notes.parent.mkdir(parents=True, exist_ok=True)
            notes.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.repo_root = str(root.resolve())
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            self._run_until(service, telegram_service, expected_messages=2)
            reply = telegram_service.sent_messages[1][1]
            result = service._last_execution_result
            self.assertEqual(ollama.ask_calls, 1)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Answer (Offline | Ollama", reply)
            self.assertEqual(result.capability_id, "telegram.plain_text")
            self.assertEqual(result.telemetry["natural_chat_classification"]["intent_label"], "explanation")
            self.assertEqual(result.telemetry["natural_chat_route"]["route_command"], "/askctx")

    def test_plain_text_planning_uses_bounded_contextual_ask(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=2724, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester"),
            TelegramInboundMessage(update_id=2725, chat_id="chat-1", text="Give me a plan for adding CSV export here.", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            notes = root / "docs" / "notes.txt"
            notes.parent.mkdir(parents=True, exist_ok=True)
            notes.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.repo_root = str(root.resolve())
            config.file_allowed_roots = (str(root.resolve()),)
            config_store.save(config)
            service._config = config_store.load()

            self._run_until(service, telegram_service, expected_messages=2)
            reply = telegram_service.sent_messages[1][1]
            result = service._last_execution_result
            self.assertEqual(ollama.ask_calls, 1)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Answer (Offline | Ollama", reply)
            self.assertEqual(result.telemetry["natural_chat_classification"]["intent_label"], "planning")
            self.assertEqual(result.telemetry["natural_chat_route"]["route_command"], "/askctx")

    def test_chat_active_draft_clarification_routes_to_refinement_flow(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=273, chat_id="chat-1", text="/chat I have an idea for a local desktop milestone tracker.", sender_label="@tester"),
            TelegramInboundMessage(update_id=274, chat_id="chat-1", text="/chat Use PySide6 and CSV export.", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation refined", reply)

    def test_chat_whats_next_with_active_plan_routes_to_planstep(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=275, chat_id="chat-1", text="/chat Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=276, chat_id="chat-1", text="/chat one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=277, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=278, chat_id="chat-1", text="/chat what's next?", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Plan step", reply)
            self.assertIn("Approve: /planapprove", reply)

    def test_chat_bundle_request_routes_to_bundle_proposal(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=279, chat_id="chat-1", text="/chat Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=280, chat_id="chat-1", text="/chat one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=281, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=282, chat_id="chat-1", text="/chat can we do the next 3 safe steps?", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertIn("Bundle proposal", reply)
            self.assertIn("Approve: /bundleapprove", reply)

    def test_chat_status_question_returns_project_state_summary(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=283, chat_id="chat-1", text="/chat Build me a landing page for BABYLON", sender_label="@tester"),
            TelegramInboundMessage(update_id=284, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=285, chat_id="chat-1", text="/chat where are we?", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            reply = telegram_service.sent_messages[-1][1]
            self.assertIn("Plan status", reply)

    def test_chat_ambiguous_input_asks_for_clarification(self) -> None:
        update = TelegramInboundMessage(update_id=286, chat_id="chat-1", text="/chat maybe", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertIn("too ambiguous", reply)
            self.assertIn("Do you want to start a new idea", reply)
            self.assertLessEqual(len(reply), 260)

    def test_plain_text_ambiguous_input_falls_back_safely(self) -> None:
        update = TelegramInboundMessage(update_id=2861, chat_id="chat-1", text="maybe", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            result = service._last_execution_result
            self.assertIn("too ambiguous", reply)
            self.assertIn("Do you want to start a new idea, ask for a plan, request a patch", reply)
            self.assertEqual(result.capability_id, "telegram.plain_text")
            self.assertEqual(result.telemetry["natural_chat_classification"]["intent_label"], "unknown_or_ambiguous")
            self.assertEqual(result.telemetry["natural_chat_route"]["route_kind"], "fallback")

    def test_chat_go_ahead_with_next_step_proposes_without_executing(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=287, chat_id="chat-1", text="/chat Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=288, chat_id="chat-1", text="/chat one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=289, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=290, chat_id="chat-1", text="/chat go ahead with the next step", sender_label="@tester"),
            TelegramInboundMessage(update_id=291, chat_id="chat-1", text="/planstatus", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 5, timeout=2.0))
            service.stop_telegram_loop()
            chat_reply = telegram_service.sent_messages[3][1]
            status_reply = telegram_service.sent_messages[4][1]
            self.assertIn("Plan step", chat_reply)
            self.assertIn("Approve: /planapprove", chat_reply)
            self.assertIn("Completed: 0", status_reply)
            self.assertIn("In progress: 1", status_reply)
            self.assertNotIn("Completed: 1", status_reply)

    def test_chat_approve_request_keeps_explicit_boundary(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=292, chat_id="chat-1", text="/chat Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=293, chat_id="chat-1", text="/chat one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=294, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=295, chat_id="chat-1", text="/planstep", sender_label="@tester"),
            TelegramInboundMessage(update_id=296, chat_id="chat-1", text="/chat approve it", sender_label="@tester"),
            TelegramInboundMessage(update_id=297, chat_id="chat-1", text="/planstatus", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 6, timeout=2.0))
            service.stop_telegram_loop()
            chat_reply = telegram_service.sent_messages[4][1]
            status_reply = telegram_service.sent_messages[5][1]
            self.assertIn("Approval stays explicit", chat_reply)
            self.assertIn("/planapprove", chat_reply)
            self.assertNotIn("Plan approval", chat_reply)
            self.assertIn("Completed: 0", status_reply)

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
            self.assertIn("Reason: Online Mode is selected, but each remote ask still needs one-shot approval with /confirm <id>.", lines)

    def test_capabilities_command_returns_compact_trust_aware_summary(self) -> None:
        update = TelegramInboundMessage(update_id=4, chat_id="chat-1", text="/capabilities", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            lines = reply.splitlines()
            self.assertEqual(lines[0], "Capabilities")
            self.assertIn("- help.read: Allowed | read-only | local | offline-safe", reply)
            self.assertIn("- status.read: Allowed | read-only | local | offline-safe", reply)
            self.assertIn("- mode.read: Allowed | read-only | local | offline-safe", reply)
            self.assertIn("- models.read: Allowed | read-only | local | offline-safe", reply)
            self.assertIn("- ask.provider_query: Allowed | external-side-effect | hybrid | online-sensitive", reply)
            self.assertIn("- audit.read: Allowed | read-only | local | offline-safe", reply)
            self.assertNotIn("telegram.parse_failure", reply)
            self.assertEqual(snapshot.last_capability_id, "capabilities.read")
            self.assertEqual(snapshot.last_capability_state, "allowed")
            self.assertIn("read-only | local | offline-safe", snapshot.last_capability_trust_summary)

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
            self.assertEqual(reply, "Couldn't run that ask.\nReason: No prompt was provided.\nNext: Try /ask <prompt>.")

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
            self.assertIn("System status", telegram_service.sent_messages[2][1])

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
            self.assertEqual(reply, "Can't run /ask right now.\nReason: Ollama service is unavailable.\nNext: Validate Ollama in the operator console before asking again.")
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
            self.assertEqual(reply, "Can't run /ask right now.\nReason: Always Offline policy is active.\nNext: Switch to Offline Mode or change policy before retrying the remote ask.")
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
            self.assertEqual(reply, "Can't run /ask right now.\nReason: Missing OpenAI API key.\nNext: Save or validate the OpenAI configuration in the operator console.")
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

    def test_confirmation_prompt_is_created_for_online_ask_under_ask_before_online(self) -> None:
        update = TelegramInboundMessage(update_id=18, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_online_confirmation_mode(service, config_store)
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Action requires confirmation.", reply)
            self.assertIn("Capability: ask.provider_query", reply)
            self.assertIn("Reply with: /confirm", reply)
            self.assertEqual(snapshot.last_capability_id, "ask.provider_query")
            self.assertEqual(snapshot.last_capability_state, "confirmation_required")
            self.assertEqual(snapshot.pending_confirmation_count, 1)

    def test_confirm_executes_online_request_exactly_once(self) -> None:
        first_update = TelegramInboundMessage(update_id=19, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=20, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            snapshot, confirm_reply = self._run_single_update(service, confirm_service)
            self.assertEqual(openai.ask_calls, 1)
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)
            self.assertIn("Answer (Online | OpenAI / gpt-5-mini)", confirm_reply)
            self.assertEqual(snapshot.pending_confirmation_count, 0)
            self.assertEqual(service._confirmation_store.get(confirmation_id).current_state, "approved")

    def test_deny_marks_confirmation_rejected_without_execution(self) -> None:
        first_update = TelegramInboundMessage(update_id=21, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            deny_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=22, chat_id="chat-1", text=f"/deny {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = deny_service
            snapshot, deny_reply = self._run_single_update(service, deny_service)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(deny_reply, f"Confirmation {confirmation_id} denied. Request not executed.")
            self.assertEqual(snapshot.pending_confirmation_count, 0)
            self.assertEqual(service._confirmation_store.get(confirmation_id).current_state, "rejected")

    def test_expired_confirmation_cannot_execute(self) -> None:
        first_update = TelegramInboundMessage(update_id=23, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            confirmation = service._confirmation_store.get(confirmation_id)
            service._confirmation_store._items[confirmation_id] = replace(
                confirmation,
                expires_at=(datetime.now().astimezone() - timedelta(seconds=5)).isoformat(timespec="seconds"),
            )

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=24, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn(f"Confirmation {confirmation_id} expired.", confirm_reply)
            self.assertEqual(service._confirmation_store.get(confirmation_id).current_state, "expired")

    def test_workflow_commands_report_and_cancel_paused_workflow(self) -> None:
        first_update = TelegramInboundMessage(
            update_id=801,
            chat_id="chat-1",
            text="/summarizeweb https://docs.openclaw.ai/guide",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            config = config_store.load()
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()

            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            workflow_id = service._workflow_store.current(chat_id="chat-1").workflow_id

            command_service = _FakeTelegramService(
                update_batches=[
                    (TelegramInboundMessage(update_id=802, chat_id="chat-1", text="/workflows", sender_label="@tester"),),
                    (TelegramInboundMessage(update_id=803, chat_id="chat-1", text=f"/workflowstatus {workflow_id}", sender_label="@tester"),),
                    (TelegramInboundMessage(update_id=804, chat_id="chat-1", text="/cancelworkflow", sender_label="@tester"),),
                    (TelegramInboundMessage(update_id=805, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),),
                ]
            )
            service._telegram_service = command_service
            snapshot = self._run_until(service, command_service, 4)

            workflows_reply = command_service.sent_messages[0][1]
            status_reply = command_service.sent_messages[1][1]
            cancel_reply = command_service.sent_messages[2][1]
            confirm_reply = command_service.sent_messages[3][1]

            self.assertIn(workflow_id, workflows_reply)
            self.assertIn("paused", workflows_reply)
            self.assertIn(f"ID: {workflow_id}", status_reply)
            self.assertIn(f"Pending confirmation: {confirmation_id}", status_reply)
            self.assertIn(f"Workflow cancelled: {workflow_id} web.summarize", cancel_reply)
            self.assertIn("already been rejected", confirm_reply)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(service._workflow_store.get(workflow_id).current_state, "cancelled")
            self.assertEqual(snapshot.last_workflow_state, "cancelled")
            self.assertIn(f"Workflow cancelled: {workflow_id} web.summarize", snapshot.last_workflow_summary)

    def test_workflow_expiry_blocks_resume_and_status_shows_expired(self) -> None:
        first_update = TelegramInboundMessage(
            update_id=806,
            chat_id="chat-1",
            text="/summarizeweb https://docs.openclaw.ai/guide",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            config = config_store.load()
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()

            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            workflow = service._workflow_store.current(chat_id="chat-1")
            self.assertIsNotNone(workflow)
            workflow_id = workflow.workflow_id
            self.assertTrue(service._workflow_store.expire_for_testing(chat_id="chat-1", workflow_id=workflow_id))

            command_service = _FakeTelegramService(
                update_batches=[
                    (TelegramInboundMessage(update_id=807, chat_id="chat-1", text=f"/workflowstatus {workflow_id}", sender_label="@tester"),),
                    (TelegramInboundMessage(update_id=808, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),),
                ]
            )
            service._telegram_service = command_service
            snapshot = self._run_until(service, command_service, 2)

            status_reply = command_service.sent_messages[0][1]
            confirm_reply = command_service.sent_messages[1][1]

            self.assertIn("State: expired", status_reply)
            self.assertIn(f"Workflow expired: {workflow_id} web.summarize", status_reply)
            self.assertIn(f"Confirmation {confirmation_id} expired.", confirm_reply)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(service._workflow_store.get(workflow_id).current_state, "expired")
            self.assertEqual(service._confirmation_store.get(confirmation_id).current_state, "expired")
            self.assertEqual(snapshot.last_workflow_state, "expired")

    def test_workflow_duplicate_confirm_does_not_reexecute(self) -> None:
        first_update = TelegramInboundMessage(
            update_id=809,
            chat_id="chat-1",
            text="/explainrepo",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)

            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            workflow_id = service._workflow_store.current(chat_id="chat-1").workflow_id

            first_confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=810, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = first_confirm_service
            snapshot = self._run_single_update(service, first_confirm_service)[0]

            second_confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=811, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = second_confirm_service
            _, duplicate_reply = self._run_single_update(service, second_confirm_service)

            self.assertEqual(openai.ask_calls, 1)
            self.assertIn(f"Workflow completed: {workflow_id} repo.explain", first_confirm_service.sent_messages[0][1])
            self.assertIn(f"Confirmation {confirmation_id} was already used.", duplicate_reply)
            workflow = service._workflow_store.get(workflow_id)
            self.assertEqual(workflow.current_state, "completed")
            self.assertEqual(workflow.metadata.get("consumed_confirmation_id"), confirmation_id)
            self.assertEqual(snapshot.last_workflow_state, "completed")

    def test_workflow_confirm_rejects_step_binding_mismatch_without_consuming_confirmation(self) -> None:
        first_update = TelegramInboundMessage(
            update_id=812,
            chat_id="chat-1",
            text="/summarizeweb https://docs.openclaw.ai/guide",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            config = config_store.load()
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()

            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            workflow = service._workflow_store.current(chat_id="chat-1")
            service._workflow_store.update(
                replace(
                    workflow,
                    metadata={**workflow.metadata, "pending_confirmation_step_id": "S9"},
                )
            )

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=813, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)

            self.assertEqual(openai.ask_calls, 0)
            self.assertIn(f"Confirmation {confirmation_id} no longer matches this workflow.", confirm_reply)
            self.assertIn("saved workflow step", confirm_reply)
            self.assertEqual(service._confirmation_store.get(confirmation_id).current_state, "pending")

    def test_workflow_terminal_resume_rejected_before_confirmation_is_consumed(self) -> None:
        first_update = TelegramInboundMessage(
            update_id=814,
            chat_id="chat-1",
            text="/summarizeweb https://docs.openclaw.ai/guide",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            config = config_store.load()
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()

            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            workflow = service._workflow_store.current(chat_id="chat-1")
            service._workflow_store.update(
                replace(
                    workflow,
                    current_state="completed",
                    finished_at="2000-01-01T00:00:00+00:00",
                )
            )

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=815, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)

            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("already completed and cannot be resumed", confirm_reply)
            self.assertEqual(service._confirmation_store.get(confirmation_id).current_state, "pending")

    def test_duplicate_confirm_does_not_reexecute(self) -> None:
        first_update = TelegramInboundMessage(update_id=25, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_service = _FakeTelegramService(
                update_batches=[
                    (TelegramInboundMessage(update_id=26, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),),
                    (TelegramInboundMessage(update_id=27, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),),
                ]
            )
            service._telegram_service = confirm_service
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(confirm_service.sent_messages) == 2, timeout=2.0))
            service.stop_telegram_loop()
            self.assertEqual(openai.ask_calls, 1)
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_service.sent_messages[0][1])
            self.assertIn(f"Confirmation {confirmation_id} was already used.", confirm_service.sent_messages[1][1])

    def test_confirmation_does_not_override_always_offline_policy(self) -> None:
        update = TelegramInboundMessage(update_id=28, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.selected_mode = "online"
            config.current_mode = "offline"
            config.selected_provider = "openai"
            config.policy = "always_offline"
            config_store.save(config)
            service._config = config_store.load()
            snapshot, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(snapshot.pending_confirmation_count, 0)
            self.assertIn("Always Offline policy is active.", reply)

    def test_confirmation_does_not_bypass_invalid_provider_after_state_changes(self) -> None:
        first_update = TelegramInboundMessage(update_id=29, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            openai.validation_status = ProviderStatus(
                provider="openai",
                display_name="OpenAI",
                configured=False,
                available=False,
                validation_state="invalid",
                ready=False,
                message="Missing OpenAI API key.",
                is_local=False,
            )

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=30, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn(f"Confirmation {confirmation_id} could not run.", confirm_reply)
            self.assertIn("Missing OpenAI API key.", confirm_reply)

    def test_confirmation_does_not_bypass_readiness_failure_after_state_changes(self) -> None:
        first_update = TelegramInboundMessage(update_id=31, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            service._latest_health_report = _report("health", "blocked", "error", "Blocked")

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=32, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn(f"Confirmation {confirmation_id} could not run.", confirm_reply)
            self.assertIn("Readiness is not ready.", confirm_reply)

    def test_readiness_not_ready_keeps_chat_translate_and_planbuild_available(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=301, chat_id="chat-1", text="/chat Build me a local desktop milestone tracker.", sender_label="@tester"),
            TelegramInboundMessage(update_id=302, chat_id="chat-1", text="/translate Build me a local desktop milestone tracker with CSV export.", sender_label="@tester"),
            TelegramInboundMessage(update_id=303, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report("health", "blocked", "error", "Blocked")
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()

            chat_reply = telegram_service.sent_messages[0][1]
            translate_reply = telegram_service.sent_messages[1][1]
            plan_reply = telegram_service.sent_messages[2][1]

            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation", chat_reply)
            self.assertNotEqual(chat_reply.splitlines()[0], "Status")
            self.assertIn("Translation", translate_reply)
            self.assertIn("Build plan", plan_reply)
            self.assertLessEqual(len(chat_reply), 700)

    def test_readiness_not_ready_blocks_repo_run_and_ask(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=304, chat_id="chat-1", text="/repo", sender_label="@tester"),
            TelegramInboundMessage(update_id=305, chat_id="chat-1", text="/run python validate_runtime.py", sender_label="@tester"),
            TelegramInboundMessage(update_id=306, chat_id="chat-1", text="/ask hello", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.repo_root = str(Path(__file__).resolve().parents[1])
            config.file_allowed_roots = (tmp,)
            config_store.save(config)
            service._config = config_store.load()
            service._normalize_repo_root_config()
            service._normalize_file_roots_config()
            service._latest_health_report = _report(
                "health",
                "blocked",
                "error",
                "Blocked",
                items=(
                    _item("health", "error", "runtime.gateway", "Runtime gateway is unavailable."),
                ),
            )
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()

            repo_reply = telegram_service.sent_messages[0][1]
            run_reply = telegram_service.sent_messages[1][1]
            ask_reply = telegram_service.sent_messages[2][1]

            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Can't run /repo right now.", repo_reply)
            self.assertIn("Readiness is not ready.", repo_reply)
            self.assertIn("Can't run /run right now.", run_reply)
            self.assertIn("Readiness is not ready.", run_reply)
            self.assertIn("Can't run /ask right now.", ask_reply)
            self.assertIn("Readiness is not ready.", ask_reply)

    def test_readiness_not_ready_still_allows_status_and_help(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=307, chat_id="chat-1", text="/status", sender_label="@tester"),
            TelegramInboundMessage(update_id=308, chat_id="chat-1", text="/help", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._latest_health_report = _report(
                "health",
                "blocked",
                "error",
                "Blocked",
                items=(
                    _item("health", "error", "runtime.gateway", "Runtime gateway is unavailable."),
                ),
            )
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            service.stop_telegram_loop()

            status_reply = telegram_service.sent_messages[0][1]
            help_reply = telegram_service.sent_messages[1][1]

            self.assertIn("System status", status_reply)
            self.assertIn("Readiness: NOT READY", status_reply)
            self.assertIn("Blockers:", status_reply)
            self.assertLessEqual(len(status_reply.splitlines()), 14)
            self.assertIn("Operator commands", help_reply)
            self.assertIn("/chat", help_reply)
            self.assertIn("/planbuild", help_reply)
            self.assertIn("/run|/test", help_reply)
            self.assertIn("/ask", help_reply)

    def test_provider_blockers_keep_local_execution_available_but_still_block_ask(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=309, chat_id="chat-1", text="/status", sender_label="@tester"),
            TelegramInboundMessage(update_id=310, chat_id="chat-1", text="/repo", sender_label="@tester"),
            TelegramInboundMessage(update_id=311, chat_id="chat-1", text="/chat build a simple python script that prints hello world", sender_label="@tester"),
            TelegramInboundMessage(
                update_id=312,
                chat_id="chat-1",
                text="/file docs/notes.txt",
                sender_label="@tester",
            ),
            TelegramInboundMessage(
                update_id=313,
                chat_id="chat-1",
                text="/createfile scripts/test.py\n@@ CONTENT\nprint(\"hello from AI-E\")",
                sender_label="@tester",
            ),
            TelegramInboundMessage(
                update_id=314,
                chat_id="chat-1",
                text="/patchfile docs/notes.txt\n@@ FIND\nbeta\n@@ REPLACE\nbeta updated",
                sender_label="@tester",
            ),
            TelegramInboundMessage(update_id=315, chat_id="chat-1", text="/run python validate_runtime.py", sender_label="@tester"),
            TelegramInboundMessage(update_id=316, chat_id="chat-1", text="/test tests.test_telegram_commands", sender_label="@tester"),
            TelegramInboundMessage(update_id=317, chat_id="chat-1", text="/web https://docs.openclaw.ai/guide", sender_label="@tester"),
            TelegramInboundMessage(update_id=318, chat_id="chat-1", text="/ask hello", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            docs = workspace / "docs"
            repo_root = Path(__file__).resolve().parents[1]
            docs.mkdir(parents=True, exist_ok=True)
            (docs / "notes.txt").write_text("alpha\nbeta\ngamma\n", encoding="utf-8")

            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.repo_root = str(repo_root)
            config.file_allowed_roots = (str(workspace.resolve()),)
            config.web_allowed_domains = ("docs.openclaw.ai",)
            config_store.save(config)
            service._config = config_store.load()
            service._normalize_repo_root_config()
            service._normalize_file_roots_config()
            service._normalize_web_domains_config()
            service._latest_health_report = _report(
                "health",
                "blocked",
                "error",
                "Provider validation failed.",
                items=(
                    _item("health", "error", "provider.validation", "Provider validation failed."),
                ),
            )
            service._latest_security_report = _report(
                "security",
                "blocked",
                "error",
                "OpenAI secret is missing.",
                items=(
                    _item("security", "error", "secret.required", "Required OpenAI secret is missing."),
                ),
            )

            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 10, timeout=2.0))
            service.stop_telegram_loop()

            status_reply = telegram_service.sent_messages[0][1]
            repo_reply = telegram_service.sent_messages[1][1]
            chat_reply = telegram_service.sent_messages[2][1]
            file_reply = telegram_service.sent_messages[3][1]
            create_reply = telegram_service.sent_messages[4][1]
            patch_reply = telegram_service.sent_messages[5][1]
            run_reply = telegram_service.sent_messages[6][1]
            test_reply = telegram_service.sent_messages[7][1]
            web_reply = telegram_service.sent_messages[8][1]
            ask_reply = telegram_service.sent_messages[9][1]

            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Readiness: READY", status_reply)
            self.assertIn("Health: BLOCKED", status_reply)
            self.assertIn("Security: BLOCKED", status_reply)
            self.assertIn("Allowed:", status_reply)
            self.assertIn("Blocked:", status_reply)
            self.assertIn("Repo:", repo_reply)
            self.assertIn("Branch:", repo_reply)
            self.assertIn("Translation", chat_reply)
            self.assertIn("File: docs/notes.txt", file_reply)
            self.assertIn("Preview:", file_reply)
            self.assertIn("Action requires confirmation.", create_reply)
            self.assertIn("Capability: file.create.write", create_reply)
            self.assertIn("Will create directories: scripts", create_reply)
            self.assertIn("Action requires confirmation.", patch_reply)
            self.assertIn("Preview: 1 replacement", patch_reply)
            self.assertIn("Action requires confirmation.", run_reply)
            self.assertIn("Preview: run python validate_runtime.py", run_reply)
            self.assertIn("Action requires confirmation.", test_reply)
            self.assertIn("Preview: run python -m unittest tests.test_telegram_commands", test_reply)
            self.assertIn("Can't run /web right now.", web_reply)
            self.assertIn("Readiness is not ready.", web_reply)
            self.assertIn("Can't run /ask right now.", ask_reply)
            self.assertIn("Readiness is not ready.", ask_reply)

    def test_confirm_invalid_id_returns_clear_message(self) -> None:
        update = TelegramInboundMessage(update_id=33, chat_id="chat-1", text="/confirm BAD999", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            self.assertIn("No pending confirmation matches BAD999 for this chat.", reply)
            self.assertIn("Next: Send the original command again if you still want to run it.", reply)



if __name__ == "__main__":
    unittest.main()








