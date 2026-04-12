from __future__ import annotations

from pathlib import Path

from aie.core.operator_control import OperatorControl
from aie.core.models import (
    ArtifactRequirement,
    ArtifactStatus,
    ArtifactType,
    AwarenessStatus,
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    IntentSpec,
    LifecycleState,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    OperatorCommandRequest,
    OperatorCommandStatus,
    OperatorCommandType,
    OperatorGateType,
    OperatorRejectionReason,
    OperatorTargetType,
    ResumeRequest,
    SessionArtifact,
    SessionDependency,
    SystemHealthState,
    TaskChain,
    TaskStep,
)
from aie.core.multi_task_orchestrator import MultiTaskOrchestrator
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
        summary="Bounded execution plan for operator control tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep operator-control summaries deterministic.",),
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
        summary="Operator control test chain.",
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


def test_operator_control_inspect_system_is_read_only() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    original = ready.to_dict()

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-inspect-system",
            command_type=OperatorCommandType.INSPECT_SYSTEM,
            target_type=OperatorTargetType.SYSTEM,
            session_registry=(ready,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.EXECUTED
    assert result.awareness_snapshot_used is not None
    assert result.resulting_awareness is not None
    assert result.resulting_awareness.status == AwarenessStatus.HEALTHY
    assert ready.to_dict() == original


def test_operator_control_inspect_session_returns_session_summary() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.NORMAL,
        last_updated="2026-04-12T10:05:00+00:00",
    )

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-inspect-session",
            command_type=OperatorCommandType.INSPECT_SESSION,
            target_type=OperatorTargetType.SESSION,
            target_session_id="session-waiting",
            session_registry=(waiting,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.EXECUTED
    assert result.session_summary is not None
    assert result.session_summary.session_id == "session-waiting"
    assert result.session_summary.lifecycle_state == LifecycleState.AWAITING_REVIEW
    assert result.blocker_summaries


def test_operator_control_run_single_cycle_routes_through_loop_engine(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-single-cycle",
            command_type=OperatorCommandType.RUN_SINGLE_CYCLE,
            target_type=OperatorTargetType.LOOP,
            session_registry=(ready,),
            session_storage_directory=str(tmp_path),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.EXECUTED
    assert result.loop_result is not None
    assert result.loop_result.actions_run_count == 1
    assert result.resulting_awareness is not None
    assert result.resulting_awareness.snapshot.completed_session_ids == ("session-ready",)


def test_operator_control_run_bounded_loop_routes_through_loop_engine(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    high = _ready_record(orchestrator, "session-high", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")
    low = _ready_record(orchestrator, "session-low", MultiTaskPriority.LOW, last_updated="2026-04-12T10:05:00+00:00")

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-bounded-loop",
            command_type=OperatorCommandType.RUN_BOUNDED_LOOP,
            target_type=OperatorTargetType.LOOP,
            session_registry=(high, low),
            max_cycles=2,
            session_storage_directory=str(tmp_path),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.EXECUTED
    assert result.loop_result is not None
    assert result.loop_result.actions_run_count == 2
    assert result.resulting_awareness is not None
    assert result.resulting_awareness.system_health_state == SystemHealthState.COMPLETED


def test_operator_control_approve_gate_makes_session_resumable() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    waiting = _waiting_review_record(
        orchestrator,
        "session-review",
        MultiTaskPriority.NORMAL,
        last_updated="2026-04-12T10:05:00+00:00",
    )

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-approve-gate",
            command_type=OperatorCommandType.APPROVE_GATE,
            target_type=OperatorTargetType.GATE,
            target_session_id="session-review",
            gate_type=OperatorGateType.REVIEW,
            session_registry=(waiting,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.EXECUTED
    assert result.session_summary is not None
    assert result.session_summary.lifecycle_state == LifecycleState.RESUMABLE
    assert result.resulting_session_status == MultiTaskSessionStatus.RESUMABLE


def test_operator_control_rejects_invalid_gate_approval() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    completed = _completed_record(orchestrator, "session-done", last_updated="2026-04-12T10:00:00+00:00")

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-invalid-gate",
            command_type=OperatorCommandType.APPROVE_GATE,
            target_type=OperatorTargetType.GATE,
            target_session_id="session-done",
            gate_type=OperatorGateType.REVIEW,
            session_registry=(completed,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.REJECTED
    assert result.decision.rejection_reason == OperatorRejectionReason.GATE_NOT_CLEARABLE


def test_operator_control_reprioritizes_session_without_executing() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-reprioritize",
            command_type=OperatorCommandType.REPRIORITIZE_SESSION,
            target_type=OperatorTargetType.SESSION,
            target_session_id="session-ready",
            new_priority=MultiTaskPriority.URGENT,
            session_registry=(ready,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.EXECUTED
    assert result.updated_session_registry[0].priority == MultiTaskPriority.URGENT
    assert result.loop_result is None
    assert result.resulting_awareness is not None
    assert result.resulting_awareness.next_action_candidates[0].session_id == "session-ready"


def test_operator_control_select_session_validates_actionable_session_without_mutation() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    original = ready.to_dict()

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-select-session",
            command_type=OperatorCommandType.SELECT_SESSION,
            target_type=OperatorTargetType.SESSION,
            target_session_id="session-ready",
            session_registry=(ready,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.NO_OP
    assert result.session_summary is not None
    assert result.session_summary.actionable is True
    assert ready.to_dict() == original


def test_operator_control_rejects_unknown_command() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-unknown",
            command_type="launch_missiles",
            target_type=OperatorTargetType.SYSTEM,
            session_registry=(ready,),
        )
    )

    assert result.decision.command_status == OperatorCommandStatus.INVALID_REQUEST
    assert result.decision.rejection_reason == OperatorRejectionReason.UNKNOWN_COMMAND


def test_operator_control_returns_structured_result_payload() -> None:
    orchestrator = MultiTaskOrchestrator()
    control = OperatorControl(multi_task_orchestrator=orchestrator)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-structured",
            command_type=OperatorCommandType.INSPECT_SYSTEM,
            target_type=OperatorTargetType.SYSTEM,
            session_registry=(ready,),
        )
    )
    payload = result.to_dict()

    assert payload["decision"]["command_id"] == "cmd-structured"
    assert payload["decision"]["command_type"] == "inspect_system"
    assert payload["decision"]["command_status"] == "executed"
    assert payload["awareness_snapshot_used"]["snapshot"]["total_sessions"] == 1