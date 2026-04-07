"""Thin application service that bridges UI actions to the runtime layer."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
import threading
import time

from .channel_models import TelegramChannelStatus, TelegramLoopStatus
from .diagnostic_models import DiagnosticReport
from .diagnostics import ControllerDiagnosticsService
from .models import ControllerSnapshot
from .profile_store import ControllerConfig, ControllerConfigStore, Mode, Policy, ProviderType
from .telegram_service import TelegramApiError, TelegramChannelService, TelegramInboundMessage, mask_telegram_token
from ..platform.secrets import SecretStore, get_secret_store
from ..providers import OllamaProviderAdapter, OpenAIProviderAdapter, ProviderReply, ProviderStatus, ProviderType as AdapterProviderType, mask_secret
from ..runtime.manager import OpenClawRuntimeManager
from ..runtime.log_sanitizer import sanitize_log_text


_OPERATOR_CONSOLE_LABEL = "Windows OpenClaw Operator Console v1.4"
_ASK_CONCISE_LIMIT = 700
_ASK_DETAILED_LIMIT = 1500
_PROVIDER_ASK_COMMANDS = frozenset({"/ask", "/askd"})
_PROVIDER_ASK_COOLDOWN_SECONDS = 4.0
_OLLAMA_ASK_TIMEOUT_SECONDS = 12.0
_OPENAI_ASK_TIMEOUT_SECONDS = 18.0


@dataclass(frozen=True)
class _TelegramResponsePlan:
    reply: str
    command_label: str
    ask_status: str = ""
    hide_content_in_summary: bool = False
    response_style: str = "concise"
    acknowledge_work: bool = False


@dataclass(frozen=True)
class _ParsedTelegramCommand:
    command_label: str
    argument: str = ""
    normalized_text: str = ""
    usage_hint: str = ""


@dataclass(frozen=True)
class _ProviderCallResult:
    state: str
    reply: ProviderReply | None = None
    error_message: str = ""


class ControllerService:
    """Facade used by the UI to keep runtime orchestration simple."""

    def __init__(
        self,
        runtime_manager: OpenClawRuntimeManager | None = None,
        config_store: ControllerConfigStore | None = None,
        secret_store: SecretStore | None = None,
        provider_adapters: dict[AdapterProviderType, object] | None = None,
        telegram_service: TelegramChannelService | None = None,
    ) -> None:
        self._runtime_manager = runtime_manager or OpenClawRuntimeManager()
        self._config_store = config_store or ControllerConfigStore()
        self._secret_store = secret_store or get_secret_store()
        self._provider_adapters = provider_adapters or {
            "ollama": OllamaProviderAdapter(),
            "openai": OpenAIProviderAdapter(),
        }
        self._telegram_service = telegram_service or TelegramChannelService()
        self._config = self._config_store.load()
        self._runtime_manager.configure(gateway_port=self._config.gateway_port, gateway_bind=self._config.gateway_bind)
        self._provider_status_cache: dict[str, ProviderStatus] = self._load_provider_status_cache(self._config)
        self._telegram_status = self._reconcile_telegram_status(self._config.telegram_status)
        self._telegram_loop_lock = threading.RLock()
        self._telegram_loop_thread: threading.Thread | None = None
        self._telegram_loop_stop_event: threading.Event | None = None
        self._telegram_loop_status = TelegramLoopStatus()
        self._provider_timeouts = {"ollama": _OLLAMA_ASK_TIMEOUT_SECONDS, "openai": _OPENAI_ASK_TIMEOUT_SECONDS}
        self._provider_ask_cooldown_seconds = _PROVIDER_ASK_COOLDOWN_SECONDS
        self._provider_chat_lock = threading.RLock()
        self._active_provider_chats: dict[str, tuple[str, threading.Thread]] = {}
        self._provider_cooldowns: dict[str, float] = {}
        self._diagnostics_service = ControllerDiagnosticsService(
            runtime_manager=self._runtime_manager,
            config_store=self._config_store,
            secret_store=self._secret_store,
        )
        self._latest_health_report: DiagnosticReport | None = None
        self._latest_security_report: DiagnosticReport | None = None
        self._last_message = "Controller ready."

    def start_runtime(self) -> ControllerSnapshot:
        self._runtime_manager.start_runtime()
        self._last_message = self._runtime_manager.get_status().status_message
        return self.snapshot()

    def stop_runtime(self) -> ControllerSnapshot:
        self._runtime_manager.stop_runtime()
        self._last_message = self._runtime_manager.get_status().status_message
        return self.snapshot()

    def restart_runtime(self) -> ControllerSnapshot:
        self._runtime_manager.restart_runtime()
        self._last_message = self._runtime_manager.get_status().status_message
        return self.snapshot()

    def clear_logs(self) -> ControllerSnapshot:
        self._runtime_manager.clear_logs()
        self._last_message = "Runtime logs cleared."
        return self.snapshot()

    def start_telegram_loop(self) -> ControllerSnapshot:
        previous = self._telegram_status
        validation = self._telegram_service.validate(
            secret_store=self._secret_store,
            secret_id=self._config.telegram_secret_id,
            transient_token="",
        )
        validation = replace(
            validation,
            last_test_result=previous.last_test_result,
            last_test_message=previous.last_test_message,
            last_test_at=previous.last_test_at,
        )
        self._telegram_status = validation
        self._persist_telegram_status()

        with self._telegram_loop_lock:
            if self._telegram_loop_thread is not None and self._telegram_loop_thread.is_alive():
                self._update_telegram_loop_status(
                    state=self._telegram_loop_status.state,
                    message="Telegram loop is already running.",
                    activity=False,
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()

            if not validation.token_present:
                self._update_telegram_loop_status(
                    state="error",
                    message="Telegram loop cannot start because no stored bot token is available.",
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()

            if validation.validation_state == "invalid":
                self._update_telegram_loop_status(
                    state="error",
                    message=f"Telegram loop cannot start: {validation.message}",
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()

            stop_event = threading.Event()
            thread = threading.Thread(
                target=self._telegram_loop_worker,
                args=(stop_event,),
                name="TelegramPollingLoop",
                daemon=True,
            )
            self._telegram_loop_stop_event = stop_event
            self._telegram_loop_thread = thread
            self._update_telegram_loop_status(
                state="starting",
                message="Starting Telegram polling loop.",
            )
            thread.start()

        self._last_message = self._telegram_loop_status.message
        return self.snapshot()

    def stop_telegram_loop(self) -> ControllerSnapshot:
        thread: threading.Thread | None
        stop_event: threading.Event | None
        with self._telegram_loop_lock:
            thread = self._telegram_loop_thread
            stop_event = self._telegram_loop_stop_event
            if thread is None or not thread.is_alive():
                self._telegram_loop_thread = None
                self._telegram_loop_stop_event = None
                self._update_telegram_loop_status(
                    state="stopped",
                    message="Telegram loop is already stopped.",
                    activity=False,
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()
            if stop_event is not None:
                stop_event.set()

        if thread is not None:
            thread.join(timeout=5.0)

        with self._telegram_loop_lock:
            self._telegram_loop_thread = None
            self._telegram_loop_stop_event = None
            self._update_telegram_loop_status(
                state="stopped",
                message="Telegram loop stopped.",
            )
        self._last_message = self._telegram_loop_status.message
        return self.snapshot()

    def check_status(self) -> ControllerSnapshot:
        self._runtime_manager.refresh_status()
        self._refresh_provider_status(self._config.selected_provider)
        self._telegram_status = self._reconcile_telegram_status(self._telegram_status)
        runtime_status = self._runtime_manager.get_status()
        selected_status = self._provider_status_cache.get(self._config.selected_provider)
        if selected_status is not None and not selected_status.ready:
            self._last_message = selected_status.message
        else:
            self._last_message = runtime_status.status_message
        return self.snapshot()

    def snapshot(self) -> ControllerSnapshot:
        status = self._runtime_manager.get_status()
        selected_provider_status = self._provider_status_cache.get(self._config.selected_provider) or self._default_provider_status(
            self._config.selected_provider
        )
        telegram_status = self._reconcile_telegram_status(self._telegram_status)
        with self._telegram_loop_lock:
            telegram_loop_status = self._telegram_loop_status
        readiness_state, readiness_message = self._compute_readiness(
            runtime_state=status.runtime_state,
            selected_provider_status=selected_provider_status,
            telegram_status=telegram_status,
        )
        return ControllerSnapshot(
            runtime_state=status.runtime_state,
            status_message=self._last_message or status.status_message,
            mode=self._config.current_mode,
            selected_mode=self._config.selected_mode,
            policy=self._config.policy,
            active_provider=self._active_provider_for_mode(self._config.current_mode),
            selected_provider=self._config.selected_provider,
            provider_status=selected_provider_status.validation_state,
            provider_message=selected_provider_status.message,
            provider_ready=selected_provider_status.ready,
            provider_model=selected_provider_status.model,
            available_provider_models=selected_provider_status.available_models,
            openai_key_masked=self._config.openai_key_masked,
            telegram_configured=telegram_status.configured,
            telegram_token_present=telegram_status.token_present,
            telegram_status=telegram_status.validation_state,
            telegram_message=telegram_status.message,
            telegram_token_masked=telegram_status.token_masked,
            telegram_bot_identity=telegram_status.identity_label if telegram_status.bot_id or telegram_status.bot_username or telegram_status.bot_display_name else "-",
            telegram_last_test_result=telegram_status.last_test_result,
            telegram_last_test_at=telegram_status.last_test_at or "-",
            telegram_loop_state=telegram_loop_status.state,
            telegram_loop_activity=telegram_loop_status.activity_state,
            telegram_loop_message=telegram_loop_status.message,
            telegram_last_activity_at=telegram_loop_status.last_activity_at or "-",
            telegram_last_command=telegram_loop_status.last_command,
            telegram_last_ask_status=telegram_loop_status.last_ask_status,
            telegram_last_inbound_summary=telegram_loop_status.last_inbound_summary,
            telegram_last_outbound_summary=telegram_loop_status.last_outbound_summary,
            readiness_state=readiness_state,
            readiness_message=readiness_message,
            health_status=self._latest_health_report.overall_status if self._latest_health_report else "unknown",
            safety_status=self._latest_security_report.overall_status if self._latest_security_report else "unknown",
            last_health_check_at=self._latest_health_report.ran_at if self._latest_health_report else "-",
            last_security_check_at=self._latest_security_report.ran_at if self._latest_security_report else "-",
            health_summary=self._latest_health_report.summary if self._latest_health_report else "Health check has not been run yet.",
            safety_summary=self._latest_security_report.summary if self._latest_security_report else "Security check has not been run yet.",
            diagnostic_summary_lines=self._diagnostic_summary_lines(),
            openclaw_installed=status.openclaw.installed,
            openclaw_path=status.openclaw.entrypoint_path or status.openclaw.wrapper_path,
            ollama_installed=status.ollama.installed,
            ollama_path=status.ollama.path,
            runtime_pid=status.pid,
            recent_logs=self._runtime_manager.get_recent_logs(),
        )

    def validate_provider(
        self,
        *,
        provider: ProviderType,
        preferred_ollama_model: str = "",
        transient_openai_key: str = "",
    ) -> ControllerSnapshot:
        validation = self._validate_provider(
            provider=provider,
            preferred_ollama_model=preferred_ollama_model,
            transient_openai_key=transient_openai_key,
        )
        self._provider_status_cache[provider] = validation
        self._persist_provider_status(provider, validation)
        self._last_message = validation.message
        return self.snapshot()

    def save_telegram_settings(self, *, telegram_token: str = "") -> ControllerSnapshot:
        trimmed = telegram_token.strip()
        if not trimmed:
            if self._secret_store.available and self._secret_store.has_secret(self._config.telegram_secret_id):
                self._telegram_status = self._reconcile_telegram_status(self._telegram_status)
                self._last_message = "Telegram token is already stored."
                return self.snapshot()
            self._telegram_status = replace(
                self._telegram_status,
                configured=False,
                token_present=False,
                ready=False,
                validation_state="invalid",
                message="Enter a Telegram bot token before saving Telegram settings.",
            )
            self._persist_telegram_status()
            self._last_message = self._telegram_status.message
            return self.snapshot()

        self._secret_store.put_secret(self._config.telegram_secret_id, trimmed)
        self._telegram_status = TelegramChannelStatus(
            configured=True,
            token_present=True,
            token_masked=mask_telegram_token(trimmed),
            validation_state="unknown",
            available=False,
            ready=False,
            message="Telegram token saved. Validate Telegram to confirm bot connectivity.",
        )
        self._persist_telegram_status()
        self._last_message = self._telegram_status.message
        return self.snapshot()

    def validate_telegram(self, *, transient_token: str = "") -> ControllerSnapshot:
        previous = self._telegram_status
        using_transient = bool(transient_token.strip())
        validation = self._telegram_service.validate(
            secret_store=self._secret_store,
            secret_id=self._config.telegram_secret_id,
            transient_token=transient_token.strip(),
        )
        if using_transient:
            stored_present = self._secret_store.available and self._secret_store.has_secret(self._config.telegram_secret_id)
            validation = replace(
                validation,
                configured=stored_present,
                token_present=stored_present,
                ready=validation.ready and stored_present,
            )
        validation = replace(
            validation,
            last_test_result=previous.last_test_result,
            last_test_message=previous.last_test_message,
            last_test_at=previous.last_test_at,
        )
        self._telegram_status = validation
        if not using_transient:
            self._persist_telegram_status()
        self._last_message = validation.message
        return self.snapshot()

    def test_telegram_connection(self) -> ControllerSnapshot:
        tested = self._telegram_service.test_connection(
            secret_store=self._secret_store,
            secret_id=self._config.telegram_secret_id,
            existing_status=self._telegram_status,
        )
        self._telegram_status = tested
        self._persist_telegram_status()
        self._last_message = tested.last_test_message
        return self.snapshot()

    def save_settings(
        self,
        *,
        selected_mode: Mode,
        selected_provider: ProviderType,
        policy: Policy,
        preferred_ollama_model: str = "",
        openai_api_key: str = "",
        confirm_online: bool = False,
    ) -> ControllerSnapshot:
        candidate = replace(
            self._config,
            selected_mode=selected_mode,
            selected_provider=selected_provider,
            policy=policy,
            preferred_ollama_model=preferred_ollama_model.strip(),
        )

        openai_api_key = openai_api_key.strip()
        if openai_api_key:
            self._secret_store.put_secret(candidate.openai_secret_id, openai_api_key)
            candidate.openai_has_secret = True
            candidate.openai_key_masked = mask_secret(openai_api_key)
        elif self._secret_store.available and self._secret_store.has_secret(candidate.openai_secret_id):
            candidate.openai_has_secret = True

        compatibility_message = self._validate_mode_provider_pair(candidate.selected_mode, candidate.selected_provider, candidate.policy)
        if compatibility_message:
            self._config = candidate
            self._config_store.save(self._config)
            self._last_message = compatibility_message
            return self.snapshot()

        self._config = candidate
        self._config_store.save(self._config)

        if selected_mode == "online" and policy == "ask_before_online" and self._config.current_mode != "online" and not confirm_online:
            self._last_message = "Settings saved. Confirm Online Mode before activating a remote provider."
            return self.snapshot()

        validation = self._validate_provider(
            provider=selected_provider,
            preferred_ollama_model=preferred_ollama_model,
            transient_openai_key="",
        )
        self._provider_status_cache[selected_provider] = validation
        self._persist_provider_status(selected_provider, validation)

        if validation.ready:
            self._config.current_mode = selected_mode
            self._config_store.save(self._config)
            mode_label = "Online" if selected_mode == "online" else "Offline"
            self._last_message = f"Settings saved. {mode_label} Mode is active with {validation.display_name}."
        else:
            current_mode_label = "Online" if self._config.current_mode == "online" else "Offline"
            self._last_message = (
                f"Settings saved, but requested mode was not activated: {validation.message} "
                f"Current mode remains {current_mode_label}."
            )
        return self.snapshot()

    def run_health_check(self) -> ControllerSnapshot:
        self._refresh_provider_status(self._config.selected_provider)
        selected_provider_status = self._provider_status_cache.get(self._config.selected_provider) or self._default_provider_status(
            self._config.selected_provider
        )
        self._latest_health_report = self._diagnostics_service.run_health_check(
            self._config,
            selected_provider_status,
            telegram_recent_success=self._telegram_recent_success(),
            telegram_last_success_at=self._telegram_loop_status.last_success_at,
        )
        self._last_message = self._latest_health_report.summary
        return self.snapshot()

    def run_security_check(self) -> ControllerSnapshot:
        self._refresh_provider_status(self._config.selected_provider)
        selected_provider_status = self._provider_status_cache.get(self._config.selected_provider) or self._default_provider_status(
            self._config.selected_provider
        )
        self._latest_security_report = self._diagnostics_service.run_security_check(self._config, selected_provider_status)
        self._last_message = self._latest_security_report.summary
        return self.snapshot()

    def shutdown(self) -> None:
        self.stop_telegram_loop()
        self._runtime_manager.stop_runtime()

    def _validate_provider(
        self,
        *,
        provider: ProviderType,
        preferred_ollama_model: str,
        transient_openai_key: str,
    ) -> ProviderStatus:
        if provider == "ollama":
            adapter = self._provider_adapters["ollama"]
            return adapter.validate(  # type: ignore[call-arg]
                runtime_status=self._runtime_manager.get_status(),
                base_url=self._config.ollama_base_url,
                preferred_model=preferred_ollama_model.strip(),
            )
        adapter = self._provider_adapters["openai"]
        return adapter.validate(  # type: ignore[call-arg]
            secret_store=self._secret_store,
            secret_id=self._config.openai_secret_id,
            transient_secret=transient_openai_key.strip(),
        )

    def _refresh_provider_status(self, provider: ProviderType) -> None:
        preferred_model = self._config.preferred_ollama_model if provider == "ollama" else ""
        validation = self._validate_provider(
            provider=provider,
            preferred_ollama_model=preferred_model,
            transient_openai_key="",
        )
        self._provider_status_cache[provider] = validation
        self._persist_provider_status(provider, validation)

    def _provider_status_for_mode(self, mode: Mode) -> ProviderStatus:
        provider = self._active_provider_for_mode(mode)
        preferred_model = self._config.preferred_ollama_model if provider == "ollama" else ""
        validation = self._validate_provider(
            provider=provider,
            preferred_ollama_model=preferred_model,
            transient_openai_key="",
        )
        self._provider_status_cache[provider] = validation
        self._persist_provider_status(provider, validation)
        return validation

    def _persist_provider_status(self, provider: ProviderType, validation: ProviderStatus) -> None:
        self._config.last_provider_statuses[provider] = validation.as_payload()
        self._config_store.save(self._config)

    def _load_provider_status_cache(self, config: ControllerConfig) -> dict[str, ProviderStatus]:
        statuses: dict[str, ProviderStatus] = {}
        for provider, payload in config.last_provider_statuses.items():
            if provider not in {"ollama", "openai"} or not isinstance(payload, dict):
                continue
            statuses[provider] = ProviderStatus(
                provider=provider,  # type: ignore[arg-type]
                display_name=str(payload.get("display_name", provider.title())),
                configured=bool(payload.get("configured", False)),
                available=bool(payload.get("available", False)),
                validation_state=str(payload.get("validation_state", "unknown")),  # type: ignore[arg-type]
                ready=bool(payload.get("ready", False)),
                message=str(payload.get("message", "Provider has not been validated yet.")),
                is_local=bool(payload.get("is_local", provider == "ollama")),
                model=str(payload.get("model", "")),
                available_models=tuple(str(item) for item in payload.get("available_models", []) if str(item).strip()),
            )
        return statuses

    def _default_provider_status(self, provider: ProviderType) -> ProviderStatus:
        return ProviderStatus(
            provider=provider,
            display_name="Ollama" if provider == "ollama" else "OpenAI",
            configured=False,
            available=False,
            validation_state="unknown",
            ready=False,
            message="Provider has not been validated yet.",
            is_local=provider == "ollama",
        )

    def _persist_telegram_status(self) -> None:
        self._config.telegram_status = self._telegram_status
        self._config_store.save(self._config)

    def _persist_telegram_offset(self, update_id: int) -> None:
        if update_id <= self._config.telegram_last_processed_update_id:
            return
        self._config.telegram_last_processed_update_id = update_id
        self._config_store.save(self._config)

    def _reconcile_telegram_status(self, status: TelegramChannelStatus) -> TelegramChannelStatus:
        has_secret = self._secret_store.available and self._secret_store.has_secret(self._config.telegram_secret_id)
        if not has_secret:
            if not status.token_present:
                return status
            return replace(
                status,
                configured=False,
                token_present=False,
                token_masked="",
                available=False,
                ready=False,
                validation_state="unknown" if status.validation_state == "valid" else status.validation_state,
                message="Telegram is not configured. Save a bot token before validating the channel.",
                bot_id="",
                bot_username="",
                bot_display_name="",
            )

        if status.token_masked:
            return replace(status, configured=True, token_present=True)

        secret = self._secret_store.get_secret(self._config.telegram_secret_id)
        return replace(
            status,
            configured=True,
            token_present=True,
            token_masked=mask_telegram_token(secret),
        )

    @staticmethod
    def _active_provider_for_mode(mode: Mode) -> ProviderType:
        return "openai" if mode == "online" else "ollama"

    @staticmethod
    def _validate_mode_provider_pair(mode: Mode, provider: ProviderType, policy: Policy) -> str:
        if mode == "offline" and provider != "ollama":
            return "Offline Mode currently requires the Ollama provider."
        if mode == "online" and provider != "openai":
            return "Online Mode currently requires the OpenAI provider."
        if policy == "always_offline" and mode == "online":
            return "Always Offline policy blocks Online Mode activation. Choose Offline Mode or a different policy."
        if policy == "always_online" and mode == "offline":
            return "Always Online policy blocks Offline Mode activation. Choose Online Mode or a different policy."
        return ""

    def _diagnostic_summary_lines(self) -> tuple[str, ...]:
        lines: list[str] = []
        if self._latest_health_report is not None:
            lines.append(f"[Health] {self._latest_health_report.summary}")
            for item in self._latest_health_report.items:
                if item.severity != "info":
                    lines.append(f"  - {item.code}: {item.message} | Action: {item.recommended_action}")
        if self._latest_security_report is not None:
            lines.append(f"[Security] {self._latest_security_report.summary}")
            for item in self._latest_security_report.items:
                if item.severity != "info":
                    lines.append(f"  - {item.code}: {item.message} | Action: {item.recommended_action}")
        if not lines:
            lines.append("Run Health Check or Security Check to populate diagnostics.")
        return tuple(lines[:10])


    def _telegram_loop_worker(self, stop_event: threading.Event) -> None:
        self._update_telegram_loop_status(
            state="running",
            activity_state="polling",
            message="Telegram polling loop is active.",
        )
        while not stop_event.is_set():
            try:
                if self._telegram_loop_status.state != "running" or self._telegram_loop_status.activity_state != "polling":
                    self._update_telegram_loop_status(
                        state="running",
                        activity_state="polling",
                        message="Telegram polling loop is active.",
                        activity=False,
                    )
                updates = self._telegram_service.get_updates(
                    secret_store=self._secret_store,
                    secret_id=self._config.telegram_secret_id,
                    offset=self._config.telegram_last_processed_update_id + 1,
                    timeout=2,
                )
                batch_provider_chats: set[str] = set()
                for update in updates:
                    if stop_event.is_set():
                        break
                    parsed_command = self._parse_telegram_command(update)
                    batch_busy = False
                    if parsed_command.command_label in _PROVIDER_ASK_COMMANDS:
                        if update.chat_id in batch_provider_chats:
                            batch_busy = True
                        else:
                            batch_provider_chats.add(update.chat_id)
                    self._handle_telegram_update(update, parsed_command=parsed_command, batch_busy=batch_busy)
            except TelegramApiError as exc:
                self._update_telegram_loop_status(
                    state="error",
                    activity_state="provider_failed",
                    message=f"Telegram polling failed: {sanitize_log_text(str(exc))}",
                )
                if stop_event.wait(1.5):
                    break
            except Exception as exc:  # noqa: BLE001
                self._update_telegram_loop_status(
                    state="error",
                    activity_state="provider_failed",
                    message=f"Telegram loop failed: {sanitize_log_text(str(exc))}",
                )
                if stop_event.wait(1.5):
                    break

        with self._telegram_loop_lock:
            if self._telegram_loop_stop_event is stop_event:
                self._telegram_loop_thread = None
                self._telegram_loop_stop_event = None
                self._update_telegram_loop_status(
                    state="stopped",
                    activity_state="idle",
                    message="Telegram loop stopped.",
                    activity=False,
                )

    def _handle_telegram_update(
        self,
        update: TelegramInboundMessage,
        *,
        parsed_command: _ParsedTelegramCommand | None = None,
        batch_busy: bool = False,
    ) -> None:
        if update.update_id <= self._config.telegram_last_processed_update_id:
            self._update_telegram_loop_status(
                state=self._telegram_loop_status.state if self._telegram_loop_status.state != "error" else "running",
                activity_state="processing_command",
                message=f"Skipped duplicate Telegram update {update.update_id}.",
                inbound_summary=f"Duplicate update {update.update_id} skipped.",
                activity=True,
            )
            return

        parsed = parsed_command or self._parse_telegram_command(update)
        command_hint = parsed.command_label
        inbound_summary = self._summarize_inbound_update(update, command_hint)
        self._update_telegram_loop_status(
            state="running",
            activity_state="processing_command",
            message=f"Handling Telegram command {command_hint}.",
            inbound_summary=inbound_summary,
            activity=True,
            last_command=command_hint,
        )
        if command_hint in _PROVIDER_ASK_COMMANDS and not batch_busy:
            self._update_telegram_loop_status(
                state="running",
                activity_state="waiting_on_provider",
                message=f"Working on {command_hint} request.",
                inbound_summary=inbound_summary,
                outbound_summary=self._summarize_text(f"{command_hint} in progress."),
                activity=True,
                last_command=command_hint,
                last_ask_status=f"{command_hint} in progress.",
            )

        plan = self._build_telegram_reply(update, parsed_command=parsed, batch_busy=batch_busy)
        outbound_summary = self._outbound_summary_for_plan(update, plan)
        loop_message = f"Processed Telegram update {update.update_id}."

        try:
            message_id = self._telegram_service.send_text(
                secret_store=self._secret_store,
                secret_id=self._config.telegram_secret_id,
                chat_id=update.chat_id,
                text=plan.reply,
            )
            if message_id:
                loop_message = f"Processed Telegram update {update.update_id} and sent reply {message_id}."
            else:
                loop_message = f"Processed Telegram update {update.update_id} and sent reply."
        except TelegramApiError as exc:
            outbound_summary = self._summarize_text(f"{plan.command_label} reply failed: {sanitize_log_text(str(exc))}")
            loop_message = sanitize_log_text(str(exc))
            self._update_telegram_loop_status(
                state="error",
                activity_state="provider_failed",
                message=f"Telegram reply failed: {loop_message}",
                inbound_summary=inbound_summary,
                outbound_summary=outbound_summary,
                activity=True,
                last_command=plan.command_label,
                last_ask_status=plan.ask_status if plan.command_label in _PROVIDER_ASK_COMMANDS else None,
            )
            self._persist_telegram_offset(update.update_id)
            return

        self._persist_telegram_offset(update.update_id)
        self._update_telegram_loop_status(
            state="running",
            activity_state="sent_reply",
            message=loop_message,
            inbound_summary=inbound_summary,
            outbound_summary=outbound_summary,
            activity=True,
            success=True,
            last_command=plan.command_label,
            last_ask_status=plan.ask_status if plan.command_label in _PROVIDER_ASK_COMMANDS else None,
        )


    def _build_telegram_reply(
        self,
        update: TelegramInboundMessage,
        *,
        parsed_command: _ParsedTelegramCommand | None = None,
        batch_busy: bool = False,
    ) -> _TelegramResponsePlan:
        parsed = parsed_command or self._parse_telegram_command(update)
        if parsed.command_label == "non_text":
            return _TelegramResponsePlan(
                reply=f"{_OPERATOR_CONSOLE_LABEL} supports plain text Telegram messages only.",
                command_label="non_text",
            )

        snapshot = self.snapshot()
        command = parsed.command_label

        if command == "parse_failure":
            return self._build_parse_failure_reply(parsed)
        if command == "/start":
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        f"{_OPERATOR_CONSOLE_LABEL} is connected.",
                        f"Readiness: {self._readiness_label(snapshot.readiness_state)}",
                        "Use /help to see supported commands.",
                    )
                ),
                command_label="/start",
            )
        if command == "/status":
            return self._build_status_reply(snapshot)
        if command == "/mode":
            return self._build_mode_reply(snapshot)
        if command == "/help":
            return self._build_help_reply()
        if command == "/models":
            return self._build_models_reply()
        if command == "/ask":
            return self._build_ask_reply(
                parsed.argument,
                snapshot,
                chat_id=update.chat_id,
                response_style="concise",
                command_label="/ask",
                batch_busy=batch_busy,
            )
        if command == "/askd":
            return self._build_ask_reply(
                parsed.argument,
                snapshot,
                chat_id=update.chat_id,
                response_style="detailed",
                command_label="/askd",
                batch_busy=batch_busy,
            )

        if snapshot.runtime_state != "running":
            return _TelegramResponsePlan(
                reply="OpenClaw runtime is not available. Start the runtime in the operator console and try again.",
                command_label="plain_text",
            )
        if snapshot.readiness_state == "not_ready":
            return _TelegramResponsePlan(
                reply="Operator console is not ready. Resolve blocking health or security issues in the desktop app and try again.",
                command_label="plain_text",
            )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    _OPERATOR_CONSOLE_LABEL,
                    "Use /help to see supported commands.",
                    "Plain text is not treated as /ask automatically.",
                )
            ),
            command_label="plain_text",
        )

    def _build_help_reply(self) -> _TelegramResponsePlan:
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Operator commands",
                    "/help - show this command list",
                    "/status - runtime, health, safety, readiness",
                    "/mode - mode, policy, and remote-use gate",
                    "/models - local Ollama models",
                    "/ask <prompt> - concise provider reply",
                    "/askd <prompt> - more detailed provider reply",
                    "Plain text is not auto-routed to /ask.",
                )
            ),
            command_label="/help",
        )

    def _build_status_reply(self, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        active_status = self._provider_status_for_mode(self._config.current_mode)
        lines = [
            "Status",
            f"Runtime: {snapshot.runtime_state}",
            f"Health: {self._health_label(snapshot.health_status)}",
            f"Security: {self._safety_label(snapshot.safety_status)}",
            f"Readiness: {self._readiness_label(snapshot.readiness_state)}",
            f"Mode: {snapshot.mode}",
            f"Policy: {self._policy_label(snapshot.policy)}",
            f"Provider: {self._provider_label(snapshot.active_provider, active_status.model)}",
            f"Telegram loop: {self._telegram_loop_label(snapshot.telegram_loop_state)}",
            f"Loop activity: {self._telegram_loop_activity_label(snapshot.telegram_loop_activity)}",
        ]
        if snapshot.readiness_state != "ready":
            lines.append(f"Note: {snapshot.readiness_message}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/status",
        )

    def _build_mode_reply(self, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        active_status = self._provider_status_for_mode(self._config.current_mode)
        online_state, online_message = self._online_use_state()
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Mode",
                    f"Selected: {snapshot.selected_mode}",
                    f"Current: {snapshot.mode}",
                    f"Policy: {self._policy_label(snapshot.policy)}",
                    f"Provider: {self._provider_label(snapshot.active_provider, active_status.model)}",
                    f"Remote use: {self._online_use_label(online_state)}",
                    f"Reason: {online_message}",
                )
            ),
            command_label="/mode",
        )

    def _build_models_reply(self) -> _TelegramResponsePlan:
        ollama_status = self._provider_status_for_mode("offline")
        if not ollama_status.available:
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "Unavailable right now.",
                        f"Reason: {ollama_status.message}",
                    )
                ),
                command_label="/models",
            )
        if not ollama_status.available_models:
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "No local Ollama models are available yet.",
                    )
                ),
                command_label="/models",
            )
        models = list(ollama_status.available_models[:5])
        remaining = len(ollama_status.available_models) - len(models)
        lines = ["Local models"]
        lines.extend(f"- {model}" for model in models)
        if remaining > 0:
            lines.append(f"... and {remaining} more")
        if ollama_status.model:
            lines.append(f"Active: {ollama_status.model}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/models",
        )

    def _build_ask_reply(

        self,
        prompt: str,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
        response_style: str,
        command_label: str,
        batch_busy: bool,
    ) -> _TelegramResponsePlan:
        if batch_busy or self._is_provider_chat_busy(chat_id):
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Another provider-backed ask is still running for this chat.",
                next_step="Wait for the current reply before sending another ask.",
                activity_state="processing_command",
            )

        prompt = " ".join(prompt.split())
        if not prompt:
            usage = "/askd <prompt>" if command_label == "/askd" else "/ask <prompt>"
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="No prompt was provided.",
                next_step=f"Try {usage}.",
                activity_state="processing_command",
            )

        rate_limited, wait_seconds = self._provider_ask_is_rate_limited(chat_id)
        if rate_limited:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason=f"Provider ask rate limit is active for this chat. Wait about {wait_seconds:.1f}s.",
                next_step="Wait a moment, then resend your ask command.",
                activity_state="processing_command",
            )

        if snapshot.runtime_state != "running":
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Runtime is not running.",
                next_step="Start the runtime in the desktop app and try again.",
                activity_state="processing_command",
            )

        current_mode = self._config.current_mode
        if current_mode == "offline":
            provider_status = self._provider_status_for_mode("offline")
            if not provider_status.ready:
                return self._blocked_ask_reply(
                    command_label=command_label,
                    reason=provider_status.message,
                    next_step="Validate Ollama in the desktop app before asking again.",
                    activity_state="provider_failed",
                )
            if snapshot.readiness_state == "not_ready":
                return self._blocked_ask_reply(
                    command_label=command_label,
                    reason="Readiness is not ready.",
                    next_step="Resolve the blocking health or security issue in the desktop app.",
                    activity_state="processing_command",
                )
            self._update_telegram_loop_status(
                state="running",
                activity_state="waiting_on_provider",
                message=f"Waiting on {command_label} via Ollama.",
                activity=True,
                last_command=command_label,
                last_ask_status=f"{command_label} in progress.",
            )
            self._mark_provider_ask_started(chat_id)
            result = self._run_provider_request(
                provider="ollama",
                chat_id=chat_id,
                func=lambda: self._provider_adapters["ollama"].ask(  # type: ignore[call-arg]
                    runtime_status=self._runtime_manager.get_status(),
                    base_url=self._config.ollama_base_url,
                    preferred_model=self._config.preferred_ollama_model,
                    prompt=prompt,
                    response_style=response_style,
                ),
            )
            if result.state == "timeout":
                return self._timeout_ask_reply(command_label=command_label, provider_name="Ollama")
            if result.state != "ok" or not isinstance(result.reply, ProviderReply):
                return self._blocked_ask_reply(
                    command_label=command_label,
                    reason="Provider request failed before a reply was returned.",
                    next_step="Check Ollama and try again.",
                    activity_state="provider_failed",
                )
            reply = result.reply
            if not reply.ok:
                return self._blocked_ask_reply(
                    command_label=command_label,
                    reason=reply.message,
                    next_step="Check Ollama and rerun /models or provider validation.",
                    activity_state="provider_failed",
                )
            model = reply.model or provider_status.model or "Ollama"
            return _TelegramResponsePlan(
                reply=self._format_ask_success(
                    reply.text,
                    provider_label=self._provider_label("ollama", model),
                    mode_label="Offline",
                    response_style=response_style,
                ),
                command_label=command_label,
                ask_status=f"{command_label} completed via Ollama / {model}.",
                hide_content_in_summary=True,
                response_style=response_style,
            )

        online_state, online_message = self._online_use_state()
        if online_state != "allowed":
            next_step = "Switch to Offline Mode or activate Online Mode explicitly in the desktop app."
            if self._config.current_mode == "online" and self._config.policy != "always_offline":
                next_step = "Save or validate the OpenAI configuration in the desktop app."
            return self._blocked_ask_reply(
                command_label=command_label,
                reason=online_message,
                next_step=next_step,
                activity_state="processing_command",
            )

        provider_status = self._provider_status_for_mode("online")
        if not provider_status.ready:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason=provider_status.message,
                next_step="Save or validate the OpenAI configuration in the desktop app.",
                activity_state="provider_failed",
            )
        if snapshot.readiness_state == "not_ready":
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Readiness is not ready.",
                next_step="Resolve the blocking health or security issue in the desktop app.",
                activity_state="processing_command",
            )
        self._update_telegram_loop_status(
            state="running",
            activity_state="waiting_on_provider",
            message=f"Waiting on {command_label} via OpenAI.",
            activity=True,
            last_command=command_label,
            last_ask_status=f"{command_label} in progress.",
        )
        self._mark_provider_ask_started(chat_id)
        result = self._run_provider_request(
            provider="openai",
            chat_id=chat_id,
            func=lambda: self._provider_adapters["openai"].ask(  # type: ignore[call-arg]
                secret_store=self._secret_store,
                secret_id=self._config.openai_secret_id,
                transient_secret="",
                prompt=prompt,
                response_style=response_style,
            ),
        )
        if result.state == "timeout":
            return self._timeout_ask_reply(command_label=command_label, provider_name="OpenAI")
        if result.state != "ok" or not isinstance(result.reply, ProviderReply):
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Provider request failed before a reply was returned.",
                next_step="Check the online provider configuration and try again.",
                activity_state="provider_failed",
            )
        reply = result.reply
        if not reply.ok:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason=reply.message,
                next_step="Check the online provider configuration and try again.",
                activity_state="provider_failed",
            )
        model = reply.model or "OpenAI"
        return _TelegramResponsePlan(
            reply=self._format_ask_success(
                reply.text,
                provider_label=self._provider_label("openai", model),
                mode_label="Online",
                response_style=response_style,
            ),
            command_label=command_label,
            ask_status=f"{command_label} completed via OpenAI / {model}.",
            hide_content_in_summary=True,
            response_style=response_style,
        )


    def _build_parse_failure_reply(self, parsed: _ParsedTelegramCommand) -> _TelegramResponsePlan:
        usage_hint = parsed.usage_hint or "Use /help to see supported commands."
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Couldn't parse that command.",
                    f"Next: {usage_hint}",
                )
            ),
            command_label="parse_failure",
        )

    def _blocked_ask_reply(
        self,
        *,
        command_label: str,
        reason: str,
        next_step: str,
        activity_state: str,
    ) -> _TelegramResponsePlan:
        title = "Can't run /askd right now." if command_label == "/askd" else "Can't run /ask right now."
        self._update_telegram_loop_status(
            state="running",
            activity_state=activity_state,
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=f"{command_label} blocked: {reason}",
        )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    title,
                    f"Reason: {reason}",
                    f"Next: {next_step}",
                )
            ),
            command_label=command_label,
            ask_status=f"{command_label} blocked: {reason}",
            hide_content_in_summary=True,
            response_style="detailed" if command_label == "/askd" else "concise",
        )

    def _timeout_ask_reply(self, *, command_label: str, provider_name: str) -> _TelegramResponsePlan:
        reason = f"{provider_name} did not finish before the timeout."
        self._update_telegram_loop_status(
            state="running",
            activity_state="timed_out",
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=f"{command_label} timed out via {provider_name}.",
        )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Provider request timed out.",
                    f"Reason: {reason}",
                    "Next: Wait a moment, then try again.",
                )
            ),
            command_label=command_label,
            ask_status=f"{command_label} timed out via {provider_name}.",
            hide_content_in_summary=True,
            response_style="detailed" if command_label == "/askd" else "concise",
        )

    def _format_ask_success(
        self,
        answer: str,
        *,
        provider_label: str,
        mode_label: str,
        response_style: str,
    ) -> str:
        heading = "Detailed answer" if response_style == "detailed" else "Answer"
        normalized = self._normalize_telegram_reply(answer, response_style=response_style)
        source = f"{mode_label} | {provider_label}"
        return chr(10).join((f"{heading} ({source})", normalized))

    def _update_telegram_loop_status(

        self,
        *,
        state: str,
        activity_state: str | None = None,
        message: str,
        inbound_summary: str | None = None,
        outbound_summary: str | None = None,
        activity: bool = True,
        success: bool = False,
        last_command: str | None = None,
        last_ask_status: str | None = None,
    ) -> None:
        with self._telegram_loop_lock:
            timestamp = self._now_iso() if activity else self._telegram_loop_status.last_activity_at
            self._telegram_loop_status = TelegramLoopStatus(
                state=state,  # type: ignore[arg-type]
                activity_state=(activity_state or self._telegram_loop_status.activity_state),  # type: ignore[arg-type]
                message=sanitize_log_text(message),
                last_activity_at=timestamp,
                last_success_at=timestamp if success and activity else self._telegram_loop_status.last_success_at,
                last_command=sanitize_log_text(last_command or self._telegram_loop_status.last_command),
                last_ask_status=sanitize_log_text(last_ask_status or self._telegram_loop_status.last_ask_status),
                last_inbound_summary=sanitize_log_text(inbound_summary or self._telegram_loop_status.last_inbound_summary),
                last_outbound_summary=sanitize_log_text(outbound_summary or self._telegram_loop_status.last_outbound_summary),
            )
    @staticmethod
    def _summarize_text(text: str, limit: int = 160) -> str:
        normalized = " ".join(text.split())
        sanitized = sanitize_log_text(normalized)
        if len(sanitized) <= limit:
            return sanitized
        return f"{sanitized[: limit - 3]}..."

    def _summarize_inbound_update(self, update: TelegramInboundMessage, command_label: str) -> str:
        if command_label in _PROVIDER_ASK_COMMANDS:
            return self._summarize_text(f"{update.sender_label}: {command_label} [prompt hidden]")
        if command_label == "plain_text":
            return self._summarize_text(f"{update.sender_label}: text message received")
        if command_label == "non_text":
            return self._summarize_text(f"{update.sender_label}: non-text message received")
        if command_label == "parse_failure":
            return self._summarize_text(f"{update.sender_label}: malformed command")
        text = update.text.strip() or command_label
        return self._summarize_text(f"{update.sender_label}: {text}")

    def _outbound_summary_for_plan(self, update: TelegramInboundMessage, plan: _TelegramResponsePlan) -> str:
        if plan.command_label in _PROVIDER_ASK_COMMANDS:
            return self._summarize_text(plan.ask_status or f"Sent {plan.command_label} reply to {update.sender_label}.")
        if plan.command_label == "plain_text":
            return self._summarize_text(f"Sent placeholder reply to {update.sender_label}.")
        if plan.command_label == "non_text":
            return self._summarize_text(f"Sent non-text guidance reply to {update.sender_label}.")
        if plan.command_label == "parse_failure":
            return self._summarize_text(f"Sent command correction to {update.sender_label}.")
        return self._summarize_text(f"Sent {plan.command_label} reply to {update.sender_label}.")

    @staticmethod
    def _parse_telegram_command(update: TelegramInboundMessage) -> _ParsedTelegramCommand:
        if not update.has_text:
            return _ParsedTelegramCommand(command_label="non_text")
        text = update.text.strip()
        if not text:
            return _ParsedTelegramCommand(command_label="plain_text")
        if not text.startswith("/"):
            return _ParsedTelegramCommand(command_label="plain_text", normalized_text=" ".join(text.split()))
        parts = text.split(None, 1)
        command_token = parts[0]
        argument = parts[1].strip() if len(parts) > 1 else ""
        command = command_token.split("@", 1)[0].lower()
        normalized_text = " ".join(text.split())
        if command in {"/start", "/help", "/status", "/mode", "/models", "/ask", "/askd"}:
            return _ParsedTelegramCommand(command_label=command, argument=argument, normalized_text=normalized_text)
        if command.startswith("/ask"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /ask <prompt> or /askd <prompt>.",
            )
        return _ParsedTelegramCommand(
            command_label="parse_failure",
            normalized_text=normalized_text,
            usage_hint="Use /help to see supported commands.",
        )

    def _run_provider_request(self, *, provider: str, chat_id: str, func) -> _ProviderCallResult:
        request_id = f"{chat_id}:{time.monotonic()}"
        result_box: dict[str, object] = {}
        done_event = threading.Event()

        def _worker() -> None:
            try:
                result_box["reply"] = func()
            except Exception as exc:  # noqa: BLE001
                result_box["error"] = sanitize_log_text(str(exc))
            finally:
                done_event.set()
                self._finish_provider_chat(chat_id, request_id)

        worker = threading.Thread(target=_worker, name=f"Telegram{provider.title()}Ask", daemon=True)
        self._begin_provider_chat(chat_id, request_id, worker)
        worker.start()
        finished = done_event.wait(self._provider_timeout_seconds(provider))
        if not finished:
            return _ProviderCallResult(state="timeout")
        if "error" in result_box:
            return _ProviderCallResult(state="error", error_message=str(result_box["error"]))
        reply = result_box.get("reply")
        if not isinstance(reply, ProviderReply):
            return _ProviderCallResult(state="error", error_message="Provider call returned an invalid result.")
        return _ProviderCallResult(state="ok", reply=reply)

    def _provider_timeout_seconds(self, provider: str) -> float:
        return float(self._provider_timeouts.get(provider, _OLLAMA_ASK_TIMEOUT_SECONDS))

    def _begin_provider_chat(self, chat_id: str, request_id: str, worker: threading.Thread) -> None:
        with self._provider_chat_lock:
            self._active_provider_chats[chat_id] = (request_id, worker)

    def _finish_provider_chat(self, chat_id: str, request_id: str) -> None:
        with self._provider_chat_lock:
            current = self._active_provider_chats.get(chat_id)
            if current is None:
                return
            if current[0] == request_id:
                self._active_provider_chats.pop(chat_id, None)

    def _is_provider_chat_busy(self, chat_id: str) -> bool:
        with self._provider_chat_lock:
            current = self._active_provider_chats.get(chat_id)
            if current is None:
                return False
            _, worker = current
            if worker.is_alive():
                return True
            self._active_provider_chats.pop(chat_id, None)
            return False

    def _mark_provider_ask_started(self, chat_id: str) -> None:
        with self._provider_chat_lock:
            self._provider_cooldowns[chat_id] = time.monotonic()

    def _provider_ask_is_rate_limited(self, chat_id: str) -> tuple[bool, float]:
        with self._provider_chat_lock:
            last_started = self._provider_cooldowns.get(chat_id)
        if last_started is None:
            return False, 0.0
        elapsed = time.monotonic() - last_started
        remaining = self._provider_ask_cooldown_seconds - elapsed
        if remaining > 0:
            return True, round(remaining, 1)
        return False, 0.0



    @staticmethod
    def _normalize_telegram_reply(text: str, *, response_style: str) -> str:
        lines = [" ".join(raw_line.split()) for raw_line in text.splitlines()]
        cleaned = [line for line in lines if line]
        if not cleaned:
            normalized_fallback = " ".join(text.split())
            return normalized_fallback or "No answer text was returned."
        if response_style == "detailed":
            normalized = chr(10).join(cleaned[:8])
            return ControllerService._trim_telegram_text(normalized, limit=_ASK_DETAILED_LIMIT)
        normalized = " ".join(cleaned)
        return ControllerService._trim_telegram_text(normalized, limit=_ASK_CONCISE_LIMIT)

    @staticmethod
    def _trim_telegram_text(text: str, *, limit: int) -> str:
        if len(text) <= limit:
            return text
        truncated = text[: limit - 3].rstrip()
        if " " in truncated:
            truncated = truncated.rsplit(" ", 1)[0]
        return f"{truncated}..."

    @staticmethod
    def _now_iso() -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")

    def _telegram_recent_success(self, *, window_seconds: float = 300.0) -> bool:
        last_success_at = self._telegram_loop_status.last_success_at.strip()
        if not last_success_at:
            return False
        try:
            last_success = datetime.fromisoformat(last_success_at)
        except ValueError:
            return False
        return (datetime.now().astimezone() - last_success).total_seconds() <= window_seconds

    @staticmethod
    def _health_label(status: str) -> str:
        return {"ok": "Healthy", "degraded": "Degraded", "blocked": "Blocked", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _safety_label(status: str) -> str:
        return {"ok": "Safe", "degraded": "Warning", "blocked": "Unsafe", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _readiness_label(state: str) -> str:
        return {"ready": "Ready", "degraded": "Degraded", "not_ready": "Not Ready"}.get(state, state)

    @staticmethod
    def _provider_label(provider: ProviderType, model: str) -> str:
        if provider == "ollama" and model:
            return f"Ollama / {model}"
        if provider == "ollama":
            return "Ollama"
        return "OpenAI"

    @staticmethod
    def _policy_label(policy: str) -> str:
        return {
            "always_offline": "Always Offline",
            "ask_before_online": "Ask Before Online",
            "always_online": "Always Online",
        }.get(policy, policy)

    @staticmethod
    def _online_use_label(state: str) -> str:
        return {
            "blocked": "Blocked",
            "confirmation-gated": "Confirmation-gated",
            "allowed": "Allowed",
        }.get(state, state)

    def _online_use_state(self) -> tuple[str, str]:
        if self._config.policy == "always_offline":
            return "blocked", "Always Offline policy is active."

        online_status = self._validate_provider(
            provider="openai",
            preferred_ollama_model="",
            transient_openai_key="",
        )
        self._provider_status_cache["openai"] = online_status
        self._persist_provider_status("openai", online_status)

        if self._config.current_mode != "online":
            if self._config.selected_mode == "online" and self._config.policy == "ask_before_online":
                return "confirmation-gated", "Online Mode is selected but not activated yet. Confirm it in the desktop app."
            return "blocked", "Offline Mode is active."

        if not online_status.ready:
            return "blocked", online_status.message

        return "allowed", f"Online Mode is active and {self._provider_label('openai', '')} is ready."

    @staticmethod
    def _telegram_loop_label(state: str) -> str:
        return {"running": "Running", "starting": "Starting", "stopped": "Stopped", "error": "Error"}.get(state, state)

    @staticmethod
    def _telegram_loop_activity_label(state: str) -> str:
        return {
            "idle": "Idle",
            "polling": "Polling",
            "processing_command": "Processing Command",
            "waiting_on_provider": "Waiting On Provider",
            "timed_out": "Timed Out",
            "provider_failed": "Provider Failed",
            "sent_reply": "Sent Reply",
        }.get(state, state)

    def _compute_readiness(

        self,
        *,
        runtime_state: str,
        selected_provider_status: ProviderStatus,
        telegram_status: TelegramChannelStatus,
    ) -> tuple[str, str]:
        blocking: list[str] = []
        warnings: list[str] = []

        if runtime_state != "running":
            blocking.append("Runtime is not running.")

        compatibility_message = self._validate_mode_provider_pair(
            self._config.selected_mode,
            self._config.selected_provider,
            self._config.policy,
        )
        if compatibility_message:
            blocking.append(compatibility_message)

        if not selected_provider_status.ready:
            blocking.append(selected_provider_status.message)

        if self._config.current_mode != self._config.selected_mode:
            warnings.append("Current mode does not match the saved selection.")

        if self._latest_health_report is None:
            warnings.append("Health check has not been run yet.")
        elif self._latest_health_report.overall_status == "blocked":
            blocking.append("Health check reported blocking issues.")
        elif self._latest_health_report.overall_status == "degraded":
            warnings.append("Health check reported warnings.")

        if self._latest_security_report is None:
            warnings.append("Security check has not been run yet.")
        elif self._latest_security_report.overall_status == "blocked":
            blocking.append("Security check reported blocking issues.")
        elif self._latest_security_report.overall_status == "degraded":
            warnings.append("Security check reported warnings.")

        if not telegram_status.token_present:
            warnings.append("Telegram bot token is not stored.")
        elif telegram_status.validation_state != "valid":
            warnings.append(telegram_status.message)
        elif telegram_status.last_test_result != "passed":
            warnings.append("Telegram connection test has not passed yet.")

        if blocking:
            return "not_ready", " ".join(blocking[:2])
        if warnings:
            return "degraded", " ".join(warnings[:2])
        return "ready", "Runtime, provider, diagnostics, and Telegram are ready for daily use."






