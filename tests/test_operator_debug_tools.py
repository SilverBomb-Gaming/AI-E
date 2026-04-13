from __future__ import annotations

from pathlib import Path

from aie.core.execution_history import ExecutionHistory
from aie.core.execution_history_persistence import ExecutionHistoryPersistence
from aie.core.models import (
    AuditEventType,
    DebugToolAction,
    DebugToolFailureReason,
    DebugToolFilter,
    DebugToolRequest,
    DebugToolStatus,
    DebugTraceScope,
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


def test_inspect_full_log_success(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(action=DebugToolAction.INSPECT_FULL_LOG, scope=DebugTraceScope.FULL_LOG),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.view is not None
    assert len(result.view.returned_steps) == 10


def test_inspect_session_success(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.INSPECT_SESSION,
            scope=DebugTraceScope.SESSION,
            target_session_id="session-a",
        ),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.target_session_id == "session-a"
    assert result.view is not None
    assert all("session-b" not in step.explanation for step in result.view.returned_steps)


def test_inspect_cycle_success(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.INSPECT_CYCLE,
            scope=DebugTraceScope.CYCLE,
            target_cycle_id=1,
        ),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.target_cycle_id == 1
    assert result.view is not None
    assert [step.event_type for step in result.view.returned_steps][:2] == [
        AuditEventType.POLICY_DECISION_MADE,
        AuditEventType.LOOP_CYCLE_STARTED,
    ]


def test_key_event_extraction(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(action=DebugToolAction.LIST_KEY_EVENTS, scope=DebugTraceScope.FULL_LOG),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.view is not None
    assert all(
        step.event_type
        in {
            AuditEventType.OPERATOR_COMMAND_RECEIVED,
            AuditEventType.POLICY_DECISION_MADE,
            AuditEventType.SESSION_SELECTED,
            AuditEventType.STATE_PERSISTED,
            AuditEventType.ACTION_BLOCKED,
        }
        or step.event_type in {AuditEventType.OPERATOR_COMMAND_EXECUTED, AuditEventType.OPERATOR_COMMAND_REJECTED}
        for step in result.view.key_events
    )


def test_stop_summary_extraction(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(action=DebugToolAction.SUMMARIZE_STOP_POINTS, scope=DebugTraceScope.FULL_LOG),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.view is not None
    assert len(result.view.returned_steps) == 1
    assert result.view.returned_steps[0].event_type == AuditEventType.ACTION_BLOCKED


def test_wait_summary_extraction(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(action=DebugToolAction.SUMMARIZE_WAIT_POINTS, scope=DebugTraceScope.FULL_LOG),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.view is not None
    assert any("wait" in step.explanation.lower() for step in result.view.returned_steps)


def test_filter_trace_steps_behavior(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.FILTER_TRACE_STEPS,
            scope=DebugTraceScope.CYCLE,
            target_cycle_id=1,
            applied_filters=DebugToolFilter(include_policy_decisions=True),
        ),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert result.view is not None
    assert len(result.view.returned_steps) == 1
    assert result.view.returned_steps[0].event_type == AuditEventType.POLICY_DECISION_MADE


def test_invalid_target_rejection(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.INSPECT_CYCLE,
            scope=DebugTraceScope.CYCLE,
            target_cycle_id=99,
        ),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.INVALID
    assert result.failure_reason == DebugToolFailureReason.UNKNOWN_SCOPE_TARGET


def test_invalid_filter_rejection(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.FILTER_TRACE_STEPS,
            scope=DebugTraceScope.FULL_LOG,
            applied_filters=DebugToolFilter(),
        ),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.INVALID
    assert result.failure_reason == DebugToolFailureReason.INVALID_FILTER


def test_action_scope_mismatch_rejection(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)

    result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.INSPECT_FULL_LOG,
            scope=DebugTraceScope.SESSION,
            target_session_id="session-a",
        ),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.INVALID
    assert result.failure_reason == DebugToolFailureReason.UNSUPPORTED_ACTION


def test_no_mutation_guarantee(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    persisted_log = _persisted_log(tmp_path)
    before = persisted_log.to_dict()

    result = tools.handle_request(
        DebugToolRequest(action=DebugToolAction.INSPECT_FULL_LOG, scope=DebugTraceScope.FULL_LOG),
        audit_log=persisted_log,
    )

    assert result.status == DebugToolStatus.COMPLETED
    assert persisted_log.to_dict() == before