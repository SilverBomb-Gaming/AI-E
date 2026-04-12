from __future__ import annotations

from pathlib import Path

from aie.core.execution_loop_engine import ExecutionLoopEngine
from aie.core.models import (
    ArtifactRequirement,
    ArtifactStatus,
    ArtifactType,
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    LifecycleState,
    LoopCycleAction,
    LoopCycleReason,
    LoopEngineRequest,
    LoopEngineStatus,
    LoopTerminationReason,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    ResumeRequest,
    SessionArtifact,
    SessionDependency,
    TaskChain,
    TaskStep,
)
from aie.core.multi_task_orchestrator import MultiTaskOrchestrator
from aie.core.state_persistence import StatePersistence
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
        summary="Bounded execution plan for loop engine tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep loop execution deterministic.",),
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
        summary="Execution loop engine test chain.",
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


def test_execution_loop_engine_runs_single_cycle_for_ready_session(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")

    cycle = engine.run_cycle(
        LoopEngineRequest(
            session_registry=(ready,),
            max_cycles=1,
            session_storage_directory=str(tmp_path),
        )
    )

    saved_path = tmp_path / "session-ready.json"
    reloaded = StatePersistence().load_session(saved_path)

    assert cycle.status == LoopEngineStatus.RAN_ACTION
    assert cycle.selected_action == LoopCycleAction.EXECUTE_SELECTED
    assert cycle.reason == LoopCycleReason.SELECTED_ACTIONABLE_SESSION
    assert cycle.selected_session_id == "session-ready"
    assert cycle.lifecycle_state_before == LifecycleState.READY_TO_EXECUTE
    assert cycle.lifecycle_state_after == LifecycleState.COMPLETED
    assert cycle.persisted_after_cycle is True
    assert reloaded.status.value == "loaded"
    assert reloaded.session is not None
    assert reloaded.session.task_execution_result.status == ExecutorStatus.COMPLETED


def test_execution_loop_engine_runs_single_cycle_for_resumable_session(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    resumable = _resumable_review_record(
        orchestrator,
        "session-resumable",
        MultiTaskPriority.URGENT,
        last_updated="2026-04-12T10:00:00+00:00",
    )

    cycle = engine.run_cycle(
        LoopEngineRequest(
            session_registry=(resumable,),
            max_cycles=1,
            session_storage_directory=str(tmp_path),
        )
    )

    assert cycle.status == LoopEngineStatus.RAN_ACTION
    assert cycle.selected_action == LoopCycleAction.RESUME_SELECTED
    assert cycle.lifecycle_state_before == LifecycleState.RESUMABLE
    assert cycle.lifecycle_state_after == LifecycleState.COMPLETED
    assert cycle.persisted_after_cycle is True


def test_execution_loop_engine_reports_waiting_human_gate() -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T10:00:00+00:00",
    )

    cycle = engine.run_cycle(LoopEngineRequest(session_registry=(waiting,), max_cycles=1))

    assert cycle.status == LoopEngineStatus.WAITING
    assert cycle.selected_action == LoopCycleAction.WAIT
    assert cycle.reason == LoopCycleReason.WAITING_ON_HUMAN_GATE
    assert cycle.termination_reason == LoopTerminationReason.HUMAN_GATE_REQUIRED


def test_execution_loop_engine_reports_dependency_blocking() -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    session_a = _blocked_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    cycle = engine.run_cycle(
        LoopEngineRequest(
            session_registry=(session_a, session_b),
            dependency_graph=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
            max_cycles=1,
        )
    )

    assert cycle.status == LoopEngineStatus.STOPPED
    assert cycle.reason == LoopCycleReason.BLOCKED_BY_DEPENDENCY
    assert cycle.termination_reason == LoopTerminationReason.BLOCKED_BY_DEPENDENCIES


def test_execution_loop_engine_reports_artifact_blocking() -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:05:00+00:00")

    cycle = engine.run_cycle(
        LoopEngineRequest(
            session_registry=(producer, consumer),
            artifact_requirements=(
                _artifact_requirement("session-b", "session-a", "missing-schema", ArtifactType.DESIGN_SPEC),
            ),
            max_cycles=1,
        )
    )

    assert cycle.status == LoopEngineStatus.STOPPED
    assert cycle.reason == LoopCycleReason.BLOCKED_BY_ARTIFACT
    assert cycle.termination_reason == LoopTerminationReason.BLOCKED_BY_ARTIFACTS


def test_execution_loop_engine_runs_bounded_multi_cycle_progression(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")
    artifact = _artifact("artifact-combat-schema", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC)
    requirement = _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC)

    result = engine.run_loop(
        LoopEngineRequest(
            session_registry=(session_a, session_b),
            dependency_graph=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
            artifact_registry=(artifact,),
            artifact_requirements=(requirement,),
            max_cycles=3,
            session_storage_directory=str(tmp_path),
        )
    )

    final_statuses = {record.session_id: record.session_status for record in result.final_registry}

    assert result.status == LoopEngineStatus.COMPLETED
    assert result.actions_run_count == 2
    assert len(result.cycles) == 2
    assert result.cycles[0].selected_session_id == "session-a"
    assert result.cycles[1].selected_session_id == "session-b"
    assert result.termination_reason == LoopTerminationReason.COMPLETED_ALL_SESSIONS
    assert final_statuses["session-a"] == MultiTaskSessionStatus.COMPLETED
    assert final_statuses["session-b"] == MultiTaskSessionStatus.COMPLETED


def test_execution_loop_engine_stops_at_max_cycles(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:05:00+00:00")

    result = engine.run_loop(
        LoopEngineRequest(
            session_registry=(session_a, session_b),
            max_cycles=1,
            session_storage_directory=str(tmp_path),
        )
    )

    assert result.status == LoopEngineStatus.MAX_CYCLES_REACHED
    assert result.termination_reason == LoopTerminationReason.MAX_CYCLES_REACHED
    assert result.actions_run_count == 1


def test_execution_loop_engine_returns_structured_result(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    engine = ExecutionLoopEngine(orchestrator, StatePersistence())
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = engine.run_loop(
        LoopEngineRequest(
            session_registry=(ready,),
            max_cycles=1,
            session_storage_directory=str(tmp_path),
        )
    )
    payload = result.to_dict()

    assert payload["status"] in {"completed", "max_cycles_reached", "ran_action"}
    assert payload["cycles"][0]["selected_session_id"] == "session-ready"
    assert payload["max_cycles"] == 1