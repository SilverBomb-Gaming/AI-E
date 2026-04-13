from __future__ import annotations

from aie.core.autonomy_policy import AutonomyPolicy
from aie.core.models import (
    ArtifactRequirement,
    ArtifactStatus,
    ArtifactType,
    AutonomyActionType,
    AutonomyPolicyContext,
    AutonomyPolicyReason,
    AutonomyPolicyStatus,
    AwarenessRequest,
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    IntentSpec,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    PolicyGateRequirement,
    PolicyProfileName,
    SessionArtifact,
    SessionDependency,
    TaskChain,
    TaskStep,
)
from aie.core.multi_task_orchestrator import MultiTaskOrchestrator
from aie.core.policy_config import PolicyConfigLoader
from aie.core.system_awareness import SystemAwareness
from aie.core.task_chain_executor import TaskChainExecutor


def _step(
    step_id: str,
    step_type: str,
    *,
    depends_on: tuple[str, ...] = (),
    requires_confirmation: bool = False,
    requires_human_review: bool = False,
    requires_playtest: bool = False,
) -> TaskStep:
    return TaskStep(
        step_id=step_id,
        step_type=step_type,
        title=step_id.replace("-", " ").title(),
        purpose=f"Execute {step_id}.",
        target_area="bounded_slice",
        engine_context="unity",
        requires_confirmation=requires_confirmation,
        requires_human_review=requires_human_review,
        requires_playtest=requires_playtest,
        depends_on=depends_on,
    )


def _handoff(
    chain_id: str,
    steps: tuple[TaskStep, ...],
    *,
    plan_status: str = "supported_ready",
    chain_status: str = "execution_ready",
    scaffold_only: bool = False,
    implementation_allowed: bool = True,
    confirmation_required: bool = False,
    playtest_required: bool = False,
    human_review_required: bool = False,
    commit_preparation_allowed: bool = True,
    open_assumptions: tuple[str, ...] = (),
    blocked_items: tuple[str, ...] = (),
) -> ConstraintRouterHandoff:
    intent = IntentSpec(
        raw_request="Create a bounded Unity gameplay slice",
        goal="Create a bounded Unity gameplay slice",
        engine_target="unity",
        scope="gameplay_scaffold",
        features=("controller",),
    )
    report = ConstraintReport(
        supported=True,
        engine_target="unity",
        status=plan_status,
        implementation_allowed=implementation_allowed,
        scaffold_only=scaffold_only,
        confirmation_required=confirmation_required,
        playtest_required=playtest_required,
        human_review_required=human_review_required,
        commit_preparation_allowed=commit_preparation_allowed,
    )
    plan = ExecutionPlan(
        status=plan_status,
        summary="Bounded execution plan for autonomy policy tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep autonomy policy decisions deterministic.",),
        open_assumptions=open_assumptions,
        blocked_items=blocked_items,
        implementation_allowed=implementation_allowed,
        scaffold_only=scaffold_only,
        confirmation_required=confirmation_required,
        playtest_required=playtest_required,
        human_review_required=human_review_required,
        commit_preparation_allowed=commit_preparation_allowed,
        task_chain_ready=True,
    )
    task_chain = TaskChain(
        chain_id=chain_id,
        status=chain_status,
        summary="Autonomy policy test chain.",
        bounded=True,
        engine_target="unity",
        steps=steps,
        open_assumptions=open_assumptions,
        blocked_items=blocked_items,
        confirmation_requirements=("Operator confirmation is required.",) if confirmation_required else (),
        playtest_required=playtest_required,
        human_review_required=human_review_required,
        codex_handoff_ready=True,
    )
    return ConstraintRouterHandoff(
        intent=intent,
        constraints=report,
        plan=plan,
        task_chain=task_chain,
        open_assumptions=open_assumptions,
        blocked_items=blocked_items,
        confirmation_requirements=task_chain.confirmation_requirements,
        requires_playtest=playtest_required,
        requires_human_review=human_review_required,
    )


