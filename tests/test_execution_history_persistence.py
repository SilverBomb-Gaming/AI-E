from __future__ import annotations

import json
from pathlib import Path

from aie.core.execution_history import ExecutionHistory
from aie.core.execution_history_persistence import ExecutionHistoryPersistence
from aie.core.models import AuditEventType, AuditPersistenceStatus


def _build_history() -> ExecutionHistory:
    history = ExecutionHistory()
    history.record_event(
        event_type=AuditEventType.LOOP_CYCLE_STARTED,
        cycle_index=1,
        action_type="run_single_cycle",
        source_component="execution_loop_engine",
    )
    history.record_event(
        event_type=AuditEventType.POLICY_DECISION_MADE,
        session_id="session-a",
        cycle_index=1,
        action_type="self_initiated_loop_advance",
        policy_decision="allowed",
        source_component="autonomy_policy",
        notes=("Allowed bounded loop advancement.",),
    )
    history.record_event(
        event_type=AuditEventType.OPERATOR_COMMAND_EXECUTED,
        session_id="session-a",
        operator_command="inspect_system",
        operator_command_id="cmd-001",
        source_component="operator_control",
    )
    return history


def test_save_and_load_audit_log_roundtrips_exactly(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    history = _build_history()
    target = tmp_path / "audit-log.json"

    save_result = persistence.save_audit_log(history.export_log(), target, notes=("initial save",))
    load_result = persistence.load_audit_log(target)

    assert save_result.status == AuditPersistenceStatus.SAVED
    assert load_result.status == AuditPersistenceStatus.LOADED
    assert load_result.persisted_log is not None
    assert load_result.persisted_log.schema_version == 1
    assert load_result.persisted_log.event_count == 3
    assert load_result.persisted_log.last_event_id == "audit-000003"
    assert [record.to_dict() for record in load_result.persisted_log.events] == [record.to_dict() for record in history.snapshot().records]


def test_append_event_preserves_existing_order(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    history = _build_history()
    target = tmp_path / "audit-log.json"

    persistence.save_audit_log(history.export_log(), target)
    appended_event = history.record_event(
        event_type=AuditEventType.STATE_PERSISTED,
        session_id="session-a",
        cycle_index=1,
        action_type="execute_selected",
        source_component="execution_loop_engine",
    )

    append_result = persistence.append_event(appended_event, target)
    load_result = persistence.load_audit_log(target)

    assert append_result.status == AuditPersistenceStatus.SAVED
    assert load_result.status == AuditPersistenceStatus.LOADED
    assert load_result.persisted_log is not None
    assert [record.event_id for record in load_result.persisted_log.events] == [
        "audit-000001",
        "audit-000002",
        "audit-000003",
        "audit-000004",
    ]


def test_reloaded_history_keeps_existing_query_surface(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    history = _build_history()
    target = tmp_path / "audit-log.json"

    persistence.save_audit_log(history.export_log(), target)
    load_result = persistence.load_audit_log(target)

    reloaded_history = ExecutionHistory()
    reloaded_history.ingest_records(load_result.persisted_log.events, replace=True)  # type: ignore[union-attr]

    assert reloaded_history.get_events_by_session("session-a").total_matches == 2
    assert reloaded_history.get_cycle_history(1).total_matches == 2
    assert reloaded_history.get_events_by_type(AuditEventType.POLICY_DECISION_MADE).total_matches == 1
    assert [record.event_id for record in reloaded_history.get_recent_events(limit=2).records] == ["audit-000003", "audit-000002"]


def test_load_rejects_malformed_json(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    target = tmp_path / "audit-log.json"
    target.write_text("{not-valid-json", encoding="utf-8")

    load_result = persistence.load_audit_log(target)

    assert load_result.status == AuditPersistenceStatus.INVALID
    assert load_result.persisted_log is None


def test_load_rejects_missing_required_fields(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    target = tmp_path / "audit-log.json"
    target.write_text(json.dumps({"schema_version": 1, "saved_at": "2026-04-12T12:00:00+00:00"}), encoding="utf-8")

    load_result = persistence.load_audit_log(target)

    assert load_result.status == AuditPersistenceStatus.INVALID
    assert any("Missing required persisted audit fields" in error for error in load_result.validation_errors)


def test_load_rejects_schema_version_mismatch(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    target = tmp_path / "audit-log.json"
    target.write_text(
        json.dumps(
            {
                "schema_version": 999,
                "saved_at": "2026-04-12T12:00:00+00:00",
                "event_count": 0,
                "events": [],
                "notes": [],
                "last_event_id": None,
                "validation_errors": [],
            }
        ),
        encoding="utf-8",
    )

    load_result = persistence.load_audit_log(target)

    assert load_result.status == AuditPersistenceStatus.VERSION_MISMATCH
    assert load_result.persisted_log is None


def test_load_rejects_invalid_event_timestamp(tmp_path: Path) -> None:
    persistence = ExecutionHistoryPersistence()
    history = _build_history()
    target = tmp_path / "audit-log.json"
    save_result = persistence.save_audit_log(history.export_log(), target)
    payload = save_result.persisted_log.to_dict()  # type: ignore[union-attr]
    payload["events"][0]["event"]["timestamp"] = "not-a-timestamp"
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    load_result = persistence.load_audit_log(target)

    assert load_result.status == AuditPersistenceStatus.INVALID
    assert any("timestamp" in error for error in load_result.validation_errors)