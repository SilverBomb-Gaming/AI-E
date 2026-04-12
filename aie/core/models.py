from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any, Literal


TaskStepType = Literal[
    "analyze",
    "scaffold",
    "implement",
    "validate",
    "document",
    "prepare_commit",
    "request_review",
    "request_playtest",
]
TaskStepStatus = Literal["planned"]
TaskChainStatus = Literal["execution_ready", "draft_supervised", "blocked"]
RepoImpactLevel = Literal["none", "low", "medium", "high"]
ExecutionRiskLevel = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class IntentSpec:
    raw_request: str
    goal: str | None = None
    engine_target: str | None = None
    platform_target: str | None = None
    scope: str | None = None
    features: tuple[str, ...] = ()
    tone: str | None = None
    constraints: tuple[str, ...] = ()
    missing_fields: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ConstraintReport:
    supported: bool
    engine_target: str | None = None
    warnings: tuple[str, ...] = ()
    blocked_actions: tuple[str, ...] = ()
    ambiguities: tuple[str, ...] = ()
    missing_inputs: tuple[str, ...] = ()
    guardrail_notes: tuple[str, ...] = ()
    status: str = "bounded_draft_only"
    implementation_allowed: bool = False
    scaffold_only: bool = True
    confirmation_required: bool = False
    playtest_required: bool = False
    human_review_required: bool = False
    commit_preparation_allowed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ExecutionPlan:
    status: str
    summary: str
    bounded: bool
    engine_target: str | None = None
    tasks: tuple[dict[str, Any], ...] = ()
    file_operations: tuple[dict[str, Any], ...] = ()
    verification_steps: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    codex_handoff_ready: bool = False
    limitations: tuple[str, ...] = ()
    open_assumptions: tuple[str, ...] = ()
    blocked_items: tuple[str, ...] = ()
    implementation_allowed: bool = False
    scaffold_only: bool = True
    confirmation_required: bool = False
    playtest_required: bool = False
    human_review_required: bool = False
    commit_preparation_allowed: bool = False
    task_chain_ready: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TaskStep:
    step_id: str
    step_type: TaskStepType
    title: str
    purpose: str
    target_area: str
    engine_context: str | None = None
    repo_impact_level: RepoImpactLevel = "none"
    risk_level: ExecutionRiskLevel = "low"
    requires_confirmation: bool = False
    requires_playtest: bool = False
    requires_human_review: bool = False
    depends_on: tuple[str, ...] = ()
    suggested_outputs: tuple[str, ...] = ()
    boundedness_notes: tuple[str, ...] = ()
    status: TaskStepStatus = "planned"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TaskChain:
    chain_id: str
    status: TaskChainStatus
    summary: str
    bounded: bool
    engine_target: str | None = None
    steps: tuple[TaskStep, ...] = ()
    open_assumptions: tuple[str, ...] = ()
    blocked_items: tuple[str, ...] = ()
    confirmation_requirements: tuple[str, ...] = ()
    playtest_required: bool = False
    human_review_required: bool = False
    codex_handoff_ready: bool = False
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["steps"] = [step.to_dict() for step in self.steps]
        return payload


@dataclass(frozen=True)
class ConstraintRouterHandoff:
    intent: IntentSpec
    constraints: ConstraintReport
    plan: ExecutionPlan
    task_chain: TaskChain
    adapter_guidance: tuple[str, ...] = ()
    open_assumptions: tuple[str, ...] = ()
    blocked_items: tuple[str, ...] = ()
    confirmation_requirements: tuple[str, ...] = ()
    requires_playtest: bool = False
    requires_human_review: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent.to_dict(),
            "constraints": self.constraints.to_dict(),
            "plan": self.plan.to_dict(),
            "task_chain": self.task_chain.to_dict(),
            "adapter_guidance": list(self.adapter_guidance),
            "open_assumptions": list(self.open_assumptions),
            "blocked_items": list(self.blocked_items),
            "confirmation_requirements": list(self.confirmation_requirements),
            "requires_playtest": self.requires_playtest,
            "requires_human_review": self.requires_human_review,
        }


class ExecutorStatus(str, Enum):
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    BLOCKED = "blocked"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    AWAITING_REVIEW = "awaiting_review"
    AWAITING_PLAYTEST = "awaiting_playtest"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


