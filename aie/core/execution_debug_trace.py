from __future__ import annotations

from datetime import datetime, timezone

from .execution_replay import ExecutionReplay
from .models import (
    AuditEventType,
    AuditLog,
    DebugTraceFailureReason,
    DebugTraceRequest,
    DebugTraceResult,
    DebugTraceScope,
    DebugTraceStatus,
    DebugTraceStep,
    DebugTraceSummary,
    PersistedAuditLog,
    ReplayFailureReason,
    ReplayRequest,
    ReplayResult,
    ReplayScope,
    ReplayStatus,
    ReplayStep,
)


class ExecutionDebugTrace:
    """Build structured, human-readable debug traces from deterministic replay results."""

    _SUPPORTED_SCOPES = {
        DebugTraceScope.FULL_LOG,
        DebugTraceScope.SESSION,
        DebugTraceScope.CYCLE,
    }

    def __init__(self, replay_engine: ExecutionReplay | None = None) -> None:
        self._replay_engine = replay_engine or ExecutionReplay()

    def build_trace(self, replay_result: ReplayResult, request: DebugTraceRequest | None = None) -> DebugTraceResult:
        trace_request = request or self._request_from_replay(replay_result)
        trace_id = self._build_trace_id()
        if trace_request.scope not in self._SUPPORTED_SCOPES:
            return self._failure_result(
                trace_id=trace_id,
                request=trace_request,
                source_replay_id=replay_result.replay_id,
                status=DebugTraceStatus.UNSUPPORTED_SCOPE,
                failure_reason=DebugTraceFailureReason.UNSUPPORTED_SCOPE,
                trace_notes=(f"Debug trace scope {trace_request.scope.value} is not supported in trace v1.",),
            )

        replay_failure = self._map_replay_failure(replay_result)
        if replay_result.timeline is None:
            return self._failure_result(
                trace_id=trace_id,
                request=trace_request,
                source_replay_id=replay_result.replay_id,
                status=DebugTraceStatus.INVALID if replay_failure != DebugTraceFailureReason.UNSUPPORTED_SCOPE else DebugTraceStatus.UNSUPPORTED_SCOPE,
                failure_reason=replay_failure,
                trace_notes=replay_result.replay_notes or ("Replay result did not contain timeline data.",),
            )

        debug_steps = self._map_replay_steps(replay_result.timeline.reconstructed_steps)
        summary = self._derive_trace_summary(replay_result)
        status = self._map_replay_status(replay_result.status)
        failure_reason = self._map_replay_failure(replay_result) if status != DebugTraceStatus.BUILT else None
        return DebugTraceResult(
            trace_id=trace_id,
            status=status,
            scope=trace_request.scope,
            summary=summary,
            ordered_steps=debug_steps,
            target_session_id=trace_request.target_session_id,
            target_cycle_id=trace_request.target_cycle_id,
            source_replay_id=replay_result.replay_id,
            start_timestamp=replay_result.timeline.start_timestamp,
            end_timestamp=replay_result.timeline.end_timestamp,
            trace_notes=trace_request.trace_notes + replay_result.replay_notes,
            failure_reason=failure_reason,
        )

    def build_full_log_trace(self, audit_log: PersistedAuditLog | AuditLog) -> DebugTraceResult:
        replay_result = self._replay_engine.replay_full_log(audit_log)
        return self.build_trace(replay_result, DebugTraceRequest(scope=DebugTraceScope.FULL_LOG, source_replay_id=replay_result.replay_id))

    def build_session_trace(self, audit_log: PersistedAuditLog | AuditLog, session_id: str) -> DebugTraceResult:
        replay_result = self._replay_engine.replay_session(audit_log, session_id)
        return self.build_trace(
            replay_result,
            DebugTraceRequest(
                scope=DebugTraceScope.SESSION,
                target_session_id=session_id,
                source_replay_id=replay_result.replay_id,
            ),
        )

    def build_cycle_trace(self, audit_log: PersistedAuditLog | AuditLog, cycle_id: int) -> DebugTraceResult:
        replay_result = self._replay_engine.replay_cycle(audit_log, cycle_id)
        return self.build_trace(
            replay_result,
            DebugTraceRequest(
                scope=DebugTraceScope.CYCLE,
                target_cycle_id=cycle_id,
                source_replay_id=replay_result.replay_id,
            ),
        )

    def build_trace_from_audit_log(
        self,
        audit_log: PersistedAuditLog | AuditLog,
        request: DebugTraceRequest,
    ) -> DebugTraceResult:
        replay_result = self._replay_engine.replay(
            audit_log,
            ReplayRequest(
                scope=self._replay_scope_for_trace_scope(request.scope),
                target_session_id=request.target_session_id,
                target_cycle_id=request.target_cycle_id,
                replay_id=request.source_replay_id,
                replay_notes=request.trace_notes,
            ),
        )
        return self.build_trace(replay_result, request)

    def _map_replay_steps(self, replay_steps: tuple[ReplayStep, ...]) -> tuple[DebugTraceStep, ...]:
        return tuple(
            DebugTraceStep(
                sequence_index=step.sequence_index,
                title=self._title_for_event_type(step.event_type),
                explanation=self._explanation_for_step(step),
                event_id=step.event_id,
                event_type=step.event_type,
                timestamp=step.timestamp,
                session_id=step.record.event.session_id or step.record.context.session_id,
                cycle_index=step.record.event.cycle_index if step.record.event.cycle_index is not None else step.record.context.cycle_index,
                action_type=step.record.event.action_type or step.record.context.action_type,
                policy_decision=step.record.event.policy_decision,
                operator_command=step.record.event.operator_command,
                reason=step.record.event.reason,
                step_notes=step.replay_notes,
            )
            for step in replay_steps
        )

    def _derive_trace_summary(self, replay_result: ReplayResult) -> DebugTraceSummary:
        timeline = replay_result.timeline
        return DebugTraceSummary(
            start_timestamp=timeline.start_timestamp if timeline else None,
            end_timestamp=timeline.end_timestamp if timeline else None,
            final_outcome=self._derive_final_outcome(replay_result),
            stop_reason=self._derive_stop_reason(replay_result),
            wait_reason=self._derive_wait_reason(replay_result),
            summary_notes=replay_result.derived_outcomes,
        )

    def _derive_final_outcome(self, replay_result: ReplayResult) -> str:
        if replay_result.timeline is None:
            return "No replay timeline was available to build a debug trace."
        if replay_result.status == ReplayStatus.PARTIAL:
            return "Replay produced a partial trace because the selected history window was incomplete."
        if replay_result.failure_reason == ReplayFailureReason.INVALID_EVENT_ORDER:
            return "Replay failed because event ordering in the selected history was inconsistent."
        last_step = replay_result.timeline.reconstructed_steps[-1] if replay_result.timeline.reconstructed_steps else None
        if last_step is None:
            return "Replay produced no traceable steps."
        if last_step.event_type == AuditEventType.LOOP_CYCLE_COMPLETED:
            return "Execution reached loop cycle completion in the selected trace scope."
        if last_step.event_type == AuditEventType.ACTION_BLOCKED:
            return "Execution ended in a blocked state in the selected trace scope."
        if last_step.event_type == AuditEventType.STATE_PERSISTED:
            return "Execution persisted state successfully before the trace ended."
        return f"Execution trace ended with event {last_step.event_type.value}."

    def _derive_stop_reason(self, replay_result: ReplayResult) -> str | None:
        if replay_result.failure_reason == ReplayFailureReason.INVALID_EVENT_ORDER:
            return "Trace stopped because replay detected invalid event ordering."
        if replay_result.failure_reason == ReplayFailureReason.UNKNOWN_CYCLE:
            return "Trace could not start because the requested cycle was not present."
        if replay_result.failure_reason == ReplayFailureReason.UNKNOWN_SESSION:
            return "Trace could not start because the requested session was not present."
        if replay_result.timeline is None:
            return None
        blocked_steps = [step for step in replay_result.timeline.reconstructed_steps if step.event_type == AuditEventType.ACTION_BLOCKED]
        if blocked_steps:
            last_blocked = blocked_steps[-1]
            reason = last_blocked.record.event.reason or "no explicit reason was recorded"
            return f"Execution stopped because action was blocked: {reason}."
        return None

    def _derive_wait_reason(self, replay_result: ReplayResult) -> str | None:
        if replay_result.timeline is None:
            return None
        blocked_steps = [step for step in replay_result.timeline.reconstructed_steps if step.event_type == AuditEventType.ACTION_BLOCKED]
        for step in blocked_steps:
            reason = step.record.event.reason
            if reason and "wait" in reason:
                return f"Execution waited because {reason}."
            if reason and "review" in reason:
                return f"Execution waited because {reason}."
        return None

    def _explanation_for_step(self, step: ReplayStep) -> str:
        record = step.record
        session_id = record.event.session_id or record.context.session_id
        cycle_index = record.event.cycle_index if record.event.cycle_index is not None else record.context.cycle_index
        if step.event_type == AuditEventType.OPERATOR_COMMAND_RECEIVED:
            command = record.event.operator_command or "an operator command"
            return f"Received operator command {command} for bounded execution review."
        if step.event_type == AuditEventType.POLICY_DECISION_MADE:
            decision = record.event.policy_decision or "an unspecified policy decision"
            return f"Policy evaluated the requested action and returned {decision}."
        if step.event_type == AuditEventType.LOOP_CYCLE_STARTED:
            return f"Loop cycle {cycle_index} started for deterministic bounded execution."
        if step.event_type == AuditEventType.SESSION_SELECTED:
            return f"Selected session {session_id} for the next bounded action."
        if step.event_type == AuditEventType.ACTION_EXECUTED:
            action = record.event.action_type or "an execution step"
            return f"Executed {action} for session {session_id}."
        if step.event_type == AuditEventType.ACTION_BLOCKED:
            reason = record.event.reason or "no explicit reason was recorded"
            return f"Blocked further execution because {reason}."
        if step.event_type == AuditEventType.STATE_PERSISTED:
            return f"Persisted bounded state for session {session_id}."
        if step.event_type == AuditEventType.LOOP_CYCLE_COMPLETED:
            return f"Loop cycle {cycle_index} completed for the selected trace scope."
        if step.event_type == AuditEventType.OPERATOR_COMMAND_EXECUTED:
            return "Marked the operator command as executed."
        if step.event_type == AuditEventType.OPERATOR_COMMAND_REJECTED:
            return "Rejected the operator command without mutating runtime state."
        if step.event_type == AuditEventType.SESSION_STATE_CHANGED:
            before = record.event.previous_state or "unknown"
            after = record.event.new_state or "unknown"
            return f"Session {session_id} changed state from {before} to {after}."
        return step.summary

    @staticmethod
    def _title_for_event_type(event_type: AuditEventType) -> str:
        titles = {
            AuditEventType.OPERATOR_COMMAND_RECEIVED: "Operator Command Received",
            AuditEventType.OPERATOR_COMMAND_EXECUTED: "Operator Command Executed",
            AuditEventType.OPERATOR_COMMAND_REJECTED: "Operator Command Rejected",
            AuditEventType.POLICY_DECISION_MADE: "Policy Decision Recorded",
            AuditEventType.LOOP_CYCLE_STARTED: "Loop Cycle Started",
            AuditEventType.LOOP_CYCLE_COMPLETED: "Loop Cycle Completed",
            AuditEventType.SESSION_SELECTED: "Session Selected",
            AuditEventType.ACTION_EXECUTED: "Action Executed",
            AuditEventType.ACTION_BLOCKED: "Action Blocked",
            AuditEventType.STATE_PERSISTED: "State Persisted",
            AuditEventType.SESSION_STATE_CHANGED: "Session State Changed",
        }
        return titles.get(event_type, event_type.value.replace("_", " ").title())

    @staticmethod
    def _map_replay_status(replay_status: ReplayStatus) -> DebugTraceStatus:
        if replay_status == ReplayStatus.REPLAYED:
            return DebugTraceStatus.BUILT
        if replay_status == ReplayStatus.PARTIAL:
            return DebugTraceStatus.PARTIAL
        if replay_status == ReplayStatus.UNSUPPORTED_SCOPE:
            return DebugTraceStatus.UNSUPPORTED_SCOPE
        if replay_status == ReplayStatus.INVALID:
            return DebugTraceStatus.INVALID
        return DebugTraceStatus.FAILED

    @staticmethod
    def _map_replay_failure(replay_result: ReplayResult) -> DebugTraceFailureReason:
        if replay_result.failure_reason in {ReplayFailureReason.UNKNOWN_SESSION, ReplayFailureReason.UNKNOWN_CYCLE}:
            return DebugTraceFailureReason.UNKNOWN_SCOPE_TARGET
        if replay_result.failure_reason == ReplayFailureReason.UNSUPPORTED_SCOPE:
            return DebugTraceFailureReason.UNSUPPORTED_SCOPE
        if replay_result.failure_reason == ReplayFailureReason.INVALID_EVENT_ORDER:
            return DebugTraceFailureReason.INCONSISTENT_TRACE
        if replay_result.failure_reason in {ReplayFailureReason.MALFORMED_HISTORY, ReplayFailureReason.INCONSISTENT_TIMELINE}:
            return DebugTraceFailureReason.MALFORMED_REPLAY
        return DebugTraceFailureReason.MISSING_REPLAY_DATA

    @staticmethod
    def _request_from_replay(replay_result: ReplayResult) -> DebugTraceRequest:
        return DebugTraceRequest(
            scope=DebugTraceScope(replay_result.scope.value),
            target_session_id=replay_result.target_session_id,
            target_cycle_id=replay_result.target_cycle_id,
            source_replay_id=replay_result.replay_id,
        )

    @staticmethod
    def _replay_scope_for_trace_scope(scope: DebugTraceScope) -> ReplayScope:
        return ReplayScope(scope.value)

    @staticmethod
    def _failure_result(
        *,
        trace_id: str,
        request: DebugTraceRequest,
        source_replay_id: str | None,
        status: DebugTraceStatus,
        failure_reason: DebugTraceFailureReason,
        trace_notes: tuple[str, ...],
    ) -> DebugTraceResult:
        return DebugTraceResult(
            trace_id=trace_id,
            status=status,
            scope=request.scope,
            summary=None,
            ordered_steps=(),
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            source_replay_id=source_replay_id,
            start_timestamp=None,
            end_timestamp=None,
            trace_notes=request.trace_notes + trace_notes,
            failure_reason=failure_reason,
        )

    @staticmethod
    def _build_trace_id() -> str:
        return f"trace-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"