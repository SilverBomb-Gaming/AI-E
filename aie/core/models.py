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


class ArtifactType(str, Enum):
    DESIGN_SPEC = "design_spec"
    BALANCE_DATA = "balance_data"
    TEXT_NOTE = "text_note"
    TEST_REPORT = "test_report"
    VALIDATION_REPORT = "validation_report"
    IMPLEMENTATION_PATCH = "implementation_patch"
    ASSET_REFERENCE = "asset_reference"


class ArtifactStatus(str, Enum):
    PRODUCED = "produced"
    MISSING = "missing"
    INVALID = "invalid"
    SUPERSEDED = "superseded"


class ArtifactRequirementStatus(str, Enum):
    NO_REQUIREMENTS = "no_requirements"
    REQUIREMENTS_SATISFIED = "requirements_satisfied"
    BLOCKED_BY_MISSING_ARTIFACT = "blocked_by_missing_artifact"
    BLOCKED_BY_INVALID_ARTIFACT = "blocked_by_invalid_artifact"
    INVALID_REQUIREMENT_REFERENCE = "invalid_requirement_reference"


class ArtifactBlockReason(str, Enum):
    MISSING_REQUIRED_ARTIFACT = "missing_required_artifact"
    INVALID_ARTIFACT_REFERENCE = "invalid_artifact_reference"
    INCOMPATIBLE_ARTIFACT_TYPE = "incompatible_artifact_type"
    ARTIFACT_NOT_PRODUCED = "artifact_not_produced"
    ARTIFACT_FROM_UNKNOWN_SESSION = "artifact_from_unknown_session"


@dataclass(frozen=True)
class SessionArtifact:
    artifact_id: str
    producer_session_id: str
    artifact_name: str
    artifact_type: ArtifactType
    artifact_status: ArtifactStatus = ArtifactStatus.PRODUCED
    artifact_metadata: dict[str, Any] | None = None
    artifact_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "producer_session_id": self.producer_session_id,
            "artifact_name": self.artifact_name,
            "artifact_type": self.artifact_type.value,
            "artifact_status": self.artifact_status.value,
            "artifact_metadata": dict(self.artifact_metadata or {}),
            "artifact_notes": list(self.artifact_notes),
        }


@dataclass(frozen=True)
class ArtifactRequirement:
    consumer_session_id: str
    producer_session_id: str
    required_artifact_name: str
    required_artifact_type: ArtifactType
    artifact_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "consumer_session_id": self.consumer_session_id,
            "producer_session_id": self.producer_session_id,
            "required_artifact_name": self.required_artifact_name,
            "required_artifact_type": self.required_artifact_type.value,
            "artifact_notes": list(self.artifact_notes),
        }


@dataclass(frozen=True)
class SessionArtifactRegistryRecord:
    session_id: str
    produced_artifacts: tuple[SessionArtifact, ...] = ()
    required_artifacts: tuple[ArtifactRequirement, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "produced_artifacts": [artifact.to_dict() for artifact in self.produced_artifacts],
            "required_artifacts": [artifact.to_dict() for artifact in self.required_artifacts],
        }


