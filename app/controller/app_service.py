"""Thin application service that bridges UI actions to the runtime layer."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
import threading

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


_OPERATOR_CONSOLE_LABEL = "Windows OpenClaw Operator Console v1.2"


@dataclass(frozen=True)
class _TelegramResponsePlan:
    reply: str
    command_label: str
    ask_status: str = ""
    hide_content_in_summary: bool = False


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
            message="Telegram polling loop is active.",
        )
        while not stop_event.is_set():
            try:
                updates = self._telegram_service.get_updates(
                    secret_store=self._secret_store,
                    secret_id=self._config.telegram_secret_id,
                    offset=self._config.telegram_last_processed_update_id + 1,
                    timeout=2,
                )
                if self._telegram_loop_status.state != "running":
                    self._update_telegram_loop_status(
                        state="running",
                        message="Telegram polling loop is active.",
                        activity=False,
                    )
                for update in updates:
                    if stop_event.is_set():
                        break
                    self._handle_telegram_update(update)
            except TelegramApiError as exc:
                self._update_telegram_loop_status(
                    state="error",
                    message=f"Telegram polling failed: {sanitize_log_text(str(exc))}",
                )
                if stop_event.wait(1.5):
                    break
            except Exception as exc:  # noqa: BLE001
                self._update_telegram_loop_status(
                    state="error",
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
                    message="Telegram loop stopped.",
                    activity=False,
                )

    def _handle_telegram_update(self, update: TelegramInboundMessage) -> None:
        if update.update_id <= self._config.telegram_last_processed_update_id:
            self._update_telegram_loop_status(
                state=self._telegram_loop_status.state if self._telegram_loop_status.state != "error" else "running",
                message=f"Skipped duplicate Telegram update {update.update_id}.",
                inbound_summary=f"Duplicate update {update.update_id} skipped.",
                activity=True,
            )
            return

        plan = self._build_telegram_reply(update)
        inbound_summary = self._summarize_inbound_update(update, plan.command_label)
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
                message=f"Telegram reply failed: {loop_message}",
                inbound_summary=inbound_summary,
                outbound_summary=outbound_summary,
                activity=True,
                last_command=plan.command_label,
                last_ask_status=plan.ask_status if plan.command_label == "/ask" else None,
            )
            self._persist_telegram_offset(update.update_id)
            return

        self._persist_telegram_offset(update.update_id)
        self._update_telegram_loop_status(
            state="running",
            message=loop_message,
            inbound_summary=inbound_summary,
            outbound_summary=outbound_summary,
            activity=True,
            success=True,
            last_command=plan.command_label,
            last_ask_status=plan.ask_status if plan.command_label == "/ask" else None,
        )

    def _build_telegram_reply(self, update: TelegramInboundMessage) -> _TelegramResponsePlan:
        if not update.has_text:
            return _TelegramResponsePlan(
                reply=f"{_OPERATOR_CONSOLE_LABEL} supports plain text Telegram messages only.",
                command_label="non_text",
            )

        text = update.text.strip()
        command = text.split()[0].lower() if text else ""
        snapshot = self.snapshot()

        if command == "/start":
            return _TelegramResponsePlan(
                reply=(
                    f"{_OPERATOR_CONSOLE_LABEL} is connected to Telegram. "
                    f"Current readiness: {self._readiness_label(snapshot.readiness_state)}. "
                    "Use /help to see supported commands."
                ),
                command_label="/start",
            )
        if command == "/status":
            active_status = self._provider_status_for_mode(self._config.current_mode)
            return _TelegramResponsePlan(
                reply="\n".join(
                    (
                        f"Runtime: {snapshot.runtime_state}",
                        f"Health: {self._health_label(snapshot.health_status)}",
                        f"Security: {self._safety_label(snapshot.safety_status)}",
                        f"Readiness: {self._readiness_label(snapshot.readiness_state)}",
                        f"Mode: {snapshot.mode}",
                        f"Policy: {snapshot.policy}",
                        f"Provider: {self._provider_label(snapshot.active_provider, active_status.model)}",
                        f"Telegram Loop: {self._telegram_loop_label(snapshot.telegram_loop_state)}",
                    )
                ),
                command_label="/status",
            )
        if command == "/mode":
            active_status = self._provider_status_for_mode(self._config.current_mode)
            online_state, online_message = self._online_use_state()
            return _TelegramResponsePlan(
                reply="\n".join(
                    (
                        f"Selected mode: {snapshot.selected_mode}",
                        f"Current mode: {snapshot.mode}",
                        f"Policy: {snapshot.policy}",
                        f"Active provider: {self._provider_label(snapshot.active_provider, active_status.model)}",
                        f"Online use: {online_state}",
                        f"Note: {online_message}",
                    )
                ),
                command_label="/mode",
            )
        if command == "/help":
            return _TelegramResponsePlan(
                reply="\n".join(
                    (
                        "Commands:",
                        "/help - list supported Telegram commands",
                        "/status - show runtime, diagnostics, mode, and provider state",
                        "/mode - show mode, policy, provider, and online-use gate",
                        "/models - list detected local Ollama models",
                        "/ask <prompt> - run one explicit provider-backed query",
                    )
                ),
                command_label="/help",
            )
        if command == "/models":
            return self._build_models_reply()
        if command == "/ask":
            prompt = text[len("/ask") :].strip()
            return self._build_ask_reply(prompt, snapshot)

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
            reply=(
                f"Message received by {_OPERATOR_CONSOLE_LABEL}. "
                "Use /help to see supported commands. Generic text does not trigger provider queries yet."
            ),
            command_label="plain_text",
        )

    def _build_models_reply(self) -> _TelegramResponsePlan:
        ollama_status = self._provider_status_for_mode("offline")
        if not ollama_status.available:
            return _TelegramResponsePlan(
                reply=f"/models is unavailable: {ollama_status.message}",
                command_label="/models",
            )
        if not ollama_status.available_models:
            return _TelegramResponsePlan(
                reply="Ollama is reachable, but no local models are available yet.",
                command_label="/models",
            )
        models = list(ollama_status.available_models[:6])
        suffix = "" if len(ollama_status.available_models) <= len(models) else ", ..."
        selected = f" | active: {ollama_status.model}" if ollama_status.model else ""
        return _TelegramResponsePlan(
            reply=f"Local Ollama models ({len(ollama_status.available_models)}): {', '.join(models)}{suffix}{selected}",
            command_label="/models",
        )

    def _build_ask_reply(self, prompt: str, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        if not prompt:
            return _TelegramResponsePlan(
                reply="Usage: /ask <prompt>",
                command_label="/ask",
                ask_status="/ask blocked: missing prompt.",
                hide_content_in_summary=True,
            )

        if snapshot.runtime_state != "running":
            return _TelegramResponsePlan(
                reply="OpenClaw runtime is not available. Start the runtime in the operator console and try again.",
                command_label="/ask",
                ask_status="/ask blocked: runtime not running.",
                hide_content_in_summary=True,
            )

        current_mode = self._config.current_mode
        if current_mode == "offline":
            provider_status = self._provider_status_for_mode("offline")
            if not provider_status.ready:
                return _TelegramResponsePlan(
                    reply=f"Offline ask is unavailable: {provider_status.message}",
                    command_label="/ask",
                    ask_status=f"/ask blocked: {provider_status.message}",
                    hide_content_in_summary=True,
                )
            if snapshot.readiness_state == "not_ready":
                return _TelegramResponsePlan(
                    reply="Operator console is not ready. Resolve blocking health or security issues in the desktop app and try again.",
                    command_label="/ask",
                    ask_status="/ask blocked: readiness is not ready.",
                    hide_content_in_summary=True,
                )
            adapter = self._provider_adapters["ollama"]
            reply = adapter.ask(  # type: ignore[call-arg]
                runtime_status=self._runtime_manager.get_status(),
                base_url=self._config.ollama_base_url,
                preferred_model=self._config.preferred_ollama_model,
                prompt=prompt,
            )
            if not isinstance(reply, ProviderReply) or not reply.ok:
                message = reply.message if isinstance(reply, ProviderReply) else "Offline provider call failed."
                return _TelegramResponsePlan(
                    reply=f"Offline ask failed: {message}",
                    command_label="/ask",
                    ask_status=f"/ask failed via Ollama: {message}",
                    hide_content_in_summary=True,
                )
            model = reply.model or provider_status.model or "Ollama"
            return _TelegramResponsePlan(
                reply=reply.text,
                command_label="/ask",
                ask_status=f"/ask completed via Ollama / {model}.",
                hide_content_in_summary=True,
            )

        online_state, online_message = self._online_use_state()
        if online_state != "allowed":
            return _TelegramResponsePlan(
                reply=f"Online ask is blocked: {online_message}",
                command_label="/ask",
                ask_status=f"/ask blocked: {online_message}",
                hide_content_in_summary=True,
            )

        provider_status = self._provider_status_for_mode("online")
        if not provider_status.ready:
            return _TelegramResponsePlan(
                reply=f"Online ask is unavailable: {provider_status.message}",
                command_label="/ask",
                ask_status=f"/ask blocked: {provider_status.message}",
                hide_content_in_summary=True,
            )
        if snapshot.readiness_state == "not_ready":
            return _TelegramResponsePlan(
                reply="Operator console is not ready. Resolve blocking health or security issues in the desktop app and try again.",
                command_label="/ask",
                ask_status="/ask blocked: readiness is not ready.",
                hide_content_in_summary=True,
            )

        adapter = self._provider_adapters["openai"]
        reply = adapter.ask(  # type: ignore[call-arg]
            secret_store=self._secret_store,
            secret_id=self._config.openai_secret_id,
            transient_secret="",
            prompt=prompt,
        )
        if not isinstance(reply, ProviderReply) or not reply.ok:
            message = reply.message if isinstance(reply, ProviderReply) else "Online provider call failed."
            return _TelegramResponsePlan(
                reply=f"Online ask failed: {message}",
                command_label="/ask",
                ask_status=f"/ask failed via OpenAI: {message}",
                hide_content_in_summary=True,
            )
        model = reply.model or "OpenAI"
        return _TelegramResponsePlan(
            reply=reply.text,
            command_label="/ask",
            ask_status=f"/ask completed via OpenAI / {model}.",
            hide_content_in_summary=True,
        )

    def _update_telegram_loop_status(
        self,
        *,
        state: str,
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
        if command_label == "/ask":
            return self._summarize_text(f"{update.sender_label}: /ask [prompt hidden]")
        if command_label == "plain_text":
            return self._summarize_text(f"{update.sender_label}: text message received")
        if command_label == "non_text":
            return self._summarize_text(f"{update.sender_label}: non-text message received")
        text = update.text.strip() or command_label
        return self._summarize_text(f"{update.sender_label}: {text}")

    def _outbound_summary_for_plan(self, update: TelegramInboundMessage, plan: _TelegramResponsePlan) -> str:
        if plan.command_label == "/ask":
            return self._summarize_text(plan.ask_status or f"Sent /ask reply to {update.sender_label}.")
        if plan.command_label == "plain_text":
            return self._summarize_text(f"Sent placeholder reply to {update.sender_label}.")
        if plan.command_label == "non_text":
            return self._summarize_text(f"Sent non-text guidance reply to {update.sender_label}.")
        return self._summarize_text(f"Sent {plan.command_label} reply to {update.sender_label}.")

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
