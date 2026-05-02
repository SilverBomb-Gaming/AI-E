"""Structured append-only execution outcome records for the learning substrate."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ExecutionOutcomeSourceLayer = Literal["core", "node", "unity", "manual"]
ExecutionOutcomeStatus = Literal["completed", "failed", "blocked", "rolled_back"]
ExecutionOutcomeRiskLevel = Literal["low", "medium", "high"]
ExecutionOutcomeRecoveryStatus = Literal["not_required", "planned", "executed", "idempotent", "failed"]


@dataclass(frozen=True)
class ExecutionOutcomeRecord:
    outcome_id: str
    created_at: str
    source_layer: ExecutionOutcomeSourceLayer
    status: ExecutionOutcomeStatus
    success: bool
    approval_path: tuple[str, ...]
    execution_path: str
    evidence_labels: tuple[str, ...]
    rollback_required: bool
    rollback_executed: bool
    workflow_id: str = ""
    task_id: str = ""
    plan_id: str = ""
    node_id: str = ""
    target_node_id: str = ""
    command: str = ""
    risk_level: ExecutionOutcomeRiskLevel | str = ""
    result_summary: str = ""
    error_summary: str = ""
    recovery_status: ExecutionOutcomeRecoveryStatus | str = ""

    def to_payload(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "outcome_id": self.outcome_id,
            "created_at": self.created_at,
            "source_layer": self.source_layer,
            "status": self.status,
            "success": self.success,
            "approval_path": list(self.approval_path),
            "execution_path": self.execution_path,
            "evidence_labels": list(self.evidence_labels),
            "rollback_required": self.rollback_required,
            "rollback_executed": self.rollback_executed,
        }
        optional_values = {
            "workflow_id": self.workflow_id,
            "task_id": self.task_id,
            "plan_id": self.plan_id,
            "node_id": self.node_id,
            "target_node_id": self.target_node_id,
            "command": self.command,
            "risk_level": self.risk_level,
            "result_summary": self.result_summary,
            "error_summary": self.error_summary,
            "recovery_status": self.recovery_status,
        }
        for key, value in optional_values.items():
            if isinstance(value, str) and value.strip():
                payload[key] = value.strip()
        return payload

    @staticmethod
    def from_payload(payload: dict[str, object]) -> ExecutionOutcomeRecord:
        approval_path = payload.get("approval_path")
        evidence_labels = payload.get("evidence_labels")
        return ExecutionOutcomeRecord(
            outcome_id=str(payload.get("outcome_id", "")).strip(),
            created_at=str(payload.get("created_at", "")).strip(),
            source_layer=str(payload.get("source_layer", "node")).strip().lower() or "node",  # type: ignore[arg-type]
            status=str(payload.get("status", "failed")).strip().lower() or "failed",  # type: ignore[arg-type]
            success=bool(payload.get("success", False)),
            approval_path=tuple(str(item).strip() for item in (approval_path or ()) if str(item).strip()),
            execution_path=str(payload.get("execution_path", "")).strip(),
            evidence_labels=tuple(str(item).strip() for item in (evidence_labels or ()) if str(item).strip()),
            rollback_required=bool(payload.get("rollback_required", False)),
            rollback_executed=bool(payload.get("rollback_executed", False)),
            workflow_id=str(payload.get("workflow_id", "")).strip(),
            task_id=str(payload.get("task_id", "")).strip(),
            plan_id=str(payload.get("plan_id", "")).strip(),
            node_id=str(payload.get("node_id", "")).strip(),
            target_node_id=str(payload.get("target_node_id", "")).strip(),
            command=str(payload.get("command", "")).strip(),
            risk_level=str(payload.get("risk_level", "")).strip(),
            result_summary=str(payload.get("result_summary", "")).strip(),
            error_summary=str(payload.get("error_summary", "")).strip(),
            recovery_status=str(payload.get("recovery_status", "")).strip(),
        )