class StopReason(str, Enum):
    DEPENDENCY_INCOMPLETE = "dependency_incomplete"
    CONFIRMATION_REQUIRED = "confirmation_required"
    REVIEW_REQUIRED = "review_required"
    PLAYTEST_REQUIRED = "playtest_required"
    BLOCKED_BY_POLICY = "blocked_by_policy"
    BLOCKED_BY_ASSUMPTION = "blocked_by_assumption"
    UNSUPPORTED_STEP_TYPE = "unsupported_step_type"
    EXECUTION_ERROR = "execution_error"


class TaskStepExecutionStatus(str, Enum):
    COMPLETED = "completed"
    BLOCKED = "blocked"
    AWAITING_HUMAN = "awaiting_human"
    DEFERRED = "deferred"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


@dataclass(frozen=True)
class TaskStepRun:
    step_id: str
    step_type: str
    status: TaskStepExecutionStatus
    stop_reason: StopReason | None = None
    notes: tuple[str, ...] = ()
    human_action_required: str | None = None
    depends_on_satisfied: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_id": self.step_id,
            "step_type": self.step_type,
            "status": self.status.value,
            "stop_reason": self.stop_reason.value if self.stop_reason else None,
            "notes": list(self.notes),
            "human_action_required": self.human_action_required,
            "depends_on_satisfied": self.depends_on_satisfied,
        }


@dataclass(frozen=True)
class TaskExecutionResult:
    status: ExecutorStatus
    completed_step_ids: tuple[str, ...] = ()
    blocked_step_ids: tuple[str, ...] = ()
    deferred_step_ids: tuple[str, ...] = ()
    step_runs: tuple[TaskStepRun, ...] = ()
    next_human_action: str | None = None
    stop_reason: StopReason | None = None
    blocked_step_id: str | None = None
    summary_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "completed_step_ids": list(self.completed_step_ids),
            "blocked_step_ids": list(self.blocked_step_ids),
            "deferred_step_ids": list(self.deferred_step_ids),
            "step_runs": [step_run.to_dict() for step_run in self.step_runs],
            "next_human_action": self.next_human_action,
            "stop_reason": self.stop_reason.value if self.stop_reason else None,
            "blocked_step_id": self.blocked_step_id,
            "summary_notes": list(self.summary_notes),
        }


class ResumeEligibility(str, Enum):
    RESUMABLE = "resumable"
    NOT_RESUMABLE = "not_resumable"


class ResumeReason(str, Enum):
    CONFIRMATION_CLEARED = "confirmation_cleared"
    REVIEW_CLEARED = "review_cleared"
    PLAYTEST_CLEARED = "playtest_cleared"
    PRIOR_PARTIAL_COMPLETION = "prior_partial_completion"
    INVALID_RESUME_REQUEST = "invalid_resume_request"
    BLOCKER_UNRESOLVED = "blocker_unresolved"
    UNSUPPORTED_PRIOR_STOP = "unsupported_prior_stop"
    INCONSISTENT_PRIOR_STATE = "inconsistent_prior_state"


class ReentryStatus(str, Enum):
    RESUMABLE = "resumable"
    NOT_RESUMABLE = "not_resumable"
    RESUMED = "resumed"
    FAILED = "failed"


@dataclass(frozen=True)
class ResumeRequest:
    prior_executor_status: ExecutorStatus
    stop_reason: StopReason | None = None
    blocked_step_id: str | None = None
    human_action_cleared: bool = False
    confirmation_cleared: bool = False
    review_cleared: bool = False
    playtest_cleared: bool = False

    @classmethod
    def from_execution_result(
        cls,
        execution_result: TaskExecutionResult,
        *,
        human_action_cleared: bool = False,
        confirmation_cleared: bool = False,
        review_cleared: bool = False,
        playtest_cleared: bool = False,
    ) -> "ResumeRequest":
        return cls(
            prior_executor_status=execution_result.status,
            stop_reason=execution_result.stop_reason,
            blocked_step_id=execution_result.blocked_step_id,
            human_action_cleared=human_action_cleared,
            confirmation_cleared=confirmation_cleared,
            review_cleared=review_cleared,
            playtest_cleared=playtest_cleared,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "prior_executor_status": self.prior_executor_status.value,
            "stop_reason": self.stop_reason.value if self.stop_reason else None,
            "blocked_step_id": self.blocked_step_id,
            "human_action_cleared": self.human_action_cleared,
            "confirmation_cleared": self.confirmation_cleared,
            "review_cleared": self.review_cleared,
            "playtest_cleared": self.playtest_cleared,
        }


