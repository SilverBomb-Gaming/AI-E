"""Bounded autonomy bundle models layered on top of the plan bridge."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


AutonomyBundleState = Literal["proposed", "approved", "running", "completed", "failed", "cancelled", "invalidated"]


@dataclass(frozen=True)
class AutonomyBundleStopConditions:
    stop_on_first_failure: bool
    stop_after_max_steps: int
    stop_if_scope_denied: bool
    stop_if_confirmation_required_beyond_bundle: bool
    stop_if_plan_invalidated: bool
    bundle_timeout_seconds: int

    def to_payload(self) -> dict[str, object]:
        return {
            "stop_on_first_failure": self.stop_on_first_failure,
            "stop_after_max_steps": self.stop_after_max_steps,
            "stop_if_scope_denied": self.stop_if_scope_denied,
            "stop_if_confirmation_required_beyond_bundle": self.stop_if_confirmation_required_beyond_bundle,
            "stop_if_plan_invalidated": self.stop_if_plan_invalidated,
            "bundle_timeout_seconds": self.bundle_timeout_seconds,
        }


@dataclass(frozen=True)
class AutonomyBundleSelectedStep:
    step_index: int
    plan_id: str
    phase_id: str
    task_group_id: str
    title: str
    mapped_execution_action: str
    dependency_state: str
    expected_result: str
    target_capability_id: str
    command_label: str
    command_argument: str
    suggested_entry_command: str

    def to_payload(self) -> dict[str, object]:
        return {
            "step_index": self.step_index,
            "plan_id": self.plan_id,
            "phase_id": self.phase_id,
            "task_group_id": self.task_group_id,
            "title": self.title,
            "mapped_execution_action": self.mapped_execution_action,
            "dependency_state": self.dependency_state,
            "expected_result": self.expected_result,
            "target_capability_id": self.target_capability_id,
            "command_label": self.command_label,
            "command_argument": self.command_argument,
            "suggested_entry_command": self.suggested_entry_command,
        }


@dataclass(frozen=True)
class AutonomyBundleProposal:
    bundle_id: str
    plan_id: str
    title: str
    rationale: str
    selected_task_groups: tuple[str, ...]
    selected_steps: tuple[AutonomyBundleSelectedStep, ...]
    max_steps: int
    stop_conditions: AutonomyBundleStopConditions
    expected_outputs: tuple[str, ...]
    risk_notes: tuple[str, ...]
    approval_required: bool

    def to_payload(self) -> dict[str, object]:
        return {
            "bundle_id": self.bundle_id,
            "plan_id": self.plan_id,
            "title": self.title,
            "rationale": self.rationale,
            "selected_task_groups": list(self.selected_task_groups),
            "selected_steps": [step.to_payload() for step in self.selected_steps],
            "max_steps": self.max_steps,
            "stop_conditions": self.stop_conditions.to_payload(),
            "expected_outputs": list(self.expected_outputs),
            "risk_notes": list(self.risk_notes),
            "approval_required": self.approval_required,
        }


@dataclass(frozen=True)
class AutonomyBundleStepResult:
    step_index: int
    phase_id: str
    task_group_id: str
    title: str
    capability_id: str
    command_label: str
    outcome: str
    reason_code: str
    summary: str

    def to_payload(self) -> dict[str, object]:
        return {
            "step_index": self.step_index,
            "phase_id": self.phase_id,
            "task_group_id": self.task_group_id,
            "title": self.title,
            "capability_id": self.capability_id,
            "command_label": self.command_label,
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "summary": self.summary,
        }


@dataclass(frozen=True)
class AutonomyBundleRunState:
    bundle_id: str
    plan_id: str
    state: AutonomyBundleState
    started_at: str
    updated_at: str
    completed_steps: tuple[AutonomyBundleStepResult, ...]
    failed_step: AutonomyBundleStepResult | None
    stop_reason: str
    result_summary: str
    current_step_index: int
    current_step_title: str
    proposal: AutonomyBundleProposal

    def to_payload(self) -> dict[str, object]:
        return {
            "bundle_id": self.bundle_id,
            "plan_id": self.plan_id,
            "state": self.state,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "completed_steps": [step.to_payload() for step in self.completed_steps],
            "failed_step": self.failed_step.to_payload() if self.failed_step is not None else None,
            "stop_reason": self.stop_reason,
            "result_summary": self.result_summary,
            "current_step_index": self.current_step_index,
            "current_step_title": self.current_step_title,
            "proposal": self.proposal.to_payload(),
        }