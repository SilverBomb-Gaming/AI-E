from __future__ import annotations

from pathlib import Path

from aie.core.execution_debug_trace import ExecutionDebugTrace
from aie.core.execution_history import ExecutionHistory
from aie.core.execution_history_persistence import ExecutionHistoryPersistence
from aie.core.execution_insights import ExecutionInsights
from aie.core.execution_replay import ExecutionReplay
from aie.core.models import (
    AuditContext,
    AuditEvent,
    AuditEventType,
    AuditRecord,
    DebugToolAction,
    DebugToolFilter,
    DebugToolRequest,
    DebugTraceScope,
    InsightCategory,
    InsightFailureReason,
    InsightRequest,
    InsightScope,
    InsightStatus,
    ReplayRequest,
    ReplayScope,
)
from aie.core.operator_debug_tools import OperatorDebugTools


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
        event_type=AuditEventType.OPERATOR_COMMAND_EXECUTED,
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
        action_type="wait",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_BLOCKED,
        session_id="session-a",
        cycle_index=1,
        action_type="wait",
        reason="awaiting_review_gate",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_COMPLETED,
        session_id="session-a",
        cycle_index=1,
        action_type="wait",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_RECEIVED,
        session_id="session-a",
        operator_command="resume_after_review",
        operator_command_id="cmd-002",
        source_component="operator_control",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-a",
        cycle_index=2,
        action_type="execute_selected",
        policy_decision="allowed",
        source_component="autonomy_policy",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_STARTED,
        cycle_index=2,
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.SESSION_SELECTED,
        session_id="session-a",
        cycle_index=2,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_EXECUTED,
        session_id="session-a",
        cycle_index=2,
        action_type="execute_selected",
        source_component="multi_task_orchestrator",
    )
    history.record_event(
        event_type=AuditEventType.STATE_PERSISTED,
        session_id="session-a",
        cycle_index=2,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_COMPLETED,
        session_id="session-a",
        cycle_index=2,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_RECEIVED,
        session_id="session-b",
        operator_command="run_external_side_effect",
        operator_command_id="cmd-003",
        source_component="operator_control",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-b",
        cycle_index=3,
        action_type="run_external_side_effect",
        policy_decision="blocked",
        source_component="autonomy_policy",
    )
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_REJECTED,
        session_id="session-b",
        operator_command="run_external_side_effect",
        reason="policy_blocked_external_side_effect",
        source_component="operator_control",
    )
    return history


def _persisted_log(tmp_path: Path):
    persistence = ExecutionHistoryPersistence()
    history = _build_history()
    target = tmp_path / "audit-log.json"
    save_result = persistence.save_audit_log(history.export_log(), target)
    assert save_result.persisted_log is not None
    return save_result.persisted_log


def test_generate_full_log_insights_from_trace(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    insights = ExecutionInsights()
    persisted_log = _persisted_log(tmp_path)
    trace_result = tracer.build_full_log_trace(persisted_log)

    result = insights.generate_insights(
        InsightRequest(scope=InsightScope.FULL_LOG, source_trace_id=trace_result.trace_id),
        trace_result=trace_result,
    )

    assert result.status == InsightStatus.GENERATED
    assert result.source_trace_id == trace_result.trace_id
    assert result.summary is not None
    assert result.summary.main_outcome == "completed"
    categories = {item.category for item in result.items}
    assert InsightCategory.STOP_POINT in categories
    assert InsightCategory.WAIT_POINT in categories
    assert InsightCategory.RESUME_POINT in categories
    assert InsightCategory.POLICY_TRANSITION in categories
    assert InsightCategory.OPERATOR_TRANSITION in categories
    assert InsightCategory.SELECTION_TRANSITION in categories
    assert InsightCategory.PERSISTENCE_MILESTONE in categories
    assert InsightCategory.COMPLETION in categories
    assert result.summary.next_inspection_hint == "inspect final persistence milestone"


def test_generate_session_insights_surfaces_wait_and_blocker(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    persisted_log = _persisted_log(tmp_path)

    result = insights.build_session_insights(persisted_log, "session-a")

    assert result.status == InsightStatus.GENERATED
    assert result.target_session_id == "session-a"
    assert result.summary is not None
    assert result.summary.first_stop_point is not None
    assert result.summary.latest_wait_point is not None
    assert result.summary.progress_resumed is True
    assert any(item.category == InsightCategory.WAIT_POINT for item in result.top_blockers)


def test_generate_cycle_insights_surfaces_selection_and_persistence(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    persisted_log = _persisted_log(tmp_path)

    result = insights.build_cycle_insights(persisted_log, 2)

    assert result.status == InsightStatus.GENERATED
    assert result.target_cycle_id == 2
    assert result.summary is not None
    assert result.summary.main_outcome == "completed"
    transition_categories = {item.category for item in result.top_transitions}
    assert InsightCategory.SELECTION_TRANSITION in transition_categories
    assert InsightCategory.PERSISTENCE_MILESTONE in transition_categories


def test_generate_insights_from_debug_result_input(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    insights = ExecutionInsights()
    persisted_log = _persisted_log(tmp_path)
    debug_result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.FILTER_TRACE_STEPS,
            scope=DebugTraceScope.CYCLE,
            target_cycle_id=2,
            applied_filters=DebugToolFilter(include_persistence_steps=True, include_policy_decisions=True),
        ),
        audit_log=persisted_log,
    )

    result = insights.generate_insights(
        InsightRequest(
            scope=InsightScope.CYCLE,
            target_cycle_id=2,
            source_trace_id=debug_result.source_trace_id,
            source_debug_request_id=debug_result.request_id,
        ),
        debug_result=debug_result,
    )

    assert result.status == InsightStatus.PARTIAL
    assert result.notes
    assert any("filtered debug output" in note for note in result.notes)


def test_partial_trace_becomes_partial_insight() -> None:
    tracer = ExecutionDebugTrace()
    replay = ExecutionReplay()
    insights = ExecutionInsights()
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
    replay_result = replay.replay(incomplete_log, ReplayRequest(scope=ReplayScope.CYCLE, target_cycle_id=3))
    trace_result = tracer.build_trace(replay_result)

    result = insights.generate_insights(
        InsightRequest(scope=InsightScope.CYCLE, target_cycle_id=3, source_trace_id=trace_result.trace_id),
        trace_result=trace_result,
    )

    assert result.status == InsightStatus.PARTIAL
    assert result.summary is not None
    assert result.summary.main_outcome == "partial"
    assert result.summary.next_inspection_hint == "inspect incomplete replay history"


def test_invalid_scope_target_from_audit_log(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    persisted_log = _persisted_log(tmp_path)

    result = insights.generate_insights(
        InsightRequest(scope=InsightScope.SESSION, target_session_id="missing-session"),
        audit_log=persisted_log,
    )

    assert result.status == InsightStatus.INVALID
    assert result.failure_reason == InsightFailureReason.UNKNOWN_SCOPE_TARGET


def test_no_mutation_guarantee_for_trace_and_history(tmp_path: Path) -> None:
    tracer = ExecutionDebugTrace()
    insights = ExecutionInsights()
    persisted_log = _persisted_log(tmp_path)
    trace_result = tracer.build_full_log_trace(persisted_log)
    before_log = persisted_log.to_dict()
    before_trace = trace_result.to_dict()

    result = insights.generate_insights(
        InsightRequest(scope=InsightScope.FULL_LOG, source_trace_id=trace_result.trace_id),
        trace_result=trace_result,
    )

    assert result.status == InsightStatus.GENERATED
    assert persisted_log.to_dict() == before_log
    assert trace_result.to_dict() == before_trace