def _ready_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    priority: MultiTaskPriority,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-implement", "implement", depends_on=(f"{session_id}-analyze",)),
        ),
    )
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=priority,
        router_handoff=handoff,
        last_updated=last_updated,
    )


def _waiting_review_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    priority: MultiTaskPriority,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-request-review", "request_review", depends_on=(f"{session_id}-analyze",)),
            _step(
                f"{session_id}-implement",
                "implement",
                depends_on=(f"{session_id}-request-review",),
                requires_human_review=True,
            ),
        ),
        human_review_required=True,
    )
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=priority,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def _blocked_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-implement", "implement", depends_on=(f"{session_id}-analyze",)),
        ),
        plan_status="bounded_draft_only",
        chain_status="draft_supervised",
        open_assumptions=("Engine target still needs confirmation.",),
    )
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=MultiTaskPriority.NORMAL,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def _completed_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(session_id, (_step(f"{session_id}-analyze", "analyze"),))
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=MultiTaskPriority.LOW,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def _artifact(
    artifact_id: str,
    producer_session_id: str,
    artifact_name: str,
    artifact_type: ArtifactType,
    *,
    artifact_status: ArtifactStatus = ArtifactStatus.PRODUCED,
) -> SessionArtifact:
    return SessionArtifact(
        artifact_id=artifact_id,
        producer_session_id=producer_session_id,
        artifact_name=artifact_name,
        artifact_type=artifact_type,
        artifact_status=artifact_status,
        artifact_metadata={"source": producer_session_id},
    )


def _artifact_requirement(
    consumer_session_id: str,
    producer_session_id: str,
    artifact_name: str,
    artifact_type: ArtifactType,
) -> ArtifactRequirement:
    return ArtifactRequirement(
        consumer_session_id=consumer_session_id,
        producer_session_id=producer_session_id,
        required_artifact_name=artifact_name,
        required_artifact_type=artifact_type,
    )


def _build_awareness(
    orchestrator: MultiTaskOrchestrator,
    *,
    session_registry: tuple[MultiTaskSessionRecord, ...],
    dependency_graph: tuple[SessionDependency, ...] = (),
    artifact_registry: tuple[SessionArtifact, ...] = (),
    artifact_requirements: tuple[ArtifactRequirement, ...] = (),
    active_policy_profile=None,
):
    return SystemAwareness(orchestrator).build_awareness_result(
        AwarenessRequest(
            session_registry=session_registry,
            dependency_graph=dependency_graph,
            artifact_registry=artifact_registry,
            artifact_requirements=artifact_requirements,
            active_policy_profile=active_policy_profile,
        )
    )


def test_autonomy_policy_allows_inspect_only_actions() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(orchestrator, session_registry=(ready,))

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.INSPECT_ONLY,
            awareness_snapshot=awareness,
            operator_command_present=True,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.ALLOWED
    assert result.decision.reasons == (AutonomyPolicyReason.OPERATOR_COMMAND_PRESENT,)
    assert result.decision.operator_approval_required is False


def test_autonomy_policy_allows_supported_operator_command() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(orchestrator, session_registry=(ready,))

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.RUN_SINGLE_CYCLE,
            awareness_snapshot=awareness,
            operator_command_present=True,
            requested_max_cycles=1,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.ALLOWED
    assert result.decision.reasons == (AutonomyPolicyReason.OPERATOR_COMMAND_PRESENT,)


def test_autonomy_policy_allows_self_initiated_actionable_loop_advance() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(orchestrator, session_registry=(ready,))

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
            awareness_snapshot=awareness,
            requested_max_cycles=3,
            current_cycle_index=0,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.ALLOWED
    assert result.decision.reasons == (AutonomyPolicyReason.SELF_INITIATED_ACTION_ALLOWED,)


