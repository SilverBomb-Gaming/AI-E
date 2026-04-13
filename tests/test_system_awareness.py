from __future__ import annotations

from pathlib import Path

from aie.core.execution_loop_engine import ExecutionLoopEngine
from aie.core.models import (
    ArtifactRequirement,
    ArtifactStatus,
    ArtifactType,
    AwarenessBlockerKind,
    AwarenessRequest,
    AwarenessStatus,
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    IntentSpec,
    LifecycleState,
    LoopCycleAction,
    LoopEngineStatus,
    LoopTerminationReason,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    PolicyProfileName,
    ResumeRequest,
    SessionArtifact,
    SessionDependency,
    SystemHealthState,
    TaskChain,
    TaskStep,
    LoopEngineRequest,
)
from aie.core.multi_task_orchestrator import MultiTaskOrchestrator
from aie.core.policy_config import PolicyConfigLoader
from aie.core.state_persistence import StatePersistence
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
        summary="Bounded execution plan for system awareness tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep awareness summaries deterministic.",),
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
        summary="System awareness test chain.",
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


def _resumable_review_record(
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
            _step(f"{session_id}-validate", "validate", depends_on=(f"{session_id}-implement",)),
        ),
        human_review_required=True,
    )
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=priority,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        resume_request=ResumeRequest.from_execution_result(prior_result, review_cleared=True),
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
        scaffold_only=False,
        implementation_allowed=True,
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


def test_system_awareness_summarizes_ready_and_waiting_sessions() -> None:
    orchestrator = MultiTaskOrchestrator()
    awareness = SystemAwareness(orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.NORMAL,
        last_updated="2026-04-12T10:05:00+00:00",
    )

    result = awareness.build_awareness_result(AwarenessRequest(session_registry=(ready, waiting)))

    session_map = {summary.session_id: summary for summary in result.session_summaries}

    assert result.status == AwarenessStatus.MIXED
    assert result.system_health_state == SystemHealthState.PARTIALLY_BLOCKED
    assert result.snapshot.active_session_ids == ("session-ready",)
    assert result.snapshot.waiting_session_ids == ("session-waiting",)
    assert result.next_action_candidates[0].session_id == "session-ready"
    assert result.next_action_candidates[0].selected_next is True
    assert session_map["session-ready"].actionable is True
    assert session_map["session-ready"].effective_status == AwarenessStatus.ACTIVE
    assert session_map["session-waiting"].effective_status == AwarenessStatus.WAITING
    assert any(
        blocker.blocker_kind == AwarenessBlockerKind.WAITING_ON_REVIEW and blocker.session_id == "session-waiting"
        for blocker in result.blocker_summaries
    )


def test_system_awareness_summarizes_dependency_and_artifact_blockers() -> None:
    orchestrator = MultiTaskOrchestrator()
    awareness = SystemAwareness(orchestrator)
    blocked = _blocked_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    dependency_blocked = _ready_record(
        orchestrator,
        "session-b",
        MultiTaskPriority.URGENT,
        last_updated="2026-04-12T10:05:00+00:00",
    )
    artifact_blocked = _ready_record(
        orchestrator,
        "session-c",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T10:10:00+00:00",
    )
    producer = _completed_record(orchestrator, "session-d", last_updated="2026-04-12T10:15:00+00:00")

    result = awareness.build_awareness_result(
        AwarenessRequest(
            session_registry=(blocked, dependency_blocked, artifact_blocked, producer),
            dependency_graph=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
            artifact_requirements=(
                _artifact_requirement("session-c", "session-d", "missing-schema", ArtifactType.DESIGN_SPEC),
            ),
        )
    )

    blocker_kinds = {blocker.blocker_kind for blocker in result.blocker_summaries}

    assert result.status == AwarenessStatus.BLOCKED
    assert result.system_health_state == SystemHealthState.FULLY_BLOCKED
    assert result.snapshot.active_session_ids == ()
    assert blocker_kinds >= {
        AwarenessBlockerKind.BLOCKED_BY_EXECUTION_STATE,
        AwarenessBlockerKind.BLOCKED_BY_DEPENDENCY,
        AwarenessBlockerKind.BLOCKED_BY_ARTIFACT,
    }
    assert all(candidate.actionable is False for candidate in result.next_action_candidates)


