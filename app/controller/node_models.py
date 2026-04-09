"""Controller-side node models for bounded multi-node execution routing."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .execution_models import LocalCommandExecutionRequest


NodeType = Literal["local", "mock"]
NodeStatus = Literal["online", "offline", "degraded"]
NodeTransport = Literal["in_process", "mock"]
NodeSelectionSource = Literal["default", "selected"]


@dataclass(frozen=True)
class NodeDescriptor:
    node_id: str
    display_name: str
    node_type: NodeType
    status: NodeStatus
    transport: NodeTransport
    summary: str
    supports_bounded_execution: bool = True
    is_default: bool = False
    last_seen_at: str = ""
    capability_labels: tuple[str, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class NodeResolution:
    node: NodeDescriptor
    source: NodeSelectionSource


@dataclass(frozen=True)
class NodeCommandExecutionResult:
    node: NodeDescriptor
    request: LocalCommandExecutionRequest
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    output_summary: str
    first_issue: str = ""
    completed_at: str = ""