"""Runtime-side state models."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Tuple


RuntimeState = Literal["stopped", "starting", "running", "error"]
PortCheckState = Literal[
    "no_conflict",
    "owned_by_active_runtime",
    "conflict_unrelated_process",
    "indeterminate",
]
LivenessState = Literal[
    "responsive",
    "responsive_with_limited_probe",
    "indeterminate",
    "unresponsive",
]


@dataclass(frozen=True)
class OpenClawInstallation:
    installed: bool = False
    wrapper_path: str = ""
    node_path: str = ""
    entrypoint_path: str = ""
    detail: str = ""


@dataclass(frozen=True)
class OllamaInstallation:
    installed: bool = False
    path: str = ""
    detail: str = ""


@dataclass(frozen=True)
class RuntimeStatus:
    runtime_state: RuntimeState = "stopped"
    status_message: str = "Runtime stopped."
    openclaw: OpenClawInstallation = field(default_factory=OpenClawInstallation)
    ollama: OllamaInstallation = field(default_factory=OllamaInstallation)
    pid: int | None = None
    last_error: str = ""


@dataclass(frozen=True)
class RuntimeInspection:
    configured_bind: str = "loopback"
    configured_host: str = "127.0.0.1"
    configured_port: int = 18789
    cli_reachable: bool = False
    invalid_executable_path: bool = False
    process_exists: bool = False
    process_responsive: bool = False
    gateway_tcp_connectable: bool = False
    gateway_listener_detected: bool = False
    gateway_listener_owned: bool = False
    control_http_responding: bool = False
    control_http_endpoint: str = ""
    recent_stdout_activity: bool = False
    recent_stdout_count: int = 0
    recent_listener_log: bool = False
    startup_grace_active: bool = False
    liveness_state: LivenessState = "indeterminate"
    liveness_message: str = "Runtime liveness has not been evaluated."
    stderr_recent: bool = False
    recent_stderr_count: int = 0
    port_conflict: bool = False
    port_conflict_detail: str = ""
    port_check_state: PortCheckState = "no_conflict"
    port_check_message: str = "No port conflict detected."
    port_owner_pids: Tuple[int, ...] = ()
    startup_failure: bool = False
    listener_addresses: Tuple[str, ...] = ()
