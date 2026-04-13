"""Controller-facing health and security diagnostics."""
from __future__ import annotations

from datetime import datetime
import json
import urllib.error
import urllib.request

from .diagnostic_models import DiagnosticItem, DiagnosticReport, DiagnosticSeverity, OverallStatus
from .profile_store import ControllerConfig, ControllerConfigStore
from ..platform.secrets import SecretStore
from ..providers import ProviderStatus
from ..runtime import OpenClawRuntimeManager
from ..runtime.log_sanitizer import LOG_REDACTION_ENABLED, contains_potential_secret


class ControllerDiagnosticsService:
    def __init__(
        self,
        *,
        runtime_manager: OpenClawRuntimeManager,
        config_store: ControllerConfigStore,
        secret_store: SecretStore,
    ) -> None:
        self._runtime_manager = runtime_manager
        self._config_store = config_store
        self._secret_store = secret_store

    def run_health_check(
        self,
        config: ControllerConfig,
        selected_provider_status: ProviderStatus,
        *,
        telegram_recent_success: bool = False,
        telegram_last_success_at: str = "",
    ) -> DiagnosticReport:
        runtime_status = self._runtime_manager.get_status()
        inspection = self._runtime_manager.inspect_runtime()
        items: list[DiagnosticItem] = []

        items.append(
            self._item(
                "health",
                "openclaw.installation",
                runtime_status.openclaw.installed,
                "OpenClaw CLI is installed." if runtime_status.openclaw.installed else "OpenClaw CLI is not installed.",
                "Install or repair the OpenClaw CLI before using the controller.",
            )
        )
        items.append(
            self._item(
                "health",
                "openclaw.running",
                runtime_status.runtime_state == "running",
                "OpenClaw runtime is running." if runtime_status.runtime_state == "running" else "OpenClaw runtime is not running.",
                "Start the runtime from the controller if you need the local gateway available.",
            )
        )
        items.append(
            self._item(
                "health",
                "openclaw.cli_reachable",
                inspection.cli_reachable,
                "OpenClaw CLI entrypoint is reachable." if inspection.cli_reachable else "OpenClaw CLI entrypoint is not reachable.",
                "Verify the OpenClaw installation path and reinstall if the wrapper or entrypoint is missing.",
            )
        )
        items.append(
            self._item(
                "health",
                "ollama.installation",
                runtime_status.ollama.installed,
                "Ollama is installed." if runtime_status.ollama.installed else "Ollama is not installed.",
                "Install Ollama if you want Offline Mode to be usable.",
            )
        )

        ollama_reachable = self._ollama_service_reachable(config.ollama_base_url)
        ollama_message = "Ollama service is reachable." if ollama_reachable else f"Ollama service is not reachable at {config.ollama_base_url}."
        items.append(
            self._item(
                "health",
                "ollama.service",
                ollama_reachable,
                ollama_message,
                "Start the Ollama service and pull a local model before using Offline Mode.",
            )
        )

        items.append(self._provider_item("health", "provider.validation", selected_provider_status))

        mode_usable = self._mode_usable(config, selected_provider_status)
        items.append(
            self._item(
                "health",
                "mode.usable",
                mode_usable,
                self._mode_message(config, selected_provider_status),
                "Choose a compatible mode/provider pair and validate the provider before activating it.",
            )
        )

        config_ok = not self._config_store.last_load_error
        items.append(
            self._item(
                "health",
                "config.load",
                config_ok,
                "Controller config loaded successfully." if config_ok else f"Controller config recovered after a load error: {self._config_store.last_load_error}",
                "Review the local controller config file if settings reset unexpectedly.",
            )
        )

        secret_ok = self._selected_secret_available(config)
        items.append(
            self._item(
                "health",
                "secret.selected_provider",
                secret_ok,
                self._secret_message(config, secret_ok),
                "Save a valid OpenAI API key before activating Online Mode.",
            )
        )

        items.extend(
            self._runtime_health_items(
                config,
                inspection,
                runtime_status.runtime_state,
                telegram_recent_success=telegram_recent_success,
                telegram_last_success_at=telegram_last_success_at,
            )
        )
        return self._build_report("health", items)

    def run_security_check(self, config: ControllerConfig, selected_provider_status: ProviderStatus) -> DiagnosticReport:
        runtime_status = self._runtime_manager.get_status()
        inspection = self._runtime_manager.inspect_runtime()
        items: list[DiagnosticItem] = []

        bind_is_local = config.gateway_bind == "loopback" and inspection.configured_host == "127.0.0.1"
        items.append(
            self._item(
                "security",
                "gateway.bind.local_only",
                bind_is_local,
                "Gateway bind is loopback-only." if bind_is_local else f"Gateway bind is '{config.gateway_bind}' instead of loopback.",
                "Keep the gateway bind mode on loopback for local-only operation.",
            )
        )

        listeners_local_only = all(address in {"127.0.0.1", "::1"} for address in inspection.listener_addresses) if inspection.listener_addresses else bind_is_local
        items.append(
            self._item(
                "security",
                "gateway.listeners.local_only",
                listeners_local_only,
                "Observed gateway listeners are loopback-only." if listeners_local_only else f"Observed non-local listener addresses: {', '.join(inspection.listener_addresses)}",
                "Stop the runtime and restore loopback-only binding before daily use.",
            )
        )

        secret_ok = self._selected_secret_available(config)
        items.append(
            self._item(
                "security",
                "secret.required",
                secret_ok,
                self._secret_message(config, secret_ok),
                "Store the required API key through the controller instead of relying on transient input.",
            )
        )

        log_safe = LOG_REDACTION_ENABLED and not any(contains_potential_secret(line) for line in self._runtime_manager.get_recent_logs())
        items.append(
            self._item(
                "security",
                "logging.redaction",
                log_safe,
                "Runtime log redaction is active." if log_safe else "Potential secret-like material was found in recent logs.",
                "Clear logs, avoid pasting secrets into validation fields, and keep redaction enabled.",
            )
        )

        degraded_state = self._is_degraded_state(config, selected_provider_status, runtime_status.runtime_state)
        items.append(
            self._item(
                "security",
                "state.degraded",
                not degraded_state,
                "No degraded fallback state detected." if not degraded_state else "Controller is operating in a degraded or inconsistent state.",
                "Run the health check and resolve the reported blocking findings before continuing.",
            )
        )

        permissive_online = config.current_mode == "online" and config.policy == "always_online"
        items.append(
            self._item(
                "security",
                "policy.online_permissive",
                not permissive_online,
                "Online Mode is not locked under Always Online policy." if not permissive_online else "Online Mode is active while policy is Always Online.",
                "Prefer Ask Before Online for daily use unless constant remote access is intentional.",
                severity_override="warning" if permissive_online else "info",
            )
        )

        items.extend(self._state_integrity_items(config, selected_provider_status, runtime_status.runtime_state))
        return self._build_report("security", items)

    def _runtime_health_items(
        self,
        config: ControllerConfig,
        inspection,
        runtime_state: str,
        *,
        telegram_recent_success: bool = False,
        telegram_last_success_at: str = "",
    ) -> list[DiagnosticItem]:
        items: list[DiagnosticItem] = []
        if inspection.invalid_executable_path:
            items.append(
                DiagnosticItem(
                    check_type="health",
                    status="fail",
                    severity="error",
                    code="runtime.invalid_executable_path",
                    message="Configured OpenClaw executable path is invalid.",
                    recommended_action="Reinstall OpenClaw or repair the CLI wrapper and entrypoint paths.",
                )
            )
        else:
            items.append(
                DiagnosticItem(
                    check_type="health",
                    status="pass",
                    severity="info",
                    code="runtime.invalid_executable_path",
                    message="Configured OpenClaw executable path is valid.",
                    recommended_action="No action needed.",
                )
            )

        items.append(
            self._runtime_liveness_item(
                inspection,
                runtime_state=runtime_state,
                telegram_recent_success=telegram_recent_success,
                telegram_last_success_at=telegram_last_success_at,
            )
        )

        absent_while_running = runtime_state == "running" and not inspection.process_exists
        items.append(
            self._item(
                "health",
                "runtime.process_missing",
                not absent_while_running,
                "Managed runtime process state is consistent." if not absent_while_running else "UI believes the runtime is running, but no managed process exists.",
                "Use Check Status or restart the runtime to clear stale state.",
            )
        )

        stderr_clean = not inspection.stderr_recent
        stderr_message = "No recent stderr activity detected." if stderr_clean else f"Recent stderr activity detected ({inspection.recent_stderr_count} line(s))."
        items.append(
            self._item(
                "health",
                "runtime.stderr_recent",
                stderr_clean,
                stderr_message,
                "Review runtime logs before continuing if stderr is active.",
                severity_override="warning" if not stderr_clean else "info",
            )
        )

        items.append(
            self._item(
                "health",
                "runtime.startup_failure",
                not inspection.startup_failure,
                "No startup failure recorded." if not inspection.startup_failure else "Runtime is in a startup failure state.",
                "Check the runtime logs and verify the configured port/bind settings.",
            )
        )

        items.append(
            self._runtime_port_item(inspection)
        )
        return items

    def _runtime_liveness_item(
        self,
        inspection,
        *,
        runtime_state: str,
        telegram_recent_success: bool = False,
        telegram_last_success_at: str = "",
    ) -> DiagnosticItem:
        if runtime_state != "running":
            return DiagnosticItem(
                check_type="health",
                status="pass",
                severity="info",
                code="runtime.unresponsive",
                message="Runtime is not running, so no active liveness probe is required.",
                recommended_action="No action needed.",
            )

        if not inspection.process_exists:
            return DiagnosticItem(
                check_type="health",
                status="fail",
                severity="error",
                code="runtime.unresponsive",
                message="Runtime is marked running, but no active process was found.",
                recommended_action="Use Check Status or restart the runtime to recover from stale process state.",
            )

        liveness_state = getattr(inspection, "liveness_state", "indeterminate")
        liveness_message = getattr(inspection, "liveness_message", "") or "Runtime liveness could not be determined."

        if telegram_recent_success:
            telegram_message = "Recent Telegram interaction succeeded, confirming live controller-to-runtime activity."
            if telegram_last_success_at:
                telegram_message = f"{telegram_message} Last success: {telegram_last_success_at}."
            if liveness_state == "unresponsive":
                return DiagnosticItem(
                    check_type="health",
                    status="pass",
                    severity="info",
                    code="runtime.unresponsive",
                    message=f"Gateway probe was limited, but runtime appears active via alternate signals. {telegram_message}",
                    recommended_action="No action needed.",
                )
            if liveness_state in {"indeterminate", "responsive_with_limited_probe"}:
                return DiagnosticItem(
                    check_type="health",
                    status="pass",
                    severity="info",
                    code="runtime.unresponsive",
                    message=f"Runtime is active via recent Telegram success. {liveness_message}",
                    recommended_action="No action needed.",
                )

        if liveness_state == "responsive":
            return DiagnosticItem(
                check_type="health",
                status="pass",
                severity="info",
                code="runtime.unresponsive",
                message=liveness_message,
                recommended_action="No action needed.",
            )
        if liveness_state == "responsive_with_limited_probe":
            return DiagnosticItem(
                check_type="health",
                status="warn",
                severity="warning",
                code="runtime.unresponsive",
                message=liveness_message,
                recommended_action="If this warning persists, rerun the health check after the runtime has been active for a few more seconds.",
            )
        if liveness_state == "indeterminate":
            return DiagnosticItem(
                check_type="health",
                status="warn",
                severity="warning",
                code="runtime.unresponsive",
                message=liveness_message,
                recommended_action="Wait for startup or listener discovery to settle, then rerun the health check.",
            )
        return DiagnosticItem(
            check_type="health",
            status="fail",
            severity="error",
            code="runtime.unresponsive",
            message=liveness_message,
            recommended_action="Restart OpenClaw and inspect recent stderr output if the runtime stays unresponsive.",
        )

    def _state_integrity_items(self, config: ControllerConfig, selected_provider_status: ProviderStatus, runtime_state: str) -> list[DiagnosticItem]:
        items: list[DiagnosticItem] = []
        compatible = self._validate_mode_provider_pair(config.current_mode, self._active_provider_for_mode(config.current_mode), config.policy) == ""
        items.append(
            self._item(
                "security",
                "integrity.mode_provider",
                compatible,
                "Current mode/provider combination is compatible." if compatible else "Current mode/provider combination is incompatible.",
                "Restore the provider that matches the active mode.",
            )
        )

        provider_valid = not (self._active_provider_for_mode(config.current_mode) == selected_provider_status.provider and not selected_provider_status.ready)
        items.append(
            self._item(
                "security",
                "integrity.provider_active_invalid",
                provider_valid,
                "Active provider validation state is usable." if provider_valid else "Active provider is selected but validation is invalid or incomplete.",
                "Validate the provider and resolve its blocking issues before using the active mode.",
            )
        )

        runtime_ready_consistent = not (runtime_state == "stopped" and config.current_mode in {"offline", "online"} and selected_provider_status.ready)
        items.append(
            self._item(
                "security",
                "integrity.runtime_ready",
                runtime_ready_consistent,
                "Runtime readiness is internally consistent." if runtime_ready_consistent else "Provider looks ready, but the runtime is stopped.",
                "Start OpenClaw if you expect the controller to be operational right now.",
                severity_override="warning" if not runtime_ready_consistent else "info",
            )
        )

        offline_usable = not (config.current_mode == "offline" and not self._mode_usable(config, selected_provider_status))
        items.append(
            self._item(
                "security",
                "integrity.offline_usable",
                offline_usable,
                "Offline Mode is usable." if offline_usable else "Offline Mode is active without a usable Ollama installation or service.",
                "Install/start Ollama and validate the selected local model.",
            )
        )

        online_secret_ok = not (config.current_mode == "online" and not self._selected_secret_available(config))
        items.append(
            self._item(
                "security",
                "integrity.online_secret",
                online_secret_ok,
                "Online Mode has a stored secret." if online_secret_ok else "Online Mode is active without a stored OpenAI secret.",
                "Store the OpenAI API key before using Online Mode.",
            )
        )

        policy_consistent = not (config.policy == "always_offline" and config.current_mode == "online")
        items.append(
            self._item(
                "security",
                "integrity.policy_mode",
                policy_consistent,
                "Policy and current mode are consistent." if policy_consistent else "Always Offline policy conflicts with the current Online Mode state.",
                "Switch back to Offline Mode or change the policy before continuing.",
            )
        )
        return items

    def _selected_secret_available(self, config: ControllerConfig) -> bool:
        needs_openai_secret = (
            config.current_mode == "online"
            or config.selected_mode == "online"
            or config.selected_provider == "openai"
        )
        if not needs_openai_secret:
            return True
        return self._secret_store.available and self._secret_store.has_secret(config.openai_secret_id)

    @staticmethod
    def _ollama_service_reachable(base_url: str) -> bool:
        try:
            request = urllib.request.Request(f"{base_url.rstrip('/')}/api/tags", method="GET")
            with urllib.request.urlopen(request, timeout=2.0) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, TimeoutError, ValueError):
            return False
        return isinstance(payload, dict)

    def _secret_message(self, config: ControllerConfig, secret_ok: bool) -> str:
        needs_openai_secret = (
            config.current_mode == "online"
            or config.selected_mode == "online"
            or config.selected_provider == "openai"
        )
        if not needs_openai_secret:
            return "No secret is required for the current offline selection."
        if secret_ok:
            return "Required OpenAI secret is available."
        if not self._secret_store.available:
            return "Secret storage is unavailable on this platform."
        return "Required OpenAI secret is missing."

    def _mode_usable(self, config: ControllerConfig, selected_provider_status: ProviderStatus) -> bool:
        return self._validate_mode_provider_pair(config.selected_mode, config.selected_provider, config.policy) == "" and selected_provider_status.ready

    def _mode_message(self, config: ControllerConfig, selected_provider_status: ProviderStatus) -> str:
        compatibility = self._validate_mode_provider_pair(config.selected_mode, config.selected_provider, config.policy)
        if compatibility:
            return compatibility
        if selected_provider_status.ready:
            return f"{config.selected_mode.title()} Mode is currently usable."
        return selected_provider_status.message

    def _is_degraded_state(self, config: ControllerConfig, selected_provider_status: ProviderStatus, runtime_state: str) -> bool:
        return (
            config.current_mode != config.selected_mode
            or not selected_provider_status.ready
            or runtime_state == "error"
        )

    def _provider_item(self, check_type: str, code: str, provider_status: ProviderStatus) -> DiagnosticItem:
        if provider_status.validation_state == "valid" and provider_status.ready:
            return DiagnosticItem(
                check_type=check_type,  # type: ignore[arg-type]
                status="pass",
                severity="info",
                code=code,
                message=f"{provider_status.display_name} validation passed.",
                recommended_action="No action needed.",
            )
        if provider_status.validation_state == "partial":
            return DiagnosticItem(
                check_type=check_type,  # type: ignore[arg-type]
                status="warn",
                severity="warning",
                code=code,
                message=provider_status.message,
                recommended_action="Finish the provider setup before relying on this mode.",
            )
        return DiagnosticItem(
            check_type=check_type,  # type: ignore[arg-type]
            status="fail",
            severity="error",
            code=code,
            message=provider_status.message,
            recommended_action="Resolve the provider validation failure before continuing.",
        )

    def _item(
        self,
        check_type: str,
        code: str,
        ok: bool,
        success_message: str,
        recommended_action: str,
        *,
        severity_override: DiagnosticSeverity | None = None,
    ) -> DiagnosticItem:
        if ok:
            return DiagnosticItem(
                check_type=check_type,  # type: ignore[arg-type]
                status="pass",
                severity=severity_override or "info",
                code=code,
                message=success_message,
                recommended_action="No action needed." if severity_override is None else recommended_action,
            )
        severity = severity_override or "error"
        return DiagnosticItem(
            check_type=check_type,  # type: ignore[arg-type]
            status="warn" if severity == "warning" else "fail",
            severity=severity,
            code=code,
            message=success_message,
            recommended_action=recommended_action,
        )

    def _runtime_port_item(self, inspection) -> DiagnosticItem:
        if inspection.port_check_state == "owned_by_active_runtime":
            return DiagnosticItem(
                check_type="health",
                status="pass",
                severity="info",
                code="runtime.port_in_use_by_active_runtime",
                message=inspection.port_check_message or "Configured port is owned by the active OpenClaw runtime.",
                recommended_action="No action needed.",
            )
        if inspection.port_check_state == "indeterminate":
            return DiagnosticItem(
                check_type="health",
                status="warn",
                severity="warning",
                code="runtime.port_ownership_indeterminate",
                message=inspection.port_check_message or "Configured port ownership could not be verified yet.",
                recommended_action="Wait for startup to settle, then rerun the health check if the warning persists.",
            )
        if inspection.port_check_state == "conflict_unrelated_process":
            return DiagnosticItem(
                check_type="health",
                status="fail",
                severity="error",
                code="runtime.port_conflict",
                message=inspection.port_check_message or inspection.port_conflict_detail or "Configured port is owned by an unrelated process.",
                recommended_action="Stop the conflicting process or change the configured gateway port before starting OpenClaw.",
            )
        return DiagnosticItem(
            check_type="health",
            status="pass",
            severity="info",
            code="runtime.port_available",
            message=inspection.port_check_message or "No port conflict detected.",
            recommended_action="No action needed.",
        )

    def _build_report(self, check_type: str, items: list[DiagnosticItem]) -> DiagnosticReport:
        overall_status, overall_severity = self._aggregate(items)
        summary = self._summary_text(check_type, overall_status, items)
        return DiagnosticReport(
            check_type=check_type,  # type: ignore[arg-type]
            overall_status=overall_status,
            overall_severity=overall_severity,
            ran_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            summary=summary,
            items=tuple(items),
        )

    @staticmethod
    def _aggregate(items: list[DiagnosticItem]) -> tuple[OverallStatus, DiagnosticSeverity]:
        if any(item.severity == "error" for item in items):
            return "blocked", "error"
        if any(item.severity == "warning" for item in items):
            return "degraded", "warning"
        return "ok", "info"

    @staticmethod
    def _summary_text(check_type: str, overall_status: OverallStatus, items: list[DiagnosticItem]) -> str:
        failures = sum(1 for item in items if item.severity == "error")
        warnings = sum(1 for item in items if item.severity == "warning")
        if check_type == "health":
            label = {"ok": "Healthy", "degraded": "Degraded", "blocked": "Blocked", "unknown": "Unknown"}[overall_status]
        else:
            label = {"ok": "Safe", "degraded": "Warning", "blocked": "Unsafe", "unknown": "Unknown"}[overall_status]
        return f"{label}: {failures} error(s), {warnings} warning(s)."

    @staticmethod
    def _active_provider_for_mode(mode: str) -> str:
        return "openai" if mode == "online" else "ollama"

    @staticmethod
    def _validate_mode_provider_pair(mode: str, provider: str, policy: str) -> str:
        if mode == "offline" and provider != "ollama":
            return "Offline Mode requires the Ollama provider."
        if mode == "online" and provider != "openai":
            return "Online Mode requires the OpenAI provider."
        if policy == "always_offline" and mode == "online":
            return "Always Offline policy blocks Online Mode."
        if policy == "always_online" and mode == "offline":
            return "Always Online policy blocks Offline Mode."
        return ""