@dataclass(frozen=True)
class ResumeDecision:
    eligibility: ResumeEligibility
    reason: ResumeReason
    prior_executor_status: ExecutorStatus
    stop_reason: StopReason | None = None
    blocked_step_id: str | None = None
    next_resumable_step_id: str | None = None
    human_action_cleared: bool = False
    confirmation_cleared: bool = False
    review_cleared: bool = False
    playtest_cleared: bool = False
    resume_allowed: bool = False
    resume_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "eligibility": self.eligibility.value,
            "reason": self.reason.value,
            "prior_executor_status": self.prior_executor_status.value,
            "stop_reason": self.stop_reason.value if self.stop_reason else None,
            "blocked_step_id": self.blocked_step_id,
            "next_resumable_step_id": self.next_resumable_step_id,
            "human_action_cleared": self.human_action_cleared,
            "confirmation_cleared": self.confirmation_cleared,
            "review_cleared": self.review_cleared,
            "playtest_cleared": self.playtest_cleared,
            "resume_allowed": self.resume_allowed,
            "resume_notes": list(self.resume_notes),
        }


@dataclass(frozen=True)
class ResumeResult:
    status: ReentryStatus
    decision: ResumeDecision
    execution_result: TaskExecutionResult | None = None
    resume_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "decision": self.decision.to_dict(),
            "execution_result": self.execution_result.to_dict() if self.execution_result else None,
            "resume_notes": list(self.resume_notes),
        }


class LifecycleState(str, Enum):
    READY_TO_EXECUTE = "ready_to_execute"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    AWAITING_REVIEW = "awaiting_review"
    AWAITING_PLAYTEST = "awaiting_playtest"
    RESUMABLE = "resumable"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    FAILED = "failed"
    INVALID_REQUEST = "invalid_request"


class OrchestrationStatus(str, Enum):
    READY_TO_EXECUTE = "ready_to_execute"
    EXECUTING = "executing"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    AWAITING_REVIEW = "awaiting_review"
    AWAITING_PLAYTEST = "awaiting_playtest"
    RESUMABLE = "resumable"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    FAILED = "failed"
    INVALID_REQUEST = "invalid_request"


class OrchestrationAction(str, Enum):
    EXECUTE = "execute"
    RESUME = "resume"
    WAIT = "wait"
    STOP = "stop"
    REJECT = "reject"


@dataclass(frozen=True)
class OrchestrationRequest:
    handoff: ConstraintRouterHandoff | None = None
    prior_execution_result: TaskExecutionResult | None = None
    resume_request: ResumeRequest | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "handoff": self.handoff.to_dict() if self.handoff else None,
            "prior_execution_result": self.prior_execution_result.to_dict() if self.prior_execution_result else None,
            "resume_request": self.resume_request.to_dict() if self.resume_request else None,
        }


@dataclass(frozen=True)
class OrchestrationDecision:
    lifecycle_state: LifecycleState
    chosen_action: OrchestrationAction
    prior_executor_status: ExecutorStatus | None = None
    resume_allowed: bool = False
    required_human_action: str | None = None
    orchestration_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "lifecycle_state": self.lifecycle_state.value,
            "chosen_action": self.chosen_action.value,
            "prior_executor_status": self.prior_executor_status.value if self.prior_executor_status else None,
            "resume_allowed": self.resume_allowed,
            "required_human_action": self.required_human_action,
            "orchestration_notes": list(self.orchestration_notes),
        }


@dataclass(frozen=True)
class OrchestrationResult:
    status: OrchestrationStatus
    decision: OrchestrationDecision
    execution_result: TaskExecutionResult | None = None
    resume_result: ResumeResult | None = None
    final_executor_status: ExecutorStatus | None = None
    orchestration_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "decision": self.decision.to_dict(),
            "execution_result": self.execution_result.to_dict() if self.execution_result else None,
            "resume_result": self.resume_result.to_dict() if self.resume_result else None,
            "final_executor_status": self.final_executor_status.value if self.final_executor_status else None,
            "orchestration_notes": list(self.orchestration_notes),
        }
