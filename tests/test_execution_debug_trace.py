from __future__ import annotations

from pathlib import Path

from aie.core.execution_debug_trace import ExecutionDebugTrace
from aie.core.execution_history import ExecutionHistory
from aie.core.execution_history_persistence import ExecutionHistoryPersistence
from aie.core.execution_replay import ExecutionReplay
from aie.core.models import (
    AuditContext,
    AuditEvent,
    AuditEventType,
    AuditRecord,
    DebugTraceFailureReason,
    DebugTraceRequest,
    DebugTraceScope,
    DebugTraceStatus,
    ReplayFailureReason,
    ReplayRequest,
    ReplayScope,
)


def _build_history() -> ExecutionHistory:
    history = ExecutionHistory()
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_RECEIVED,
        session_id="session-a",
        operator_command="run_single_cycle",
        operator_command_id="cmd-001",
        source_component="operator_control",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-a",
        cycle_index=1,
        action_type="run_single_cycle",
        policy_decision="allowed",
        source_component="autonomy_policy",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_STARTED,
        cycle_index=1,
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.SESSION_SELECTED,
        session_id="session-a",
        cycle_index=1,
        action_type="execute_selected",
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
        event_type=AuditEventType.STATE_PERSISTED,
        session_id="session-a",
        cycle_index=1,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_COMPLETED,
        session_id="session-a",
        cycle_index=1,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_STARTED,
        cycle_index=2,
        source_component="execution_loop_engine",
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
        event_type=AuditEventType.LOOP_CYCLE_COMPLETED,
        session_id="session-b",
        cycle_index=2,
        action_type="wait",
        source_component="execution_loop_engine",
    )
    return history


def _persisted_log(tmp_path: Path):
    persistence = ExecutionHistoryPersistence()
    history = _build_history()
    target = tmp_path / "audit-log.json"
    save_result = persistence.save_audit_log(history.export_log(), target)
    assert save_result.persisted_log is not None
    return save_result.persisted_log


def test_build_full_log_trace_succeeds(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    persisted_log = _persisted_log(tmp_path)

    result = tracer.build_full_log_trace(persisted_log)

    assert result.status == DebugTraceStatus.BUILT
    assert result.summary is not None
    assert result.summary.final_outcome == "Execution reached loop cycle completion in the selected trace scope."
    assert result.ordered_steps[0].title == "Operator Command Received"
    assert result.ordered_steps[-1].title == "Loop Cycle Completed"


def test_build_session_trace_filters_to_target_session(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    persisted_log = _persisted_log(tmp_path)

    result = tracer.build_session_trace(persisted_log, "session-a")

    assert result.status == DebugTraceStatus.BUILT
    assert result.target_session_id == "session-a"
    assert all(
        (step.event_type == AuditEventType.LOOP_CYCLE_STARTED)
        or (step.event_type == AuditEventType.POLICY_DECISION_MADE)
        or ("session-b" not in step.explanation)
        for step in result.ordered_steps
    )


def test_build_cycle_trace_shows_cycle_flow(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    persisted_log = _persisted_log(tmp_path)

    result = tracer.build_cycle_trace(persisted_log, 1)

    assert result.status == DebugTraceStatus.BUILT
    assert result.target_cycle_id == 1
    assert [step.title for step in result.ordered_steps] == [
        "Policy Decision Recorded",
        "Loop Cycle Started",
        "Session Selected",
        "Action Executed",
        "State Persisted",
        "Loop Cycle Completed",
    ]


def test_unknown_target_replay_maps_to_invalid_trace(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)
    replay_result = replay.replay_session(persisted_log, "missing-session")

    result = tracer.build_trace(
        replay_result,
        DebugTraceRequest(scope=DebugTraceScope.SESSION, target_session_id="missing-session"),
    )

    assert replay_result.failure_reason == ReplayFailureReason.UNKNOWN_SESSION
    assert result.status == DebugTraceStatus.INVALID
    assert result.failure_reason == DebugTraceFailureReason.UNKNOWN_SCOPE_TARGET


def test_partial_replay_becomes_partial_trace() -> None:
    tracer = ExecutionDebugTrace()
    replay = ExecutionReplay()
    incomplete_log = ExecutionHistory(
        records=(
            AuditRecord(
                event_id="audit-000001",
                event=AuditEvent(
                    timestamp="2026-04-12T10:00:01+00:00",
                    event_type=AuditEventType.ACTION_EXECUTED,
                    session_id="session-a",
                    cycle_index=3,
                    action_type="execute_selected",
                ),
                context=AuditContext(session_id="session-a", cycle_index=3, action_type="execute_selected", source_component="multi_task_orchestrator"),
            ),
        )
    ).export_log()
    replay_result = replay.replay_cycle(incomplete_log, 3)

    result = tracer.build_trace(
        replay_result,
        DebugTraceRequest(scope=DebugTraceScope.CYCLE, target_cycle_id=3),
    )

    assert result.status == DebugTraceStatus.PARTIAL
    assert result.failure_reason == DebugTraceFailureReason.MISSING_REPLAY_DATA
    assert result.summary is not None
    assert result.summary.final_outcome == "Replay produced a partial trace because the selected history window was incomplete."


def test_ordered_trace_preserves_replay_order(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    persisted_log = _persisted_log(tmp_path)

    result = tracer.build_full_log_trace(persisted_log)

    assert [step.event_id for step in result.ordered_steps] == [
        "audit-000001",
        "audit-000002",
        "audit-000003",
        "audit-000004",
        "audit-000005",
        "audit-000006",
        "audit-000007",
        "audit-000008",
        "audit-000009",
        "audit-000010",
    ]


def test_debug_trace_does_not_mutate_replay_or_persisted_history(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)
    before_log = persisted_log.to_dict()
    replay_result = replay.replay(
        persisted_log,
        ReplayRequest(scope=ReplayScope.FULL_LOG, replay_notes=("trace me",)),
    )
    before_replay = replay_result.to_dict()

    result = tracer.build_trace(
        replay_result,
        DebugTraceRequest(scope=DebugTraceScope.FULL_LOG, trace_notes=("read-only trace",)),
    )

    assert result.status == DebugTraceStatus.BUILT
    assert persisted_log.to_dict() == before_log
    assert replay_result.to_dict() == before_replay