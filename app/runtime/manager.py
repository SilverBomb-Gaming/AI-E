"""OpenClaw runtime detection and process lifecycle management."""
from __future__ import annotations

import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import replace
from pathlib import Path
from typing import TextIO

try:
    import psutil
except ImportError:  # pragma: no cover - optional dependency
    psutil = None  # type: ignore[assignment]

from ..platform import get_platform_adapter
from ..platform.base import BasePlatformAdapter
from .log_buffer import LogBuffer
from .models import OllamaInstallation, OpenClawInstallation, RuntimeInspection, RuntimeStatus


_STARTUP_PORT_GRACE_SECONDS = 4.0


class OpenClawRuntimeManager:
    """Starts and stops the local OpenClaw gateway without blocking the UI."""

    def __init__(
        self,
        platform_adapter: BasePlatformAdapter | None = None,
        *,
        gateway_port: int = 18789,
        gateway_bind: str = "loopback",
    ) -> None:
        self._platform = platform_adapter or get_platform_adapter()
        self._gateway_port = gateway_port
        self._gateway_bind = gateway_bind
        self._lock = threading.RLock()
        self._log_buffer = LogBuffer()
        self._process: subprocess.Popen[str] | None = None
        self._status = RuntimeStatus()
        self._last_start_attempt_at = 0.0
        self.refresh_status()

    def get_status(self) -> RuntimeStatus:
        return self.refresh_status()

    def configure(self, *, gateway_port: int | None = None, gateway_bind: str | None = None) -> None:
        with self._lock:
            if gateway_port is not None:
                self._gateway_port = gateway_port
            if gateway_bind is not None:
                self._gateway_bind = gateway_bind

    def refresh_status(self) -> RuntimeStatus:
        with self._lock:
            openclaw = self.detect_openclaw_installation()
            ollama = self.detect_ollama_installation()
            process = self._process
            pid: int | None = None
            runtime_state = self._status.runtime_state
            status_message = self._status.status_message
            last_error = self._status.last_error

            if process is not None:
                exit_code = process.poll()
                if exit_code is None:
                    pid = process.pid
                    if runtime_state != "starting":
                        runtime_state = "running"
                    if runtime_state == "starting":
                        status_message = f"Starting OpenClaw gateway on port {self._gateway_port}."
                    else:
                        status_message = f"OpenClaw gateway running on port {self._gateway_port}."
                else:
                    self._process = None
                    pid = None
                    if self._status.runtime_state in {"starting", "running"} and exit_code != 0:
                        runtime_state = "error"
                        status_message = f"OpenClaw exited with code {exit_code}."
                        last_error = status_message
                        self._log_buffer.append("system", status_message)
                    else:
                        runtime_state = "stopped"
                        status_message = "Runtime stopped."
                        last_error = ""
            else:
                if runtime_state == "starting":
                    runtime_state = "stopped"
                    status_message = "Runtime stopped."

            self._status = RuntimeStatus(
                runtime_state=runtime_state,
                status_message=status_message,
                openclaw=openclaw,
                ollama=ollama,
                pid=pid,
                last_error=last_error,
            )
            return self._status

    def detect_openclaw_installation(self) -> OpenClawInstallation:
        node = self._platform.detect_command(["node.exe", "node"])
        wrapper = self._platform.detect_command(["openclaw.cmd", "openclaw.ps1", "openclaw"])
        if not wrapper.available:
            return OpenClawInstallation(detail="OpenClaw CLI was not found on PATH.")

        wrapper_path = Path(wrapper.path)
        package_root = wrapper_path.parent / "node_modules" / "openclaw"
        entrypoint = package_root / "openclaw.mjs"
        if not entrypoint.exists():
            return OpenClawInstallation(
                installed=False,
                wrapper_path=self._platform.normalize_path(wrapper_path),
                detail="OpenClaw package entrypoint was not found next to the CLI wrapper.",
            )

        if not node.available:
            return OpenClawInstallation(
                installed=False,
                wrapper_path=self._platform.normalize_path(wrapper_path),
                entrypoint_path=self._platform.normalize_path(entrypoint),
                detail="Node was not found on PATH.",
            )

        return OpenClawInstallation(
            installed=True,
            wrapper_path=self._platform.normalize_path(wrapper_path),
            node_path=node.path,
            entrypoint_path=self._platform.normalize_path(entrypoint),
            detail="OpenClaw CLI detected.",
        )

    def detect_ollama_installation(self) -> OllamaInstallation:
        ollama = self._platform.detect_command(["ollama.exe", "ollama"])
        if not ollama.available:
            return OllamaInstallation(detail="Ollama was not found on PATH.")
        return OllamaInstallation(installed=True, path=ollama.path, detail="Ollama CLI detected.")

    def start_runtime(self) -> RuntimeStatus:
        with self._lock:
            current = self.refresh_status()
            if current.runtime_state in {"starting", "running"}:
                return current

            if not current.openclaw.installed:
                self._status = replace(
                    current,
                    runtime_state="error",
                    status_message=current.openclaw.detail or "OpenClaw is not installed.",
                    last_error=current.openclaw.detail or "OpenClaw is not installed.",
                )
                self._log_buffer.append("system", self._status.status_message)
                return self._status

            command = [
                current.openclaw.node_path,
                current.openclaw.entrypoint_path,
                "gateway",
                "--bind",
                self._gateway_bind,
                "--port",
                str(self._gateway_port),
                "--verbose",
            ]
            cwd = str(Path(current.openclaw.entrypoint_path).parent)
            self._status = replace(
                current,
                runtime_state="starting",
                status_message=f"Starting OpenClaw gateway on port {self._gateway_port}.",
                pid=None,
                last_error="",
            )
            self._last_start_attempt_at = time.time()
            self._log_buffer.append("system", f"Launching OpenClaw: {' '.join(command)}")
            self._process = self._platform.spawn_process(command, cwd=cwd)
            self._start_log_threads(self._process)

        time.sleep(0.8)
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                self._status = replace(
                    self._status,
                    runtime_state="running",
                    status_message=f"OpenClaw gateway running on port {self._gateway_port}.",
                    pid=self._process.pid,
                )
        return self.refresh_status()

    def stop_runtime(self) -> RuntimeStatus:
        with self._lock:
            process = self._process
            if process is None or process.poll() is not None:
                self._process = None
                self._status = replace(
                    self.refresh_status(),
                    runtime_state="stopped",
                    status_message="Runtime already stopped.",
                    pid=None,
                    last_error="",
                )
                return self._status
            self._log_buffer.append("system", "Stopping OpenClaw gateway.")

        try:
            self._platform.stop_process(process)
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._status = replace(
                    self.refresh_status(),
                    runtime_state="error",
                    status_message=f"Failed to stop OpenClaw cleanly: {exc}",
                    last_error=str(exc),
                )
                self._log_buffer.append("system", self._status.status_message)
                return self._status

        with self._lock:
            self._process = None
            self._last_start_attempt_at = 0.0
            self._status = replace(
                self.refresh_status(),
                runtime_state="stopped",
                status_message="OpenClaw runtime stopped.",
                pid=None,
                last_error="",
            )
        return self._status

    def restart_runtime(self) -> RuntimeStatus:
        self.stop_runtime()
        return self.start_runtime()

    def clear_logs(self) -> RuntimeStatus:
        with self._lock:
            self._log_buffer.clear()
            self._status = replace(self.refresh_status(), status_message="Runtime logs cleared.")
            return self._status

    def get_recent_logs(self, *, limit: int = 200) -> tuple[str, ...]:
        return self._log_buffer.snapshot(limit=limit)

    def inspect_runtime(self) -> RuntimeInspection:
        with self._lock:
            status = self.refresh_status()
            process = self._process
            process_exists = process is not None and process.poll() is None
            configured_host = self._configured_host()
            listeners = self._listener_details(self._gateway_port)
            gateway_tcp_connectable = self._can_connect(configured_host, self._gateway_port)
            process_responsive = process_exists and gateway_tcp_connectable
            port_check_state, port_check_message, owner_pids = self._detect_port_usage(
                managed_pid=process.pid if process_exists and process else None,
                runtime_state=status.runtime_state,
                openclaw=status.openclaw,
                listeners=listeners,
            )
            control_http_responding, control_http_endpoint = self._probe_related_http_endpoint(
                managed_pid=process.pid if process_exists and process else None,
                gateway_port=self._gateway_port,
            )
            recent_stdout_count = self._log_buffer.count_recent("stdout", window_seconds=180.0)
            recent_listener_log = self._has_recent_listener_log()
            startup_grace_active = self._within_startup_grace(status.runtime_state)
            liveness_state, liveness_message = self._classify_liveness(
                runtime_state=status.runtime_state,
                process_exists=process_exists,
                gateway_tcp_connectable=gateway_tcp_connectable,
                port_check_state=port_check_state,
                control_http_responding=control_http_responding,
                recent_stdout_count=recent_stdout_count,
                recent_listener_log=recent_listener_log,
                startup_grace_active=startup_grace_active,
            )
            invalid_executable_path = bool(status.openclaw.entrypoint_path and not Path(status.openclaw.entrypoint_path).exists())
            stderr_recent_count = self._log_buffer.count_recent("stderr", window_seconds=300.0)
            return RuntimeInspection(
                configured_bind=self._gateway_bind,
                configured_host=configured_host,
                configured_port=self._gateway_port,
                cli_reachable=status.openclaw.installed,
                invalid_executable_path=invalid_executable_path,
                process_exists=process_exists,
                process_responsive=process_responsive,
                gateway_tcp_connectable=gateway_tcp_connectable,
                gateway_listener_detected=bool(listeners),
                gateway_listener_owned=port_check_state == "owned_by_active_runtime",
                control_http_responding=control_http_responding,
                control_http_endpoint=control_http_endpoint,
                recent_stdout_activity=recent_stdout_count > 0,
                recent_stdout_count=recent_stdout_count,
                recent_listener_log=recent_listener_log,
                startup_grace_active=startup_grace_active,
                liveness_state=liveness_state,
                liveness_message=liveness_message,
                stderr_recent=stderr_recent_count > 0,
                recent_stderr_count=stderr_recent_count,
                port_conflict=port_check_state == "conflict_unrelated_process",
                port_conflict_detail=port_check_message if port_check_state == "conflict_unrelated_process" else "",
                port_check_state=port_check_state,
                port_check_message=port_check_message,
                port_owner_pids=owner_pids,
                startup_failure=status.runtime_state == "error" or bool(status.last_error),
                listener_addresses=tuple(address for address, _, _ in listeners),
            )

    def _start_log_threads(self, process: subprocess.Popen[str]) -> None:
        if process.stdout is not None:
            threading.Thread(
                target=self._consume_stream,
                args=("stdout", process.stdout),
                name="OpenClawStdout",
                daemon=True,
            ).start()
        if process.stderr is not None:
            threading.Thread(
                target=self._consume_stream,
                args=("stderr", process.stderr),
                name="OpenClawStderr",
                daemon=True,
            ).start()

    def _consume_stream(self, source: str, stream: TextIO) -> None:
        try:
            for line in iter(stream.readline, ""):
                if not line:
                    break
                self._log_buffer.append(source, line)
        finally:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass

    def _configured_host(self) -> str:
        bind = self._gateway_bind.strip().lower()
        if bind == "loopback":
            return "127.0.0.1"
        if bind == "lan":
            return "0.0.0.0"
        if bind == "tailnet":
            return "tailscale"
        return bind or "127.0.0.1"

    def _can_connect(self, host: str, port: int) -> bool:
        if host in {"tailscale", "auto", "custom", "0.0.0.0"}:
            host = "127.0.0.1"
        try:
            with socket.create_connection((host, port), timeout=0.75):
                return True
        except OSError:
            return False

    def _listener_details(self, port: int) -> list[tuple[str, int | None, str]]:
        listeners: list[tuple[str, int | None, str]] = []
        if psutil is not None:  # type: ignore[truthy-bool]
            try:
                for conn in psutil.net_connections(kind="tcp"):
                    laddr = getattr(conn, "laddr", None)
                    if not laddr:
                        continue
                    conn_port = getattr(laddr, "port", None)
                    if conn_port != port or conn.status != psutil.CONN_LISTEN:
                        continue
                    host = getattr(laddr, "ip", None) or laddr[0]
                    listeners.append((str(host), conn.pid, self._process_identity(conn.pid)))
            except Exception:  # noqa: BLE001
                listeners = []
        return listeners

    def _detect_port_usage(
        self,
        *,
        managed_pid: int | None,
        runtime_state: str,
        openclaw: OpenClawInstallation,
        listeners: list[tuple[str, int | None, str]],
    ) -> tuple[str, str, tuple[int, ...]]:
        owner_pids = tuple(sorted({pid for _, pid, _ in listeners if pid is not None}))
        within_startup_grace = self._within_startup_grace(runtime_state)

        if listeners:
            related_pids = self._related_runtime_pids(managed_pid)
            owned_flags = [
                self._is_listener_owned_by_runtime(
                    listener_pid=pid,
                    listener_identity=identity,
                    related_pids=related_pids,
                    openclaw=openclaw,
                )
                for _, pid, identity in listeners
            ]
            unknown_flags = [
                self._is_listener_ownership_unknown(
                    listener_pid=pid,
                    listener_identity=identity,
                    related_pids=related_pids,
                )
                for _, pid, identity in listeners
            ]

            if all(owned_flags):
                return (
                    "owned_by_active_runtime",
                    f"Configured port {self._gateway_port} is in use by the active OpenClaw runtime.",
                    owner_pids,
                )
            if any(owned_flags) and any(not owned for owned in owned_flags):
                return (
                    "conflict_unrelated_process",
                    f"Configured port {self._gateway_port} is shared with an unrelated process.",
                    owner_pids,
                )
            if any(unknown_flags):
                if within_startup_grace:
                    return (
                        "indeterminate",
                        f"Configured port {self._gateway_port} is active while OpenClaw ownership is still being verified.",
                        owner_pids,
                    )
                return (
                    "indeterminate",
                    f"Configured port {self._gateway_port} is active, but ownership could not be verified.",
                    owner_pids,
                )
            return (
                "conflict_unrelated_process",
                f"Configured port {self._gateway_port} is occupied by another process.",
                owner_pids,
            )

        if managed_pid is None and self._can_connect("127.0.0.1", self._gateway_port):
            if within_startup_grace:
                return (
                    "indeterminate",
                    f"Configured port {self._gateway_port} responded during startup; ownership is still pending.",
                    owner_pids,
                )
            return (
                "conflict_unrelated_process",
                f"Configured port {self._gateway_port} appears to be in use by another listener.",
                owner_pids,
            )
        return ("no_conflict", "No port conflict detected.", owner_pids)

    def _within_startup_grace(self, runtime_state: str) -> bool:
        if runtime_state == "starting":
            return True
        return bool(
            runtime_state == "running"
            and self._last_start_attempt_at
            and (time.time() - self._last_start_attempt_at) < _STARTUP_PORT_GRACE_SECONDS
        )

    def _related_runtime_pids(self, managed_pid: int | None) -> set[int]:
        if managed_pid is None:
            return set()
        related = {managed_pid}
        if psutil is None:  # type: ignore[truthy-bool]
            return related
        try:
            process = psutil.Process(managed_pid)
            related.update(child.pid for child in process.children(recursive=True))
        except Exception:  # noqa: BLE001
            return related
        return related

    def _process_identity(self, pid: int | None) -> str:
        if pid is None or psutil is None:  # type: ignore[truthy-bool]
            return ""
        try:
            process = psutil.Process(pid)
            parts = process.cmdline()
            if parts:
                return " ".join(str(part) for part in parts)
            exe = process.exe()
            return str(exe)
        except Exception:  # noqa: BLE001
            return ""

    def _is_listener_owned_by_runtime(
        self,
        *,
        listener_pid: int | None,
        listener_identity: str,
        related_pids: set[int],
        openclaw: OpenClawInstallation,
    ) -> bool:
        if listener_pid is not None and listener_pid in related_pids:
            return True
        return self._matches_openclaw_identity(listener_identity, openclaw)

    def _is_listener_ownership_unknown(
        self,
        *,
        listener_pid: int | None,
        listener_identity: str,
        related_pids: set[int],
    ) -> bool:
        if listener_pid is not None:
            return False
        if listener_identity:
            return False
        return bool(related_pids)

    def _matches_openclaw_identity(self, identity: str, openclaw: OpenClawInstallation) -> bool:
        normalized = identity.lower().strip()
        if not normalized:
            return False
        if "openclaw" in normalized and "gateway" in normalized:
            return True
        if openclaw.entrypoint_path and openclaw.entrypoint_path.lower() in normalized:
            return True
        if openclaw.wrapper_path and Path(openclaw.wrapper_path).name.lower() in normalized:
            return True
        return False

    def _probe_related_http_endpoint(self, *, managed_pid: int | None, gateway_port: int) -> tuple[bool, str]:
        if managed_pid is None or psutil is None:  # type: ignore[truthy-bool]
            return False, ""
        related_pids = self._related_runtime_pids(managed_pid)
        if not related_pids:
            return False, ""

        candidates: list[tuple[int, str]] = []
        try:
            for conn in psutil.net_connections(kind="tcp"):
                laddr = getattr(conn, "laddr", None)
                if not laddr or conn.status != psutil.CONN_LISTEN:
                    continue
                if conn.pid not in related_pids:
                    continue
                port = getattr(laddr, "port", None)
                if port is None or port == gateway_port:
                    continue
                host = str(getattr(laddr, "ip", None) or laddr[0])
                if host not in {"127.0.0.1", "::1", "0.0.0.0"}:
                    continue
                probe_host = "127.0.0.1"
                candidates.append((int(port), f"http://{probe_host}:{int(port)}/"))
        except Exception:  # noqa: BLE001
            return False, ""

        candidates.sort(key=lambda item: abs(item[0] - gateway_port))
        for _, endpoint in candidates:
            if self._http_probe(endpoint):
                return True, endpoint
        return False, ""

    def _http_probe(self, url: str) -> bool:
        request = urllib.request.Request(url, method="GET", headers={"User-Agent": "AI-E-HealthCheck/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=0.75):
                return True
        except urllib.error.HTTPError:
            return True
        except (urllib.error.URLError, OSError, TimeoutError, ValueError):
            return False

    def _has_recent_listener_log(self) -> bool:
        recent_stdout = self._log_buffer.recent_lines(source="stdout", window_seconds=180.0, limit=40)
        keywords = ("listening", "listener", "ws://", "http://", "gateway", "browser")
        return any(any(keyword in line.lower() for keyword in keywords) for line in recent_stdout)

    def _classify_liveness(
        self,
        *,
        runtime_state: str,
        process_exists: bool,
        gateway_tcp_connectable: bool,
        port_check_state: str,
        control_http_responding: bool,
        recent_stdout_count: int,
        recent_listener_log: bool,
        startup_grace_active: bool,
    ) -> tuple[str, str]:
        if runtime_state != "running":
            if startup_grace_active:
                return "indeterminate", "Runtime startup is still within the initial grace period."
            return "indeterminate", "Runtime is not expected to respond because it is not running."

        if not process_exists:
            return "unresponsive", "Runtime is marked running, but no active process was found."

        strong_signals: list[str] = []
        limited_signals: list[str] = []

        if gateway_tcp_connectable:
            strong_signals.append("Configured gateway port accepted a TCP connection.")
        if port_check_state == "owned_by_active_runtime":
            strong_signals.append("Configured gateway listener is owned by the active OpenClaw runtime.")
        elif port_check_state == "indeterminate":
            limited_signals.append("Configured gateway listener is active, but ownership is still being verified.")
        if control_http_responding:
            strong_signals.append("A related local HTTP control endpoint responded successfully.")
        if recent_listener_log:
            strong_signals.append("Recent runtime logs report active gateway or browser listeners.")
        elif recent_stdout_count > 0:
            limited_signals.append("Recent runtime stdout activity was observed.")

        if strong_signals:
            message = strong_signals[0]
            if not gateway_tcp_connectable and len(strong_signals) > 0:
                message = f"Gateway TCP probe did not respond, but runtime appears active via alternate signals. {strong_signals[0]}"
            return "responsive", message

        if startup_grace_active:
            return "indeterminate", "Runtime is still within the startup grace period; listener probes are still settling."

        if limited_signals:
            return "responsive_with_limited_probe", limited_signals[0]

        return "unresponsive", "Runtime process exists but no listener or alternate liveness signal responded."
