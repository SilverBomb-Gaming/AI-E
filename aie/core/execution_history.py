from __future__ import annotations

from datetime import datetime, timezone

from .models import (
    AuditContext,
    AuditEvent,
    AuditEventType,
    AuditLog,
    AuditQuery,
    AuditQueryResult,
    AuditRecord,
)


class ExecutionHistory:
    """Append-only in-memory audit store for bounded execution history."""

    def __init__(self, records: tuple[AuditRecord, ...] = ()) -> None:
        self._records: list[AuditRecord] = list(records)

    def record_event(
        self,
        *,
        event_type: AuditEventType,
        session_id: str | None = None,
        cycle_index: int | None = None,
        action_type: str | None = None,
        policy_decision: str | None = None,
        previous_state: str | None = None,
        new_state: str | None = None,
        operator_command: str | None = None,
        operator_command_id: str | None = None,
        reason: str | None = None,
        source_component: str | None = None,
        notes: tuple[str, ...] = (),
    ) -> AuditRecord:
        event = AuditEvent(
            timestamp=self._timestamp(),
            event_type=event_type,
            session_id=session_id,
            cycle_index=cycle_index,
            action_type=action_type,
            policy_decision=policy_decision,
            previous_state=previous_state,
            new_state=new_state,
            operator_command=operator_command,
            reason=reason,
            notes=notes,
        )
        record = AuditRecord(
            event_id=f"audit-{len(self._records) + 1:06d}",
            event=event,
            context=AuditContext(
                cycle_index=cycle_index,
                session_id=session_id,
                operator_command_id=operator_command_id,
                action_type=action_type,
                source_component=source_component,
            ),
        )
        return self._append_record(record)

    @classmethod
    def from_records(cls, records: tuple[AuditRecord, ...]) -> "ExecutionHistory":
        return cls(records=records)

    def export_log(self) -> AuditLog:
        return self.snapshot()

    def ingest_log(self, audit_log: AuditLog, *, replace: bool = False) -> AuditLog:
        if replace:
            self._records = list(audit_log.records)
        else:
            self._records.extend(audit_log.records)
        return self.snapshot()

    def ingest_records(self, records: tuple[AuditRecord, ...], *, replace: bool = False) -> AuditLog:
        return self.ingest_log(AuditLog(records=records), replace=replace)

    def snapshot(self) -> AuditLog:
        return AuditLog(records=tuple(self._records))

    def query(self, audit_query: AuditQuery) -> AuditQueryResult:
        records = self._filter_records(audit_query)
        limited_records = records[: audit_query.limit] if audit_query.limit is not None else records
        return AuditQueryResult(
            query=audit_query,
            records=tuple(limited_records),
            total_matches=len(records),
        )

    def get_recent_events(self, limit: int = 10) -> AuditQueryResult:
        records = list(reversed(self._records))
        limited_records = tuple(records[:limit])
        return AuditQueryResult(
            query=AuditQuery(limit=limit),
            records=limited_records,
            total_matches=len(self._records),
        )

    def get_events_by_session(self, session_id: str) -> AuditQueryResult:
        return self.query(AuditQuery(session_id=session_id))

    def get_events_by_type(self, event_type: AuditEventType) -> AuditQueryResult:
        return self.query(AuditQuery(event_type=event_type))

    def get_cycle_history(self, cycle_index: int) -> AuditQueryResult:
        return self.query(AuditQuery(cycle_index=cycle_index))

    def _filter_records(self, audit_query: AuditQuery) -> list[AuditRecord]:
        filtered = list(self._records)
        if audit_query.session_id is not None:
            filtered = [record for record in filtered if record.event.session_id == audit_query.session_id]
        if audit_query.cycle_index is not None:
            filtered = [record for record in filtered if record.event.cycle_index == audit_query.cycle_index]
        if audit_query.event_type is not None:
            filtered = [record for record in filtered if record.event.event_type == audit_query.event_type]
        return filtered

    def _append_record(self, record: AuditRecord) -> AuditRecord:
        self._records.append(record)
        return record

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()