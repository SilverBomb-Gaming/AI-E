"""In-memory workflow models for bounded multi-step operator tasks."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


WorkflowType = Literal["repo.explain", "file.explain", "web.summarize"]
WorkflowState = Literal[
    "pending",
    "running",
    "waiting_confirmation",
    "blocked",
    "failed",
    "completed",
    "cancelled",
]
WorkflowConfirmationState = Literal["none", "pending", "approved", "denied", "expired"]
WorkflowStepType = Literal["repo_status", "file_read", "web_fetch", "ask"]
WorkflowStepOutcome = Literal[
    "pending",
    "running",
    "success",
    "blocked",
    "failed",
    "confirmation_required",
    "cancelled",
    "expired",
    "invalid_request",
    "out_of_scope",
    "timed_out",
    "unavailable",
    "degraded",
]


@dataclass(frozen=True)
class WorkflowStep:
    step_id: str
    step_type: WorkflowStepType
    capability_id: str
    description: str
    input_summary: str
    context_input_ids: tuple[str, ...] = ()
    output_context_id: str = ""
    outcome: WorkflowStepOutcome = "pending"
    outcome_reason: str = ""
    started_at: str = ""
    finished_at: str = ""
    duration_ms: int = 0


@dataclass(frozen=True)
class WorkflowRecord:
    workflow_id: str
    workflow_type: WorkflowType
    name: str
    description: str
    created_at: str
    started_at: str = ""
    finished_at: str = ""
    current_state: WorkflowState = "pending"
    current_step_index: int = 0
    total_steps: int = 0
    steps: tuple[WorkflowStep, ...] = ()
    step_outcomes: tuple[str, ...] = ()
    user_id: str = ""
    chat_id: str = ""
    confirmation_state: WorkflowConfirmationState = "none"
    audit_summary: str = ""
    final_user_facing_summary: str = ""
    metadata: dict[str, str] = field(default_factory=dict)
