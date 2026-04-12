from __future__ import annotations

from pathlib import Path

from aie.core.execution_history import ExecutionHistory
from aie.core.execution_loop_engine import ExecutionLoopEngine
from aie.core.models import (
    AuditEventType,
    AwarenessRequest,
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    IntentSpec,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    OperatorCommandRequest,
    OperatorCommandStatus,
    OperatorCommandType,
    OperatorTargetType,
    TaskChain,
    TaskStep,
    LoopEngineRequest,
)
from aie.core.multi_task_orchestrator import MultiTaskOrchestrator
from aie.core.operator_control import OperatorControl
from aie.core.state_persistence import StatePersistence
from aie.core.system_awareness import SystemAwareness


def _step(
    step_id: str,
    step_type: str,
    *,
    depends_on: tuple[str, ...] = (),
) -> TaskStep:
    return TaskStep(
        step_id=step_id,
        step_type=step_type,
        title=step_id.replace("-", " ").title(),
        purpose=f"Execute {step_id}.",
        target_area="bounded_slice",
        engine_context="unity",
        depends_on=depends_on,
    )


def _handoff(chain_id: str, steps: tuple[TaskStep, ...]) -> ConstraintRouterHandoff:
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
        status="supported_ready",
        implementation_allowed=True,
        scaffold_only=False,
        confirmation_required=False,
        playtest_required=False,
        human_review_required=False,
        commit_preparation_allowed=True,
    )
    plan = ExecutionPlan(
        status="supported_ready",
        summary="Bounded execution plan for execution history tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep audit history deterministic.",),
        implementation_allowed=True,
        scaffold_only=False,
        confirmation_required=False,
        playtest_required=False,
        human_review_required=False,
        commit_preparation_allowed=True,
        task_chain_ready=True,
    )
    task_chain = TaskChain(
        chain_id=chain_id,
        status="execution_ready",
        summary="Execution history test chain.",
        bounded=True,
        engine_target="unity",
        steps=steps,
        codex_handoff_ready=True,
    )
    return ConstraintRouterHandoff(
        intent=intent,
        constraints=report,
        plan=plan,
        task_chain=task_chain,
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


def test_execution_history_supports_recent_and_filtered_queries() -> None:
    history = ExecutionHistory()

    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_STARTED,
        cycle_index=1,
        action_type="run_single_cycle",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_EXECUTED,
        session_id="session-a",
        cycle_index=1,
        action_type="execute_selected",
        source_component="multi_task_orchestrator",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_BLOCKED,
        session_id="session-b",
        cycle_index=2,
        action_type="wait",
        reason="waiting_on_human_gate",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.SESSION_STATE_CHANGED,
        session_id="session-a",
        cycle_index=1,
        previous_state="ready_to_execute",
        new_state="completed",
        source_component="multi_task_orchestrator",
    )

    snapshot = history.snapshot()
    recent = history.get_recent_events(limit=2)
    session_history = history.get_events_by_session("session-a")
    type_history = history.get_events_by_type(AuditEventType.ACTION_BLOCKED)
    cycle_history = history.get_cycle_history(1)

    assert len(snapshot.records) == 4
    assert [record.event_id for record in recent.records] == ["audit-000004", "audit-000003"]
    assert session_history.total_matches == 2
    assert {record.event.event_type for record in session_history.records} == {
        AuditEventType.ACTION_EXECUTED,
        AuditEventType.SESSION_STATE_CHANGED,
    }
    assert type_history.total_matches == 1
    assert type_history.records[0].event.session_id == "session-b"
    assert cycle_history.total_matches == 3


def test_system_awareness_surfaces_recent_audit_records() -> None:
    history = ExecutionHistory()
    orchestrator = MultiTaskOrchestrator(execution_history=history)
    awareness = SystemAwareness(orchestrator, history)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")

    for index in range(6):
        history.record_event(
            event_type=AuditEventType.LOOP_CYCLE_STARTED,
            cycle_index=index + 1,
            source_component="execution_loop_engine",
            notes=(f"cycle-{index + 1}",),
        )

    result = awareness.build_awareness_result(AwarenessRequest(session_registry=(ready,)))

    assert len(result.recent_audit_records) == 5
    assert [record.event_id for record in result.recent_audit_records] == [
        "audit-000006",
        "audit-000005",
        "audit-000004",
        "audit-000003",
        "audit-000002",
    ]


def test_operator_control_records_received_and_outcome_events() -> None:
    history = ExecutionHistory()
    orchestrator = MultiTaskOrchestrator(execution_history=history)
    control = OperatorControl(multi_task_orchestrator=orchestrator, execution_history=history)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")

    executed = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-inspect",
            command_type=OperatorCommandType.INSPECT_SYSTEM,
            target_type=OperatorTargetType.SYSTEM,
            session_registry=(ready,),
        )
    )
    rejected = control.handle_command(
        OperatorCommandRequest(
            command_id="cmd-unknown",
            command_type="unknown_command",
            target_type=OperatorTargetType.SYSTEM,
            session_registry=(ready,),
        )
    )

    records = history.snapshot().records
    event_types = [record.event.event_type for record in records]

    assert executed.decision.command_status == OperatorCommandStatus.EXECUTED
    assert rejected.decision.command_status == OperatorCommandStatus.INVALID_REQUEST
    assert event_types == [
        AuditEventType.OPERATOR_COMMAND_RECEIVED,
        AuditEventType.POLICY_DECISION_MADE,
        AuditEventType.OPERATOR_COMMAND_EXECUTED,
        AuditEventType.OPERATOR_COMMAND_RECEIVED,
        AuditEventType.OPERATOR_COMMAND_REJECTED,
    ]
    assert records[2].context.operator_command_id == "cmd-inspect"
    assert records[4].context.operator_command_id == "cmd-unknown"


def test_execution_loop_engine_records_cycle_policy_and_transition_history(tmp_path: Path) -> None:
    history = ExecutionHistory()
    orchestrator = MultiTaskOrchestrator(execution_history=history)
    engine = ExecutionLoopEngine(orchestrator, StatePersistence(), execution_history=history)
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")

    cycle = engine.run_cycle(
        LoopEngineRequest(
            session_registry=(ready,),
            max_cycles=1,
            session_storage_directory=str(tmp_path),
        )
    )

    cycle_records = history.get_cycle_history(cycle.cycle_index).records
    event_types = {record.event.event_type for record in cycle_records}

    assert cycle.selected_session_id == "session-ready"
    assert {
        AuditEventType.LOOP_CYCLE_STARTED,
        AuditEventType.SESSION_SELECTED,
        AuditEventType.STATE_PERSISTED,
        AuditEventType.LOOP_CYCLE_COMPLETED,
        AuditEventType.ACTION_EXECUTED,
        AuditEventType.SESSION_STATE_CHANGED,
    }.issubset(event_types)
    assert history.get_events_by_type(AuditEventType.POLICY_DECISION_MADE).total_matches == 1