@dataclass(frozen=True)
class ArtifactRequirementEvaluationResult:
    session_id: str
    requirement_status: ArtifactRequirementStatus
    block_reasons: tuple[ArtifactBlockReason, ...] = ()
    blocked_by_artifact_ids: tuple[str, ...] = ()
    artifact_notes: tuple[str, ...] = ()
    artifact_ready: bool = False
    invalid_requirement_reference: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "requirement_status": self.requirement_status.value,
            "block_reasons": [reason.value for reason in self.block_reasons],
            "blocked_by_artifact_ids": list(self.blocked_by_artifact_ids),
            "artifact_notes": list(self.artifact_notes),
            "artifact_ready": self.artifact_ready,
            "invalid_requirement_reference": self.invalid_requirement_reference,
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
class ArtifactAwareSessionRecord:
    base_record: DependencyAwareSessionRecord
    produced_artifacts: tuple[SessionArtifact, ...] = ()
    required_artifacts: tuple[ArtifactRequirement, ...] = ()
    requirement_status: ArtifactRequirementStatus = ArtifactRequirementStatus.NO_REQUIREMENTS
    artifact_block_reasons: tuple[ArtifactBlockReason, ...] = ()
    blocked_by_artifact_ids: tuple[str, ...] = ()
    artifact_notes: tuple[str, ...] = ()
    artifact_ready: bool = False
    invalid_requirement_reference: bool = False
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
    def dependency_status(self) -> DependencyStatus:
        return self.base_record.dependency_status

    @property
    def dependency_block_reasons(self) -> tuple[DependencyBlockReason, ...]:
        return self.base_record.dependency_block_reasons

    @property
    def blocked_by_session_ids(self) -> tuple[str, ...]:
        return self.base_record.blocked_by_session_ids

    @property
    def prerequisite_session_ids(self) -> tuple[str, ...]:
        return self.base_record.prerequisite_session_ids

    @property
    def dependent_session_ids(self) -> tuple[str, ...]:
        return self.base_record.dependent_session_ids

    @property
    def dependency_notes(self) -> tuple[str, ...]:
        return self.base_record.dependency_notes

    @property
    def dependency_ready(self) -> bool:
        return self.base_record.dependency_ready

    @property
    def invalid_dependency(self) -> bool:
        return self.base_record.invalid_dependency

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
                "produced_artifacts": [artifact.to_dict() for artifact in self.produced_artifacts],
                "required_artifacts": [artifact.to_dict() for artifact in self.required_artifacts],
                "requirement_status": self.requirement_status.value,
                "artifact_block_reasons": [reason.value for reason in self.artifact_block_reasons],
                "blocked_by_artifact_ids": list(self.blocked_by_artifact_ids),
                "artifact_notes": list(self.artifact_notes),
                "artifact_ready": self.artifact_ready,
                "invalid_requirement_reference": self.invalid_requirement_reference,
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
    artifact_registry: tuple[SessionArtifact, ...] = ()
    artifacts_to_register: tuple[SessionArtifact, ...] = ()
    artifact_requirements: tuple[ArtifactRequirement, ...] = ()
    artifact_requirements_to_register: tuple[ArtifactRequirement, ...] = ()
    selected_session_id: str | None = None
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "requested_action": self.requested_action.value,
            "session_registry": [record.to_dict() for record in self.session_registry],
            "sessions_to_register": [record.to_dict() for record in self.sessions_to_register],
            "dependency_graph": [dependency.to_dict() for dependency in self.dependency_graph],
            "dependencies_to_register": [dependency.to_dict() for dependency in self.dependencies_to_register],
            "artifact_registry": [artifact.to_dict() for artifact in self.artifact_registry],
            "artifacts_to_register": [artifact.to_dict() for artifact in self.artifacts_to_register],
            "artifact_requirements": [artifact.to_dict() for artifact in self.artifact_requirements],
            "artifact_requirements_to_register": [artifact.to_dict() for artifact in self.artifact_requirements_to_register],
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
    artifact_blocked_session_ids: tuple[str, ...] = ()
    invalid_artifact_session_ids: tuple[str, ...] = ()
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
            "artifact_blocked_session_ids": list(self.artifact_blocked_session_ids),
            "invalid_artifact_session_ids": list(self.invalid_artifact_session_ids),
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


@dataclass(frozen=True)
class ArtifactAwareMultiTaskResult:
    decision: MultiTaskDecision
    session_registry: tuple[ArtifactAwareSessionRecord, ...]
    dependency_graph: tuple[DependencyGraphRecord, ...] = ()
    artifact_registry: tuple[SessionArtifactRegistryRecord, ...] = ()
    selected_session_result: OrchestrationResult | None = None
    registered_session_ids: tuple[str, ...] = ()
    registered_dependencies: tuple[SessionDependency, ...] = ()
    registered_artifacts: tuple[SessionArtifact, ...] = ()
    registered_artifact_requirements: tuple[ArtifactRequirement, ...] = ()
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.to_dict(),
            "session_registry": [record.to_dict() for record in self.session_registry],
            "dependency_graph": [record.to_dict() for record in self.dependency_graph],
            "artifact_registry": [record.to_dict() for record in self.artifact_registry],
            "selected_session_result": self.selected_session_result.to_dict() if self.selected_session_result else None,
            "registered_session_ids": list(self.registered_session_ids),
            "registered_dependencies": [dependency.to_dict() for dependency in self.registered_dependencies],
            "registered_artifacts": [artifact.to_dict() for artifact in self.registered_artifacts],
            "registered_artifact_requirements": [artifact.to_dict() for artifact in self.registered_artifact_requirements],
            "notes": list(self.notes),
        }


class LoopEngineStatus(str, Enum):
    RAN_ACTION = "ran_action"
    WAITING = "waiting"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"
    NO_ACTIONABLE_SESSIONS = "no_actionable_sessions"
    MAX_CYCLES_REACHED = "max_cycles_reached"
    INVALID_REQUEST = "invalid_request"


class LoopCycleAction(str, Enum):
    INSPECT = "inspect"
    EXECUTE_SELECTED = "execute_selected"
    RESUME_SELECTED = "resume_selected"
    PERSIST_STATE = "persist_state"
    WAIT = "wait"
    STOP = "stop"
    REJECT = "reject"


