from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum, IntEnum
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


class PersistenceStatus(str, Enum):
    SAVED = "saved"
    LOADED = "loaded"
    INVALID = "invalid"
    VERSION_MISMATCH = "version_mismatch"
    FAILED = "failed"


class PersistenceRecordVersion(IntEnum):
    V1 = 1


@dataclass(frozen=True)
class PersistedLifecycleSnapshot:
    last_lifecycle_state: LifecycleState
    last_required_human_action: str | None = None
    final_executor_status: ExecutorStatus | None = None
    stop_reason: StopReason | None = None
    blocked_step_id: str | None = None
    resumable_state_present: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "last_lifecycle_state": self.last_lifecycle_state.value,
            "last_required_human_action": self.last_required_human_action,
            "final_executor_status": self.final_executor_status.value if self.final_executor_status else None,
            "stop_reason": self.stop_reason.value if self.stop_reason else None,
            "blocked_step_id": self.blocked_step_id,
            "resumable_state_present": self.resumable_state_present,
        }


@dataclass(frozen=True)
class PersistedExecutionSession:
    session_id: str
    schema_version: int
    saved_at: str
    router_handoff: ConstraintRouterHandoff
    orchestration_result: OrchestrationResult
    task_execution_result: TaskExecutionResult
    lifecycle_snapshot: PersistedLifecycleSnapshot
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "schema_version": self.schema_version,
            "saved_at": self.saved_at,
            "router_handoff": self.router_handoff.to_dict(),
            "orchestration_result": self.orchestration_result.to_dict(),
            "task_execution_result": self.task_execution_result.to_dict(),
            "lifecycle_snapshot": self.lifecycle_snapshot.to_dict(),
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class SaveResult:
    status: PersistenceStatus
    path: str | None = None
    session_id: str | None = None
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "path": self.path,
            "session_id": self.session_id,
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class LoadResult:
    status: PersistenceStatus
    path: str | None = None
    session: PersistedExecutionSession | None = None
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "path": self.path,
            "session": self.session.to_dict() if self.session else None,
            "notes": list(self.notes),
        }


class MultiTaskSessionStatus(str, Enum):
    READY = "ready"
    WAITING = "waiting"
    RESUMABLE = "resumable"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    FAILED = "failed"
    INVALID = "invalid"


class MultiTaskPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class MultiTaskAction(str, Enum):
    REGISTER_SESSION = "register_session"
    INSPECT_SESSIONS = "inspect_sessions"
    SELECT_NEXT_SESSION = "select_next_session"
    EXECUTE_SELECTED = "execute_selected"
    RESUME_SELECTED = "resume_selected"
    WAIT = "wait"
    STOP = "stop"
    REJECT = "reject"


class SessionSelectionReason(str, Enum):
    HIGHEST_PRIORITY_RESUMABLE = "highest_priority_resumable"
    HIGHEST_PRIORITY_READY = "highest_priority_ready"
    STABLE_TIEBREAKER = "stable_tiebreaker"
    EXPLICIT_SELECTION = "explicit_selection"
    NO_ACTIONABLE_SESSIONS = "no_actionable_sessions"
    INVALID_SELECTION = "invalid_selection"


class DependencyStatus(str, Enum):
    NO_DEPENDENCIES = "no_dependencies"
    DEPENDENCY_READY = "dependency_ready"
    BLOCKED_BY_DEPENDENCY = "blocked_by_dependency"
    INVALID_DEPENDENCY = "invalid_dependency"
    DEPENDENCY_COMPLETED = "dependency_completed"


class DependencyBlockReason(str, Enum):
    PREREQUISITE_NOT_COMPLETED = "prerequisite_not_completed"
    PREREQUISITE_FAILED = "prerequisite_failed"
    PREREQUISITE_BLOCKED = "prerequisite_blocked"
    MISSING_PREREQUISITE_SESSION = "missing_prerequisite_session"
    CYCLIC_DEPENDENCY = "cyclic_dependency"
    INVALID_DEPENDENCY_REFERENCE = "invalid_dependency_reference"


@dataclass(frozen=True)
class SessionDependency:
    session_id: str
    prerequisite_session_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "prerequisite_session_id": self.prerequisite_session_id,
        }


@dataclass(frozen=True)
class DependencyGraphRecord:
    session_id: str
    prerequisite_session_ids: tuple[str, ...] = ()
    dependent_session_ids: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "prerequisite_session_ids": list(self.prerequisite_session_ids),
            "dependent_session_ids": list(self.dependent_session_ids),
        }


