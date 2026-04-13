from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .execution_debug_trace import ExecutionDebugTrace
from .models import (
    AuditEventType,
    AuditLog,
    DebugToolAction,
    DebugToolFailureReason,
    DebugToolResult,
    DebugToolStatus,
    DebugTraceFailureReason,
    DebugTraceResult,
    DebugTraceScope,
    DebugTraceStatus,
    DebugTraceStep,
    InsightCategory,
    InsightFailureReason,
    InsightItem,
    InsightRequest,
    InsightResult,
    InsightScope,
    InsightStatus,
    InsightSummary,
    PersistedAuditLog,
)


@dataclass(frozen=True)
class _InsightSource:
    steps: tuple[DebugTraceStep, ...]
    summary_notes: tuple[str, ...]
    source_trace_id: str | None
    start_timestamp: str | None
    end_timestamp: str | None
    final_outcome: str | None
    status: InsightStatus


class ExecutionInsights:
    """Extract deterministic, structured insights from replay-backed trace truth."""

    _SUPPORTED_SCOPES = {
        InsightScope.FULL_LOG,
        InsightScope.SESSION,
        InsightScope.CYCLE,
    }
    _FILTERED_DEBUG_ACTIONS = {
        DebugToolAction.LIST_KEY_EVENTS,
        DebugToolAction.FILTER_TRACE_STEPS,
        DebugToolAction.SUMMARIZE_STOP_POINTS,
        DebugToolAction.SUMMARIZE_WAIT_POINTS,
    }
    _PROGRESS_EVENT_TYPES = {
        AuditEventType.LOOP_CYCLE_STARTED,
        AuditEventType.SESSION_SELECTED,
        AuditEventType.ACTION_EXECUTED,
        AuditEventType.STATE_PERSISTED,
    }

    def __init__(self, trace_builder: ExecutionDebugTrace | None = None) -> None:
        self._trace_builder = trace_builder or ExecutionDebugTrace()

    def generate_insights(
        self,
        request: InsightRequest,
        *,
        audit_log: PersistedAuditLog | AuditLog | None = None,
        trace_result: DebugTraceResult | None = None,
        debug_result: DebugToolResult | None = None,
    ) -> InsightResult:
        insight_id = request.request_id or self._build_insight_id()
        validation_failure = self._validate_request(request)
        if validation_failure is not None:
            return self._failure_result(
                insight_id=insight_id,
                request=request,
                status=InsightStatus.INVALID if validation_failure != InsightFailureReason.UNSUPPORTED_SCOPE else InsightStatus.UNSUPPORTED_SCOPE,
                failure_reason=validation_failure,
                notes=self._validation_failure_notes(request, validation_failure),
            )

        source = self._resolve_source(request, audit_log=audit_log, trace_result=trace_result, debug_result=debug_result)
        if isinstance(source, InsightResult):
            return source

        items = self._extract_items(source.steps)
        top_blockers = self._top_blockers(items)
        top_transitions = self._top_transitions(items)
        summary = self._build_summary(source, items, top_blockers)
        notes = request.notes + source.summary_notes
        return InsightResult(
            insight_id=insight_id,
            status=source.status,
            scope=request.scope,
            summary=summary,
            items=items,
            top_blockers=top_blockers,
            top_transitions=top_transitions,
            final_outcome=summary.main_outcome,
            source_trace_id=source.source_trace_id,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            notes=notes,
            start_timestamp=source.start_timestamp,
            end_timestamp=source.end_timestamp,
            failure_reason=None,
        )

    def build_full_log_insights(self, audit_log: PersistedAuditLog | AuditLog) -> InsightResult:
        return self.generate_insights(InsightRequest(scope=InsightScope.FULL_LOG), audit_log=audit_log)

    def build_session_insights(self, audit_log: PersistedAuditLog | AuditLog, session_id: str) -> InsightResult:
        return self.generate_insights(
            InsightRequest(scope=InsightScope.SESSION, target_session_id=session_id),
            audit_log=audit_log,
        )

    def build_cycle_insights(self, audit_log: PersistedAuditLog | AuditLog, cycle_id: int) -> InsightResult:
        return self.generate_insights(
            InsightRequest(scope=InsightScope.CYCLE, target_cycle_id=cycle_id),
            audit_log=audit_log,
        )

    def _resolve_source(
        self,
        request: InsightRequest,
        *,
        audit_log: PersistedAuditLog | AuditLog | None,
        trace_result: DebugTraceResult | None,
        debug_result: DebugToolResult | None,
    ) -> _InsightSource | InsightResult:
        if debug_result is not None:
            return self._source_from_debug_result(request, debug_result)

        if trace_result is None:
            if audit_log is None:
                return self._failure_result(
                    insight_id=request.request_id or self._build_insight_id(),
                    request=request,
                    status=InsightStatus.INVALID,
                    failure_reason=InsightFailureReason.MISSING_TRACE_DATA,
                    notes=("Execution insight generation requires a trace result, debug result, or audit log.",),
                )
            trace_result = self._trace_from_audit_log(request, audit_log)

        return self._source_from_trace_result(request, trace_result)

    def _trace_from_audit_log(self, request: InsightRequest, audit_log: PersistedAuditLog | AuditLog) -> DebugTraceResult:
        if request.scope == InsightScope.FULL_LOG:
            return self._trace_builder.build_full_log_trace(audit_log)
        if request.scope == InsightScope.SESSION:
            return self._trace_builder.build_session_trace(audit_log, request.target_session_id or "")
        return self._trace_builder.build_cycle_trace(audit_log, request.target_cycle_id or -1)

    def _source_from_trace_result(self, request: InsightRequest, trace_result: DebugTraceResult) -> _InsightSource | InsightResult:
        if request.source_trace_id is not None and request.source_trace_id != trace_result.trace_id:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE,
                notes=("Insight request source trace id did not match the provided trace result.",),
            )
        if trace_result.scope.value != request.scope.value:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE,
                notes=("Insight request scope did not match the provided trace scope.",),
            )
        if trace_result.status in {DebugTraceStatus.INVALID, DebugTraceStatus.FAILED, DebugTraceStatus.UNSUPPORTED_SCOPE}:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=self._status_from_trace_status(trace_result.status),
                failure_reason=self._failure_from_trace_failure(trace_result.failure_reason),
                notes=trace_result.trace_notes or ("Upstream trace could not be converted into structured insights.",),
            )
        if not trace_result.ordered_steps and trace_result.summary is None:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.MALFORMED_TRACE,
                notes=("Trace result did not include steps or summary data for insight generation.",),
            )

        notes = trace_result.trace_notes + (trace_result.summary.summary_notes if trace_result.summary else ())
        return _InsightSource(
            steps=trace_result.ordered_steps,
            summary_notes=notes,
            source_trace_id=trace_result.trace_id,
            start_timestamp=trace_result.start_timestamp,
            end_timestamp=trace_result.end_timestamp,
            final_outcome=trace_result.summary.final_outcome if trace_result.summary else None,
            status=InsightStatus.PARTIAL if trace_result.status == DebugTraceStatus.PARTIAL else InsightStatus.GENERATED,
        )

    def _source_from_debug_result(self, request: InsightRequest, debug_result: DebugToolResult) -> _InsightSource | InsightResult:
        if debug_result.scope.value != request.scope.value:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE,
                notes=("Insight request scope did not match the provided debug result scope.",),
            )
        if request.source_debug_request_id is not None and request.source_debug_request_id != debug_result.request_id:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE,
                notes=("Insight request debug source id did not match the provided debug result.",),
            )
        if request.source_trace_id is not None and request.source_trace_id != debug_result.source_trace_id:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE,
                notes=("Insight request source trace id did not match the provided debug result.",),
            )
        if debug_result.status in {DebugToolStatus.INVALID, DebugToolStatus.FAILED, DebugToolStatus.UNSUPPORTED_REQUEST}:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=self._status_from_debug_status(debug_result.status),
                failure_reason=self._failure_from_debug_failure(debug_result.failure_reason),
                notes=debug_result.notes or ("Upstream debug result could not be converted into structured insights.",),
            )
        if debug_result.view is None:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.MISSING_TRACE_DATA,
                notes=("Debug result did not include trace steps for insight generation.",),
            )
        if not debug_result.view.returned_steps and debug_result.view.summary is None:
            return self._failure_result(
                insight_id=request.request_id or self._build_insight_id(),
                request=request,
                status=InsightStatus.INVALID,
                failure_reason=InsightFailureReason.MALFORMED_TRACE,
                notes=("Debug result view was empty and could not produce structured insights.",),
            )

        notes = debug_result.notes + (debug_result.view.summary.summary_notes if debug_result.view.summary else ())
        status = InsightStatus.PARTIAL if debug_result.status == DebugToolStatus.PARTIAL else InsightStatus.GENERATED
        if debug_result.action in self._FILTERED_DEBUG_ACTIONS:
            status = InsightStatus.PARTIAL
            notes = notes + (f"Insight generation used filtered debug output from {debug_result.action.value}.",)
        start_timestamp = debug_result.view.returned_steps[0].timestamp if debug_result.view.returned_steps else None
        end_timestamp = debug_result.view.returned_steps[-1].timestamp if debug_result.view.returned_steps else None
        return _InsightSource(
            steps=debug_result.view.returned_steps,
            summary_notes=notes,
            source_trace_id=debug_result.source_trace_id,
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
            final_outcome=debug_result.view.summary.final_outcome if debug_result.view.summary else None,
            status=status,
        )

    def _extract_items(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        extracted = []
        extracted.extend(self._extract_stop_points(steps))
        extracted.extend(self._extract_wait_points(steps))
        extracted.extend(self._extract_resume_points(steps))
        extracted.extend(self._extract_policy_transitions(steps))
        extracted.extend(self._extract_operator_transitions(steps))
        extracted.extend(self._extract_selection_transitions(steps))
        extracted.extend(self._extract_persistence_milestones(steps))
        extracted.extend(self._extract_blockers(steps))
        extracted.extend(self._extract_completion_items(steps))
        return tuple(sorted(extracted, key=lambda item: (item.sequence_index, item.category.value)))

    def _extract_stop_points(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.STOP_POINT,
                step=step,
                title="Stop Point",
                detail=f"Execution stopped because {step.reason or step.explanation.lower()}",
                tags=(("waiting",) if self._is_wait_step(step) else ()),
            )
            for step in steps
            if step.event_type == AuditEventType.ACTION_BLOCKED
        )

    def _extract_wait_points(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.WAIT_POINT,
                step=step,
                title="Wait Point",
                detail=f"Execution is waiting because {step.reason or step.explanation.lower()}",
            )
            for step in steps
            if self._is_wait_step(step)
        )

    def _extract_resume_points(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        items: list[InsightItem] = []
        pending_resume_from: DebugTraceStep | None = None
        for step in steps:
            if step.event_type == AuditEventType.ACTION_BLOCKED:
                pending_resume_from = step
                continue
            if pending_resume_from is None:
                continue
            if step.event_type in self._PROGRESS_EVENT_TYPES:
                items.append(
                    self._build_item(
                        category=InsightCategory.RESUME_POINT,
                        step=step,
                        title="Resume Point",
                        detail=f"Progress resumed at {step.event_type.value} after blocker {pending_resume_from.event_id}.",
                        related_event_id=pending_resume_from.event_id,
                    )
                )
                pending_resume_from = None
        return tuple(items)

    def _extract_policy_transitions(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.POLICY_TRANSITION,
                step=step,
                title="Policy Transition",
                detail=f"Policy recorded {step.policy_decision or 'an unspecified decision'} for the selected action.",
                tags=((step.policy_decision,) if step.policy_decision else ()),
            )
            for step in steps
            if step.event_type == AuditEventType.POLICY_DECISION_MADE
        )

    def _extract_operator_transitions(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.OPERATOR_TRANSITION,
                step=step,
                title="Operator Transition",
                detail=self._operator_transition_detail(step),
            )
            for step in steps
            if step.event_type in {
                AuditEventType.OPERATOR_COMMAND_RECEIVED,
                AuditEventType.OPERATOR_COMMAND_EXECUTED,
                AuditEventType.OPERATOR_COMMAND_REJECTED,
            }
        )

    def _extract_selection_transitions(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.SELECTION_TRANSITION,
                step=step,
                title="Selection Transition",
                detail=f"Selected session {step.session_id or 'unknown'} for bounded work in cycle {step.cycle_index}.",
            )
            for step in steps
            if step.event_type == AuditEventType.SESSION_SELECTED
        )

    def _extract_persistence_milestones(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.PERSISTENCE_MILESTONE,
                step=step,
                title="Persistence Milestone",
                detail=f"State persisted for session {step.session_id or 'unknown'} in cycle {step.cycle_index}.",
            )
            for step in steps
            if step.event_type == AuditEventType.STATE_PERSISTED
        )

    def _extract_blockers(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.BLOCKER,
                step=step,
                title="Blocker",
                detail=f"Blocked by {step.reason or 'an unspecified constraint'}.",
                tags=(("wait",) if self._is_wait_step(step) else ()),
            )
            for step in steps
            if step.event_type == AuditEventType.ACTION_BLOCKED
        )

    def _extract_completion_items(self, steps: tuple[DebugTraceStep, ...]) -> tuple[InsightItem, ...]:
        return tuple(
            self._build_item(
                category=InsightCategory.COMPLETION,
                step=step,
                title="Completion",
                detail=f"Cycle {step.cycle_index} completed for the selected scope.",
            )
            for step in steps
            if step.event_type == AuditEventType.LOOP_CYCLE_COMPLETED
        )

    def _top_blockers(self, items: tuple[InsightItem, ...]) -> tuple[InsightItem, ...]:
        blockers = [item for item in items if item.category in {InsightCategory.BLOCKER, InsightCategory.WAIT_POINT, InsightCategory.STOP_POINT}]
        return tuple(sorted(blockers, key=lambda item: item.sequence_index, reverse=True)[:3])

    def _top_transitions(self, items: tuple[InsightItem, ...]) -> tuple[InsightItem, ...]:
        transitions = [
            item
            for item in items
            if item.category
            in {
                InsightCategory.OPERATOR_TRANSITION,
                InsightCategory.POLICY_TRANSITION,
                InsightCategory.SELECTION_TRANSITION,
                InsightCategory.PERSISTENCE_MILESTONE,
                InsightCategory.RESUME_POINT,
                InsightCategory.COMPLETION,
            }
        ]
        return tuple(transitions[:5])

    def _build_summary(
        self,
        source: _InsightSource,
        items: tuple[InsightItem, ...],
        top_blockers: tuple[InsightItem, ...],
    ) -> InsightSummary:
        stop_points = [item for item in items if item.category == InsightCategory.STOP_POINT]
        wait_points = [item for item in items if item.category == InsightCategory.WAIT_POINT]
        resume_points = [item for item in items if item.category == InsightCategory.RESUME_POINT]
        completion_items = [item for item in items if item.category == InsightCategory.COMPLETION]
        terminal_blocker = self._terminal_blocker(items)
        main_outcome = self._derive_main_outcome(source, terminal_blocker, completion_items)
        return InsightSummary(
            main_outcome=main_outcome,
            first_stop_point=stop_points[0].detail if stop_points else None,
            latest_wait_point=wait_points[-1].detail if wait_points else None,
            progress_resumed=bool(resume_points),
            terminal_blocker=terminal_blocker.detail if terminal_blocker else None,
            completion_state=completion_items[-1].detail if completion_items else None,
            next_inspection_hint=self._derive_next_inspection_hint(source, items, terminal_blocker, wait_points),
            summary_notes=source.summary_notes,
        )

    def _derive_main_outcome(
        self,
        source: _InsightSource,
        terminal_blocker: InsightItem | None,
        completion_items: list[InsightItem],
    ) -> str:
        if source.status == InsightStatus.PARTIAL:
            return "partial"
        if terminal_blocker is not None:
            if "wait" in terminal_blocker.detail.lower() or "review" in terminal_blocker.detail.lower() or "gate" in terminal_blocker.detail.lower():
                return "waiting"
            return "blocked"
        if completion_items:
            return "completed"
        if source.final_outcome is not None and "persisted" in source.final_outcome.lower():
            return "persisted"
        if source.final_outcome is not None:
            return source.final_outcome
        return "incomplete"

    def _derive_next_inspection_hint(
        self,
        source: _InsightSource,
        items: tuple[InsightItem, ...],
        terminal_blocker: InsightItem | None,
        wait_points: list[InsightItem],
    ) -> str | None:
        if source.status == InsightStatus.PARTIAL:
            return "inspect incomplete replay history"
        if terminal_blocker is not None:
            blocker_text = terminal_blocker.detail.lower()
            if "review" in blocker_text or "gate" in blocker_text:
                return "inspect unresolved review gate"
            if "artifact" in blocker_text:
                return "inspect missing artifact contract"
            if "dependency" in blocker_text:
                return "inspect invalid dependency reference"
            return "inspect latest blocker condition"
        if wait_points and not any(item.category == InsightCategory.RESUME_POINT for item in items):
            return "inspect latest wait condition"
        if any(item.category == InsightCategory.PERSISTENCE_MILESTONE for item in items):
            return "inspect final persistence milestone"
        return "inspect latest key transition" if source.final_outcome else None

    @staticmethod
    def _terminal_blocker(items: tuple[InsightItem, ...]) -> InsightItem | None:
        blockers = [item for item in items if item.category == InsightCategory.BLOCKER]
        completions = [item for item in items if item.category == InsightCategory.COMPLETION]
        latest_completion_index = completions[-1].sequence_index if completions else -1
        terminal_candidates = [item for item in blockers if item.sequence_index > latest_completion_index]
        if terminal_candidates:
            return terminal_candidates[-1]
        if completions:
            return None
        return blockers[-1] if blockers else None

    @staticmethod
    def _build_item(
        *,
        category: InsightCategory,
        step: DebugTraceStep,
        title: str,
        detail: str,
        related_event_id: str | None = None,
        tags: tuple[str, ...] = (),
    ) -> InsightItem:
        return InsightItem(
            category=category,
            event_id=step.event_id,
            event_type=step.event_type,
            timestamp=step.timestamp,
            sequence_index=step.sequence_index,
            title=title,
            detail=detail,
            session_id=step.session_id,
            cycle_index=step.cycle_index,
            related_event_id=related_event_id,
            tags=tags,
        )

    @staticmethod
    def _is_wait_step(step: DebugTraceStep) -> bool:
        if step.event_type != AuditEventType.ACTION_BLOCKED:
            return False
        reason = (step.reason or "").lower()
        action_type = (step.action_type or "").lower()
        return action_type == "wait" or "wait" in reason or "review" in reason or "gate" in reason

    @staticmethod
    def _operator_transition_detail(step: DebugTraceStep) -> str:
        command = step.operator_command or "an operator command"
        if step.event_type == AuditEventType.OPERATOR_COMMAND_RECEIVED:
            return f"Received operator command {command}."
        if step.event_type == AuditEventType.OPERATOR_COMMAND_EXECUTED:
            return f"Operator command {command} executed within bounded runtime control."
        return f"Operator command {command} was rejected without runtime mutation."

    @staticmethod
    def _status_from_trace_status(status: DebugTraceStatus) -> InsightStatus:
        if status == DebugTraceStatus.PARTIAL:
            return InsightStatus.PARTIAL
        if status == DebugTraceStatus.UNSUPPORTED_SCOPE:
            return InsightStatus.UNSUPPORTED_SCOPE
        if status == DebugTraceStatus.INVALID:
            return InsightStatus.INVALID
        return InsightStatus.FAILED

    @staticmethod
    def _failure_from_trace_failure(failure_reason: DebugTraceFailureReason | None) -> InsightFailureReason:
        if failure_reason == DebugTraceFailureReason.UNKNOWN_SCOPE_TARGET:
            return InsightFailureReason.UNKNOWN_SCOPE_TARGET
        if failure_reason == DebugTraceFailureReason.UNSUPPORTED_SCOPE:
            return InsightFailureReason.UNSUPPORTED_SCOPE
        if failure_reason == DebugTraceFailureReason.INCONSISTENT_TRACE:
            return InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE
        if failure_reason == DebugTraceFailureReason.MALFORMED_REPLAY:
            return InsightFailureReason.MALFORMED_TRACE
        return InsightFailureReason.MISSING_TRACE_DATA

    @staticmethod
    def _status_from_debug_status(status: DebugToolStatus) -> InsightStatus:
        if status == DebugToolStatus.PARTIAL:
            return InsightStatus.PARTIAL
        if status == DebugToolStatus.UNSUPPORTED_REQUEST:
            return InsightStatus.UNSUPPORTED_SCOPE
        if status == DebugToolStatus.INVALID:
            return InsightStatus.INVALID
        return InsightStatus.FAILED

    @staticmethod
    def _failure_from_debug_failure(failure_reason: DebugToolFailureReason | None) -> InsightFailureReason:
        if failure_reason == DebugToolFailureReason.UNKNOWN_SCOPE_TARGET:
            return InsightFailureReason.UNKNOWN_SCOPE_TARGET
        if failure_reason == DebugToolFailureReason.UNSUPPORTED_ACTION:
            return InsightFailureReason.UNSUPPORTED_SCOPE
        if failure_reason == DebugToolFailureReason.INCONSISTENT_TRACE:
            return InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE
        if failure_reason == DebugToolFailureReason.MALFORMED_REPLAY_INPUT:
            return InsightFailureReason.MALFORMED_TRACE
        return InsightFailureReason.MISSING_TRACE_DATA

    def _validate_request(self, request: InsightRequest) -> InsightFailureReason | None:
        if request.scope not in self._SUPPORTED_SCOPES:
            return InsightFailureReason.UNSUPPORTED_SCOPE
        if request.scope == InsightScope.SESSION and request.target_session_id is None:
            return InsightFailureReason.UNKNOWN_SCOPE_TARGET
        if request.scope == InsightScope.CYCLE and request.target_cycle_id is None:
            return InsightFailureReason.UNKNOWN_SCOPE_TARGET
        return None

    @staticmethod
    def _validation_failure_notes(request: InsightRequest, failure_reason: InsightFailureReason) -> tuple[str, ...]:
        if failure_reason == InsightFailureReason.UNSUPPORTED_SCOPE:
            return (f"Execution insight scope {request.scope.value} is not supported in v1.",)
        if failure_reason == InsightFailureReason.UNKNOWN_SCOPE_TARGET:
            return (f"Execution insight request for scope {request.scope.value} is missing its target identifier.",)
        return ("Execution insight request validation failed.",)

    @staticmethod
    def _failure_result(
        *,
        insight_id: str,
        request: InsightRequest,
        status: InsightStatus,
        failure_reason: InsightFailureReason,
        notes: tuple[str, ...],
    ) -> InsightResult:
        return InsightResult(
            insight_id=insight_id,
            status=status,
            scope=request.scope,
            summary=None,
            items=(),
            top_blockers=(),
            top_transitions=(),
            final_outcome=None,
            source_trace_id=request.source_trace_id,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            notes=request.notes + notes,
            start_timestamp=None,
            end_timestamp=None,
            failure_reason=failure_reason,
        )

    @staticmethod
    def _build_insight_id() -> str:
        return f"insight-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"