class LoopCycleReason(str, Enum):
    SELECTED_ACTIONABLE_SESSION = "selected_actionable_session"
    NO_ACTIONABLE_SESSIONS = "no_actionable_sessions"
    WAITING_ON_HUMAN_GATE = "waiting_on_human_gate"
    BLOCKED_BY_DEPENDENCY = "blocked_by_dependency"
    BLOCKED_BY_ARTIFACT = "blocked_by_artifact"
    PERSISTENCE_FAILED = "persistence_failed"
    EXECUTION_FAILED = "execution_failed"
    ALL_SESSIONS_COMPLETED = "all_sessions_completed"
    INVALID_STATE = "invalid_state"
    MAX_CYCLES_REACHED = "max_cycles_reached"


class LoopTerminationReason(str, Enum):
    NO_ACTIONABLE_SESSIONS = "no_actionable_sessions"
    HUMAN_GATE_REQUIRED = "human_gate_required"
    BLOCKED_BY_DEPENDENCIES = "blocked_by_dependencies"
    BLOCKED_BY_ARTIFACTS = "blocked_by_artifacts"
    COMPLETED_ALL_SESSIONS = "completed_all_sessions"
    MAX_CYCLES_REACHED = "max_cycles_reached"
    INVALID_STATE = "invalid_state"
    EXECUTION_ERROR = "execution_error"
    PERSISTENCE_FAILED = "persistence_failed"


@dataclass(frozen=True)
class LoopEngineRequest:
    session_registry: tuple[MultiTaskSessionRecord, ...] = ()
    dependency_graph: tuple[SessionDependency, ...] = ()
    artifact_registry: tuple[SessionArtifact, ...] = ()
    artifact_requirements: tuple[ArtifactRequirement, ...] = ()
    max_cycles: int = 1
    session_storage_directory: str | None = None
    session_file_paths: tuple[tuple[str, str], ...] = ()
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_registry": [record.to_dict() for record in self.session_registry],
            "dependency_graph": [dependency.to_dict() for dependency in self.dependency_graph],
            "artifact_registry": [artifact.to_dict() for artifact in self.artifact_registry],
            "artifact_requirements": [artifact.to_dict() for artifact in self.artifact_requirements],
            "max_cycles": self.max_cycles,
            "session_storage_directory": self.session_storage_directory,
            "session_file_paths": [
                {"session_id": session_id, "path": path}
                for session_id, path in self.session_file_paths
            ],
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class LoopCycleResult:
    cycle_index: int
    status: LoopEngineStatus
    selected_action: LoopCycleAction
    reason: LoopCycleReason
    selected_session_id: str | None = None
    lifecycle_state_before: LifecycleState | None = None
    lifecycle_state_after: LifecycleState | None = None
    persisted_after_cycle: bool = False
    persistence_results: tuple[SaveResult, ...] = ()
    cycle_notes: tuple[str, ...] = ()
    termination_reason: LoopTerminationReason | None = None
    actions_run_count: int = 0
    multi_task_result: ArtifactAwareMultiTaskResult | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "cycle_index": self.cycle_index,
            "status": self.status.value,
            "selected_action": self.selected_action.value,
            "reason": self.reason.value,
            "selected_session_id": self.selected_session_id,
            "lifecycle_state_before": self.lifecycle_state_before.value if self.lifecycle_state_before else None,
            "lifecycle_state_after": self.lifecycle_state_after.value if self.lifecycle_state_after else None,
            "persisted_after_cycle": self.persisted_after_cycle,
            "persistence_results": [result.to_dict() for result in self.persistence_results],
            "cycle_notes": list(self.cycle_notes),
            "termination_reason": self.termination_reason.value if self.termination_reason else None,
            "actions_run_count": self.actions_run_count,
            "multi_task_result": self.multi_task_result.to_dict() if self.multi_task_result else None,
        }


@dataclass(frozen=True)
class LoopEngineResult:
    status: LoopEngineStatus
    cycles: tuple[LoopCycleResult, ...]
    final_registry: tuple[ArtifactAwareSessionRecord, ...] = ()
    dependency_graph: tuple[DependencyGraphRecord, ...] = ()
    artifact_registry: tuple[SessionArtifactRegistryRecord, ...] = ()
    termination_reason: LoopTerminationReason | None = None
    actions_run_count: int = 0
    max_cycles: int = 1
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "cycles": [cycle.to_dict() for cycle in self.cycles],
            "final_registry": [record.to_dict() for record in self.final_registry],
            "dependency_graph": [record.to_dict() for record in self.dependency_graph],
            "artifact_registry": [record.to_dict() for record in self.artifact_registry],
            "termination_reason": self.termination_reason.value if self.termination_reason else None,
            "actions_run_count": self.actions_run_count,
            "max_cycles": self.max_cycles,
            "notes": list(self.notes),
        }