def test_autonomy_policy_requires_operator_approval_for_waiting_human_gate() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.NORMAL,
        last_updated="2026-04-12T10:05:00+00:00",
    )
    awareness = _build_awareness(orchestrator, session_registry=(waiting,))

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
            awareness_snapshot=awareness,
            target_session_id="session-waiting",
            requested_max_cycles=2,
            current_cycle_index=0,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.REQUIRES_OPERATOR_APPROVAL
    assert AutonomyPolicyReason.WAITING_ON_HUMAN_GATE in result.decision.reasons
    assert result.decision.gate_requirement == PolicyGateRequirement.REVIEW
    assert result.decision.operator_approval_required is True


def test_autonomy_policy_blocks_self_initiated_dependency_blockers() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    session_a = _blocked_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")
    awareness = _build_awareness(
        orchestrator,
        session_registry=(session_a, session_b),
        dependency_graph=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
    )

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
            awareness_snapshot=awareness,
            target_session_id="session-b",
            requested_max_cycles=2,
            current_cycle_index=0,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.BLOCKED
    assert AutonomyPolicyReason.BLOCKED_BY_DEPENDENCY in result.decision.reasons


def test_autonomy_policy_blocks_self_initiated_artifact_blockers() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:05:00+00:00")
    awareness = _build_awareness(
        orchestrator,
        session_registry=(producer, consumer),
        artifact_registry=(
            _artifact("artifact-a", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
        ),
        artifact_requirements=(
            _artifact_requirement("session-b", "session-a", "missing-schema", ArtifactType.DESIGN_SPEC),
        ),
    )

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
            awareness_snapshot=awareness,
            target_session_id="session-b",
            requested_max_cycles=2,
            current_cycle_index=0,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.BLOCKED
    assert AutonomyPolicyReason.BLOCKED_BY_ARTIFACT in result.decision.reasons


def test_autonomy_policy_blocks_exhausted_loop_budget() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(orchestrator, session_registry=(ready,))

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
            awareness_snapshot=awareness,
            requested_max_cycles=1,
            current_cycle_index=1,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.BLOCKED
    assert result.decision.reasons == (AutonomyPolicyReason.LOOP_BUDGET_EXCEEDED,)


def test_autonomy_policy_rejects_unsupported_v1_action() -> None:
    orchestrator = MultiTaskOrchestrator()
    policy = AutonomyPolicy()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(orchestrator, session_registry=(ready,))

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.RESUME_SESSION,
            awareness_snapshot=awareness,
            operator_command_present=True,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.UNSUPPORTED
    assert result.decision.reasons == (AutonomyPolicyReason.UNSUPPORTED_IN_V1,)


def test_autonomy_policy_blocks_self_initiated_action_under_operator_only_profile() -> None:
    orchestrator = MultiTaskOrchestrator()
    loader = PolicyConfigLoader()
    active_profile = loader.load_profile(PolicyProfileName.OPERATOR_ONLY)
    policy = AutonomyPolicy(active_policy_profile=active_profile, policy_config_loader=loader)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(
        orchestrator,
        session_registry=(ready,),
        active_policy_profile=active_profile,
    )

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
            awareness_snapshot=awareness,
            active_policy_profile=active_profile,
            requested_max_cycles=1,
            current_cycle_index=0,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.REQUIRES_OPERATOR_APPROVAL
    assert AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE in result.decision.reasons


def test_autonomy_policy_blocks_operator_loop_above_strict_cap() -> None:
    orchestrator = MultiTaskOrchestrator()
    loader = PolicyConfigLoader()
    active_profile = loader.load_profile(PolicyProfileName.STRICT)
    policy = AutonomyPolicy(active_policy_profile=active_profile, policy_config_loader=loader)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    awareness = _build_awareness(
        orchestrator,
        session_registry=(ready,),
        active_policy_profile=active_profile,
    )

    result = policy.evaluate(
        AutonomyPolicyContext(
            action_type=AutonomyActionType.RUN_BOUNDED_LOOP,
            awareness_snapshot=awareness,
            active_policy_profile=active_profile,
            operator_command_present=True,
            requested_max_cycles=5,
        )
    )

    assert result.decision.decision_status == AutonomyPolicyStatus.BLOCKED
    assert result.decision.reasons == (AutonomyPolicyReason.LOOP_BUDGET_EXCEEDED,)