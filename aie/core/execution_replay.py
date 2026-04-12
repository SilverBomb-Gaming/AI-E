from __future__ import annotations

from datetime import datetime, timezone

from .models import (
    AuditEventType,
    AuditLog,
    AuditRecord,
    PersistedAuditLog,
    ReplayFailureReason,
    ReplayRequest,
    ReplayResult,
    ReplayScope,
    ReplayStatus,
    ReplayStep,
    ReplayTimeline,
)


class ExecutionReplay:
    """Deterministically reconstruct replay timelines from persisted audit truth."""

    _SUPPORTED_SCOPES = {
        ReplayScope.FULL_LOG,
        ReplayScope.SESSION,
        ReplayScope.CYCLE,
    }

    def replay(self, audit_log: PersistedAuditLog | AuditLog, request: ReplayRequest) -> ReplayResult:
        replay_id = request.replay_id or self._build_replay_id()
        all_records = self._records_for_log(audit_log)
        if request.scope not in self._SUPPORTED_SCOPES:
            return self._failure_result(
                replay_id=replay_id,
                request=request,
                status=ReplayStatus.UNSUPPORTED_SCOPE,
                failure_reason=ReplayFailureReason.UNSUPPORTED_SCOPE,
                replay_notes=(f"Replay scope {request.scope.value} is not supported in replay v1.",),
            )

        selected_records, selection_failure = self._records_for_scope(all_records, request)
        if selection_failure is not None:
            return self._failure_result(
                replay_id=replay_id,
                request=request,
                status=ReplayStatus.INVALID,
                failure_reason=selection_failure,
                replay_notes=self._selection_failure_notes(request, selection_failure),
            )

        if not selected_records:
            return self._failure_result(
                replay_id=replay_id,
                request=request,
                status=ReplayStatus.INVALID,
                failure_reason=ReplayFailureReason.MISSING_EVENTS,
                replay_notes=("Replay request did not resolve to any audit events.",),
            )

        ordering_errors = self._validate_event_order(selected_records)
        if ordering_errors:
            return self._failure_result(
                replay_id=replay_id,
                request=request,
                status=ReplayStatus.FAILED,
                failure_reason=ReplayFailureReason.INVALID_EVENT_ORDER,
                replay_notes=tuple(ordering_errors),
            )

        steps = self._build_replay_steps(selected_records)
        derived_outcomes = self._derive_outcomes(selected_records, request)
        timeline_notes, status, failure_reason = self._assess_timeline(selected_records, request)
        timeline = ReplayTimeline(
            scope=request.scope,
            event_ids=tuple(record.event_id for record in selected_records),
            reconstructed_steps=steps,
            start_timestamp=selected_records[0].event.timestamp if selected_records else None,
            end_timestamp=selected_records[-1].event.timestamp if selected_records else None,
            derived_outcomes=derived_outcomes,
        )
        return ReplayResult(
            replay_id=replay_id,
            status=status,
            scope=request.scope,
            timeline=timeline,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            replay_notes=request.replay_notes + timeline_notes,
            derived_outcomes=derived_outcomes,
            failure_reason=failure_reason,
        )

    def replay_full_log(self, audit_log: PersistedAuditLog | AuditLog) -> ReplayResult:
        return self.replay(audit_log, ReplayRequest(scope=ReplayScope.FULL_LOG))

    def replay_session(self, audit_log: PersistedAuditLog | AuditLog, session_id: str) -> ReplayResult:
        return self.replay(audit_log, ReplayRequest(scope=ReplayScope.SESSION, target_session_id=session_id))

    def replay_cycle(self, audit_log: PersistedAuditLog | AuditLog, cycle_id: int) -> ReplayResult:
        return self.replay(audit_log, ReplayRequest(scope=ReplayScope.CYCLE, target_cycle_id=cycle_id))

    @staticmethod
    def _records_for_log(audit_log: PersistedAuditLog | AuditLog) -> tuple[AuditRecord, ...]:
        if isinstance(audit_log, PersistedAuditLog):
            return audit_log.events
        return audit_log.records

    def _records_for_scope(
        self,
        records: tuple[AuditRecord, ...],
        request: ReplayRequest,
    ) -> tuple[tuple[AuditRecord, ...], ReplayFailureReason | None]:
        if request.scope == ReplayScope.FULL_LOG:
            return records, None
        if request.scope == ReplayScope.SESSION:
            if request.target_session_id is None:
                return (), ReplayFailureReason.UNKNOWN_SESSION
            selected = tuple(
                record
                for record in records
                if record.event.session_id == request.target_session_id or record.context.session_id == request.target_session_id
            )
            return selected, None if selected else ReplayFailureReason.UNKNOWN_SESSION
        if request.scope == ReplayScope.CYCLE:
            if request.target_cycle_id is None:
                return (), ReplayFailureReason.UNKNOWN_CYCLE
            selected = tuple(
                record
                for record in records
                if record.event.cycle_index == request.target_cycle_id or record.context.cycle_index == request.target_cycle_id
            )
            return selected, None if selected else ReplayFailureReason.UNKNOWN_CYCLE
        return (), ReplayFailureReason.UNSUPPORTED_SCOPE

    def _build_replay_steps(self, records: tuple[AuditRecord, ...]) -> tuple[ReplayStep, ...]:
        return tuple(
            ReplayStep(
                sequence_index=index,
                event_id=record.event_id,
                timestamp=record.event.timestamp,
                event_type=record.event.event_type,
                summary=self._summarize_record(record),
                record=record,
                replay_notes=self._replay_notes_for_record(record),
            )
            for index, record in enumerate(records, start=1)
        )

    def _derive_outcomes(self, records: tuple[AuditRecord, ...], request: ReplayRequest) -> tuple[str, ...]:
        involved_sessions = sorted(
            {
                record.event.session_id or record.context.session_id
                for record in records
                if record.event.session_id or record.context.session_id
            }
        )
        cycles = sorted(
            {
                record.event.cycle_index if record.event.cycle_index is not None else record.context.cycle_index
                for record in records
                if record.event.cycle_index is not None or record.context.cycle_index is not None
            }
        )
        executed_actions = [record for record in records if record.event.event_type == AuditEventType.ACTION_EXECUTED]
        policy_decisions = [record for record in records if record.event.event_type == AuditEventType.POLICY_DECISION_MADE]
        operator_commands = [record for record in records if record.event.event_type in {AuditEventType.OPERATOR_COMMAND_RECEIVED, AuditEventType.OPERATOR_COMMAND_EXECUTED, AuditEventType.OPERATOR_COMMAND_REJECTED}]
        outcomes = [
            f"Derived replay scope {request.scope.value} contains {len(records)} audit event(s).",
            f"Derived replay covers {len(cycles)} cycle(s): {', '.join(str(cycle) for cycle in cycles) if cycles else 'none' }.",
            f"Derived replay covers {len(involved_sessions)} session(s): {', '.join(involved_sessions) if involved_sessions else 'none'}.",
            f"Derived replay contains {len(executed_actions)} executed action event(s).",
            f"Derived replay contains {len(policy_decisions)} policy decision event(s).",
            f"Derived replay contains {len(operator_commands)} operator command event(s).",
        ]
        return tuple(outcomes)

    def _assess_timeline(
        self,
        records: tuple[AuditRecord, ...],
        request: ReplayRequest,
    ) -> tuple[tuple[str, ...], ReplayStatus, ReplayFailureReason | None]:
        if request.scope == ReplayScope.CYCLE:
            event_types = {record.event.event_type for record in records}
            notes: list[str] = []
            missing = []
            if AuditEventType.LOOP_CYCLE_STARTED not in event_types:
                missing.append("loop_cycle_started")
            if AuditEventType.LOOP_CYCLE_COMPLETED not in event_types:
                missing.append("loop_cycle_completed")
            if missing:
                notes.append(
                    f"Replay cycle {request.target_cycle_id} is incomplete because required cycle markers are missing: {', '.join(missing)}."
                )
                return tuple(notes), ReplayStatus.PARTIAL, ReplayFailureReason.MISSING_EVENTS
        return (), ReplayStatus.REPLAYED, None

    def _validate_event_order(self, records: tuple[AuditRecord, ...]) -> tuple[str, ...]:
        errors: list[str] = []
        seen_event_ids: set[str] = set()
        last_timestamp: str | None = None
        for record in records:
            if record.event_id in seen_event_ids:
                errors.append(f"Replay detected duplicate event id {record.event_id} in the selected timeline.")
            seen_event_ids.add(record.event_id)
            if last_timestamp is not None and record.event.timestamp < last_timestamp:
                errors.append(
                    f"Replay detected non-monotonic timestamp ordering between {last_timestamp} and {record.event.timestamp}."
                )
            last_timestamp = record.event.timestamp
        return tuple(errors)

    def _summarize_record(self, record: AuditRecord) -> str:
        session_id = record.event.session_id or record.context.session_id
        cycle_index = record.event.cycle_index if record.event.cycle_index is not None else record.context.cycle_index
        summary = f"{record.event.event_type.value}"
        if session_id:
            summary += f" for session {session_id}"
        if cycle_index is not None:
            summary += f" during cycle {cycle_index}"
        if record.event.action_type:
            summary += f" with action {record.event.action_type}"
        return summary + "."

    @staticmethod
    def _replay_notes_for_record(record: AuditRecord) -> tuple[str, ...]:
        notes = list(record.event.notes)
        if record.context.source_component:
            notes.append(f"Recorded by {record.context.source_component}.")
        return tuple(notes)

    @staticmethod
    def _selection_failure_notes(request: ReplayRequest, failure_reason: ReplayFailureReason) -> tuple[str, ...]:
        if failure_reason == ReplayFailureReason.UNKNOWN_SESSION:
            return (f"Replay could not find events for session {request.target_session_id}.",)
        if failure_reason == ReplayFailureReason.UNKNOWN_CYCLE:
            return (f"Replay could not find events for cycle {request.target_cycle_id}.",)
        return (f"Replay scope {request.scope.value} is not supported.",)

    @staticmethod
    def _failure_result(
        *,
        replay_id: str,
        request: ReplayRequest,
        status: ReplayStatus,
        failure_reason: ReplayFailureReason,
        replay_notes: tuple[str, ...],
    ) -> ReplayResult:
        return ReplayResult(
            replay_id=replay_id,
            status=status,
            scope=request.scope,
            timeline=None,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            replay_notes=request.replay_notes + replay_notes,
            derived_outcomes=(),
            failure_reason=failure_reason,
        )

    @staticmethod
    def _build_replay_id() -> str:
        return f"replay-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"