@dataclass(frozen=True)
class DependencyEvaluationResult:
    session_id: str
    dependency_status: DependencyStatus
    block_reasons: tuple[DependencyBlockReason, ...] = ()
    blocked_by_session_ids: tuple[str, ...] = ()
    dependency_notes: tuple[str, ...] = ()
    dependency_ready: bool = False
    invalid_dependency: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "dependency_status": self.dependency_status.value,
            "block_reasons": [reason.value for reason in self.block_reasons],
            "blocked_by_session_ids": list(self.blocked_by_session_ids),
            "dependency_notes": list(self.dependency_notes),
            "dependency_ready": self.dependency_ready,
            "invalid_dependency": self.invalid_dependency,
        }


@dataclass(frozen=True)
class MultiTaskSessionRecord:
    session_id: str
    priority: MultiTaskPriority
    lifecycle_state: LifecycleState
    session_status: MultiTaskSessionStatus
    last_executor_status: ExecutorStatus | None = None
    required_human_action: str | None = None
    resumable: bool = False
    blocked: bool = False
    last_updated: str = ""
    router_handoff: ConstraintRouterHandoff | None = None
    prior_execution_result: TaskExecutionResult | None = None
    orchestration_result: OrchestrationResult | None = None
    persisted_session: PersistedExecutionSession | None = None
    resume_request: ResumeRequest | None = None
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "priority": self.priority.value,
            "lifecycle_state": self.lifecycle_state.value,
            "session_status": self.session_status.value,
            "last_executor_status": self.last_executor_status.value if self.last_executor_status else None,
            "required_human_action": self.required_human_action,
            "resumable": self.resumable,
            "blocked": self.blocked,
            "last_updated": self.last_updated,
            "router_handoff": self.router_handoff.to_dict() if self.router_handoff else None,
            "prior_execution_result": self.prior_execution_result.to_dict() if self.prior_execution_result else None,
            "orchestration_result": self.orchestration_result.to_dict() if self.orchestration_result else None,
            "persisted_session": self.persisted_session.to_dict() if self.persisted_session else None,
            "resume_request": self.resume_request.to_dict() if self.resume_request else None,
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class DependencyAwareSessionRecord:
    base_record: MultiTaskSessionRecord
    prerequisite_session_ids: tuple[str, ...] = ()
    dependent_session_ids: tuple[str, ...] = ()
    dependency_status: DependencyStatus = DependencyStatus.NO_DEPENDENCIES
    dependency_block_reasons: tuple[DependencyBlockReason, ...] = ()
    blocked_by_session_ids: tuple[str, ...] = ()
    dependency_notes: tuple[str, ...] = ()
    dependency_ready: bool = False
    invalid_dependency: bool = False
    effective_session_status: MultiTaskSessionStatus = MultiTaskSessionStatus.INVALID

    @property
    def session_id(self) -> str:
        return self.base_record.session_id

    @property
    def priority(self) -> MultiTaskPriority:
        return self.base_record.priority

    @property
    def lifecycle_state(self) -> LifecycleState:
        return self.base_record.lifecycle_state

    @property
    def base_session_status(self) -> MultiTaskSessionStatus:
        return self.base_record.session_status

    @property
    def session_status(self) -> MultiTaskSessionStatus:
        return self.effective_session_status

    @property
    def last_executor_status(self) -> ExecutorStatus | None:
        return self.base_record.last_executor_status

    @property
    def required_human_action(self) -> str | None:
        return self.base_record.required_human_action

    @property
    def resumable(self) -> bool:
        return self.base_record.resumable

    @property
    def blocked(self) -> bool:
        return self.session_status == MultiTaskSessionStatus.BLOCKED

    @property
    def last_updated(self) -> str:
        return self.base_record.last_updated

    @property
    def router_handoff(self) -> ConstraintRouterHandoff | None:
        return self.base_record.router_handoff

    @property
    def prior_execution_result(self) -> TaskExecutionResult | None:
        return self.base_record.prior_execution_result

    @property
    def orchestration_result(self) -> OrchestrationResult | None:
        return self.base_record.orchestration_result

    @property
    def persisted_session(self) -> PersistedExecutionSession | None:
        return self.base_record.persisted_session

    @property
    def resume_request(self) -> ResumeRequest | None:
        return self.base_record.resume_request

    @property
    def notes(self) -> tuple[str, ...]:
        return self.base_record.notes

    def to_dict(self) -> dict[str, Any]:
        payload = self.base_record.to_dict()
        payload.update(
            {
                "base_session_status": self.base_session_status.value,
                "session_status": self.session_status.value,
                "prerequisite_session_ids": list(self.prerequisite_session_ids),
                "dependent_session_ids": list(self.dependent_session_ids),
                "dependency_status": self.dependency_status.value,
                "dependency_block_reasons": [reason.value for reason in self.dependency_block_reasons],
                "blocked_by_session_ids": list(self.blocked_by_session_ids),
                "dependency_notes": list(self.dependency_notes),
                "dependency_ready": self.dependency_ready,
                "invalid_dependency": self.invalid_dependency,
            }
        )
        return payload


