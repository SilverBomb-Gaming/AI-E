"""Structured execution plans for governed AI-E runtime requests."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ExecutionRiskLevel = Literal["none", "low", "medium", "high"]


@dataclass(frozen=True)
class ExecutionPlan:
    plan_id: str
    workflow_kind: str
    scope: str
    risk_level: ExecutionRiskLevel | str
    runtime_target: str
    requested_actions: tuple[str, ...]
    predicted_files: tuple[str, ...]
    predicted_commands: tuple[str, ...]
    requires_approval: bool
    dry_run_available: bool
    rollback_possible: bool
    estimated_impact: str
    generated_at: str

    def to_payload(self) -> dict[str, object]:
        return {
            "plan_id": self.plan_id,
            "workflow_kind": self.workflow_kind,
            "scope": self.scope,
            "risk_level": self.risk_level,
            "runtime_target": self.runtime_target,
            "requested_actions": list(self.requested_actions),
            "predicted_files": list(self.predicted_files),
            "predicted_commands": list(self.predicted_commands),
            "requires_approval": self.requires_approval,
            "dry_run_available": self.dry_run_available,
            "rollback_possible": self.rollback_possible,
            "estimated_impact": self.estimated_impact,
            "generated_at": self.generated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ExecutionPlan":
        return ExecutionPlan(
            plan_id=str(payload.get("plan_id", "")).strip(),
            workflow_kind=str(payload.get("workflow_kind", "")).strip(),
            scope=str(payload.get("scope", "")).strip(),
            risk_level=str(payload.get("risk_level", "medium")).strip() or "medium",
            runtime_target=str(payload.get("runtime_target", "")).strip(),
            requested_actions=_string_tuple(payload.get("requested_actions")),
            predicted_files=_string_tuple(payload.get("predicted_files")),
            predicted_commands=_string_tuple(payload.get("predicted_commands")),
            requires_approval=bool(payload.get("requires_approval", True)),
            dry_run_available=bool(payload.get("dry_run_available", True)),
            rollback_possible=bool(payload.get("rollback_possible", False)),
            estimated_impact=str(payload.get("estimated_impact", "")).strip(),
            generated_at=str(payload.get("generated_at", "")).strip(),
        )


@dataclass(frozen=True)
class ExecutionReceipt:
    receipt_id: str
    linked_plan_id: str
    runtime_used: str
    execution_started: str
    execution_finished: str
    files_changed: tuple[str, ...]
    commands_executed: tuple[str, ...]
    validation_result: str
    rollback_available: bool
    mutation_applied: bool
    operator_approved: bool
    execution_summary: str
    audit_visible: bool

    def to_payload(self) -> dict[str, object]:
        return {
            "receipt_id": self.receipt_id,
            "linked_plan_id": self.linked_plan_id,
            "runtime_used": self.runtime_used,
            "execution_started": self.execution_started,
            "execution_finished": self.execution_finished,
            "files_changed": list(self.files_changed),
            "commands_executed": list(self.commands_executed),
            "validation_result": self.validation_result,
            "rollback_available": self.rollback_available,
            "mutation_applied": self.mutation_applied,
            "operator_approved": self.operator_approved,
            "execution_summary": self.execution_summary,
            "audit_visible": self.audit_visible,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ExecutionReceipt":
        return ExecutionReceipt(
            receipt_id=str(payload.get("receipt_id", "")).strip(),
            linked_plan_id=str(payload.get("linked_plan_id", "")).strip(),
            runtime_used=str(payload.get("runtime_used", "")).strip(),
            execution_started=str(payload.get("execution_started", "")).strip(),
            execution_finished=str(payload.get("execution_finished", "")).strip(),
            files_changed=_string_tuple(payload.get("files_changed")),
            commands_executed=_string_tuple(payload.get("commands_executed")),
            validation_result=str(payload.get("validation_result", "")).strip(),
            rollback_available=bool(payload.get("rollback_available", False)),
            mutation_applied=bool(payload.get("mutation_applied", False)),
            operator_approved=bool(payload.get("operator_approved", False)),
            execution_summary=str(payload.get("execution_summary", "")).strip(),
            audit_visible=bool(payload.get("audit_visible", True)),
        )


def _string_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    try:
        return tuple(str(item).strip() for item in value if str(item).strip())  # type: ignore[union-attr]
    except TypeError:
        text = str(value).strip()
        return (text,) if text else ()
