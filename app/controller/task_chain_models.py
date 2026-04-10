"""Durable bounded autonomous task-chain models."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal


TaskChainType = Literal["validate_then_report", "feature_validate_loop", "dispatch_validate_recover"]
TaskChainStatus = Literal["created", "running", "completed", "stopped", "failed", "blocked"]
TaskChainTargetKind = Literal["local", "node", "role"]
TaskChainStepFamily = Literal["run", "test", "dispatch", "feature_status", "report"]
TaskChainStepStatus = Literal["success", "failed", "timed_out", "unavailable", "refused", "blocked", "stopped"]


@dataclass(frozen=True)
class TaskChainRecord:
    chain_id: str
    title: str
    objective: str
    chain_type: TaskChainType
    created_at: str
    approved_at: str
    status: TaskChainStatus
    owner_label: str
    source: str
    chat_id: str
    command_text: str
    command_label: str
    command_argument: str
    primary_target_kind: TaskChainTargetKind
    primary_target_selector: str
    primary_target_display: str
    fallback_target_kind: TaskChainTargetKind
    fallback_target_selector: str
    fallback_target_display: str
    fallback_policy: str
    allowed_step_families: tuple[TaskChainStepFamily, ...]
    max_steps: int
    max_failures: int
    max_no_progress: int
    latest_summary: str = ""
    final_summary: str = ""
    latest_step_id: str = ""
    steps_completed: int = 0
    success_count: int = 0
    failure_count: int = 0
    no_progress_count: int = 0
    last_failure_reason: str = ""
    finished_at: str = ""
    stop_reason: str = ""
    metadata: dict[str, str] = field(default_factory=dict)

    def to_payload(self) -> dict[str, object]:
        return {
            "chain_id": self.chain_id,
            "title": self.title,
            "objective": self.objective,
            "chain_type": self.chain_type,
            "created_at": self.created_at,
            "approved_at": self.approved_at,
            "status": self.status,
            "owner_label": self.owner_label,
            "source": self.source,
            "chat_id": self.chat_id,
            "command_text": self.command_text,
            "command_label": self.command_label,
            "command_argument": self.command_argument,
            "primary_target_kind": self.primary_target_kind,
            "primary_target_selector": self.primary_target_selector,
            "primary_target_display": self.primary_target_display,
            "fallback_target_kind": self.fallback_target_kind,
            "fallback_target_selector": self.fallback_target_selector,
            "fallback_target_display": self.fallback_target_display,
            "fallback_policy": self.fallback_policy,
            "allowed_step_families": list(self.allowed_step_families),
            "max_steps": self.max_steps,
            "max_failures": self.max_failures,
            "max_no_progress": self.max_no_progress,
            "latest_summary": self.latest_summary,
            "final_summary": self.final_summary,
            "latest_step_id": self.latest_step_id,
            "steps_completed": self.steps_completed,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "no_progress_count": self.no_progress_count,
            "last_failure_reason": self.last_failure_reason,
            "finished_at": self.finished_at,
            "stop_reason": self.stop_reason,
            "metadata": dict(self.metadata),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> TaskChainRecord:
        families = payload.get("allowed_step_families")
        metadata = payload.get("metadata")
        return TaskChainRecord(
            chain_id=str(payload.get("chain_id", "")).strip().upper(),
            title=str(payload.get("title", "")).strip(),
            objective=str(payload.get("objective", "")).strip(),
            chain_type=str(payload.get("chain_type", "validate_then_report")).strip().lower() or "validate_then_report",  # type: ignore[arg-type]
            created_at=str(payload.get("created_at", "")).strip(),
            approved_at=str(payload.get("approved_at", "")).strip(),
            status=str(payload.get("status", "created")).strip().lower() or "created",  # type: ignore[arg-type]
            owner_label=str(payload.get("owner_label", "")).strip(),
            source=str(payload.get("source", "local-cli")).strip(),
            chat_id=str(payload.get("chat_id", "local-cli")).strip(),
            command_text=str(payload.get("command_text", "")).strip(),
            command_label=str(payload.get("command_label", "")).strip(),
            command_argument=str(payload.get("command_argument", "")).strip(),
            primary_target_kind=str(payload.get("primary_target_kind", "local")).strip().lower() or "local",  # type: ignore[arg-type]
            primary_target_selector=str(payload.get("primary_target_selector", "")).strip(),
            primary_target_display=str(payload.get("primary_target_display", "")).strip(),
            fallback_target_kind=str(payload.get("fallback_target_kind", "local")).strip().lower() or "local",  # type: ignore[arg-type]
            fallback_target_selector=str(payload.get("fallback_target_selector", "")).strip(),
            fallback_target_display=str(payload.get("fallback_target_display", "")).strip(),
            fallback_policy=str(payload.get("fallback_policy", "stop")).strip().lower() or "stop",
            allowed_step_families=tuple(
                str(item).strip().lower()  # type: ignore[arg-type]
                for item in families or ()
                if str(item).strip()
            ),
            max_steps=max(1, int(payload.get("max_steps", 1))),
            max_failures=max(1, int(payload.get("max_failures", 1))),
            max_no_progress=max(1, int(payload.get("max_no_progress", 1))),
            latest_summary=str(payload.get("latest_summary", "")).strip(),
            final_summary=str(payload.get("final_summary", "")).strip(),
            latest_step_id=str(payload.get("latest_step_id", "")).strip(),
            steps_completed=max(0, int(payload.get("steps_completed", 0))),
            success_count=max(0, int(payload.get("success_count", 0))),
            failure_count=max(0, int(payload.get("failure_count", 0))),
            no_progress_count=max(0, int(payload.get("no_progress_count", 0))),
            last_failure_reason=str(payload.get("last_failure_reason", "")).strip(),
            finished_at=str(payload.get("finished_at", "")).strip(),
            stop_reason=str(payload.get("stop_reason", "")).strip(),
            metadata={str(key): str(value) for key, value in (metadata.items() if isinstance(metadata, dict) else ())},
        )


@dataclass(frozen=True)
class TaskChainStepRecord:
    step_id: str
    chain_id: str
    step_number: int
    family: TaskChainStepFamily
    label: str
    started_at: str
    finished_at: str
    status: TaskChainStepStatus
    result_summary: str
    progress_made: bool
    target_node_id: str = ""
    target_node_name: str = ""
    target_node_role: str = ""
    dispatch_job_id: str = ""
    failure_reason: str = ""
    metadata: dict[str, str] = field(default_factory=dict)

    def with_metadata(self, **metadata: str) -> TaskChainStepRecord:
        merged = dict(self.metadata)
        merged.update({str(key): str(value) for key, value in metadata.items()})
        return replace(self, metadata=merged)

    def to_payload(self) -> dict[str, object]:
        return {
            "step_id": self.step_id,
            "chain_id": self.chain_id,
            "step_number": self.step_number,
            "family": self.family,
            "label": self.label,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "result_summary": self.result_summary,
            "progress_made": self.progress_made,
            "target_node_id": self.target_node_id,
            "target_node_name": self.target_node_name,
            "target_node_role": self.target_node_role,
            "dispatch_job_id": self.dispatch_job_id,
            "failure_reason": self.failure_reason,
            "metadata": dict(self.metadata),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> TaskChainStepRecord:
        metadata = payload.get("metadata")
        return TaskChainStepRecord(
            step_id=str(payload.get("step_id", "")).strip(),
            chain_id=str(payload.get("chain_id", "")).strip().upper(),
            step_number=max(1, int(payload.get("step_number", 1))),
            family=str(payload.get("family", "report")).strip().lower() or "report",  # type: ignore[arg-type]
            label=str(payload.get("label", "")).strip(),
            started_at=str(payload.get("started_at", "")).strip(),
            finished_at=str(payload.get("finished_at", "")).strip(),
            status=str(payload.get("status", "failed")).strip().lower() or "failed",  # type: ignore[arg-type]
            result_summary=str(payload.get("result_summary", "")).strip(),
            progress_made=bool(payload.get("progress_made", False)),
            target_node_id=str(payload.get("target_node_id", "")).strip(),
            target_node_name=str(payload.get("target_node_name", "")).strip(),
            target_node_role=str(payload.get("target_node_role", "")).strip(),
            dispatch_job_id=str(payload.get("dispatch_job_id", "")).strip(),
            failure_reason=str(payload.get("failure_reason", "")).strip(),
            metadata={str(key): str(value) for key, value in (metadata.items() if isinstance(metadata, dict) else ())},
        )