@dataclass(frozen=True)
class MultiTaskOrchestrationRequest:
    requested_action: MultiTaskAction = MultiTaskAction.INSPECT_SESSIONS
    session_registry: tuple[MultiTaskSessionRecord, ...] = ()
    sessions_to_register: tuple[MultiTaskSessionRecord, ...] = ()
    dependency_graph: tuple[SessionDependency, ...] = ()
    dependencies_to_register: tuple[SessionDependency, ...] = ()
    selected_session_id: str | None = None
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "requested_action": self.requested_action.value,
            "session_registry": [record.to_dict() for record in self.session_registry],
            "sessions_to_register": [record.to_dict() for record in self.sessions_to_register],
            "dependency_graph": [dependency.to_dict() for dependency in self.dependency_graph],
            "dependencies_to_register": [dependency.to_dict() for dependency in self.dependencies_to_register],
            "selected_session_id": self.selected_session_id,
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class MultiTaskDecision:
    chosen_action: MultiTaskAction
    selected_session_id: str | None = None
    selection_reason: SessionSelectionReason = SessionSelectionReason.NO_ACTIONABLE_SESSIONS
    actionable_session_ids: tuple[str, ...] = ()
    waiting_session_ids: tuple[str, ...] = ()
    blocked_session_ids: tuple[str, ...] = ()
    completed_session_ids: tuple[str, ...] = ()
    invalid_session_ids: tuple[str, ...] = ()
    dependency_blocked_session_ids: tuple[str, ...] = ()
    invalid_dependency_session_ids: tuple[str, ...] = ()
    decision_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "chosen_action": self.chosen_action.value,
            "selected_session_id": self.selected_session_id,
            "selection_reason": self.selection_reason.value,
            "actionable_session_ids": list(self.actionable_session_ids),
            "waiting_session_ids": list(self.waiting_session_ids),
            "blocked_session_ids": list(self.blocked_session_ids),
            "completed_session_ids": list(self.completed_session_ids),
            "invalid_session_ids": list(self.invalid_session_ids),
            "dependency_blocked_session_ids": list(self.dependency_blocked_session_ids),
            "invalid_dependency_session_ids": list(self.invalid_dependency_session_ids),
            "decision_notes": list(self.decision_notes),
        }


@dataclass(frozen=True)
class MultiTaskOrchestrationResult:
    decision: MultiTaskDecision
    session_registry: tuple[MultiTaskSessionRecord, ...]
    selected_session_result: OrchestrationResult | None = None
    registered_session_ids: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.to_dict(),
            "session_registry": [record.to_dict() for record in self.session_registry],
            "selected_session_result": self.selected_session_result.to_dict() if self.selected_session_result else None,
            "registered_session_ids": list(self.registered_session_ids),
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class DependencyAwareMultiTaskResult:
    decision: MultiTaskDecision
    session_registry: tuple[DependencyAwareSessionRecord, ...]
    dependency_graph: tuple[DependencyGraphRecord, ...] = ()
    selected_session_result: OrchestrationResult | None = None
    registered_session_ids: tuple[str, ...] = ()
    registered_dependencies: tuple[SessionDependency, ...] = ()
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.to_dict(),
            "session_registry": [record.to_dict() for record in self.session_registry],
            "dependency_graph": [record.to_dict() for record in self.dependency_graph],
            "selected_session_result": self.selected_session_result.to_dict() if self.selected_session_result else None,
            "registered_session_ids": list(self.registered_session_ids),
            "registered_dependencies": [dependency.to_dict() for dependency in self.registered_dependencies],
            "notes": list(self.notes),
        }
