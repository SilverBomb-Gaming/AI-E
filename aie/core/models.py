from __future__ import annotations

from dataclasses import asdict, dataclass
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
