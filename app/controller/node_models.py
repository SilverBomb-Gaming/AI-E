"""Controller-side node and dispatch models for bounded multi-node orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

from .execution_models import LocalCommandExecutionRequest


NodeType = Literal["local", "shared", "mock"]
NodeRole = Literal["controller", "executor", "validator", "sandbox"]
NodeStatus = Literal["online", "busy", "offline", "degraded", "stale", "disabled"]
NodeTransport = Literal["in_process", "shared_directory", "mock"]
NodeSelectionSource = Literal["default", "selected", "role", "explicit"]
DispatchSelectionMode = Literal["node_id", "role"]
DispatchStatus = Literal["queued", "running", "completed", "failed", "refused"]


@dataclass(frozen=True)
class NodeDescriptor:
    node_id: str
    display_name: str
    role: NodeRole
    node_type: NodeType
    status: NodeStatus
    transport: NodeTransport
    summary: str
    machine_label: str = ""
    enabled: bool = True
    supports_bounded_execution: bool = True
    is_default: bool = False
    repo_root: str = ""
    allowed_roots: tuple[str, ...] = ()
    registered_at: str = ""
    last_seen_at: str = ""
    capability_labels: tuple[str, ...] = ()
    current_job_id: str = ""
    last_job_id: str = ""
    last_job_status: str = ""
    last_result_summary: str = ""
    metadata: dict[str, object] = field(default_factory=dict)

    def with_status(self, status: NodeStatus, **changes: object) -> NodeDescriptor:
        payload: dict[str, object] = {"status": status, **changes}
        return replace(self, **payload)

    def supports_command(self, command_label: str) -> bool:
        normalized = command_label.strip().lower()
        return bool(normalized and normalized in {label.strip().lower() for label in self.capability_labels})

    def to_payload(self) -> dict[str, object]:
        return {
            "node_id": self.node_id,
            "display_name": self.display_name,
            "role": self.role,
            "node_type": self.node_type,
            "status": self.status,
            "transport": self.transport,
            "summary": self.summary,
            "machine_label": self.machine_label,
            "enabled": self.enabled,
            "supports_bounded_execution": self.supports_bounded_execution,
            "is_default": self.is_default,
            "repo_root": self.repo_root,
            "allowed_roots": list(self.allowed_roots),
            "registered_at": self.registered_at,
            "last_seen_at": self.last_seen_at,
            "capability_labels": list(self.capability_labels),
            "current_job_id": self.current_job_id,
            "last_job_id": self.last_job_id,
            "last_job_status": self.last_job_status,
            "last_result_summary": self.last_result_summary,
            "metadata": dict(self.metadata),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> NodeDescriptor:
        metadata = payload.get("metadata")
        allowed_roots = payload.get("allowed_roots")
        capability_labels = payload.get("capability_labels")
        return NodeDescriptor(
            node_id=str(payload.get("node_id", "")).strip(),
            display_name=str(payload.get("display_name", "")).strip(),
            role=str(payload.get("role", "executor")).strip().lower() or "executor",  # type: ignore[arg-type]
            node_type=str(payload.get("node_type", "shared")).strip().lower() or "shared",  # type: ignore[arg-type]
            status=str(payload.get("status", "offline")).strip().lower() or "offline",  # type: ignore[arg-type]
            transport=str(payload.get("transport", "shared_directory")).strip().lower() or "shared_directory",  # type: ignore[arg-type]
            summary=str(payload.get("summary", "")).strip(),
            machine_label=str(payload.get("machine_label", "")).strip(),
            enabled=bool(payload.get("enabled", True)),
            supports_bounded_execution=bool(payload.get("supports_bounded_execution", True)),
            is_default=bool(payload.get("is_default", False)),
            repo_root=str(payload.get("repo_root", "")).strip(),
            allowed_roots=tuple(str(item).strip() for item in allowed_roots or () if str(item).strip()),
            registered_at=str(payload.get("registered_at", "")).strip(),
            last_seen_at=str(payload.get("last_seen_at", "")).strip(),
            capability_labels=tuple(str(item).strip() for item in capability_labels or () if str(item).strip()),
            current_job_id=str(payload.get("current_job_id", "")).strip(),
            last_job_id=str(payload.get("last_job_id", "")).strip(),
            last_job_status=str(payload.get("last_job_status", "")).strip(),
            last_result_summary=str(payload.get("last_result_summary", "")).strip(),
            metadata={str(key): value for key, value in (metadata.items() if isinstance(metadata, dict) else ())},
        )


@dataclass(frozen=True)
class NodeResolution:
    node: NodeDescriptor
    source: NodeSelectionSource


@dataclass(frozen=True)
class NodeDispatchTarget:
    selection_mode: DispatchSelectionMode
    target_value: str
    required_command_label: str
    requested_command: str
    routing_reason: str
    node: NodeDescriptor


@dataclass(frozen=True)
class NodeDispatchRecord:
    job_id: str
    status: DispatchStatus
    requested_capability_id: str
    requested_command_label: str
    requested_command_text: str
    requested_command_summary: str
    target_selection_mode: DispatchSelectionMode
    target_selector: str
    target_node_id: str
    target_node_role: NodeRole
    target_node_name: str
    routing_reason: str
    request_source: str
    requester_label: str
    chat_id: str
    confirmation_required: bool
    confirmation_id: str = ""
    queued_at: str = ""
    started_at: str = ""
    finished_at: str = ""
    result_summary: str = ""
    failure_reason: str = ""
    current_job_state: str = ""
    execution_payload: dict[str, object] = field(default_factory=dict)

    def with_status(self, status: DispatchStatus, **changes: object) -> NodeDispatchRecord:
        payload: dict[str, object] = {"status": status, **changes}
        return replace(self, **payload)

    def to_payload(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "requested_capability_id": self.requested_capability_id,
            "requested_command_label": self.requested_command_label,
            "requested_command_text": self.requested_command_text,
            "requested_command_summary": self.requested_command_summary,
            "target_selection_mode": self.target_selection_mode,
            "target_selector": self.target_selector,
            "target_node_id": self.target_node_id,
            "target_node_role": self.target_node_role,
            "target_node_name": self.target_node_name,
            "routing_reason": self.routing_reason,
            "request_source": self.request_source,
            "requester_label": self.requester_label,
            "chat_id": self.chat_id,
            "confirmation_required": self.confirmation_required,
            "confirmation_id": self.confirmation_id,
            "queued_at": self.queued_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result_summary": self.result_summary,
            "failure_reason": self.failure_reason,
            "current_job_state": self.current_job_state,
            "execution_payload": dict(self.execution_payload),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> NodeDispatchRecord:
        return NodeDispatchRecord(
            job_id=str(payload.get("job_id", "")).strip(),
            status=str(payload.get("status", "queued")).strip().lower() or "queued",  # type: ignore[arg-type]
            requested_capability_id=str(payload.get("requested_capability_id", "")).strip(),
            requested_command_label=str(payload.get("requested_command_label", "")).strip(),
            requested_command_text=str(payload.get("requested_command_text", "")).strip(),
            requested_command_summary=str(payload.get("requested_command_summary", "")).strip(),
            target_selection_mode=str(payload.get("target_selection_mode", "node_id")).strip().lower() or "node_id",  # type: ignore[arg-type]
            target_selector=str(payload.get("target_selector", "")).strip(),
            target_node_id=str(payload.get("target_node_id", "")).strip(),
            target_node_role=str(payload.get("target_node_role", "executor")).strip().lower() or "executor",  # type: ignore[arg-type]
            target_node_name=str(payload.get("target_node_name", "")).strip(),
            routing_reason=str(payload.get("routing_reason", "")).strip(),
            request_source=str(payload.get("request_source", "local-cli")).strip(),
            requester_label=str(payload.get("requester_label", "")).strip(),
            chat_id=str(payload.get("chat_id", "")).strip(),
            confirmation_required=bool(payload.get("confirmation_required", True)),
            confirmation_id=str(payload.get("confirmation_id", "")).strip(),
            queued_at=str(payload.get("queued_at", "")).strip(),
            started_at=str(payload.get("started_at", "")).strip(),
            finished_at=str(payload.get("finished_at", "")).strip(),
            result_summary=str(payload.get("result_summary", "")).strip(),
            failure_reason=str(payload.get("failure_reason", "")).strip(),
            current_job_state=str(payload.get("current_job_state", "")).strip(),
            execution_payload={
                str(key): value for key, value in (payload.get("execution_payload", {}).items() if isinstance(payload.get("execution_payload"), dict) else ())
            },
        )


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