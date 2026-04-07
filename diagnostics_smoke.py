from __future__ import annotations

import tempfile
import time
from pathlib import Path

from app.controller.diagnostics import ControllerDiagnosticsService
from app.controller.profile_store import ControllerConfig, ControllerConfigStore
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderStatus
from app.runtime.manager import OpenClawRuntimeManager
from app.runtime.models import OllamaInstallation, OpenClawInstallation, RuntimeInspection, RuntimeStatus


class FakeRuntimeManager:
    def __init__(
        self,
        *,
        runtime_status: RuntimeStatus | None = None,
        inspection: RuntimeInspection | None = None,
        recent_logs: tuple[str, ...] = (),
    ) -> None:
        self._runtime_status = runtime_status or RuntimeStatus(
            runtime_state="running",
            openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
            ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
            pid=1234,
        )
        self._inspection = inspection or RuntimeInspection(
            configured_bind="loopback",
            configured_host="127.0.0.1",
            configured_port=18789,
            cli_reachable=True,
            process_exists=True,
            process_responsive=True,
        )
        self._recent_logs = recent_logs

    def get_status(self) -> RuntimeStatus:
        return self._runtime_status

    def inspect_runtime(self) -> RuntimeInspection:
        return self._inspection

    def get_recent_logs(self, *, limit: int = 200) -> tuple[str, ...]:
        return self._recent_logs[-limit:]


def assert_true(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)


def make_port_usage_harness(*, related_pids: set[int] | None = None, startup_grace: bool = False, connect_result: bool = False):
    manager = object.__new__(OpenClawRuntimeManager)
    manager._gateway_port = 18789
    manager._last_start_attempt_at = time.time() if startup_grace else 0.0
    manager._related_runtime_pids = lambda managed_pid: set(related_pids or ({managed_pid} if managed_pid is not None else set()))  # type: ignore[attr-defined]
    manager._can_connect = lambda host, port: connect_result  # type: ignore[attr-defined]
    return manager


