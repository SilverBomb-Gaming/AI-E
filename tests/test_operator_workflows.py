from __future__ import annotations

from pathlib import Path

from aie.core.execution_history import ExecutionHistory
from aie.core.execution_history_persistence import ExecutionHistoryPersistence
from aie.core.execution_insights import ExecutionInsights
from aie.core.models import (
    AuditContext,
    AuditEvent,
    AuditEventType,
    AuditRecord,
    DebugToolAction,
    DebugToolFilter,
    DebugToolRequest,
    DebugTraceScope,
    InsightRequest,
    InsightScope,
    WorkflowFailureReason,
    WorkflowRequest,
    WorkflowStatus,
    WorkflowStepType,
)
from aie.core.operator_debug_tools import OperatorDebugTools
from aie.core.operator_workflows import OperatorWorkflows


def _build_history() -> ExecutionHistory:
    history = ExecutionHistory()
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-review",
        cycle_index=1,
        action_type="wait",
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
        session_id="session-review",
        cycle_index=1,
        action_type="wait",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_BLOCKED,
        session_id="session-review",
        cycle_index=1,
        action_type="wait",
        reason="awaiting_review_gate",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-complete",
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
        session_id="session-complete",
        cycle_index=2,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_EXECUTED,
        session_id="session-complete",
        cycle_index=2,
        action_type="execute_selected",
        source_component="multi_task_orchestrator",
    )
    history.record_event(
        event_type=AuditEventType.STATE_PERSISTED,
        session_id="session-complete",
        cycle_index=2,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_COMPLETED,
        session_id="session-complete",
        cycle_index=2,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-dependency",
        cycle_index=3,
        action_type="execute_selected",
        policy_decision="allowed",
        source_component="autonomy_policy",
    )
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_STARTED,
        cycle_index=3,
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.SESSION_SELECTED,
        session_id="session-dependency",
        cycle_index=3,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.ACTION_BLOCKED,
        session_id="session-dependency",
        cycle_index=3,
        action_type="execute_selected",
        reason="dependency_missing_asset_manifest",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_RECEIVED,
        session_id="session-policy",
        operator_command="run_external_side_effect",
        operator_command_id="cmd-003",
        source_component="operator_control",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-policy",
        cycle_index=4,
        action_type="run_external_side_effect",
        policy_decision="blocked",
        source_component="autonomy_policy",
    )
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_REJECTED,
        session_id="session-policy",
        operator_command="run_external_side_effect",
        reason="policy_blocked_external_side_effect",
        source_component="operator_control",
    )
    return history


def _persisted_log(tmp_path: Path):
    persistence = ExecutionHistoryPersistence()
    target = tmp_path / "workflow-audit-log.json"
    save_result = persistence.save_audit_log(_build_history().export_log(), target)
    assert save_result.persisted_log is not None
    return save_result.persisted_log


