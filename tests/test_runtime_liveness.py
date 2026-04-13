from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.diagnostics import ControllerDiagnosticsService
from app.controller.profile_store import ControllerConfig, ControllerConfigStore
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderStatus
from app.runtime.manager import OpenClawRuntimeManager
from app.runtime.models import OllamaInstallation, OpenClawInstallation, RuntimeInspection, RuntimeStatus


class _FakeRuntimeManager:
    def __init__(
        self,
        *,
        runtime_state: str = "running",
        inspection: RuntimeInspection | None = None,
    ) -> None:
        self._runtime_status = RuntimeStatus(
            runtime_state=runtime_state,  # type: ignore[arg-type]
            status_message="OpenClaw gateway running on port 18789." if runtime_state == "running" else "Runtime stopped.",
            openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
            ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
            pid=4321 if runtime_state == "running" else None,
        )
        self._inspection = inspection or RuntimeInspection(
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

    def get_status(self) -> RuntimeStatus:
        return self._runtime_status

    def inspect_runtime(self) -> RuntimeInspection:
        return self._inspection

    def get_recent_logs(self, *, limit: int = 200) -> tuple[str, ...]:
        return ()


class RuntimeLivenessClassificationTests(unittest.TestCase):
    def test_websocket_listener_counts_as_responsive_without_http_probe(self) -> None:
        manager = object.__new__(OpenClawRuntimeManager)
        state, message = manager._classify_liveness(  # type: ignore[attr-defined]
            runtime_state="running",
            process_exists=True,
            gateway_tcp_connectable=False,
            port_check_state="owned_by_active_runtime",
            control_http_responding=False,
            recent_stdout_count=0,
            recent_listener_log=False,
            startup_grace_active=False,
        )
        self.assertEqual(state, "responsive")
        self.assertIn("alternate signals", message.lower())

    def test_related_http_control_endpoint_counts_as_responsive(self) -> None:
        manager = object.__new__(OpenClawRuntimeManager)
        state, message = manager._classify_liveness(  # type: ignore[attr-defined]
            runtime_state="running",
            process_exists=True,
            gateway_tcp_connectable=False,
            port_check_state="no_conflict",
            control_http_responding=True,
            recent_stdout_count=0,
            recent_listener_log=False,
            startup_grace_active=False,
        )
        self.assertEqual(state, "responsive")
        self.assertIn("alternate signals", message.lower())


class DiagnosticsLivenessTests(unittest.TestCase):
    @staticmethod
    def _ready_ollama() -> ProviderStatus:
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama is ready.",
            is_local=True,
        )

    def test_recent_telegram_success_prevents_blocking_false_positive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControllerDiagnosticsService(
                runtime_manager=_FakeRuntimeManager(
                    inspection=RuntimeInspection(
                        configured_bind="loopback",
                        configured_host="127.0.0.1",
                        configured_port=18789,
                        cli_reachable=True,
                        process_exists=True,
                        process_responsive=False,
                        gateway_tcp_connectable=False,
                        gateway_listener_detected=False,
                        gateway_listener_owned=False,
                        liveness_state="unresponsive",
                        liveness_message="Gateway probe did not respond, but runtime may still be active via alternate signals.",
                    )
                ),
                config_store=ControllerConfigStore(config_path=Path(tmp) / "controller_config.json"),
                secret_store=InMemorySecretStore(),
            )
            service._ollama_service_reachable = lambda base_url: True  # type: ignore[method-assign]
            report = service.run_health_check(
                ControllerConfig(),
                self._ready_ollama(),
                telegram_recent_success=True,
                telegram_last_success_at="2026-04-07T10:00:00-04:00",
            )
            item = next(entry for entry in report.items if entry.code == "runtime.unresponsive")
            self.assertEqual(item.severity, "info")
            self.assertEqual(report.overall_status, "ok")

    def test_true_dead_runtime_still_blocks_health(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControllerDiagnosticsService(
                runtime_manager=_FakeRuntimeManager(
                    inspection=RuntimeInspection(
                        configured_bind="loopback",
                        configured_host="127.0.0.1",
                        configured_port=18789,
                        cli_reachable=True,
                        process_exists=True,
                        process_responsive=False,
                        gateway_tcp_connectable=False,
                        gateway_listener_detected=False,
                        gateway_listener_owned=False,
                        liveness_state="unresponsive",
                        liveness_message="Runtime process exists but no listener or alternate liveness signal responded.",
                    )
                ),
                config_store=ControllerConfigStore(config_path=Path(tmp) / "controller_config.json"),
                secret_store=InMemorySecretStore(),
            )
            service._ollama_service_reachable = lambda base_url: True  # type: ignore[method-assign]
            report = service.run_health_check(ControllerConfig(), self._ready_ollama())
            item = next(entry for entry in report.items if entry.code == "runtime.unresponsive")
            self.assertEqual(item.severity, "error")
            self.assertEqual(report.overall_status, "blocked")

    def test_startup_grace_only_warns(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControllerDiagnosticsService(
                runtime_manager=_FakeRuntimeManager(
                    inspection=RuntimeInspection(
                        configured_bind="loopback",
                        configured_host="127.0.0.1",
                        configured_port=18789,
                        cli_reachable=True,
                        process_exists=True,
                        process_responsive=False,
                        gateway_tcp_connectable=False,
                        gateway_listener_detected=False,
                        gateway_listener_owned=False,
                        startup_grace_active=True,
                        liveness_state="indeterminate",
                        liveness_message="Runtime is still within the startup grace period; listener probes are still settling.",
                    )
                ),
                config_store=ControllerConfigStore(config_path=Path(tmp) / "controller_config.json"),
                secret_store=InMemorySecretStore(),
            )
            service._ollama_service_reachable = lambda base_url: True  # type: ignore[method-assign]
            report = service.run_health_check(ControllerConfig(), self._ready_ollama())
            item = next(entry for entry in report.items if entry.code == "runtime.unresponsive")
            self.assertEqual(item.severity, "warning")
            self.assertEqual(report.overall_status, "degraded")


if __name__ == "__main__":
    unittest.main()