def run() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        config_store = ControllerConfigStore(config_path=Path(tmp) / "controller_config.json")
        secrets = InMemorySecretStore()

        local_bind_service = ControllerDiagnosticsService(
            runtime_manager=FakeRuntimeManager(
                inspection=RuntimeInspection(
                    configured_bind="lan",
                    configured_host="0.0.0.0",
                    configured_port=18789,
                    cli_reachable=True,
                    process_exists=True,
                    process_responsive=True,
                    listener_addresses=("0.0.0.0",),
                )
            ),
            config_store=config_store,
            secret_store=secrets,
        )
        ready_ollama = ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama is ready.",
            is_local=True,
        )
        security_report = local_bind_service.run_security_check(
            ControllerConfig(gateway_bind="lan"),
            ready_ollama,
        )
        assert_true(any(item.code == "gateway.bind.local_only" and item.severity == "error" for item in security_report.items), "local bind detection failed")

        missing_secret_service = ControllerDiagnosticsService(
            runtime_manager=FakeRuntimeManager(),
            config_store=config_store,
            secret_store=secrets,
        )
        missing_secret_report = missing_secret_service.run_security_check(
            ControllerConfig(current_mode="online", selected_mode="online", selected_provider="openai"),
            ProviderStatus(
                provider="openai",
                display_name="OpenAI",
                configured=False,
                available=False,
                validation_state="invalid",
                ready=False,
                message="Missing OpenAI secret.",
                is_local=False,
            ),
        )
        assert_true(any(item.code == "secret.required" and item.severity == "error" for item in missing_secret_report.items), "missing secret check failed")

        degraded_runtime_service = ControllerDiagnosticsService(
            runtime_manager=FakeRuntimeManager(
                runtime_status=RuntimeStatus(
                    runtime_state="running",
                    openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
                    ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
                    pid=1234,
                ),
                inspection=RuntimeInspection(
                    configured_bind="loopback",
                    configured_host="127.0.0.1",
                    configured_port=18789,
                    cli_reachable=True,
                    process_exists=False,
                    process_responsive=False,
                    startup_failure=True,
                ),
            ),
            config_store=config_store,
            secret_store=secrets,
        )
        degraded_report = degraded_runtime_service.run_health_check(ControllerConfig(), ready_ollama)
        assert_true(any(item.code == "runtime.process_missing" and item.severity == "error" for item in degraded_report.items), "degraded runtime detection failed")

        invalid_combo_service = ControllerDiagnosticsService(
            runtime_manager=FakeRuntimeManager(),
            config_store=config_store,
            secret_store=secrets,
        )
        invalid_combo_report = invalid_combo_service.run_health_check(
            ControllerConfig(selected_mode="online", selected_provider="ollama"),
            ready_ollama,
        )
        assert_true(any(item.code == "mode.usable" and item.severity == "error" for item in invalid_combo_report.items), "mode/provider integrity check failed")

        secrets.put_secret("openai/default", "sk-abcdefghijklmnopqrstuvwxyz123456")
        warning_only_service = ControllerDiagnosticsService(
            runtime_manager=FakeRuntimeManager(
                inspection=RuntimeInspection(
                    configured_bind="loopback",
                    configured_host="127.0.0.1",
                    configured_port=18789,
                    cli_reachable=True,
                    process_exists=True,
                    process_responsive=True,
                    listener_addresses=("127.0.0.1",),
                )
            ),
            config_store=config_store,
            secret_store=secrets,
        )
        warning_only_report = warning_only_service.run_security_check(
            ControllerConfig(current_mode="online", selected_mode="online", selected_provider="openai", policy="always_online"),
            ProviderStatus(
                provider="openai",
                display_name="OpenAI",
                configured=True,
                available=True,
                validation_state="valid",
                ready=True,
                message="OpenAI ready.",
                is_local=False,
            ),
        )
        assert_true(warning_only_report.overall_status == "degraded", "severity mapping failed")
        assert_true(warning_only_report.overall_severity == "warning", "warning severity mapping failed")

        openclaw = OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs", wrapper_path="C:\\openclaw.cmd")

        unrelated_manager = make_port_usage_harness()
        unrelated_state, _, _ = unrelated_manager._detect_port_usage(  # type: ignore[attr-defined]
            managed_pid=None,
            runtime_state="stopped",
            openclaw=openclaw,
            listeners=[("127.0.0.1", 9001, "python unrelated.py")],
        )
        assert_true(unrelated_state == "conflict_unrelated_process", "unrelated listener was not classified as a conflict")

        owned_manager = make_port_usage_harness()
        owned_state, _, _ = owned_manager._detect_port_usage(  # type: ignore[attr-defined]
            managed_pid=4321,
            runtime_state="running",
            openclaw=openclaw,
            listeners=[("127.0.0.1", 4321, "node C:\\openclaw.mjs gateway")],
        )
        assert_true(owned_state == "owned_by_active_runtime", "active runtime PID was not recognized as valid ownership")

        child_owned_manager = make_port_usage_harness(related_pids={4321, 5678})
        child_owned_state, _, _ = child_owned_manager._detect_port_usage(  # type: ignore[attr-defined]
            managed_pid=4321,
            runtime_state="running",
            openclaw=openclaw,
            listeners=[("127.0.0.1", 5678, "node child-gateway")],
        )
        assert_true(child_owned_state == "owned_by_active_runtime", "descendant runtime PID was not recognized as valid ownership")

        handoff_manager = make_port_usage_harness(related_pids={4321}, startup_grace=True)
        handoff_state, _, _ = handoff_manager._detect_port_usage(  # type: ignore[attr-defined]
            managed_pid=4321,
            runtime_state="starting",
            openclaw=openclaw,
            listeners=[("127.0.0.1", None, "")],
        )
        assert_true(handoff_state == "indeterminate", "startup handoff should not be classified as a blocking conflict")

        indeterminate_service = ControllerDiagnosticsService(
            runtime_manager=FakeRuntimeManager(
                runtime_status=RuntimeStatus(
                    runtime_state="running",
                    openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
                    ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
                    pid=4321,
                ),
                inspection=RuntimeInspection(
                    configured_bind="loopback",
                    configured_host="127.0.0.1",
                    configured_port=18789,
                    cli_reachable=True,
                    process_exists=True,
                    process_responsive=True,
                    port_check_state="indeterminate",
                    port_check_message="Configured port 18789 is active while OpenClaw ownership is still being verified.",
                    port_owner_pids=(4321,),
                    listener_addresses=("127.0.0.1",),
                ),
            ),
            config_store=config_store,
            secret_store=secrets,
        )
        indeterminate_report = indeterminate_service.run_health_check(ControllerConfig(), ready_ollama)
        assert_true(indeterminate_report.overall_status == "degraded", "indeterminate port ownership should not block health readiness")
        assert_true(any(item.code == "runtime.port_ownership_indeterminate" and item.severity == "warning" for item in indeterminate_report.items), "indeterminate ownership warning was not reported")

    print("diagnostics smoke passed")


if __name__ == "__main__":
    run()