def test_system_awareness_surfaces_recent_loop_activity_from_latest_result(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    awareness = SystemAwareness(orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    loop_result = engine.run_loop(
        LoopEngineRequest(
            session_registry=(ready,),
            max_cycles=1,
            session_storage_directory=str(tmp_path),
        )
    )

    result = awareness.build_awareness_result(AwarenessRequest(latest_loop_result=loop_result))

    assert result.status == AwarenessStatus.COMPLETED
    assert result.snapshot.total_sessions == 1
    assert result.snapshot.completed_session_ids == ("session-ready",)
    assert result.recent_activity is not None
    assert result.recent_activity.cycle_index == 1
    assert result.recent_activity.selected_session_id == "session-ready"
    assert result.recent_activity.selected_action == LoopCycleAction.EXECUTE_SELECTED
    assert result.last_policy_decision is not None
    assert result.recent_activity.latest_cycle_status == LoopEngineStatus.RAN_ACTION
    assert result.recent_activity.latest_termination_reason == LoopTerminationReason.COMPLETED_ALL_SESSIONS


def test_system_awareness_derives_next_action_candidates_using_current_rules() -> None:
    orchestrator = MultiTaskOrchestrator()
    awareness = SystemAwareness(orchestrator)
    urgent_ready = _ready_record(
        orchestrator,
        "session-ready",
        MultiTaskPriority.URGENT,
        last_updated="2026-04-12T10:00:00+00:00",
    )
    high_resumable = _resumable_review_record(
        orchestrator,
        "session-resumable",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T09:55:00+00:00",
    )

    result = awareness.build_awareness_result(AwarenessRequest(session_registry=(urgent_ready, high_resumable)))

    assert result.next_action_candidates[0].session_id == "session-resumable"
    assert result.next_action_candidates[0].selected_next is True
    assert result.next_action_candidates[0].actionable is True
    assert result.next_action_candidates[1].session_id == "session-ready"
    assert result.next_action_candidates[1].actionable is True
    assert result.next_action_candidates[1].selected_next is False
    assert "outranked" in result.next_action_candidates[1].notes[0]


def test_system_awareness_reports_completed_system_without_blockers() -> None:
    orchestrator = MultiTaskOrchestrator()
    awareness = SystemAwareness(orchestrator)
    completed = _completed_record(orchestrator, "session-done", last_updated="2026-04-12T10:00:00+00:00")

    result = awareness.build_awareness_result(AwarenessRequest(session_registry=(completed,)))

    assert result.status == AwarenessStatus.COMPLETED
    assert result.system_health_state == SystemHealthState.COMPLETED
    assert result.snapshot.completed_session_ids == ("session-done",)
    assert result.blocker_summaries == ()
    assert result.next_action_candidates[0].actionable is False
    assert result.next_action_candidates[0].ineligible_reason == "Session is already completed."


def test_system_awareness_is_read_only() -> None:
    orchestrator = MultiTaskOrchestrator()
    awareness = SystemAwareness(orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T10:05:00+00:00",
    )
    original_ready = ready.to_dict()
    original_waiting = waiting.to_dict()
    registry = (ready, waiting)

    awareness.build_awareness_result(AwarenessRequest(session_registry=registry))

    assert registry[0].to_dict() == original_ready
    assert registry[1].to_dict() == original_waiting
    assert registry[0].lifecycle_state == LifecycleState.READY_TO_EXECUTE
    assert registry[1].lifecycle_state == LifecycleState.AWAITING_REVIEW


def test_system_awareness_surfaces_active_policy_profile() -> None:
    orchestrator = MultiTaskOrchestrator()
    loader = PolicyConfigLoader()
    strict_profile = loader.load_profile(PolicyProfileName.STRICT)
    awareness = SystemAwareness(orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")

    result = awareness.build_awareness_result(
        AwarenessRequest(
            session_registry=(ready,),
            active_policy_profile=strict_profile,
        )
    )

    assert result.active_policy_profile is not None
    assert result.active_policy_profile.profile_name == PolicyProfileName.STRICT