"""Structured state for the bounded autonomous development loop."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


AutonomousDevStepName = Literal[
    "coding_plan",
    "feature_apply",
    "validation",
    "commit_prepare",
    "commit_execute",
    "push_execute",
    "pr_preview",
]
AutonomousDevStepStatus = Literal[
    "pending",
    "completed",
    "awaiting_confirmation",
    "blocked",
    "stopped",
]
AutonomousDevChainStatus = Literal[
    "chain_ready",
    "awaiting_confirmation",
    "blocked",
    "completed",
    "stopped",
]
AutonomousDevPlanningKind = Literal["planned", "refused", "needs_clarification", "not_applicable"]


@dataclass(frozen=True)
class AutonomousDevStepRecord:
    name: AutonomousDevStepName
    status: AutonomousDevStepStatus
    prerequisites: tuple[str, ...]
    confirmation_required: bool
    result_summary: str = ""
    outcome_code: str = ""
    next_step_eligible: bool = False

    def to_payload(self) -> dict[str, object]:
        return {
            "name": self.name,
            "status": self.status,
            "prerequisites": list(self.prerequisites),
            "confirmation_required": self.confirmation_required,
            "result_summary": self.result_summary,
            "outcome_code": self.outcome_code,
            "next_step_eligible": self.next_step_eligible,
        }


@dataclass(frozen=True)
class AutonomousDevChainRecord:
    chain_id: str
    originating_request: str
    feature_request: str
    feature_title: str
    bundle_id: str
    status: AutonomousDevChainStatus
    current_step: AutonomousDevStepName
    completed_steps: tuple[AutonomousDevStepName, ...]
    blocked_reason: str
    final_outcome: str
    created_at: str
    updated_at: str
    steps: tuple[AutonomousDevStepRecord, ...]
    latest_summary: str = ""
    latest_commit_sha: str = ""
    latest_branch: str = ""
    latest_pr_title: str = ""
    stop_reason: str = ""

    def step(self, name: AutonomousDevStepName) -> AutonomousDevStepRecord | None:
        for step in self.steps:
            if step.name == name:
                return step
        return None

    def to_payload(self) -> dict[str, object]:
        return {
            "chain_id": self.chain_id,
            "originating_request": self.originating_request,
            "feature_request": self.feature_request,
            "feature_title": self.feature_title,
            "bundle_id": self.bundle_id,
            "status": self.status,
            "current_step": self.current_step,
            "completed_steps": list(self.completed_steps),
            "blocked_reason": self.blocked_reason,
            "final_outcome": self.final_outcome,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "steps": [step.to_payload() for step in self.steps],
            "latest_summary": self.latest_summary,
            "latest_commit_sha": self.latest_commit_sha,
            "latest_branch": self.latest_branch,
            "latest_pr_title": self.latest_pr_title,
            "stop_reason": self.stop_reason,
        }


@dataclass(frozen=True)
class AutonomousDevPlanningDecision:
    kind: AutonomousDevPlanningKind
    cleaned_prompt: str = ""
    refusal_reason: str = ""
    clarification_question: str = ""
    next_step: str = ""


@dataclass(frozen=True)
class AutonomousDevAdvanceDecision:
    matched: bool
    chain: AutonomousDevChainRecord | None = None
    routed_command: str = ""
    current_step: str = ""
    reply: str = ""
    summary: str = ""
    telemetry: dict[str, object] | None = None


@dataclass(frozen=True)
class AutonomousDevValidationResult:
    outcome: Literal["success", "failed", "timed_out"]
    summary: str
    first_issue: str = ""