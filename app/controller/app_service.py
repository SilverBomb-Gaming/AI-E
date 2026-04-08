"""Thin application service that bridges UI actions to the runtime layer."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlparse

from .audit_models import AuditRecord
from .audit_store import AuditStore
from .capability_evaluator import CapabilityEvaluator
from .capability_executor import CapabilityExecutor
from .capability_models import CapabilityContext, CapabilityEvaluation, CapabilityManifest
from .capability_registry import COMMAND_CAPABILITY_MAP, get_capability_manifest, list_summary_capabilities
from .context_models import BufferedContext
from .context_store import ContextStore
from .confirmation_models import ConfirmationContextSnapshot, PendingConfirmation
from .confirmation_store import ConfirmationStore
from .channel_models import TelegramChannelStatus, TelegramLoopStatus
from .diagnostic_models import DiagnosticReport
from .execution_models import CapabilityExecutionResult
from .file_reader import FileReadSnapshot, FileReader, FileReaderError
from .diagnostics import ControllerDiagnosticsService
from .models import ControllerSnapshot
from .profile_store import ControllerConfig, ControllerConfigStore, Mode, Policy, ProviderType
from .scope_models import ExecutionScope, ScopeValidationResult
from .scope_validator import ScopeValidator
from .web_fetcher import WebFetchError, WebFetchSnapshot, WebFetcher
from .repo_inspector import RepoInspectionSnapshot, RepoInspector, RepoInspectorError
from .telegram_service import TelegramApiError, TelegramChannelService, TelegramInboundMessage, mask_telegram_token
from ..platform.secrets import SecretStore, get_secret_store
from ..providers import OllamaProviderAdapter, OpenAIProviderAdapter, ProviderReply, ProviderStatus, ProviderType as AdapterProviderType, mask_secret
from ..runtime.manager import OpenClawRuntimeManager
from ..runtime.log_sanitizer import sanitize_log_text


_OPERATOR_CONSOLE_LABEL = "Windows OpenClaw Operator Console v2.5"
_ASK_CONCISE_LIMIT = 700
_ASK_DETAILED_LIMIT = 1500
_PROVIDER_ASK_COMMANDS = frozenset({"/ask", "/askd", "/asklast", "/askctx"})
_PROVIDER_ASK_COOLDOWN_SECONDS = 4.0
_OLLAMA_ASK_TIMEOUT_SECONDS = 12.0
_OPENAI_ASK_TIMEOUT_SECONDS = 18.0
_CONFIRMATION_LIFETIME_SECONDS = 120.0
_AUDIT_LOG_MAX_RECORDS = 50
_CONTEXT_BUFFER_MAX_ITEMS = 6
_CONTEXT_LIFETIME_SECONDS = 1800.0
_CONTEXT_PROMPT_CHAR_LIMIT = 2200


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
        repo_inspector: RepoInspector | None = None,
        file_reader: FileReader | None = None,
        web_fetcher: WebFetcher | None = None,
    ) -> None:
        self._runtime_manager = runtime_manager or OpenClawRuntimeManager()
        self._config_store = config_store or ControllerConfigStore()
        self._secret_store = secret_store or get_secret_store()
        self._provider_adapters = provider_adapters or {
            "ollama": OllamaProviderAdapter(),
            "openai": OpenAIProviderAdapter(),
        }
        self._telegram_service = telegram_service or TelegramChannelService()
        self._repo_inspector = repo_inspector or RepoInspector()
        self._file_reader = file_reader or FileReader()
        self._web_fetcher = web_fetcher or WebFetcher()
        self._config = self._config_store.load()
        self._normalize_repo_root_config()
        self._normalize_file_roots_config()
        self._normalize_web_domains_config()
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
        self._scope_validator = ScopeValidator()
        self._capability_evaluator = CapabilityEvaluator()
        self._capability_executor = CapabilityExecutor(self)
        self._audit_store = AuditStore(max_records=_AUDIT_LOG_MAX_RECORDS)
        self._context_store = ContextStore(
            max_contexts_per_chat=_CONTEXT_BUFFER_MAX_ITEMS,
            lifetime_seconds=_CONTEXT_LIFETIME_SECONDS,
        )
        self._last_capability_evaluation: CapabilityEvaluation | None = None
        self._last_execution_result: CapabilityExecutionResult | None = None
        self._last_context_source = "No buffered context yet."
        self._last_context_action = "No context action yet."
        self._last_repo_branch = "-"
        self._last_repo_state = "No repository insight result yet."
        self._last_repo_checked_at = "-"
        self._last_file_read = "No file preview result yet."
        self._last_file_status = "No file preview result yet."
        self._last_file_read_at = "-"
        self._last_web_fetch = "No web fetch result yet."
        self._last_web_status = "No web fetch result yet."
        self._last_web_content_type = "-"
        self._last_web_fetched_at = "-"
        self._confirmation_store = ConfirmationStore(lifetime_seconds=_CONFIRMATION_LIFETIME_SECONDS)
        self._last_confirmation_requested = "No pending confirmation requested yet."
        self._last_confirmation_result = "No confirmation handled yet."
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
        self._cleanup_expired_confirmations()
        self._cleanup_expired_contexts()
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
        current_context = self._context_store.current_any()
        current_context_freshness = self._describe_current_context_freshness(current_context)
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
            configured_repo_root=self._config.repo_root or "-",
            configured_file_roots=self._file_roots_summary(self._config.file_allowed_roots),
            configured_web_domains=self._web_domains_summary(self._config.web_allowed_domains),
            buffered_context_count=self._context_store.total_count(),
            last_context_source=self._last_context_source,
            current_context_freshness=current_context_freshness,
            last_context_action=self._last_context_action,
            last_repo_branch=self._last_repo_branch,
            last_repo_status=self._last_repo_state,
            last_repo_checked_at=self._last_repo_checked_at,
            last_file_read=self._last_file_read,
            last_file_read_status=self._last_file_status,
            last_file_read_at=self._last_file_read_at,
            last_web_fetch=self._last_web_fetch,
            last_web_status=self._last_web_status,
            last_web_content_type=self._last_web_content_type,
            last_web_fetched_at=self._last_web_fetched_at,
            last_capability_id=self._last_capability_evaluation.capability_id if self._last_capability_evaluation else "-",
            last_capability_state=self._last_capability_evaluation.current_availability_state if self._last_capability_evaluation else "unknown",
            last_capability_message=self._last_capability_evaluation.message if self._last_capability_evaluation else "No capability evaluated yet.",
            last_capability_trust_summary=self._format_evaluation_trust_summary(self._last_capability_evaluation) if self._last_capability_evaluation else "No capability trust summary yet.",
            last_execution_outcome=self._last_execution_result.outcome if self._last_execution_result else "unknown",
            last_execution_reason_code=self._last_execution_result.outcome_reason_code if self._last_execution_result else "no_execution_yet",
            last_execution_summary=self._last_execution_result.internal_summary if self._last_execution_result else "No execution result yet.",
            last_execution_trust_summary=self._last_execution_result.trust_summary if self._last_execution_result else "No execution trust summary yet.",
            last_execution_scope_summary=self._last_execution_result.scope_summary if self._last_execution_result else "No execution scope summary yet.",
            last_execution_duration_ms=self._last_execution_result.duration_ms if self._last_execution_result else 0,
            last_execution_finished_at=self._last_execution_result.finished_at if self._last_execution_result else "-",
            last_audit_summary=self._format_audit_record_summary(self._audit_store.latest()) if self._audit_store.latest() else "No audit record yet.",
            pending_confirmation_count=self._confirmation_store.pending_count(),
            last_confirmation_requested=self._last_confirmation_requested,
            last_confirmation_result=self._last_confirmation_result,
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
            self._last_message = "Settings saved. Online requests will require one-shot confirmation before remote execution."
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

    def _normalize_repo_root_config(self) -> None:
        raw_value = self._config.repo_root.strip()
        if not raw_value:
            normalized = str(Path(__file__).resolve().parents[2])
        else:
            try:
                candidate = Path(raw_value)
                normalized = str(candidate.resolve(strict=False)) if not candidate.is_absolute() else str(candidate)
            except OSError:
                normalized = raw_value
        if normalized != self._config.repo_root:
            self._config.repo_root = normalized
            self._config_store.save(self._config)

    def _normalize_file_roots_config(self) -> None:
        raw_roots = tuple(root for root in self._config.file_allowed_roots if root.strip())
        if not raw_roots:
            raw_roots = (self._config.repo_root.strip(),)
        normalized_roots: list[str] = []
        seen: set[str] = set()
        for raw_root in raw_roots:
            candidate_text = raw_root.strip()
            if not candidate_text:
                continue
            try:
                candidate = Path(candidate_text)
                normalized = str(candidate.resolve(strict=False)) if not candidate.is_absolute() else str(candidate)
            except OSError:
                normalized = candidate_text
            if normalized not in seen:
                seen.add(normalized)
                normalized_roots.append(normalized)
        final_roots = tuple(normalized_roots)
        if final_roots != self._config.file_allowed_roots:
            self._config.file_allowed_roots = final_roots
            self._config_store.save(self._config)

    def _normalize_web_domains_config(self) -> None:
        raw_domains = tuple(domain for domain in self._config.web_allowed_domains if domain.strip())
        normalized_domains: list[str] = []
        seen: set[str] = set()
        for raw_domain in raw_domains:
            candidate = raw_domain.strip().lower()
            if not candidate:
                continue
            if "://" in candidate:
                candidate = self._host_from_url(candidate)
            else:
                candidate = candidate.split("/", 1)[0]
            if candidate.startswith("*."):
                candidate = f"*.{candidate[2:].lstrip('.')}"
            else:
                candidate = candidate.lstrip(".")
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            normalized_domains.append(candidate)
        final_domains = tuple(normalized_domains)
        if final_domains != self._config.web_allowed_domains:
            self._config.web_allowed_domains = final_domains
            self._config_store.save(self._config)

    def _repo_configuration_state(self) -> tuple[str, bool, str, str]:
        raw_value = self._config.repo_root.strip()
        if not raw_value:
            return "", False, "Repository root is not configured.", "repo_root_missing"
        candidate = Path(raw_value)
        if not candidate.is_absolute():
            return raw_value, False, "Repository root must be an absolute path.", "repo_root_not_absolute"
        try:
            resolved = candidate.resolve(strict=False)
        except OSError:
            return raw_value, False, "Repository root could not be resolved.", "repo_root_invalid"
        if not resolved.exists():
            return str(resolved), False, "Repository not found at configured path.", "repo_not_found"
        if not resolved.is_dir():
            return str(resolved), False, "Repository root is not a directory.", "repo_root_not_directory"
        return str(resolved), True, f"Repository root ready: {resolved.name}.", "repo_ready"

    def _file_scope_state(self) -> tuple[tuple[str, ...], bool, str, str]:
        usable_roots: list[str] = []
        invalid_absolute = False
        for raw_root in self._config.file_allowed_roots:
            candidate_text = raw_root.strip()
            if not candidate_text:
                continue
            candidate = Path(candidate_text)
            if not candidate.is_absolute():
                invalid_absolute = True
                continue
            try:
                resolved = candidate.resolve(strict=False)
            except OSError:
                continue
            if resolved.exists() and resolved.is_dir():
                usable_roots.append(str(resolved))
        roots = tuple(dict.fromkeys(usable_roots))
        if roots:
            return roots, True, f"File preview is scoped to {len(roots)} allowed director{'y' if len(roots) == 1 else 'ies'}.", "file_scope_ready"
        if invalid_absolute:
            return (), False, "Allowed file directories must use absolute paths.", "file_roots_not_absolute"
        return (), False, "No allowed file directories are configured.", "file_roots_missing"

    def _web_scope_state(self) -> tuple[tuple[str, ...], bool, str, str]:
        allowed_domains = tuple(domain for domain in self._config.web_allowed_domains if domain.strip())
        if allowed_domains:
            return allowed_domains, True, f"Web fetch is scoped to {len(allowed_domains)} allowed domain{'s' if len(allowed_domains) != 1 else ''}.", "web_scope_ready"
        return (), False, "No allowed web domains are configured.", "web_scope_missing"

    def _repo_display_name(self, repo_root: str = "") -> str:
        candidate = repo_root.strip() or self._config.repo_root.strip()
        if not candidate:
            return "Configured Repo"
        path = Path(candidate)
        return path.name or candidate

    @staticmethod
    def _file_roots_summary(roots: tuple[str, ...]) -> str:
        if not roots:
            return "-"
        labels = [Path(root).name or root for root in roots[:2]]
        if len(roots) > 2:
            labels.append(f"+{len(roots) - 2} more")
        return ", ".join(labels)

    @staticmethod
    def _web_domains_summary(domains: tuple[str, ...]) -> str:
        if not domains:
            return "-"
        labels = list(domains[:3])
        if len(domains) > 3:
            labels.append(f"+{len(domains) - 3} more")
        return ", ".join(labels)

    def _describe_current_context_freshness(self, current_context: BufferedContext | None) -> str:
        if current_context is None:
            return "none"
        freshness = self._context_store.freshness_of(current_context)
        if freshness == "stale":
            return "stale"
        if freshness == "expired":
            return "expired"
        return "active"

    def inspect_repo_status(self) -> RepoInspectionSnapshot:
        repo_root, repo_root_valid, repo_message, repo_code = self._repo_configuration_state()
        if not repo_root_valid:
            raise RepoInspectorError(repo_code, repo_message)
        return self._repo_inspector.inspect(repo_root, commit_limit=4)

    def resolve_file_request(self, relative_path: str) -> tuple[str, str, tuple[str, ...], str, str]:
        requested = relative_path.strip()
        if not requested:
            return "", "", (), "missing_file_path", "Use /file <relative_path>."
        candidate_path = Path(requested)
        if candidate_path.is_absolute():
            return requested, "", (), "absolute_path_not_allowed", "Use /file <relative_path> inside the allowed directories."
        if any(part == ".." for part in candidate_path.parts):
            return requested.replace("\\", "/"), "", (), "target_path_not_allowed", "File is outside allowed directories."

        allowed_roots, roots_valid, roots_message, roots_code = self._file_scope_state()
        if not roots_valid:
            return requested.replace("\\", "/"), "", allowed_roots, roots_code, roots_message

        requested_display = requested.replace("\\", "/")
        first_scoped_target = ""
        for root in allowed_roots:
            try:
                target = (Path(root) / candidate_path).resolve(strict=False)
                target.relative_to(Path(root).resolve())
            except (OSError, ValueError):
                continue
            if not first_scoped_target:
                first_scoped_target = str(target)
            if target.exists() and target.is_file():
                return requested_display, str(target), allowed_roots, "file_target_ready", "Scoped file target is ready."
        if first_scoped_target:
            return requested_display, first_scoped_target, allowed_roots, "file_not_found", "File not found in allowed scope."
        return requested_display, "", allowed_roots, "target_path_not_allowed", "File is outside allowed directories."

    def read_file_preview(self, relative_path: str) -> FileReadSnapshot:
        display_path, target_path, _, reason_code, message = self.resolve_file_request(relative_path)
        if reason_code != "file_target_ready" or not target_path:
            raise FileReaderError(reason_code, message)
        return self._file_reader.read_text_preview(target_path, display_path=display_path)

    def resolve_web_request(self, target_url: str) -> tuple[str, str, tuple[str, ...], str, str, str]:
        requested = " ".join(target_url.split())
        if not requested:
            return "", "", (), "", "missing_url", "Use /web <https://allowed-domain/path>."

        allowed_domains, scope_valid, scope_message, scope_code = self._web_scope_state()
        if not scope_valid:
            return requested, "", allowed_domains, "", scope_code, scope_message

        try:
            normalized_url = WebFetcher.normalize_target_url(requested)
        except WebFetchError as exc:
            return requested, "", allowed_domains, "", exc.code, exc.message

        target_domain = self._host_from_url(normalized_url)
        return self._sanitize_url_for_display(normalized_url), normalized_url, allowed_domains, target_domain, "web_target_ready", "Scoped web target is ready."

    def fetch_web_preview(self, target_url: str) -> WebFetchSnapshot:
        display_url, normalized_url, allowed_domains, _, reason_code, message = self.resolve_web_request(target_url)
        if reason_code != "web_target_ready" or not normalized_url:
            raise WebFetchError(reason_code, message)
        return self._web_fetcher.fetch_text_preview(normalized_url, allowed_domains=allowed_domains)

    def _build_repo_reply(self, inspection: RepoInspectionSnapshot) -> _TelegramResponsePlan:
        lines = [
            f"Repo: {inspection.repo_name}",
            f"Branch: {inspection.branch}",
            f"Status: {inspection.status_label}",
        ]
        if inspection.recent_commits:
            lines.append("Recent commits:")
            lines.extend(f"- {commit}" for commit in inspection.recent_commits[:4])
        else:
            lines.append("Recent commits: none yet")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/repo",
        )

    def _build_file_reply(self, preview: FileReadSnapshot) -> _TelegramResponsePlan:
        lines = [
            f"File: {preview.display_path}",
            f"Size: {preview.size_label}",
            "Preview:",
            preview.preview_text,
        ]
        if preview.oversized:
            lines.append("Note: Large file preview truncated for safety.")
        elif preview.truncated:
            lines.append("Note: Preview truncated.")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/file",
        )

    def _build_web_reply(self, preview: WebFetchSnapshot) -> _TelegramResponsePlan:
        lines = [
            f"Web: {preview.domain}",
            f"Type: {preview.content_type}",
            f"URL: {preview.display_url}",
            "Preview:",
            preview.preview_text,
        ]
        if preview.display_url.startswith("http://"):
            lines.append("Note: HTTP preview allowed for this request; prefer HTTPS when available.")
        if preview.redirected:
            lines.append("Note: Followed an allowed redirect that stayed within the configured web scope.")
        if preview.oversized:
            lines.append("Note: Large web preview truncated for safety.")
        elif preview.truncated:
            lines.append("Note: Preview truncated.")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/web",
        )

    def create_context_buffer(
        self,
        *,
        source_capability_id: str,
        source_command: str,
        scope_type: str,
        source_summary: str,
        content_kind: str,
        normalized_content: str,
        content_preview: str,
        size_class: str,
        chat_id: str,
        user_id: str,
        request_id: str,
    ) -> BufferedContext:
        normalized = self._summarize_text(normalized_content, limit=2400)
        preview = self._summarize_text(content_preview or normalized, limit=240)
        summary = self._summarize_text(source_summary, limit=96)
        truncated = size_class in {"truncated", "large"}
        trust_summary = self._format_manifest_trust_summary(self._capability_manifest(source_capability_id))
        return self._context_store.create(
            source_capability_id=source_capability_id,
            source_command=source_command,
            scope_type=scope_type,  # type: ignore[arg-type]
            source_summary=summary,
            content_kind=content_kind,  # type: ignore[arg-type]
            content_preview=preview,
            normalized_content=normalized,
            size_class=size_class,  # type: ignore[arg-type]
            truncated=truncated,
            trust_summary=trust_summary,
            user_id=user_id,
            chat_id=chat_id,
            originating_request_id=request_id,
        )

    def latest_context_for_chat(self, *, chat_id: str) -> BufferedContext | None:
        self._cleanup_expired_contexts()
        return self._context_store.latest(chat_id=chat_id)

    def resolve_context_for_chat(self, *, chat_id: str, reference: str) -> BufferedContext | None:
        self._cleanup_expired_contexts()
        return self._context_store.resolve(chat_id=chat_id, reference=reference)

    def recent_contexts_for_chat(self, *, chat_id: str, limit: int = 5) -> tuple[BufferedContext, ...]:
        self._cleanup_expired_contexts()
        return self._context_store.recent(chat_id=chat_id, limit=limit)

    def clear_contexts_for_chat(self, *, chat_id: str) -> int:
        cleared = self._context_store.clear(chat_id=chat_id)
        if self._context_store.total_count() == 0:
            self._last_context_source = "No buffered context yet."
        return cleared

    def _cleanup_expired_contexts(self) -> None:
        expired = self._context_store.cleanup_expired()
        if expired and self._context_store.total_count() == 0:
            self._last_context_source = "No buffered context yet."
        latest = self._context_store.latest_any()
        if latest is None:
            self._last_context_source = "No buffered context yet."

    def _context_ready_note(self, context: BufferedContext) -> str:
        return f"Context: {context.context_id} ready for /asklast or /askctx {context.context_id} <prompt>."

    def _build_contexts_reply(self, *, chat_id: str, limit: int = 5) -> _TelegramResponsePlan:
        contexts = self.recent_contexts_for_chat(chat_id=chat_id, limit=max(1, min(limit, 6)))
        if not contexts:
            return _TelegramResponsePlan(
                reply="Contexts\nNo recent context is available in this chat.",
                command_label="/contexts",
            )
        lines = ["Contexts (latest first)"]
        for item in contexts:
            lines.append(f"- {item.context_id} {item.source_capability_id} {item.source_summary}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/contexts",
        )

    def _build_clear_context_reply(self, *, cleared_count: int) -> _TelegramResponsePlan:
        if cleared_count <= 0:
            message = "Context buffer is already clear for this chat."
        elif cleared_count == 1:
            message = "Cleared 1 context entry for this chat."
        else:
            message = f"Cleared {cleared_count} context entries for this chat."
        return _TelegramResponsePlan(
            reply=message,
            command_label="/clearcontext",
        )

    def _build_contextual_prompt(self, *, prompt: str, context: BufferedContext) -> tuple[str, bool]:
        content = context.normalized_content.strip()
        trimmed = False
        if len(content) > _CONTEXT_PROMPT_CHAR_LIMIT:
            content = f"{content[: _CONTEXT_PROMPT_CHAR_LIMIT - 3].rstrip()}..."
            trimmed = True
        combined = "\n".join(
            (
                "Use the explicit operator-provided context below if it helps answer the request.",
                f"Context Source: {context.source_summary}",
                "Context:",
                content,
                "User Request:",
                prompt.strip(),
            )
        )
        return combined, trimmed

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
                last_ask_status=plan.ask_status if plan.command_label in _PROVIDER_ASK_COMMANDS or (plan.command_label == "/confirm" and plan.ask_status) else None,
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
            last_ask_status=plan.ask_status if plan.command_label in _PROVIDER_ASK_COMMANDS or (plan.command_label == "/confirm" and plan.ask_status) else None,
        )


    def _build_telegram_reply(
        self,
        update: TelegramInboundMessage,
        *,
        parsed_command: _ParsedTelegramCommand | None = None,
        batch_busy: bool = False,
    ) -> _TelegramResponsePlan:
        parsed = parsed_command or self._parse_telegram_command(update)
        snapshot = self.snapshot()
        result = self._capability_executor.execute_telegram(
            update=update,
            parsed_command=parsed,
            snapshot=snapshot,
            batch_busy=batch_busy,
        )
        self._remember_execution_result(result)
        return self._plan_from_execution_result(result)

    def _remember_execution_result(self, result: CapabilityExecutionResult) -> None:
        self._last_execution_result = result
        self._remember_context_execution_result(result)
        self._audit_store.append(self._build_audit_record(result))
        self._remember_repo_execution_result(result)
        self._remember_file_execution_result(result)
        self._remember_web_execution_result(result)
        self._last_message = result.internal_summary or self._last_message

    def _remember_context_execution_result(self, result: CapabilityExecutionResult) -> None:
        created_context_id = str(result.telemetry.get("context_created_id") or "").strip()
        context_source = str(result.telemetry.get("context_source_summary") or "").strip()
        if created_context_id and context_source:
            self._last_context_source = self._summarize_text(f"{created_context_id} {context_source}", limit=120)
            self._last_context_action = self._summarize_text(
                f"Created {created_context_id} from {result.capability_id}.",
                limit=120,
            )
            return
        if result.capability_id == "context.clear":
            summary = str(result.telemetry.get("context_clear_summary") or result.internal_summary).strip()
            self._last_context_action = self._summarize_text(summary or "Context buffer cleared.", limit=120)
            if self._context_store.total_count() == 0:
                self._last_context_source = "No buffered context yet."
            return
        if result.capability_id == "context.read":
            self._last_context_action = self._summarize_text(result.internal_summary, limit=120)
            return
        used_context_id = str(result.telemetry.get("context_used_id") or "").strip()
        used_source = str(result.telemetry.get("context_source_summary") or "").strip()
        if used_context_id:
            label = used_source or "stored context"
            self._last_context_action = self._summarize_text(
                f"Used {used_context_id} from {label} via {result.command_label}.",
                limit=120,
            )

    def _remember_repo_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id != "repo.status.read":
            return
        repo_branch = str(result.telemetry.get("repo_branch") or "").strip()
        repo_status = str(result.telemetry.get("repo_status_label") or "").strip()
        repo_name = str(result.telemetry.get("repo_name") or self._repo_display_name()).strip() or self._repo_display_name()
        if repo_branch:
            self._last_repo_branch = repo_branch
        if repo_status:
            self._last_repo_state = self._summarize_text(f"{repo_name}: {repo_status}", limit=120)
        else:
            self._last_repo_state = self._summarize_text(result.internal_summary, limit=120)
        self._last_repo_checked_at = result.finished_at or self._now_iso()

    def _remember_file_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id != "file.read":
            return
        file_name = str(result.telemetry.get("file_name") or "").strip()
        file_status = str(result.telemetry.get("file_status") or "").strip()
        file_display = str(result.telemetry.get("display_path") or file_name or "unknown file").strip()
        self._last_file_read = file_display
        if file_status:
            self._last_file_status = self._summarize_text(file_status, limit=120)
        else:
            self._last_file_status = self._summarize_text(result.internal_summary, limit=120)
        self._last_file_read_at = result.finished_at or self._now_iso()

    def _remember_web_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id != "web.fetch.read":
            return
        web_domain = str(result.telemetry.get("web_domain") or "unknown domain").strip()
        web_status = str(result.telemetry.get("web_status") or "").strip()
        content_type = str(result.telemetry.get("web_content_type") or "").strip()
        self._last_web_fetch = web_domain
        self._last_web_status = self._summarize_text(web_status or result.internal_summary, limit=120)
        self._last_web_content_type = content_type or "-"
        self._last_web_fetched_at = result.finished_at or self._now_iso()

    @staticmethod
    def _plan_from_execution_result(result: CapabilityExecutionResult) -> _TelegramResponsePlan:
        response_style = str(result.request.metadata.get("response_style", "detailed" if result.command_label == "/askd" else "concise"))
        return _TelegramResponsePlan(
            reply=result.user_message,
            command_label=result.command_label,
            ask_status=result.ask_status,
            hide_content_in_summary=result.hide_content_in_summary,
            response_style=response_style,
        )

    @staticmethod
    def _operator_console_label() -> str:
        return _OPERATOR_CONSOLE_LABEL

    def _build_help_reply(self) -> _TelegramResponsePlan:
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Operator commands",
                    "/help - command list",
                    "/status - readiness",
                    "/mode - mode / policy",
                    "/models - local models",
                    "/repo - summary",
                    "/file <path> - preview",
                    "/web <url> - preview",
                    "/contexts - recent context",
                    "/clearcontext - clear context",
                    "/capabilities - capability state",
                    "/audit - recent actions",
                    "/ask <prompt> - concise ask",
                    "/askd <prompt> - detailed ask",
                    "/asklast <prompt> - latest context",
                    "/askctx <id> <prompt> - chosen context",
                    "/confirm <id> - approve action",
                    "/deny <id> - reject action",
                    "Plain text is not auto-routed.",
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

    def _build_models_reply(
        self,
        capability: CapabilityEvaluation | None,
        context: CapabilityContext | None,
    ) -> _TelegramResponsePlan:
        ollama_status = context.offline_provider_status if context is not None else self._provider_status_for_mode("offline")
        if capability is not None and capability.reason_code == "ollama_unavailable":
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "Unavailable right now.",
                        f"Reason: {capability.blocking_reason}",
                    )
                ),
                command_label="/models",
            )
        if capability is not None and capability.reason_code == "no_local_models":
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "No local Ollama models are available yet.",
                    )
                ),
                command_label="/models",
            )
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
        requester_label: str,
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

        capability, context = self._evaluate_command_capability(command_label, snapshot)
        if capability is None or context is None:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Capability evaluation is unavailable.",
                next_step="Run /status from Telegram or the desktop app, then try again.",
                activity_state="processing_command",
            )
        if capability.current_availability_state == "confirmation_required":
            return self._build_confirmation_required_reply(
                command_label=command_label,
                capability=capability,
                context=context,
                snapshot=snapshot,
                prompt=prompt,
                response_style=response_style,
                chat_id=chat_id,
                requester_label=requester_label,
            )
        if capability.current_availability_state != "allowed":
            return self._blocked_ask_reply_from_capability(command_label=command_label, capability=capability)

        execution_mode = self._config.current_mode
        if self._config.selected_mode == "online" and self._config.current_mode != "online":
            execution_mode = "online"
        if execution_mode == "offline":
            provider_status = context.offline_provider_status
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

        provider_status = context.online_provider_status
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
        model = reply.model or provider_status.model or "OpenAI"
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
        if command_label == "/file":
            return self._summarize_text(f"{update.sender_label}: /file [path hidden]")
        if command_label == "/web":
            return self._summarize_text(f"{update.sender_label}: /web [url hidden]")
        if command_label in {"/contexts", "/clearcontext"}:
            return self._summarize_text(f"{update.sender_label}: {command_label}")
        if command_label == "plain_text":
            return self._summarize_text(f"{update.sender_label}: text message received")
        if command_label == "non_text":
            return self._summarize_text(f"{update.sender_label}: non-text message received")
        if command_label == "parse_failure":
            return self._summarize_text(f"{update.sender_label}: malformed command")
        text = update.text.strip() or command_label
        return self._summarize_text(f"{update.sender_label}: {text}")

    def _outbound_summary_for_plan(self, update: TelegramInboundMessage, plan: _TelegramResponsePlan) -> str:
        if plan.command_label in _PROVIDER_ASK_COMMANDS or (plan.command_label == "/confirm" and plan.ask_status):
            return self._summarize_text(plan.ask_status or f"Sent {plan.command_label} reply to {update.sender_label}.")
        if plan.command_label == "plain_text":
            return self._summarize_text(f"Sent placeholder reply to {update.sender_label}.")
        if plan.command_label == "non_text":
            return self._summarize_text(f"Sent non-text guidance reply to {update.sender_label}.")
        if plan.command_label == "parse_failure":
            return self._summarize_text(f"Sent command correction to {update.sender_label}.")
        if plan.command_label == "/file":
            return self._summarize_text(f"Sent /file reply to {update.sender_label}.")
        if plan.command_label == "/web":
            return self._summarize_text(f"Sent /web reply to {update.sender_label}.")
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
        if command in {
            "/start",
            "/help",
            "/status",
            "/mode",
            "/models",
            "/repo",
            "/file",
            "/web",
            "/contexts",
            "/clearcontext",
            "/capabilities",
            "/audit",
            "/confirm",
            "/deny",
            "/ask",
            "/askd",
            "/asklast",
            "/askctx",
        }:
            return _ParsedTelegramCommand(command_label=command, argument=argument, normalized_text=normalized_text)
        if command.startswith("/file"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /file <relative_path>.",
            )
        if command.startswith("/web"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /web <https://allowed-domain/path>.",
            )
        if command.startswith("/repo"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /repo or /repo status.",
            )
        if command.startswith("/contexts") or command.startswith("/clearcontext"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /contexts or /clearcontext.",
            )
        if command.startswith("/asklast"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /asklast <prompt>.",
            )
        if command.startswith("/askctx"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /askctx <context_id> <prompt>.",
            )
        if command.startswith("/ask"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /ask <prompt> or /askd <prompt>.",
            )
        if command.startswith("/confirm") or command.startswith("/deny"):
            return _ParsedTelegramCommand(
                command_label="parse_failure",
                normalized_text=normalized_text,
                usage_hint="Use /confirm <id> or /deny <id>.",
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

    def _evaluate_command_capability(
        self,
        command_label: str,
        snapshot: ControllerSnapshot,
        *,
        remember: bool = True,
        confirmation_granted: bool = False,
        source: str = "telegram",
    ) -> tuple[CapabilityEvaluation | None, CapabilityContext | None]:
        capability_id = COMMAND_CAPABILITY_MAP.get(command_label)
        if capability_id is None:
            return None, None
        return self._evaluate_capability_id(
            capability_id,
            snapshot,
            remember=remember,
            confirmation_granted=confirmation_granted,
            source=source,
        )

    def _evaluate_capability_id(
        self,
        capability_id: str,
        snapshot: ControllerSnapshot,
        *,
        remember: bool = True,
        confirmation_granted: bool = False,
        source: str = "telegram",
    ) -> tuple[CapabilityEvaluation, CapabilityContext]:
        context = self._build_capability_context(snapshot, capability_id=capability_id)
        evaluation = self._capability_evaluator.evaluate(
            capability_id,
            context,
            source=source,  # type: ignore[arg-type]
            confirmation_granted=confirmation_granted,
        )
        if remember:
            self._last_capability_evaluation = evaluation
        return evaluation, context

    def _build_capability_context(self, snapshot: ControllerSnapshot, *, capability_id: str) -> CapabilityContext:
        manifest = self._capability_manifest(capability_id)
        need_offline = manifest.provider_dependency in {"ollama", "active_provider"} and (
            manifest.offline_safety != "requires_online" or snapshot.mode == "offline" or self._config.selected_mode == "offline"
        )
        need_online = manifest.provider_dependency in {"openai", "active_provider"} and (
            manifest.offline_safety != "safe_offline" or snapshot.mode == "online" or self._config.selected_mode == "online"
        )
        need_offline = need_offline or snapshot.mode == "offline"
        need_online = need_online or snapshot.mode == "online" or self._config.selected_mode == "online"
        offline_status = self._provider_status_for_mode("offline") if need_offline else self._provider_status_cache.get("ollama") or self._default_provider_status("ollama")
        online_status = self._provider_status_for_mode("online") if need_online else self._provider_status_cache.get("openai") or self._default_provider_status("openai")
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        file_allowed_roots, file_scope_valid, file_message, _ = self._file_scope_state()
        web_allowed_domains, web_scope_valid, web_message, _ = self._web_scope_state()
        return CapabilityContext(
            runtime_state=snapshot.runtime_state,
            readiness_state=snapshot.readiness_state,
            mode=snapshot.mode,
            selected_mode=snapshot.selected_mode,
            policy=snapshot.policy,
            active_provider=snapshot.active_provider,
            selected_provider=snapshot.selected_provider,
            health_status=snapshot.health_status,
            safety_status=snapshot.safety_status,
            offline_provider_status=offline_status,
            online_provider_status=online_status,
            repo_root=repo_root,
            repo_root_valid=repo_root_valid,
            repo_message=repo_message,
            file_allowed_roots=file_allowed_roots,
            file_scope_valid=file_scope_valid,
            file_message=file_message,
            web_allowed_domains=web_allowed_domains,
            web_scope_valid=web_scope_valid,
            web_message=web_message,
        )

    def _build_capabilities_reply(self, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        lines = ["Capabilities"]
        for manifest in list_summary_capabilities():
            evaluation, _ = self._evaluate_capability_id(
                manifest.capability_id,
                snapshot,
                remember=False,
                source="telegram",
            )
            lines.append(self._format_capability_summary_line(evaluation))
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/capabilities",
        )

    def _build_audit_reply(self, *, limit: int = 5) -> _TelegramResponsePlan:
        records = self._audit_store.recent(limit=max(1, min(limit, 8)))
        if not records:
            return _TelegramResponsePlan(
                reply="Audit\nNo capability executions have been recorded yet.",
                command_label="/audit",
            )
        lines = ["Audit"]
        for record in records:
            lines.append(self._format_audit_record_summary(record))
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/audit",
        )

    def _format_capability_summary_line(self, evaluation: CapabilityEvaluation) -> str:
        state_label = self._capability_state_label(evaluation.current_availability_state)
        parts = [
            state_label,
            self._access_kind_label(evaluation.access_kind),
            self._locality_label(evaluation.locality),
            self._offline_safety_label(evaluation.offline_safety),
        ]
        if evaluation.current_availability_state == "confirmation_required":
            parts.append("confirmation-gated")
        detail = evaluation.blocking_reason or evaluation.message
        line = f"- {evaluation.capability_id}: {' | '.join(parts)}"
        if evaluation.current_availability_state != "allowed":
            line = f"{line} ({self._summarize_text(detail, limit=60)})"
        return line

    def _blocked_ask_reply_from_capability(
        self,
        *,
        command_label: str,
        capability: CapabilityEvaluation,
    ) -> _TelegramResponsePlan:
        reason = capability.blocking_reason or capability.message
        next_step_map = {
            "runtime_not_running": "Start the runtime in the operator console and try again.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
            "offline_provider_unavailable": "Validate Ollama in the operator console before asking again.",
            "online_provider_unavailable": "Save or validate the OpenAI configuration in the operator console.",
            "policy_always_offline": "Switch to Offline Mode or activate Online Mode explicitly in the operator console.",
            "online_confirmation_required": "Approve the pending remote request with /confirm <id> after /ask returns a confirmation prompt.",
        }
        next_step = next_step_map.get(capability.reason_code, "Check the operator console configuration and try again.")
        activity_state = "provider_failed" if capability.current_availability_state in {"unavailable", "degraded"} else "processing_command"
        return self._blocked_ask_reply(
            command_label=command_label,
            reason=reason,
            next_step=next_step,
            activity_state=activity_state,
        )

    def _build_confirmation_required_reply(
        self,
        *,
        command_label: str,
        capability: CapabilityEvaluation,
        context: CapabilityContext,
        snapshot: ControllerSnapshot,
        prompt: str,
        response_style: str,
        chat_id: str,
        requester_label: str,
    ) -> _TelegramResponsePlan:
        confirmation = self._confirmation_store.create(
            capability_id=capability.capability_id,
            original_command=command_label,
            argument_summary=f"{command_label} [prompt hidden]",
            prompt_text=prompt,
            response_style=response_style,
            chat_id=chat_id,
            requester_label=requester_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
        )
        expires_in = self._confirmation_seconds_remaining(confirmation)
        awaiting_message = f"{command_label} awaiting confirmation {confirmation.confirmation_id}."
        self._last_confirmation_requested = f"{confirmation.confirmation_id} pending for {capability.capability_id} ({command_label})."
        self._last_confirmation_result = f"{confirmation.confirmation_id} pending approval."
        self._last_message = f"Confirmation {confirmation.confirmation_id} created for {capability.capability_id}."
        self._update_telegram_loop_status(
            state="running",
            activity_state="processing_command",
            message=self._last_message,
            activity=True,
            last_command=command_label,
            last_ask_status=awaiting_message,
        )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Action requires confirmation.",
                    f"Action: {command_label} (prompt hidden)",
                    f"Capability: {capability.capability_id}",
                    f"Reason: {self._confirmation_reason_message(capability.reason_code)}",
                    f"ID: {confirmation.confirmation_id} (expires in about {expires_in}s)",
                    f"Reply with: /confirm {confirmation.confirmation_id} or /deny {confirmation.confirmation_id}",
                )
            ),
            command_label=command_label,
            ask_status=awaiting_message,
            hide_content_in_summary=True,
            response_style=response_style,
        )

    def _build_confirm_reply(
        self,
        argument: str,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
    ) -> _TelegramResponsePlan:
        confirmation_id = self._normalize_confirmation_id(argument)
        if not confirmation_id:
            return self._confirmation_usage_reply(command_label="/confirm")
        outcome, confirmation = self._confirmation_store.approve(confirmation_id, chat_id=chat_id)
        if outcome == "approved" and confirmation is not None:
            return self._execute_confirmed_capability(confirmation, snapshot, chat_id=chat_id)
        return self._confirmation_state_reply(
            command_label="/confirm",
            confirmation_id=confirmation_id,
            outcome=outcome,
            confirmation=confirmation,
        )

    def _build_deny_reply(self, argument: str, *, chat_id: str) -> _TelegramResponsePlan:
        confirmation_id = self._normalize_confirmation_id(argument)
        if not confirmation_id:
            return self._confirmation_usage_reply(command_label="/deny")
        outcome, confirmation = self._confirmation_store.reject(confirmation_id, chat_id=chat_id)
        return self._confirmation_state_reply(
            command_label="/deny",
            confirmation_id=confirmation_id,
            outcome=outcome,
            confirmation=confirmation,
        )

    def _execute_confirmed_capability(
        self,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
    ) -> _TelegramResponsePlan:
        if confirmation.capability_id != "ask.provider_query":
            message = f"Confirmation {confirmation.confirmation_id} cannot run because the capability is no longer supported."
            self._last_confirmation_result = message
            self._last_message = message
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        f"Confirmation {confirmation.confirmation_id} could not run.",
                        "Reason: The capability is no longer supported for confirmation execution.",
                        "Next: Send the original command again after checking the operator console.",
                    )
                ),
                command_label="/confirm",
            )
        return self._execute_confirmed_provider_query(confirmation, snapshot, chat_id=chat_id)

    def _execute_confirmed_provider_query(
        self,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
    ) -> _TelegramResponsePlan:
        if self._is_provider_chat_busy(chat_id):
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason="Another provider-backed ask is still running for this chat.",
                next_step="Wait for the current reply before confirming another action.",
                command_label="/confirm",
            )

        if confirmation.evaluation_context.selected_mode == "online" and snapshot.selected_mode != "online":
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason="Selected mode changed after this confirmation was created.",
                next_step="Re-select Online Mode, resend the original command, and confirm the new request.",
                command_label="/confirm",
            )

        capability, context = self._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        if capability.current_availability_state != "allowed":
            return self._blocked_confirmation_reply_from_capability(
                confirmation_id=confirmation.confirmation_id,
                capability=capability,
            )

        use_online_provider = confirmation.evaluation_context.selected_mode == "online" or snapshot.mode == "online"
        provider_name = "OpenAI" if use_online_provider else "Ollama"
        provider_key = "openai" if use_online_provider else "ollama"
        provider_status = context.online_provider_status if use_online_provider else context.offline_provider_status
        mode_label = "Online" if use_online_provider else "Offline"

        self._update_telegram_loop_status(
            state="running",
            activity_state="waiting_on_provider",
            message=f"Waiting on confirmation {confirmation.confirmation_id} via {provider_name}.",
            activity=True,
            last_command="/confirm",
            last_ask_status=f"Confirmation {confirmation.confirmation_id} in progress.",
        )
        self._mark_provider_ask_started(chat_id)

        if use_online_provider:
            result = self._run_provider_request(
                provider=provider_key,
                chat_id=chat_id,
                func=lambda: self._provider_adapters["openai"].ask(  # type: ignore[call-arg]
                    secret_store=self._secret_store,
                    secret_id=self._config.openai_secret_id,
                    transient_secret="",
                    prompt=confirmation.prompt_text,
                    response_style=confirmation.response_style,
                ),
            )
        else:
            result = self._run_provider_request(
                provider=provider_key,
                chat_id=chat_id,
                func=lambda: self._provider_adapters["ollama"].ask(  # type: ignore[call-arg]
                    runtime_status=self._runtime_manager.get_status(),
                    base_url=self._config.ollama_base_url,
                    preferred_model=self._config.preferred_ollama_model,
                    prompt=confirmation.prompt_text,
                    response_style=confirmation.response_style,
                ),
            )

        if result.state == "timeout":
            reason = f"{provider_name} did not finish before the timeout."
            self._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} timed out via {provider_name}."
            self._last_message = self._last_confirmation_result
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        f"Confirmation {confirmation.confirmation_id} timed out.",
                        f"Reason: {reason}",
                        "Next: Send the original command again if you still want to run it.",
                    )
                ),
                command_label="/confirm",
                ask_status=self._last_confirmation_result,
                hide_content_in_summary=True,
                response_style=confirmation.response_style,
            )
        if result.state != "ok" or not isinstance(result.reply, ProviderReply):
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason="Provider request failed before a reply was returned.",
                next_step="Check the provider configuration and try the original command again.",
                command_label="/confirm",
            )

        reply = result.reply
        if not reply.ok:
            next_step = "Check the online provider configuration and try the original command again."
            if not use_online_provider:
                next_step = "Check Ollama and try the original command again."
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason=reply.message,
                next_step=next_step,
                command_label="/confirm",
            )

        model = reply.model or provider_status.model or provider_name
        self._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and completed via {provider_name}."
        self._last_message = self._last_confirmation_result
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    f"Confirmation {confirmation.confirmation_id} approved.",
                    self._format_ask_success(
                        reply.text,
                        provider_label=self._provider_label(provider_key, model),  # type: ignore[arg-type]
                        mode_label=mode_label,
                        response_style=confirmation.response_style,
                    ),
                )
            ),
            command_label="/confirm",
            ask_status=f"Confirmation {confirmation.confirmation_id} completed via {provider_name} / {model}.",
            hide_content_in_summary=True,
            response_style=confirmation.response_style,
        )

    def _blocked_confirmation_reply_from_capability(
        self,
        *,
        confirmation_id: str,
        capability: CapabilityEvaluation,
    ) -> _TelegramResponsePlan:
        next_step_map = {
            "runtime_not_running": "Start the runtime in the operator console and resend the original command.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console, then resend the original command.",
            "offline_provider_unavailable": "Validate Ollama in the operator console before retrying the original command.",
            "online_provider_unavailable": "Save or validate the OpenAI configuration in the operator console before retrying the original command.",
            "policy_always_offline": "Switch to Offline Mode or resend the original command after changing policy in the operator console.",
            "online_confirmation_required": "Resend the original command to request a fresh confirmation.",
        }
        return self._confirmation_result_reply(
            confirmation_id=confirmation_id,
            state_label="could not run",
            reason=capability.blocking_reason or capability.message,
            next_step=next_step_map.get(capability.reason_code, "Check the operator console configuration and resend the original command."),
            command_label="/confirm",
        )

    def _confirmation_usage_reply(self, *, command_label: str) -> _TelegramResponsePlan:
        usage = "/confirm <id>" if command_label == "/confirm" else "/deny <id>"
        action = "approve" if command_label == "/confirm" else "reject"
        return _TelegramResponsePlan(
            reply=f"Use {usage} to {action} a pending action.",
            command_label=command_label,
        )

    def _confirmation_state_reply(
        self,
        *,
        command_label: str,
        confirmation_id: str,
        outcome: str,
        confirmation: PendingConfirmation | None,
    ) -> _TelegramResponsePlan:
        if outcome in {"not_found", "wrong_chat"}:
            message = f"No pending confirmation matches {confirmation_id} for this chat."
            self._last_confirmation_result = message
            self._last_message = message
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        message,
                        "Next: Send the original command again if you still want to run it.",
                    )
                ),
                command_label=command_label,
            )
        if outcome == "expired" or (confirmation is not None and confirmation.current_state == "expired"):
            return self._confirmation_result_reply(
                confirmation_id=confirmation_id,
                state_label="expired",
                reason="This confirmation is no longer valid.",
                next_step="Send the original command again to request a new confirmation.",
                command_label=command_label,
            )
        if outcome == "rejected":
            message = f"Confirmation {confirmation_id} denied. Request not executed."
            self._last_confirmation_result = message
            self._last_message = message
            return _TelegramResponsePlan(
                reply=message,
                command_label=command_label,
            )
        if outcome == "already_used" and confirmation is not None:
            if confirmation.current_state == "approved":
                return self._confirmation_result_reply(
                    confirmation_id=confirmation_id,
                    state_label="was already used",
                    reason="This confirmation has already been consumed.",
                    next_step="Send the original command again if you need a new request.",
                    command_label=command_label,
                )
            if confirmation.current_state == "rejected":
                return self._confirmation_result_reply(
                    confirmation_id=confirmation_id,
                    state_label="was already denied",
                    reason="This confirmation has already been rejected.",
                    next_step="Send the original command again if you want a fresh confirmation prompt.",
                    command_label=command_label,
                )
        return self._confirmation_result_reply(
            confirmation_id=confirmation_id,
            state_label="could not be processed",
            reason="The confirmation state is no longer valid.",
            next_step="Send the original command again if you still want to run it.",
            command_label=command_label,
        )

    def _confirmation_result_reply(
        self,
        *,
        confirmation_id: str,
        state_label: str,
        reason: str,
        next_step: str,
        command_label: str,
    ) -> _TelegramResponsePlan:
        summary = f"Confirmation {confirmation_id} {state_label}."
        self._last_confirmation_result = summary
        self._last_message = summary
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    summary,
                    f"Reason: {reason}",
                    f"Next: {next_step}",
                )
            ),
            command_label=command_label,
        )

    def _confirmation_context_snapshot(
        self,
        snapshot: ControllerSnapshot,
        context: CapabilityContext,
    ) -> ConfirmationContextSnapshot:
        selected_online = snapshot.selected_mode == "online"
        provider_status = context.online_provider_status if selected_online else context.offline_provider_status
        return ConfirmationContextSnapshot(
            mode=snapshot.mode,
            selected_mode=snapshot.selected_mode,
            policy=snapshot.policy,
            active_provider=snapshot.active_provider,
            selected_provider=snapshot.selected_provider,
            readiness_state=snapshot.readiness_state,
            provider_state=provider_status.validation_state,
            provider_message=provider_status.message,
        )

    @staticmethod
    def _normalize_confirmation_id(argument: str) -> str:
        token = argument.strip().split()[0] if argument.strip() else ""
        return token.upper()

    @staticmethod
    def _confirmation_reason_message(reason_code: str) -> str:
        return {
            "online_confirmation_required": "Online access requires one-shot approval under Ask Before Online.",
        }.get(reason_code, "Explicit operator confirmation is required before this action can run.")

    @staticmethod
    def _confirmation_seconds_remaining(confirmation: PendingConfirmation) -> int:
        try:
            expires_at = datetime.fromisoformat(confirmation.expires_at)
        except ValueError:
            return 0
        remaining = int((expires_at - datetime.now().astimezone()).total_seconds())
        return max(0, remaining)

    def _cleanup_expired_confirmations(self) -> None:
        expired = self._confirmation_store.cleanup_expired()
        if expired <= 0:
            return
        noun = "confirmation has" if expired == 1 else "confirmations have"
        message = f"{expired} pending {noun} expired."
        self._last_confirmation_result = message
        self._last_message = message


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
        base = "Ollama" if provider == "ollama" else "OpenAI"
        if model:
            return f"{base} / {model}"
        return base

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
                return "confirmation-gated", "Online Mode is selected, but each remote ask still needs one-shot approval with /confirm <id>."
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

    @staticmethod
    def _capability_state_label(state: str) -> str:
        return {
            "allowed": "Allowed",
            "blocked": "Blocked",
            "degraded": "Degraded",
            "confirmation_required": "Confirmation Required",
            "unavailable": "Unavailable",
            "unknown": "Unknown",
        }.get(state, state)

    @staticmethod
    def _access_kind_label(access_kind: str) -> str:
        return {
            "read_only": "read-only",
            "mutating": "mutating",
            "external_side_effect": "external-side-effect",
        }.get(access_kind, access_kind)

    @staticmethod
    def _locality_label(locality: str) -> str:
        return {
            "local_only": "local",
            "networked": "networked",
            "hybrid": "hybrid",
        }.get(locality, locality)

    @staticmethod
    def _offline_safety_label(offline_safety: str) -> str:
        return {
            "safe_offline": "offline-safe",
            "requires_online": "online-required",
            "optional_online": "online-sensitive",
        }.get(offline_safety, offline_safety)

    def _capability_manifest(self, capability_id: str) -> CapabilityManifest:
        return get_capability_manifest(capability_id)

    def _format_manifest_trust_summary(self, manifest: CapabilityManifest) -> str:
        parts = [
            self._access_kind_label(manifest.access_kind),
            self._locality_label(manifest.locality),
            self._offline_safety_label(manifest.offline_safety),
        ]
        if manifest.confirmation_sensitivity == "always":
            parts.append("always-confirm")
        elif manifest.confirmation_sensitivity == "policy_based":
            parts.append("policy-confirm")
        if manifest.telegram_exposure != "allowed":
            parts.append(f"telegram-{manifest.telegram_exposure}")
        return " | ".join(parts)

    def _format_evaluation_trust_summary(self, evaluation: CapabilityEvaluation) -> str:
        return self._summarize_text(
            self._format_manifest_trust_summary(self._capability_manifest(evaluation.capability_id)),
            limit=120,
        )

    def _build_execution_scope(
        self,
        capability_id: str,
        *,
        snapshot: ControllerSnapshot,
    ) -> ExecutionScope:
        manifest = self._capability_manifest(capability_id)
        if manifest.scope_type == "network" and capability_id == "ask.provider_query":
            if snapshot.selected_mode == "online" and snapshot.mode != "online":
                target_domain = "api.openai.com"
            elif snapshot.mode == "online":
                target_domain = "api.openai.com"
            else:
                target_domain = self._host_from_url(self._config.ollama_base_url) or "127.0.0.1"
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                target_domain=target_domain,
                domain_allowlist=(target_domain,),
            )
        if manifest.scope_type == "repository":
            repo_root = self._config.repo_root.strip() if manifest.scope_uses_configured_root else manifest.scope_repo_root
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                repo_root=repo_root,
                target_path=repo_root,
            )
        if manifest.scope_type == "filesystem":
            allowed_paths = self._config.file_allowed_roots if manifest.scope_uses_configured_paths else manifest.scope_allowed_paths
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                allowed_paths=tuple(allowed_paths),
            )
        if manifest.scope_type == "network" and manifest.scope_uses_configured_domains:
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                domain_allowlist=tuple(self._config.web_allowed_domains),
            )
        return ExecutionScope(
            scope_type=manifest.scope_type,
            access_mode=manifest.access_mode,
            repo_root=manifest.scope_repo_root,
            allowed_paths=manifest.scope_allowed_paths,
            domain_allowlist=manifest.scope_domain_allowlist,
        )

    def validate_request_scope(self, request) -> ScopeValidationResult:
        manifest = self._capability_manifest(request.capability_id)
        return self._scope_validator.validate(request, manifest)

    def _format_scope_summary(self, scope: ExecutionScope) -> str:
        parts = [f"{scope.scope_type}/{scope.access_mode}"]
        if scope.scope_type == "network" and scope.target_domain:
            parts.append(f"target={scope.target_domain}")
        elif scope.scope_type == "repository":
            parts.append(f"repo={self._repo_display_name(scope.repo_root)}")
        elif scope.scope_type == "filesystem" and scope.target_path:
            parts.append("target=path")
        return " ".join(parts)

    def _build_audit_record(self, result: CapabilityExecutionResult) -> AuditRecord:
        if result.capability_id == "repo.status.read":
            action_summary = str(result.telemetry.get("repo_summary") or f"repo status for {self._repo_display_name()}")
        elif result.capability_id == "file.read":
            action_summary = str(result.telemetry.get("file_summary") or "file preview")
        elif result.capability_id == "web.fetch.read":
            action_summary = str(result.telemetry.get("web_summary") or "web fetch preview")
        elif result.capability_id == "context.read":
            action_summary = str(result.telemetry.get("context_summary") or "context listing")
        elif result.capability_id == "context.clear":
            action_summary = str(result.telemetry.get("context_clear_summary") or "context buffer cleared")
        else:
            action_summary = str(result.request.metadata.get("argument_summary") or result.command_label)
        created_context_id = str(result.telemetry.get("context_created_id") or "").strip()
        used_context_id = str(result.telemetry.get("context_used_id") or "").strip()
        if created_context_id and result.capability_id in {"repo.status.read", "file.read", "web.fetch.read"}:
            action_summary = f"{action_summary} | created {created_context_id}"
        elif used_context_id and result.capability_id == "ask.provider_query":
            action_summary = f"{action_summary} | used {used_context_id}"
        return AuditRecord(
            audit_id=self._generate_audit_id(),
            request_id=result.request_id,
            capability_id=result.capability_id,
            timestamp_start=result.started_at,
            timestamp_end=result.finished_at,
            outcome=result.outcome,
            outcome_reason=result.outcome_reason_code,
            user_id=result.request.user_id,
            chat_id=result.request.chat_id,
            confirmation_used=result.confirmation_used,
            scope_summary=result.scope_summary,
            provider_used=result.provider_used,
            duration_ms=result.duration_ms,
            action_summary=self._summarize_text(action_summary, limit=80),
        )

    def _format_audit_record_summary(self, record: AuditRecord | None) -> str:
        if record is None:
            return "No audit record yet."
        return self._summarize_text(
            f"- {self._short_time(record.timestamp_end)} {record.capability_id} | {record.outcome} | {record.outcome_reason}",
            limit=120,
        )

    @staticmethod
    def _generate_audit_id() -> str:
        return f"AUD-{secrets.token_hex(4).upper()}"

    @staticmethod
    def _host_from_url(value: str) -> str:
        if not value.strip():
            return ""
        parsed = urlparse(value)
        return (parsed.hostname or "").lower()

    @staticmethod
    def _sanitize_url_for_display(value: str) -> str:
        parsed = urlparse(value)
        return parsed._replace(query="", fragment="", params="").geturl()

    @staticmethod
    def _short_time(value: str) -> str:
        if not value or value == "-":
            return "--:--:--"
        try:
            return datetime.fromisoformat(value).astimezone().strftime("%H:%M:%S")
        except ValueError:
            return value

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








