from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import (
    AuditContext,
    AuditEvent,
    AuditEventType,
    AuditLoadResult,
    AuditLog,
    AuditLogRecordVersion,
    AuditPersistenceSnapshot,
    AuditPersistenceStatus,
    AuditRecord,
    AuditSaveResult,
    PersistedAuditLog,
)


class ExecutionHistoryPersistence:
    """Persist append-only execution history records as deterministic JSON."""

    def save_audit_log(
        self,
        audit_log: AuditLog | PersistedAuditLog,
        path: str | Path,
        *,
        notes: tuple[str, ...] = (),
        saved_at: str | None = None,
    ) -> AuditSaveResult:
        target = Path(path)
        persisted_log = self._persisted_log_for_save(audit_log, target=target, notes=notes, saved_at=saved_at)
        validation = self.validate_audit_payload(persisted_log.to_dict())
        if validation.status != AuditPersistenceStatus.LOADED:
            return AuditSaveResult(
                status=validation.status,
                persisted_log=None,
                snapshot=validation.snapshot,
                notes=validation.notes,
                validation_errors=validation.validation_errors,
            )

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(self._serialize_payload(persisted_log.to_dict()), encoding="utf-8")
        except Exception as exc:
            snapshot = self._snapshot_for_log(persisted_log, storage_path=str(target))
            return AuditSaveResult(
                status=AuditPersistenceStatus.FAILED,
                snapshot=snapshot,
                notes=(f"Failed to save audit log: {exc}",),
                validation_errors=(str(exc),),
            )

        stored_log = PersistedAuditLog(
            schema_version=persisted_log.schema_version,
            saved_at=persisted_log.saved_at,
            event_count=persisted_log.event_count,
            events=persisted_log.events,
            notes=persisted_log.notes,
            storage_path=str(target),
            last_event_id=persisted_log.last_event_id,
            validation_errors=(),
        )
        snapshot = self._snapshot_for_log(stored_log, storage_path=str(target))
        return AuditSaveResult(
            status=AuditPersistenceStatus.SAVED,
            persisted_log=stored_log,
            snapshot=snapshot,
            notes=("Audit log saved successfully.",),
        )

    def append_event(
        self,
        event: AuditRecord,
        path: str | Path,
        *,
        notes: tuple[str, ...] = (),
    ) -> AuditSaveResult:
        target = Path(path)
        existing_notes: tuple[str, ...] = ()
        existing_events: tuple[AuditRecord, ...] = ()
        if target.exists():
            loaded = self.load_audit_log(target)
            if loaded.status != AuditPersistenceStatus.LOADED or loaded.persisted_log is None:
                return AuditSaveResult(
                    status=loaded.status,
                    persisted_log=None,
                    snapshot=loaded.snapshot,
                    notes=loaded.notes,
                    validation_errors=loaded.validation_errors,
                )
            existing_events = loaded.persisted_log.events
            existing_notes = loaded.persisted_log.notes

        merged_notes = tuple(dict.fromkeys(existing_notes + notes))
        return self.save_audit_log(
            AuditLog(records=existing_events + (event,)),
            target,
            notes=merged_notes,
        )

    def load_audit_log(self, path: str | Path) -> AuditLoadResult:
        target = Path(path)
        try:
            raw_text = target.read_text(encoding="utf-8")
        except Exception as exc:
            return AuditLoadResult(
                status=AuditPersistenceStatus.FAILED,
                snapshot=AuditPersistenceSnapshot(storage_path=str(target), validation_errors=(str(exc),)),
                notes=(f"Failed to read audit log: {exc}",),
                validation_errors=(str(exc),),
            )

        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=AuditPersistenceSnapshot(storage_path=str(target), validation_errors=(str(exc),)),
                notes=(f"Invalid JSON in audit log: {exc}",),
                validation_errors=(str(exc),),
            )

        validation = self.validate_audit_payload(payload, storage_path=str(target))
        if validation.status != AuditPersistenceStatus.LOADED:
            return validation

        try:
            persisted_log = self.deserialize_audit_log(payload, storage_path=str(target))
        except Exception as exc:
            snapshot = AuditPersistenceSnapshot(storage_path=str(target), validation_errors=(str(exc),))
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=snapshot,
                notes=(f"Failed to reconstruct persisted audit log: {exc}",),
                validation_errors=(str(exc),),
            )

        snapshot = self._snapshot_for_log(persisted_log, storage_path=str(target))
        return AuditLoadResult(
            status=AuditPersistenceStatus.LOADED,
            persisted_log=persisted_log,
            snapshot=snapshot,
            notes=("Audit log loaded successfully.",),
        )

    def validate_audit_payload(
        self,
        payload: dict[str, Any],
        *,
        storage_path: str | None = None,
    ) -> AuditLoadResult:
        if not isinstance(payload, dict):
            error = "Persisted audit payload must be a JSON object."
            snapshot = AuditPersistenceSnapshot(storage_path=storage_path, validation_errors=(error,))
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=snapshot,
                notes=(error,),
                validation_errors=(error,),
            )

        required_fields = ("schema_version", "saved_at", "event_count", "events", "notes", "last_event_id")
        validation_errors = [f"Missing required persisted audit fields: {field}." for field in required_fields if field not in payload]
        if validation_errors:
            snapshot = AuditPersistenceSnapshot(storage_path=storage_path, validation_errors=tuple(validation_errors))
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=snapshot,
                notes=tuple(validation_errors),
                validation_errors=tuple(validation_errors),
            )

        schema_version = payload.get("schema_version")
        if schema_version != AuditLogRecordVersion.V1.value:
            error = f"Unsupported audit log schema version: {schema_version}."
            snapshot = AuditPersistenceSnapshot(
                schema_version=schema_version if isinstance(schema_version, int) else None,
                storage_path=storage_path,
                validation_errors=(error,),
            )
            return AuditLoadResult(
                status=AuditPersistenceStatus.VERSION_MISMATCH,
                snapshot=snapshot,
                notes=(error,),
                validation_errors=(error,),
            )

        if not isinstance(payload.get("events"), list):
            error = "Persisted audit field events must be a list."
            snapshot = AuditPersistenceSnapshot(
                schema_version=AuditLogRecordVersion.V1.value,
                storage_path=storage_path,
                validation_errors=(error,),
            )
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=snapshot,
                notes=(error,),
                validation_errors=(error,),
            )

        if not isinstance(payload.get("notes"), list):
            error = "Persisted audit field notes must be a list."
            snapshot = AuditPersistenceSnapshot(
                schema_version=AuditLogRecordVersion.V1.value,
                storage_path=storage_path,
                validation_errors=(error,),
            )
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=snapshot,
                notes=(error,),
                validation_errors=(error,),
            )

        validation_errors.extend(self._validate_timestamp(payload.get("saved_at"), field_name="saved_at"))
        validation_errors.extend(self._validate_event_list(payload.get("events", [])))

        event_count = payload.get("event_count")
        if not isinstance(event_count, int):
            validation_errors.append("Persisted audit field event_count must be an integer.")
        elif event_count != len(payload["events"]):
            validation_errors.append(
                f"Persisted audit event_count {event_count} does not match loaded event total {len(payload['events'])}."
            )

        expected_last_event_id = payload["events"][-1].get("event_id") if payload["events"] else None
        if payload.get("last_event_id") != expected_last_event_id:
            validation_errors.append(
                "Persisted audit last_event_id does not match the final event in the log."
            )

        if payload.get("validation_errors") not in (None, []):
            if not isinstance(payload.get("validation_errors"), list):
                validation_errors.append("Persisted audit field validation_errors must be a list when present.")

        snapshot = AuditPersistenceSnapshot(
            schema_version=AuditLogRecordVersion.V1.value,
            saved_at=payload.get("saved_at"),
            event_count=event_count if isinstance(event_count, int) else 0,
            storage_path=storage_path,
            last_event_id=payload.get("last_event_id"),
            notes=tuple(payload.get("notes", [])) if isinstance(payload.get("notes"), list) else (),
            validation_errors=tuple(validation_errors),
        )
        if validation_errors:
            return AuditLoadResult(
                status=AuditPersistenceStatus.INVALID,
                snapshot=snapshot,
                notes=tuple(validation_errors),
                validation_errors=tuple(validation_errors),
            )

        return AuditLoadResult(
            status=AuditPersistenceStatus.LOADED,
            snapshot=snapshot,
            notes=("Audit payload validation succeeded.",),
        )

    @staticmethod
    def serialize_event(event: AuditRecord) -> dict[str, Any]:
        return event.to_dict()

    def deserialize_event(self, payload: dict[str, Any]) -> AuditRecord:
        event_payload = payload["event"]
        context_payload = payload["context"]
        return AuditRecord(
            event_id=payload["event_id"],
            event=AuditEvent(
                timestamp=event_payload["timestamp"],
                event_type=AuditEventType(event_payload["event_type"]),
                session_id=event_payload.get("session_id"),
                cycle_index=event_payload.get("cycle_index"),
                action_type=event_payload.get("action_type"),
                policy_decision=event_payload.get("policy_decision"),
                previous_state=event_payload.get("previous_state"),
                new_state=event_payload.get("new_state"),
                operator_command=event_payload.get("operator_command"),
                reason=event_payload.get("reason"),
                notes=tuple(event_payload.get("notes", [])),
            ),
            context=AuditContext(
                cycle_index=context_payload.get("cycle_index"),
                session_id=context_payload.get("session_id"),
                operator_command_id=context_payload.get("operator_command_id"),
                action_type=context_payload.get("action_type"),
                source_component=context_payload.get("source_component"),
            ),
        )

    def deserialize_audit_log(self, payload: dict[str, Any], *, storage_path: str | None = None) -> PersistedAuditLog:
        events = tuple(self.deserialize_event(event_payload) for event_payload in payload["events"])
        return PersistedAuditLog(
            schema_version=payload["schema_version"],
            saved_at=payload["saved_at"],
            event_count=payload["event_count"],
            events=events,
            notes=tuple(payload.get("notes", [])),
            storage_path=storage_path,
            last_event_id=payload.get("last_event_id"),
            validation_errors=tuple(payload.get("validation_errors", [])),
        )

    def _persisted_log_for_save(
        self,
        audit_log: AuditLog | PersistedAuditLog,
        *,
        target: Path,
        notes: tuple[str, ...],
        saved_at: str | None,
    ) -> PersistedAuditLog:
        if isinstance(audit_log, PersistedAuditLog):
            merged_notes = tuple(dict.fromkeys(audit_log.notes + notes))
            return PersistedAuditLog(
                schema_version=AuditLogRecordVersion.V1.value,
                saved_at=saved_at or audit_log.saved_at,
                event_count=len(audit_log.events),
                events=audit_log.events,
                notes=merged_notes,
                storage_path=str(target),
                last_event_id=audit_log.events[-1].event_id if audit_log.events else None,
                validation_errors=(),
            )

        return PersistedAuditLog(
            schema_version=AuditLogRecordVersion.V1.value,
            saved_at=saved_at or self._timestamp(),
            event_count=len(audit_log.records),
            events=audit_log.records,
            notes=notes,
            storage_path=str(target),
            last_event_id=audit_log.records[-1].event_id if audit_log.records else None,
            validation_errors=(),
        )

    @staticmethod
    def _serialize_payload(payload: dict[str, Any]) -> str:
        return json.dumps(payload, indent=2)

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    def _validate_event_list(self, events: list[Any]) -> list[str]:
        validation_errors: list[str] = []
        for index, event_payload in enumerate(events):
            prefix = f"Persisted audit event at index {index}"
            if not isinstance(event_payload, dict):
                validation_errors.append(f"{prefix} must be an object.")
                continue

            required_record_fields = ("event_id", "event", "context")
            for field in required_record_fields:
                if field not in event_payload:
                    validation_errors.append(f"{prefix} is missing required field {field}.")

            event_id = event_payload.get("event_id")
            if not isinstance(event_id, str) or not event_id:
                validation_errors.append(f"{prefix} must include a non-empty string event_id.")

            nested_event = event_payload.get("event")
            if not isinstance(nested_event, dict):
                validation_errors.append(f"{prefix} field event must be an object.")
            else:
                required_event_fields = ("timestamp", "event_type", "notes")
                for field in required_event_fields:
                    if field not in nested_event:
                        validation_errors.append(f"{prefix} event is missing required field {field}.")
                event_type = nested_event.get("event_type")
                if event_type is not None:
                    try:
                        AuditEventType(event_type)
                    except ValueError:
                        validation_errors.append(f"{prefix} has unsupported event_type {event_type}.")
                validation_errors.extend(self._validate_timestamp(nested_event.get("timestamp"), field_name=f"{prefix} timestamp"))
                if not isinstance(nested_event.get("notes"), list):
                    validation_errors.append(f"{prefix} event field notes must be a list.")

            nested_context = event_payload.get("context")
            if not isinstance(nested_context, dict):
                validation_errors.append(f"{prefix} field context must be an object.")
            else:
                required_context_fields = (
                    "cycle_index",
                    "session_id",
                    "operator_command_id",
                    "action_type",
                    "source_component",
                )
                for field in required_context_fields:
                    if field not in nested_context:
                        validation_errors.append(f"{prefix} context is missing required field {field}.")

        return validation_errors

    @staticmethod
    def _validate_timestamp(value: Any, *, field_name: str) -> list[str]:
        if not isinstance(value, str):
            return [f"{field_name} must be an ISO 8601 string."]
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return [f"{field_name} must be a valid ISO 8601 timestamp."]
        return []

    @staticmethod
    def _snapshot_for_log(
        persisted_log: PersistedAuditLog,
        *,
        storage_path: str | None,
    ) -> AuditPersistenceSnapshot:
        return AuditPersistenceSnapshot(
            schema_version=persisted_log.schema_version,
            saved_at=persisted_log.saved_at,
            event_count=persisted_log.event_count,
            storage_path=storage_path,
            last_event_id=persisted_log.last_event_id,
            notes=persisted_log.notes,
            validation_errors=persisted_log.validation_errors,
        )