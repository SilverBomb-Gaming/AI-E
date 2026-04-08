"""Plan bridge state and proposal models for controlled stepwise execution."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


PlanTaskGroupStatus = Literal["pending", "ready", "in_progress", "completed", "blocked", "failed", "cancelled"]
PlanStepState = Literal["idle", "proposed", "approved", "executing", "completed", "failed", "cancelled"]


@dataclass(frozen=True)
class PlanExecutionProposal:
    proposal_id: str
    plan_id: str
    phase_id: str
    task_group_id: str
    title: str
    rationale: str
    proposed_actions: tuple[str, ...]
    expected_outputs: tuple[str, ...]
    required_confirmations: tuple[str, ...]
    suggested_entry_command: str
    blockers: tuple[str, ...]
    target_capability_id: str
    command_label: str
    command_argument: str

    def to_payload(self) -> dict[str, object]:
        return {
            "proposal_id": self.proposal_id,
            "plan_id": self.plan_id,
            "phase_id": self.phase_id,
            "task_group_id": self.task_group_id,
            "title": self.title,
            "rationale": self.rationale,
            "proposed_actions": list(self.proposed_actions),
            "expected_outputs": list(self.expected_outputs),
            "required_confirmations": list(self.required_confirmations),
            "suggested_entry_command": self.suggested_entry_command,
            "blockers": list(self.blockers),
            "target_capability_id": self.target_capability_id,
            "command_label": self.command_label,
            "command_argument": self.command_argument,
        }


@dataclass(frozen=True)
class PlanTaskGroupProgress:
    phase_id: str
    task_group_id: str
    task_group_name: str
    status: PlanTaskGroupStatus
    execution_proposal: PlanExecutionProposal | None
    last_result_summary: str
    last_result_state: str

    def to_payload(self) -> dict[str, object]:
        return {
            "phase_id": self.phase_id,
            "task_group_id": self.task_group_id,
            "task_group_name": self.task_group_name,
            "status": self.status,
            "execution_proposal": self.execution_proposal.to_payload() if self.execution_proposal is not None else None,
            "last_result_summary": self.last_result_summary,
            "last_result_state": self.last_result_state,
        }


@dataclass(frozen=True)
class BuildExecutionBridgeState:
    active_plan_id: str
    current_phase_id: str
    current_task_group_id: str
    current_step_state: PlanStepState
    execution_proposal: PlanExecutionProposal | None
    task_group_progress: tuple[PlanTaskGroupProgress, ...]
    last_result_summary: str
    last_result_state: str

    def to_payload(self) -> dict[str, object]:
        return {
            "active_plan_id": self.active_plan_id,
            "current_phase_id": self.current_phase_id,
            "current_task_group_id": self.current_task_group_id,
            "current_step_state": self.current_step_state,
            "execution_proposal": self.execution_proposal.to_payload() if self.execution_proposal is not None else None,
            "task_group_progress": [item.to_payload() for item in self.task_group_progress],
            "last_result_summary": self.last_result_summary,
            "last_result_state": self.last_result_state,
        }