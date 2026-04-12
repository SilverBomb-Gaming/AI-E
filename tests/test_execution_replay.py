from __future__ import annotations

from pathlib import Path

from aie.core.execution_history import ExecutionHistory
from aie.core.execution_history_persistence import ExecutionHistoryPersistence
from aie.core.execution_replay import ExecutionReplay
from aie.core.models import (
    AuditContext,
    AuditEvent,
    AuditEventType,
    AuditRecord,
    ReplayFailureReason,
    ReplayRequest,
    ReplayScope,
    ReplayStatus,
)


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


def test_replay_full_log_succeeds_in_original_order(tmp_path: Path) -> None:
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)

    result = replay.replay_full_log(persisted_log)

    assert result.status == ReplayStatus.REPLAYED
    assert result.timeline is not None
    assert [step.event_id for step in result.timeline.reconstructed_steps] == [
        "audit-000001",
        "audit-000002",
        "audit-000003",
        "audit-000004",
        "audit-000005",
        "audit-000006",
        "audit-000007",
        "audit-000008",
        "audit-000009",
        "audit-000010",
    ]
    assert result.timeline.reconstructed_steps[0].event_type == AuditEventType.OPERATOR_COMMAND_RECEIVED
    assert result.timeline.reconstructed_steps[-1].event_type == AuditEventType.LOOP_CYCLE_COMPLETED


def test_replay_session_filters_to_target_session(tmp_path: Path) -> None:
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)

    result = replay.replay_session(persisted_log, "session-a")

    assert result.status == ReplayStatus.REPLAYED
    assert result.timeline is not None
    assert {step.record.event.session_id or step.record.context.session_id for step in result.timeline.reconstructed_steps} == {"session-a"}
    assert any("session-a" in outcome for outcome in result.derived_outcomes)


def test_replay_cycle_filters_to_target_cycle(tmp_path: Path) -> None:
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)

    result = replay.replay_cycle(persisted_log, 1)

    assert result.status == ReplayStatus.REPLAYED
    assert result.timeline is not None
    assert {step.record.event.cycle_index or step.record.context.cycle_index for step in result.timeline.reconstructed_steps} == {1}
    assert result.timeline.reconstructed_steps[0].event_type == AuditEventType.POLICY_DECISION_MADE


def test_replay_rejects_unknown_session(tmp_path: Path) -> None:
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)

    result = replay.replay_session(persisted_log, "session-missing")

    assert result.status == ReplayStatus.INVALID
    assert result.failure_reason == ReplayFailureReason.UNKNOWN_SESSION
    assert result.timeline is None


def test_replay_rejects_unknown_cycle(tmp_path: Path) -> None:
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)

    result = replay.replay_cycle(persisted_log, 99)

    assert result.status == ReplayStatus.INVALID
    assert result.failure_reason == ReplayFailureReason.UNKNOWN_CYCLE
    assert result.timeline is None


def test_replay_detects_invalid_event_order() -> None:
    replay = ExecutionReplay()
    malformed_log = ExecutionHistory(
        records=(
            AuditRecord(
                event_id="audit-000001",
                event=AuditEvent(
                    timestamp="2026-04-12T10:00:05+00:00",
                    event_type=AuditEventType.LOOP_CYCLE_COMPLETED,
                    cycle_index=1,
                ),
                context=AuditContext(cycle_index=1, source_component="execution_loop_engine"),
            ),
            AuditRecord(
                event_id="audit-000002",
                event=AuditEvent(
                    timestamp="2026-04-12T10:00:01+00:00",
                    event_type=AuditEventType.LOOP_CYCLE_STARTED,
                    cycle_index=1,
                ),
                context=AuditContext(cycle_index=1, source_component="execution_loop_engine"),
            ),
        )
    ).export_log()

    result = replay.replay_full_log(malformed_log)

    assert result.status == ReplayStatus.FAILED
    assert result.failure_reason == ReplayFailureReason.INVALID_EVENT_ORDER


def test_replay_cycle_returns_partial_when_cycle_markers_are_incomplete() -> None:
    replay = ExecutionReplay()
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

    result = replay.replay_cycle(incomplete_log, 3)

    assert result.status == ReplayStatus.PARTIAL
    assert result.failure_reason == ReplayFailureReason.MISSING_EVENTS
    assert result.timeline is not None


def test_replay_does_not_mutate_persisted_history(tmp_path: Path) -> None:
    replay = ExecutionReplay()
    persisted_log = _persisted_log(tmp_path)
    before = persisted_log.to_dict()

    result = replay.replay(
        persisted_log,
        ReplayRequest(scope=ReplayScope.FULL_LOG, replay_notes=("read-only replay",)),
    )

    assert result.status == ReplayStatus.REPLAYED
    assert persisted_log.to_dict() == before