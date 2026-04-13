from __future__ import annotations

from datetime import datetime, timezone

from .execution_debug_trace import ExecutionDebugTrace
from .models import (
    AuditEventType,
    AuditLog,
    DebugToolAction,
    DebugToolFailureReason,
    DebugToolFilter,
    DebugToolRequest,
    DebugToolResult,
    DebugToolStatus,
    DebugToolView,
    DebugTraceFailureReason,
    DebugTraceResult,
    DebugTraceScope,
    DebugTraceStatus,
    PersistedAuditLog,
)


class OperatorDebugTools:
    """Provide bounded, read-only operator inspection over replay-backed debug traces."""

    _SUPPORTED_ACTIONS = {
        DebugToolAction.INSPECT_FULL_LOG,
        DebugToolAction.INSPECT_SESSION,
        DebugToolAction.INSPECT_CYCLE,
        DebugToolAction.LIST_KEY_EVENTS,
        DebugToolAction.FILTER_TRACE_STEPS,
        DebugToolAction.SUMMARIZE_STOP_POINTS,
        DebugToolAction.SUMMARIZE_WAIT_POINTS,
    }

    def __init__(self, trace_builder: ExecutionDebugTrace | None = None) -> None:
        self._trace_builder = trace_builder or ExecutionDebugTrace()

    def handle_request(
        self,
        request: DebugToolRequest,
        *,
        audit_log: PersistedAuditLog | AuditLog | None = None,
        trace_result: DebugTraceResult | None = None,
    ) -> DebugToolResult:
        request_id = request.request_id or self._build_request_id()
        validation_failure = self._validate_request(request)
        if validation_failure is not None:
            return self._failure_result(
                request_id=request_id,
                request=request,
                status=DebugToolStatus.INVALID,
                failure_reason=validation_failure,
                notes=self._validation_failure_notes(request, validation_failure),
            )

        if request.action not in self._SUPPORTED_ACTIONS:
            return self._failure_result(
                request_id=request_id,
                request=request,
                status=DebugToolStatus.UNSUPPORTED_REQUEST,
                failure_reason=DebugToolFailureReason.UNSUPPORTED_ACTION,
                notes=(f"Debug action {request.action.value} is not supported in operator debug tools v1.",),
            )

        built_trace = self._build_trace_for_request(request, audit_log=audit_log, trace_result=trace_result)
        if built_trace is None:
            return self._failure_result(
                request_id=request_id,
                request=request,
                status=DebugToolStatus.INVALID,
                failure_reason=DebugToolFailureReason.MISSING_TRACE_DATA,
                notes=("Operator debug tools require a trace result or audit log input.",),
            )

        if built_trace.status in {DebugTraceStatus.INVALID, DebugTraceStatus.FAILED, DebugTraceStatus.UNSUPPORTED_SCOPE}:
            return self._failure_from_trace(request_id=request_id, request=request, trace_result=built_trace)

        filtered_steps = self._apply_filters(built_trace.ordered_steps, request.applied_filters)
        if request.applied_filters is not None and not self._filter_is_effective(request.applied_filters):
            return self._failure_result(
                request_id=request_id,
                request=request,
                status=DebugToolStatus.INVALID,
                failure_reason=DebugToolFailureReason.INVALID_FILTER,
                notes=("At least one explicit debug filter must be set when filtering trace steps.",),
            )

        key_events = self._extract_key_events(built_trace.ordered_steps)
        view = self._build_view(request, built_trace, filtered_steps, key_events)
        status = DebugToolStatus.PARTIAL if built_trace.status == DebugTraceStatus.PARTIAL else DebugToolStatus.COMPLETED
        notes = request.notes + built_trace.trace_notes
        return DebugToolResult(
            request_id=request_id,
            action=request.action,
            scope=request.scope,
            view=view,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            applied_filters=request.applied_filters,
            status=status,
            failure_reason=None,
            notes=notes,
        )

    def _build_trace_for_request(
        self,
        request: DebugToolRequest,
        *,
        audit_log: PersistedAuditLog | AuditLog | None,
        trace_result: DebugTraceResult | None,
    ) -> DebugTraceResult | None:
        if trace_result is not None:
            return trace_result
        if audit_log is None:
            return None
        if request.scope == DebugTraceScope.FULL_LOG:
            return self._trace_builder.build_full_log_trace(audit_log)
        if request.scope == DebugTraceScope.SESSION and request.target_session_id is not None:
            return self._trace_builder.build_session_trace(audit_log, request.target_session_id)
        if request.scope == DebugTraceScope.CYCLE and request.target_cycle_id is not None:
            return self._trace_builder.build_cycle_trace(audit_log, request.target_cycle_id)
        return None

    def _apply_filters(
        self,
        steps,
        applied_filters: DebugToolFilter | None,
    ):
        if applied_filters is None:
            return tuple(steps)
        allowed_types = set(applied_filters.event_types)

        def matches(step) -> bool:
            if step.event_type in allowed_types:
                return True
            if applied_filters.include_stop_related and step.event_type == AuditEventType.ACTION_BLOCKED:
                return True
            if applied_filters.include_wait_related and ("wait" in step.explanation.lower() or "review" in step.explanation.lower()):
                return True
            if applied_filters.include_policy_decisions and step.event_type == AuditEventType.POLICY_DECISION_MADE:
                return True
            if applied_filters.include_operator_commands and step.event_type in {
                AuditEventType.OPERATOR_COMMAND_RECEIVED,
                AuditEventType.OPERATOR_COMMAND_EXECUTED,
                AuditEventType.OPERATOR_COMMAND_REJECTED,
            }:
                return True
            if applied_filters.include_persistence_steps and step.event_type == AuditEventType.STATE_PERSISTED:
                return True
            if applied_filters.include_session_selection_steps and step.event_type == AuditEventType.SESSION_SELECTED:
                return True
            return False

        return tuple(step for step in steps if matches(step))

    def _extract_key_events(self, steps) -> tuple:
        key_types = {
            AuditEventType.OPERATOR_COMMAND_RECEIVED,
            AuditEventType.OPERATOR_COMMAND_EXECUTED,
            AuditEventType.OPERATOR_COMMAND_REJECTED,
            AuditEventType.POLICY_DECISION_MADE,
            AuditEventType.SESSION_SELECTED,
            AuditEventType.ACTION_BLOCKED,
            AuditEventType.STATE_PERSISTED,
        }
        return tuple(step for step in steps if step.event_type in key_types)

    def _summarize_stop_points(self, trace_result: DebugTraceResult) -> DebugToolView:
        stop_steps = tuple(step for step in trace_result.ordered_steps if step.event_type == AuditEventType.ACTION_BLOCKED)
        summary = trace_result.summary
        return DebugToolView(returned_steps=stop_steps, key_events=stop_steps, summary=summary)

    def _summarize_wait_points(self, trace_result: DebugTraceResult) -> DebugToolView:
        wait_steps = tuple(
            step for step in trace_result.ordered_steps if "wait" in step.explanation.lower() or "review" in step.explanation.lower()
        )
        return DebugToolView(returned_steps=wait_steps, key_events=wait_steps, summary=trace_result.summary)

    def _build_view(self, request: DebugToolRequest, trace_result: DebugTraceResult, filtered_steps, key_events) -> DebugToolView:
        if request.action == DebugToolAction.INSPECT_FULL_LOG:
            return DebugToolView(returned_steps=trace_result.ordered_steps, key_events=key_events, summary=trace_result.summary)
        if request.action == DebugToolAction.INSPECT_SESSION:
            return DebugToolView(returned_steps=trace_result.ordered_steps, key_events=key_events, summary=trace_result.summary)
        if request.action == DebugToolAction.INSPECT_CYCLE:
            return DebugToolView(returned_steps=trace_result.ordered_steps, key_events=key_events, summary=trace_result.summary)
        if request.action == DebugToolAction.LIST_KEY_EVENTS:
            return DebugToolView(returned_steps=key_events, key_events=key_events, summary=trace_result.summary)
        if request.action == DebugToolAction.FILTER_TRACE_STEPS:
            return DebugToolView(returned_steps=filtered_steps, key_events=self._extract_key_events(filtered_steps), summary=trace_result.summary)
        if request.action == DebugToolAction.SUMMARIZE_STOP_POINTS:
            return self._summarize_stop_points(trace_result)
        if request.action == DebugToolAction.SUMMARIZE_WAIT_POINTS:
            return self._summarize_wait_points(trace_result)
        return DebugToolView(returned_steps=trace_result.ordered_steps, key_events=key_events, summary=trace_result.summary)

    def _validate_request(self, request: DebugToolRequest) -> DebugToolFailureReason | None:
        if not self._scope_matches_action(request):
            return DebugToolFailureReason.UNSUPPORTED_ACTION
        if request.action == DebugToolAction.INSPECT_SESSION and request.target_session_id is None:
            return DebugToolFailureReason.UNKNOWN_SCOPE_TARGET
        if request.action == DebugToolAction.INSPECT_CYCLE and request.target_cycle_id is None:
            return DebugToolFailureReason.UNKNOWN_SCOPE_TARGET
        if request.scope == DebugTraceScope.SESSION and request.target_session_id is None:
            return DebugToolFailureReason.UNKNOWN_SCOPE_TARGET
        if request.scope == DebugTraceScope.CYCLE and request.target_cycle_id is None:
            return DebugToolFailureReason.UNKNOWN_SCOPE_TARGET
        if request.action == DebugToolAction.FILTER_TRACE_STEPS and request.applied_filters is None:
            return DebugToolFailureReason.INVALID_FILTER
        return None

    @staticmethod
    def _scope_matches_action(request: DebugToolRequest) -> bool:
        if request.action == DebugToolAction.INSPECT_FULL_LOG:
            return request.scope == DebugTraceScope.FULL_LOG
        if request.action == DebugToolAction.INSPECT_SESSION:
            return request.scope == DebugTraceScope.SESSION
        if request.action == DebugToolAction.INSPECT_CYCLE:
            return request.scope == DebugTraceScope.CYCLE
        return True

    @staticmethod
    def _filter_is_effective(applied_filters: DebugToolFilter) -> bool:
        return any(
            [
                bool(applied_filters.event_types),
                applied_filters.include_stop_related,
                applied_filters.include_wait_related,
                applied_filters.include_policy_decisions,
                applied_filters.include_operator_commands,
                applied_filters.include_persistence_steps,
                applied_filters.include_session_selection_steps,
            ]
        )

    @staticmethod
    def _validation_failure_notes(request: DebugToolRequest, failure_reason: DebugToolFailureReason) -> tuple[str, ...]:
        if failure_reason == DebugToolFailureReason.UNSUPPORTED_ACTION:
            return (f"Debug request {request.action.value} does not support scope {request.scope.value}.",)
        if failure_reason == DebugToolFailureReason.UNKNOWN_SCOPE_TARGET:
            return (f"Debug request {request.action.value} is missing the required scope target.",)
        if failure_reason == DebugToolFailureReason.INVALID_FILTER:
            return ("Debug request filters were missing or invalid for the requested action.",)
        return ("Debug request validation failed.",)

    def _failure_from_trace(self, *, request_id: str, request: DebugToolRequest, trace_result: DebugTraceResult) -> DebugToolResult:
        return self._failure_result(
            request_id=request_id,
            request=request,
            status=self._status_from_trace(trace_result.status),
            failure_reason=self._failure_reason_from_trace(trace_result.failure_reason),
            notes=trace_result.trace_notes or ("Upstream debug trace could not be built.",),
        )

    @staticmethod
    def _status_from_trace(trace_status: DebugTraceStatus) -> DebugToolStatus:
        if trace_status == DebugTraceStatus.PARTIAL:
            return DebugToolStatus.PARTIAL
        if trace_status == DebugTraceStatus.UNSUPPORTED_SCOPE:
            return DebugToolStatus.UNSUPPORTED_REQUEST
        if trace_status == DebugTraceStatus.INVALID:
            return DebugToolStatus.INVALID
        if trace_status == DebugTraceStatus.FAILED:
            return DebugToolStatus.FAILED
        return DebugToolStatus.COMPLETED

    @staticmethod
    def _failure_reason_from_trace(failure_reason: DebugTraceFailureReason | None) -> DebugToolFailureReason:
        if failure_reason == DebugTraceFailureReason.UNKNOWN_SCOPE_TARGET:
            return DebugToolFailureReason.UNKNOWN_SCOPE_TARGET
        if failure_reason == DebugTraceFailureReason.UNSUPPORTED_SCOPE:
            return DebugToolFailureReason.UNSUPPORTED_ACTION
        if failure_reason == DebugTraceFailureReason.INCONSISTENT_TRACE:
            return DebugToolFailureReason.INCONSISTENT_TRACE
        if failure_reason == DebugTraceFailureReason.MALFORMED_REPLAY:
            return DebugToolFailureReason.MALFORMED_REPLAY_INPUT
        return DebugToolFailureReason.MISSING_TRACE_DATA

    @staticmethod
    def _failure_result(
        *,
        request_id: str,
        request: DebugToolRequest,
        status: DebugToolStatus,
        failure_reason: DebugToolFailureReason,
        notes: tuple[str, ...],
    ) -> DebugToolResult:
        return DebugToolResult(
            request_id=request_id,
            action=request.action,
            scope=request.scope,
            view=None,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            applied_filters=request.applied_filters,
            status=status,
            failure_reason=failure_reason,
            notes=request.notes + notes,
        )

    @staticmethod
    def _build_request_id() -> str:
        return f"debug-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"