def test_generate_workflow_for_dependency_blocker(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    insight_result = insights.build_session_insights(persisted_log, "session-dependency")

    result = workflows.generate_workflow(
        WorkflowRequest(
            scope=InsightScope.SESSION,
            target_session_id="session-dependency",
            source_insight_id=insight_result.insight_id,
            source_trace_id=insight_result.source_trace_id,
        ),
        insight_result=insight_result,
    )

    assert result.status == WorkflowStatus.GENERATED
    assert result.priority_order == ("workflow-step-001", "workflow-step-002")
    assert [step.step_type for step in result.steps[:2]] == [
        WorkflowStepType.CHECK_DEPENDENCY,
        WorkflowStepType.INSPECT,
    ]
    assert result.steps[0].description == "Inspect unresolved dependency reference"
    assert result.linked_insights == (result.steps[0].related_insight_id,)


def test_generate_workflow_for_waiting_review(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    insight_result = insights.build_session_insights(persisted_log, "session-review")

    result = workflows.build_session_workflow(insight_result, "session-review")

    assert result.status == WorkflowStatus.GENERATED
    assert [step.step_type for step in result.steps[:2]] == [
        WorkflowStepType.REVIEW,
        WorkflowStepType.CONFIRM,
    ]
    assert result.summary is not None
    assert result.summary.linked_step_id == "workflow-step-001"


def test_generate_workflow_for_completed_run(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    insight_result = insights.build_cycle_insights(persisted_log, 2)

    result = workflows.build_cycle_workflow(insight_result, 2)

    assert result.status == WorkflowStatus.GENERATED
    assert [step.step_type for step in result.steps] == [
        WorkflowStepType.CONFIRM,
        WorkflowStepType.INSPECT,
    ]
    assert result.steps[0].description == "Verify completion output and persistence state"
    assert result.steps[1].description == "Inspect persisted outputs for the completed scope"


def test_generate_workflow_for_partial_insight_from_filtered_debug_output(tmp_path: Path) -> None:
    tools = OperatorDebugTools()
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    debug_result = tools.handle_request(
        DebugToolRequest(
            action=DebugToolAction.FILTER_TRACE_STEPS,
            scope=DebugTraceScope.SESSION,
            target_session_id="session-policy",
            applied_filters=DebugToolFilter(include_policy_decisions=True, include_operator_commands=True),
        ),
        audit_log=persisted_log,
    )
    insight_result = insights.generate_insights(
        InsightRequest(
            scope=InsightScope.SESSION,
            target_session_id="session-policy",
            source_trace_id=debug_result.source_trace_id,
            source_debug_request_id=debug_result.request_id,
        ),
        debug_result=debug_result,
    )

    result = workflows.generate_workflow(
        WorkflowRequest(
            scope=InsightScope.SESSION,
            target_session_id="session-policy",
            source_insight_id=insight_result.insight_id,
            source_trace_id=insight_result.source_trace_id,
        ),
        insight_result=insight_result,
    )

    assert result.status == WorkflowStatus.PARTIAL
    assert result.steps
    assert any("partial insight" in note.lower() or "filtered debug output" in note.lower() for note in result.notes)


def test_generate_workflow_for_blocked_policy_transition(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    insight_result = insights.build_session_insights(persisted_log, "session-policy")

    result = workflows.build_session_workflow(insight_result, "session-policy")

    assert result.status == WorkflowStatus.GENERATED
    assert [step.step_type for step in result.steps[:2]] == [
        WorkflowStepType.CHECK_POLICY,
        WorkflowStepType.INSPECT,
    ]


def test_invalid_workflow_source_trace_mismatch_returns_invalid(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    insight_result = insights.build_cycle_insights(persisted_log, 2)

    result = workflows.generate_workflow(
        WorkflowRequest(
            scope=InsightScope.CYCLE,
            target_cycle_id=2,
            source_insight_id=insight_result.insight_id,
            source_trace_id="trace-mismatch",
        ),
        insight_result=insight_result,
    )

    assert result.status == WorkflowStatus.INVALID
    assert result.failure_reason == WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE


def test_missing_insight_input_returns_invalid() -> None:
    workflows = OperatorWorkflows()

    result = workflows.generate_workflow(
        WorkflowRequest(scope=InsightScope.FULL_LOG),
        insight_result=None,
    )

    assert result.status == WorkflowStatus.INVALID
    assert result.failure_reason == WorkflowFailureReason.MISSING_INSIGHT_INPUT


def test_no_mutation_guarantee_for_insight_result(tmp_path: Path) -> None:
    insights = ExecutionInsights()
    workflows = OperatorWorkflows()
    persisted_log = _persisted_log(tmp_path)
    insight_result = insights.build_cycle_insights(persisted_log, 2)
    before = insight_result.to_dict()

    result = workflows.build_cycle_workflow(insight_result, 2)

    assert result.status == WorkflowStatus.GENERATED
    assert insight_result.to_dict() == before