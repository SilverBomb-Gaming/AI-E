import json
import subprocess
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Thread

import pytest

from app import home_surface
from ai_e_runtime.agent_router import AgentRouter
from ai_e_runtime.capability_registry import CapabilityEvidenceStore, CapabilityRegistry
from ai_e_runtime.level_0001_entity_transform_mutation import run_level_0001_entity_transform_mutation
from ai_e_runtime.mutation_approval import approve_mutation_task
from ai_e_runtime.scheduler import Scheduler
from ai_e_runtime.state_store import StateStore
from ai_e_runtime.supervisor import Supervisor, SupervisorConfig
from ai_e_runtime.task_intake import ConversationalTaskIntake
from orchestrator.config import OrchestratorConfig


pytestmark = pytest.mark.fast


class FakeClock:
    def __init__(self) -> None:
        self._now = datetime(2026, 3, 16, 12, 0, 0, tzinfo=timezone.utc)
        self._monotonic = 0.0

    def now(self) -> datetime:
        return self._now

    def monotonic(self) -> float:
        return self._monotonic

    def sleep(self, seconds: float) -> None:
        self.advance(seconds)

    def advance(self, seconds: float) -> None:
        self._monotonic += float(seconds)
        self._now += timedelta(seconds=float(seconds))


def test_supervisor_runs_multiple_tasks_emits_heartbeat_and_stops_on_time_limit(tmp_path):
    config = _make_config(tmp_path / "time_limit")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "TASK_001", priority=1, execution_seconds=2),
                _task(config, "TASK_002", priority=2, execution_seconds=2),
                _task(config, "TASK_003", priority=3, execution_seconds=2),
                _task(config, "TASK_004", priority=4, execution_seconds=2),
                _task(config, "TASK_005", priority=5, execution_seconds=2),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=7,
            heartbeat_interval_seconds=3,
            poll_interval_seconds=1,
            session_id="persistent-test-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()

    assert result.stop_reason == "time_limit_reached"
    assert result.tasks_attempted >= 3
    assert result.tasks_completed >= 3
    assert result.queue_remaining == 1
    assert result.heartbeats_emitted >= 2

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue[:4]] == ["completed", "completed", "completed", "completed"]
    assert queue[4]["status"] == "pending"

    heartbeat_log = result.heartbeat_log_path.read_text(encoding="utf-8")
    assert heartbeat_log.count("SESSION_HEARTBEAT") >= 2
    assert "queue_remaining=1" in heartbeat_log

    selector_json = config.runs_dir / "persistent-test-session" / "artifacts" / "selector_01_TASK_001.json"
    selector_text = config.runs_dir / "persistent-test-session" / "artifacts" / "selector_01_TASK_001.txt"
    runtime_status_path = config.runs_dir / "persistent-test-session" / "runtime_status.json"
    session_summary_json = config.runs_dir / "persistent-test-session" / "session_summary.json"
    session_summary_md = config.runs_dir / "persistent-test-session" / "session_summary.md"
    operator_report = config.runs_dir / "persistent-test-session" / "operator_report.md"
    assert selector_json.exists()
    assert selector_text.exists()
    assert session_summary_json.exists()
    assert session_summary_md.exists()
    assert operator_report.exists()
    selection_payload = json.loads(selector_json.read_text(encoding="utf-8"))
    selection_lines = selector_text.read_text(encoding="utf-8").splitlines()
    runtime_status = json.loads(runtime_status_path.read_text(encoding="utf-8"))
    session_summary = json.loads(session_summary_json.read_text(encoding="utf-8"))
    session_summary_markdown = session_summary_md.read_text(encoding="utf-8")
    operator_report_text = operator_report.read_text(encoding="utf-8")
    assert selection_payload["selected_task_id"] == "TASK_001"
    assert selection_payload["score"] == selection_payload["selected_task_score"]["total_score"]
    assert selection_payload["top_candidates"][0]["task_id"] == "TASK_001"
    assert selection_lines[0] == "SUMMARY"
    assert selection_lines[-2] == "TIMESTAMP"
    assert runtime_status["last_selected_task_id"] == "TASK_004"
    assert runtime_status["last_selection_reason"].startswith("Autonomous selector chose task TASK_004")
    assert runtime_status["top_candidates"][0]["task_id"] == "TASK_004"
    assert runtime_status["tasks_executed_count"] == 4
    assert runtime_status["loop_iterations"] >= 4
    assert runtime_status["last_task_result_status"] == "completed"
    assert runtime_status["failure_streak_count"] == 0
    assert session_summary["loop_visibility"]["tasks_executed_count"] == 4
    assert session_summary["loop_visibility"]["last_task_result_status"] == "completed"
    assert session_summary["selector_visibility"]["selected_task"] == "TASK_004"
    assert session_summary["selector_visibility"]["score"] == runtime_status["last_selection_score"]
    assert session_summary["selector_visibility"]["reason"] == runtime_status["last_selection_reason"]
    assert session_summary["selector_visibility"]["top_candidates"][0]["task_id"] == "TASK_004"
    assert "excluded_tasks" in session_summary["selector_visibility"]
    assert "## AI-E Loop Summary" in session_summary_markdown
    assert "Tasks Executed Count: 4" in session_summary_markdown
    assert "## AI-E Decision Summary" in session_summary_markdown
    assert "Selected Task:" in session_summary_markdown
    assert "TASK_004" in session_summary_markdown
    assert runtime_status["last_selection_reason"] in session_summary_markdown
    assert "SUMMARY" in operator_report_text
    assert "FACTS" in operator_report_text
    assert "loop iterations:" in operator_report_text
    assert "tasks executed: 4" in operator_report_text
    assert "selected task: TASK_004" in operator_report_text
    assert "top candidates captured:" in operator_report_text
    assert "TIMESTAMP" in operator_report_text

    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    assert state["session_id"] == "persistent-test-session"
    assert len(state["tasks_attempted"]) == 4
    assert len(state["tasks_completed"]) == 4
    assert "session_summary.json" in state["artifacts_generated"]
    assert "session_summary.md" in state["artifacts_generated"]
    assert "operator_report.md" in state["artifacts_generated"]


def test_supervisor_stops_when_max_task_executions_reached(tmp_path, capsys):
    config = _make_config(tmp_path / "max_task_executions")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "MAX_001", priority=1, execution_seconds=1),
                _task(config, "MAX_002", priority=2, execution_seconds=1),
                _task(config, "MAX_003", priority=3, execution_seconds=1),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=2,
            poll_interval_seconds=1,
            max_task_executions=2,
            session_id="max-task-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "max_task_executions_reached"
    assert result.tasks_completed == 2
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "completed", "pending"]

    runtime_status = json.loads((config.runs_dir / "max-task-session" / "runtime_status.json").read_text(encoding="utf-8"))
    session_summary = json.loads((config.runs_dir / "max-task-session" / "session_summary.json").read_text(encoding="utf-8"))
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert session_summary["loop_visibility"]["tasks_executed_count"] == 2
    assert "[AI-E LOOP]" in output
    assert "Iteration: 2" in output
    assert "Result: success" in output


def test_supervisor_stops_when_repeated_failure_threshold_exceeded(tmp_path, capsys):
    config = _make_config(tmp_path / "repeated_failure_threshold")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "FAIL_001", priority=1, execution_seconds=1, simulated_outcome="blocked"),
                _task(config, "FAIL_002", priority=2, execution_seconds=1, simulated_outcome="blocked"),
                _task(config, "FAIL_003", priority=3, execution_seconds=1, simulated_outcome="completed"),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=2,
            poll_interval_seconds=1,
            repeated_failure_threshold=2,
            session_id="failure-threshold-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "repeated_failure_threshold_exceeded"
    assert result.tasks_completed == 0
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["blocked", "blocked", "pending"]

    runtime_status = json.loads((config.runs_dir / "failure-threshold-session" / "runtime_status.json").read_text(encoding="utf-8"))
    session_summary = json.loads((config.runs_dir / "failure-threshold-session" / "session_summary.json").read_text(encoding="utf-8"))
    operator_report = (config.runs_dir / "failure-threshold-session" / "operator_report.md").read_text(encoding="utf-8")
    assert runtime_status["failure_streak_count"] == 2
    assert runtime_status["last_task_result_status"] == "blocked"
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["stop_reason"] == "repeated_failure_threshold_exceeded"
    assert session_summary["tasks_blocked"] == 2
    assert session_summary["loop_visibility"]["failure_streak_count"] == 2
    assert "stop reason: repeated_failure_threshold_exceeded" in operator_report
    assert "[AI-E LOOP]" in output
    assert "Result: blocked" in output


def test_supervisor_stops_when_all_remaining_tasks_are_blocked(tmp_path, capsys):
    config = _make_config(tmp_path / "all_remaining_blocked")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "BLOCKED_POLICY_001",
                    "priority": 1,
                    "status": "pending",
                    "content_policy_decision": "blocked",
                    "contract_path": _create_runtime_payload(config, "BLOCKED_POLICY_001", execution_seconds=1),
                },
                {
                    "task_id": "BLOCKED_DECISION_001",
                    "priority": 2,
                    "status": "pending",
                    "decision": "block",
                    "contract_path": _create_runtime_payload(config, "BLOCKED_DECISION_001", execution_seconds=1),
                },
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=2,
            poll_interval_seconds=1,
            session_id="all-remaining-blocked-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "all_remaining_tasks_blocked"
    assert result.tasks_completed == 0
    runtime_status = json.loads((config.runs_dir / "all-remaining-blocked-session" / "runtime_status.json").read_text(encoding="utf-8"))
    session_summary = json.loads((config.runs_dir / "all-remaining-blocked-session" / "session_summary.json").read_text(encoding="utf-8"))
    operator_report = (config.runs_dir / "all-remaining-blocked-session" / "operator_report.md").read_text(encoding="utf-8")
    assert runtime_status["tasks_executed_count"] == 0
    assert runtime_status["last_task_result_status"] is None
    assert runtime_status["queue_remaining"] == 2
    assert runtime_status["top_candidates"] == []
    assert {entry["task_id"] for entry in runtime_status["excluded_tasks"]} == {"BLOCKED_POLICY_001", "BLOCKED_DECISION_001"}
    assert session_summary["stop_reason"] == "all_remaining_tasks_blocked"
    assert session_summary["loop_visibility"]["tasks_executed_count"] == 0
    assert "stop reason: all_remaining_tasks_blocked" in operator_report
    assert "[AI-E LOOP]" in output
    assert "Result: all_remaining_tasks_blocked" in output
    assert "TASK STARTED" not in output


def test_supervisor_handles_mixed_queue_without_misclassifying_approval_waiting_work(tmp_path, capsys):
    config = _make_config(tmp_path / "mixed_queue")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "ALLOWED_001", priority=1, execution_seconds=1),
                {
                    "task_id": "BLOCKED_POLICY_002",
                    "priority": 2,
                    "status": "pending",
                    "content_policy_decision": "blocked",
                    "contract_path": _create_runtime_payload(config, "BLOCKED_POLICY_002", execution_seconds=1),
                },
                {
                    "task_id": "NEEDS_APPROVAL_001",
                    "priority": 3,
                    "status": "needs_approval",
                    "contract_path": _create_runtime_payload(config, "NEEDS_APPROVAL_001", execution_seconds=1),
                },
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=3,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="mixed-queue-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.tasks_completed == 1
    assert result.stop_reason == "time_limit_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "pending", "needs_approval"]
    runtime_status = json.loads((config.runs_dir / "mixed-queue-session" / "runtime_status.json").read_text(encoding="utf-8"))
    session_summary = json.loads((config.runs_dir / "mixed-queue-session" / "session_summary.json").read_text(encoding="utf-8"))
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "completed"
    assert runtime_status["queue_remaining"] == 2
    assert any(entry["task_id"] == "BLOCKED_POLICY_002" for entry in runtime_status["excluded_tasks"])
    assert any(entry["task_id"] == "NEEDS_APPROVAL_001" for entry in runtime_status["excluded_tasks"])
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "time_limit_reached"
    assert "QUEUE WAITING FOR APPROVAL" in output
    assert "Result: waiting_for_approval" in output
    assert "Result: all_remaining_tasks_blocked" not in output


def test_supervisor_handles_retry_scheduled_mix_without_breaking_loop_semantics(tmp_path, capsys):
    config = _make_config(tmp_path / "retry_mix")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "OK_001", priority=1, execution_seconds=1),
                _task(config, "RETRY_001", priority=5, execution_seconds=1, simulated_outcome="retryable_failure"),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            repeated_failure_threshold=10,
            session_id="retry-mix-session",
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_empty"
    assert result.tasks_completed == 1
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "blocked"]
    assert queue[1]["retry_count"] == 3
    runtime_status = json.loads((config.runs_dir / "retry-mix-session" / "runtime_status.json").read_text(encoding="utf-8"))
    session_summary = json.loads((config.runs_dir / "retry-mix-session" / "session_summary.json").read_text(encoding="utf-8"))
    assert runtime_status["tasks_executed_count"] == 4
    assert runtime_status["last_task_result_status"] == "blocked"
    assert runtime_status["failure_streak_count"] == 3
    assert session_summary["tasks_completed"] == 1
    assert session_summary["tasks_blocked"] == 1
    assert session_summary["loop_visibility"]["failure_streak_count"] == 3
    assert "TASK RETRY" in output
    assert "Result: retry_scheduled" in output
    assert "Result: blocked" in output


def test_supervisor_platformer_auto_iteration_rejects_invalid_variant_then_accepts_valid_candidate(tmp_path, capsys):
    config = _make_config(tmp_path / "platformer_auto_iteration_accept")
    invalid_payload = {
        "target_context": "platformer",
        "layout_validation_available": True,
        "layout_validation_status": "issues_found",
        "layout_validation_summary": "1 spatial issue(s) detected for platformer layout: 1 unreachable platform.",
        "layout_validation_issue_count": 1,
        "layout_validation_blocking_issue_count": 1,
        "layout_validation_issue_messages": ["Unreachable platform at P2."],
        "layout_validation_issue_codes": ["unreachable_platform"],
        "layout_validation_issues": [
            {
                "code": "unreachable_platform",
                "severity": "error",
                "message": "Unreachable platform at P2.",
            }
        ],
    }
    valid_payload = {
        "target_context": "platformer",
        "layout_validation_available": True,
        "layout_validation_status": "passed",
        "layout_validation_summary": "Spatial validation clean for platformer layout: 0 issues detected.",
        "layout_validation_issue_count": 0,
        "layout_validation_blocking_issue_count": 0,
        "layout_validation_issue_messages": [],
        "layout_validation_issue_codes": [],
        "layout_validation_issues": [],
    }
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "PLAT_AUTO_ACCEPT_001",
                    priority=1,
                    execution_seconds=1,
                    result_payload_sequence=[invalid_payload, valid_payload],
                ),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            platformer_auto_iteration_max_attempts=3,
            session_id="platformer-auto-iteration-accept",
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_empty"
    assert result.tasks_completed == 1
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    runtime_status = json.loads((config.runs_dir / "platformer-auto-iteration-accept" / "runtime_status.json").read_text(encoding="utf-8"))
    assert runtime_status["tasks_executed_count"] == 1
    artifact = json.loads(
        (config.runs_dir / "platformer-auto-iteration-accept" / "artifacts" / "PLAT_AUTO_ACCEPT_001_attempt_01.json").read_text(encoding="utf-8")
    )
    details = artifact["result"]["details"]
    assert details["platformer_auto_iteration_attempt_count"] == 3
    assert details["platformer_auto_iteration_accepted_attempt"] == 2
    assert details["platformer_auto_iteration_exhausted"] is False
    assert details["platformer_auto_iteration_valid_candidate_count"] == 2
    assert details["platformer_auto_iteration_valid_candidate_ids"] == ["candidate_1", "candidate_2"]
    assert details["platformer_auto_iteration_summary"] == (
        "3 attempts made: attempt 1 rejected (Unreachable platform at P2.); attempt 2 accepted (no blocking issues); attempt 3 accepted (no blocking issues). 2 valid candidates generated."
    )
    assert len(details["platformer_auto_iteration_attempts"]) == 3
    assert details["platformer_auto_iteration_attempts"][0]["decision"] == "rejected"
    assert details["platformer_auto_iteration_attempts"][1]["decision"] == "accepted"
    assert details["platformer_auto_iteration_attempts"][1]["candidate_id"] == "candidate_1"
    assert details["platformer_auto_iteration_attempts"][2]["decision"] == "accepted"
    assert details["platformer_auto_iteration_attempts"][2]["candidate_id"] == "candidate_2"
    assert set(details["platformer_auto_iteration_candidate_set"].keys()) == {"candidate_1", "candidate_2"}
    assert details["platformer_auto_iteration_valid_candidates"][0]["candidate_id"] == "candidate_1"
    assert details["platformer_auto_iteration_valid_candidates"][1]["candidate_id"] == "candidate_2"
    assert details["platformer_auto_iteration_valid_candidates"][0]["candidate_label"] == "Candidate A"
    assert details["platformer_auto_iteration_valid_candidates"][1]["candidate_label"] == "Candidate B"
    assert details["platformer_auto_iteration_valid_candidates"][0]["validation_metadata"]["layout_validation_status_label"] == "clean"
    assert details["platformer_auto_iteration_valid_candidates"][0]["evaluation_summary"] == "Spatial validation clean for platformer layout: 0 issues detected."
    assert details["platformer_auto_iteration_result_set"] == (
        "AUTONOMOUS RESULT SET\n\n"
        "2 valid candidates generated\n\n"
        "Candidate A:\n"
        "- Validation: clean\n"
        "- Evaluation: Spatial validation clean for platformer layout: 0 issues detected.\n\n"
        "Candidate B:\n"
        "- Validation: clean\n"
        "- Evaluation: Spatial validation clean for platformer layout: 0 issues detected."
    )
    assert "rank" not in details["platformer_auto_iteration_result_set"].lower()
    assert "recommend" not in details["platformer_auto_iteration_result_set"].lower()
    assert artifact["validation"]["queue_action"] == "complete"
    assert artifact["validation"]["note"] == details["platformer_auto_iteration_summary"]

    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    attempted_entry = state["tasks_attempted"][0]
    assert attempted_entry["auto_iteration_attempt_count"] == 3
    assert attempted_entry["auto_iteration_accepted_attempt"] == 2
    assert attempted_entry["auto_iteration_exhausted"] is False
    assert attempted_entry["auto_iteration_valid_candidate_count"] == 2
    assert attempted_entry["auto_iteration_valid_candidate_ids"] == ["candidate_1", "candidate_2"]
    assert attempted_entry["auto_iteration_summary"] == details["platformer_auto_iteration_summary"]
    assert attempted_entry["auto_iteration_result_set"] == details["platformer_auto_iteration_result_set"]
    assert "PLATFORMER AUTO-ITERATION task_id=PLAT_AUTO_ACCEPT_001 attempt=1/3" in output
    assert "decision=rejected reason=Unreachable platform at P2." in output
    assert "PLATFORMER AUTO-ITERATION task_id=PLAT_AUTO_ACCEPT_001 attempt=2/3" in output
    assert "decision=accepted reason=no blocking issues" in output
    assert "PLATFORMER AUTO-ITERATION task_id=PLAT_AUTO_ACCEPT_001 attempt=3/3" in output


def test_supervisor_platformer_auto_iteration_formats_multi_candidate_layout_parameters_without_ranking(tmp_path):
    config = _make_config(tmp_path / "platformer_auto_iteration_result_set_format")
    clock = FakeClock()
    router = _make_router(clock)
    first_valid_payload = {
        "target_context": "platformer",
        "layout_validation_available": True,
        "layout_validation_status": "passed",
        "layout_validation_status_label": "clean",
        "layout_validation_summary": "Spatial validation clean for candidate one: 0 issues detected.",
        "layout_validation_issue_count": 0,
        "layout_validation_blocking_issue_count": 0,
        "gap_size_tier": "large",
        "obstacle_density_tier": "dense",
    }
    second_valid_payload = {
        "target_context": "platformer",
        "layout_validation_available": True,
        "layout_validation_status": "passed",
        "layout_validation_status_label": "clean",
        "layout_validation_summary": "Spatial validation clean for candidate two: 0 issues detected.",
        "layout_validation_issue_count": 0,
        "layout_validation_blocking_issue_count": 0,
        "gap_size_tier": "standard",
        "obstacle_density_tier": "sparse",
    }
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "PLAT_AUTO_FORMAT_001",
                    priority=1,
                    execution_seconds=0,
                    result_payload_sequence=[first_valid_payload, second_valid_payload, second_valid_payload],
                ),
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            platformer_auto_iteration_max_attempts=2,
            session_id="platformer-auto-iteration-format",
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()

    artifact = json.loads(
        (config.runs_dir / "platformer-auto-iteration-format" / "artifacts" / "PLAT_AUTO_FORMAT_001_attempt_01.json").read_text(encoding="utf-8")
    )
    details = artifact["result"]["details"]
    candidate_one = details["platformer_auto_iteration_candidate_set"]["candidate_1"]
    candidate_two = details["platformer_auto_iteration_candidate_set"]["candidate_2"]
    assert result.tasks_completed == 1
    assert candidate_one["layout_parameters"]["gap_size_tier"] == "large"
    assert candidate_one["layout_parameters"]["obstacle_density_tier"] == "dense"
    assert candidate_two["layout_parameters"]["gap_size_tier"] == "standard"
    assert candidate_two["layout_parameters"]["obstacle_density_tier"] == "sparse"
    assert details["platformer_auto_iteration_result_set"] == (
        "AUTONOMOUS RESULT SET\n\n"
        "2 valid candidates generated\n\n"
        "Candidate A:\n"
        "- Validation: clean\n"
        "- Evaluation: Gap size: large; Obstacle density: dense\n"
        "- Gap size: large\n"
        "- Obstacle density: dense\n\n"
        "Candidate B:\n"
        "- Validation: clean\n"
        "- Evaluation: Gap size: standard; Obstacle density: sparse\n"
        "- Gap size: standard\n"
        "- Obstacle density: sparse"
    )
    assert "best" not in details["platformer_auto_iteration_result_set"].lower()
    assert "recommended" not in details["platformer_auto_iteration_result_set"].lower()
    assert "score" not in details["platformer_auto_iteration_result_set"].lower()


def test_supervisor_platformer_auto_iteration_candidate_storage_is_deterministic_and_unranked(tmp_path):
    config = _make_config(tmp_path / "platformer_auto_iteration_deterministic_storage")
    clock = FakeClock()
    router = _make_router(clock)
    valid_payloads = [
        {
            "target_context": "platformer",
            "layout_validation_available": True,
            "layout_validation_status": "passed",
            "layout_validation_status_label": "clean",
            "layout_validation_summary": f"Spatial validation clean for candidate {index}: 0 issues detected.",
            "layout_validation_issue_count": 0,
            "layout_validation_blocking_issue_count": 0,
            "gap_size_tier": tier,
        }
        for index, tier in enumerate(("small", "standard", "large"), start=1)
    ]
    _write_queue(
        config.queue_path,
        {"tasks": [_task(config, "PLAT_AUTO_DETERMINISTIC_001", priority=1, execution_seconds=0, result_payload_sequence=valid_payloads)]},
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            platformer_auto_iteration_max_attempts=3,
            session_id="platformer-auto-iteration-deterministic",
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    supervisor.run()

    artifact = json.loads(
        (config.runs_dir / "platformer-auto-iteration-deterministic" / "artifacts" / "PLAT_AUTO_DETERMINISTIC_001_attempt_01.json").read_text(encoding="utf-8")
    )
    details = artifact["result"]["details"]
    assert details["platformer_auto_iteration_valid_candidate_ids"] == ["candidate_1", "candidate_2", "candidate_3"]
    assert list(details["platformer_auto_iteration_candidate_set"].keys()) == ["candidate_1", "candidate_2", "candidate_3"]
    assert [entry["candidate_label"] for entry in details["platformer_auto_iteration_valid_candidates"]] == ["Candidate A", "Candidate B", "Candidate C"]
    for entry in details["platformer_auto_iteration_valid_candidates"]:
        assert "rank" not in entry
        assert "score" not in entry
        assert "recommendation" not in entry
        assert "recommended" not in entry


def test_supervisor_platformer_autonomous_build_complete_presents_intent_candidate_set_and_attempt_log(tmp_path):
    config = _make_config(tmp_path / "platformer_autonomous_build_complete")
    invalid_payload = {
        "target_context": "platformer",
        "layout_validation_available": True,
        "layout_validation_status": "issues_found",
        "layout_validation_summary": "1 spatial issue(s) detected for platformer layout: 1 unreachable platform.",
        "layout_validation_issue_count": 1,
        "layout_validation_blocking_issue_count": 1,
        "layout_validation_issue_messages": ["Unreachable platform at P9."],
        "layout_validation_issue_codes": ["unreachable_platform"],
        "layout_validation_issues": [
            {
                "code": "unreachable_platform",
                "severity": "error",
                "message": "Unreachable platform at P9.",
            }
        ],
    }
    valid_payload = {
        "target_context": "platformer",
        "layout_validation_available": True,
        "layout_validation_status": "passed",
        "layout_validation_status_label": "clean",
        "layout_validation_summary": "Spatial validation clean for bounded challenge traversal candidate: 0 issues detected.",
        "layout_validation_issue_count": 0,
        "layout_validation_blocking_issue_count": 0,
        "gap_size_tier": "large",
        "obstacle_density_tier": "dense",
        "enemy_density_tier": "high",
        "segment_count_tier": "long",
    }
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "PLAT_AUTO_BUILD_001",
                    priority=1,
                    execution_seconds=0,
                    source_prompt="make traversal more challenging but fair",
                    operator_prompt="make gaps larger",
                    mapped_prompt="use challenge traversal",
                    plan_key="platformer_challenge_traversal_v1",
                    plan_title="Use challenge traversal",
                    resolution_source="goal_intent_mapping",
                    goal_components=[
                        "increase gap size",
                        "increase obstacle density",
                        "increase enemy density",
                        "increase segment count",
                    ],
                    result_payload_sequence=[invalid_payload, valid_payload],
                ),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            platformer_auto_iteration_max_attempts=2,
            session_id="platformer-autonomous-build-complete",
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()

    artifact = json.loads(
        (config.runs_dir / "platformer-autonomous-build-complete" / "artifacts" / "PLAT_AUTO_BUILD_001_attempt_01.json").read_text(encoding="utf-8")
    )
    artifact_markdown = (
        config.runs_dir / "platformer-autonomous-build-complete" / "artifacts" / "PLAT_AUTO_BUILD_001_attempt_01.md"
    ).read_text(encoding="utf-8")
    details = artifact["result"]["details"]
    assert result.tasks_completed == 1
    assert details["platformer_autonomous_build_parameter_families"] == [
        "gap_size",
        "obstacle_density",
        "enemy_density",
        "segment_count",
    ]
    assert details["platformer_autonomous_build_complete"] == (
        "AUTONOMOUS BUILD COMPLETE\n\n"
        "Requested directive: make traversal more challenging but fair\n"
        "Bounded mapping: use challenge traversal\n"
        "Known capability families: gap_size, obstacle_density, enemy_density, segment_count\n\n"
        "AUTONOMOUS RESULT SET\n\n"
        "1 valid candidate generated\n\n"
        "Candidate A:\n"
        "- Validation: clean\n"
        "- Evaluation: Gap size: large; Obstacle density: dense; Enemy density: high; Segment count: long\n"
        "- Gap size: large\n"
        "- Obstacle density: dense\n"
        "- Enemy density: high\n"
        "- Segment count: long\n\n"
        "ATTEMPT LOG\n"
        "- attempt 1: rejected | validation=issues_found | reason=Unreachable platform at P9.\n"
        "- attempt 2: accepted | validation=passed | reason=no blocking issues\n\n"
        "USER CONTROL\n"
        "- approve\n"
        "- reject\n"
        "- request changes"
    )
    assert "AUTONOMOUS BUILD COMPLETE" in artifact_markdown
    assert "request changes" in details["platformer_autonomous_build_complete"].lower()
    assert "recommend" not in details["platformer_autonomous_build_complete"].lower()
    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    attempted_entry = state["tasks_attempted"][0]
    assert attempted_entry["auto_iteration_build_parameter_families"] == details["platformer_autonomous_build_parameter_families"]
    assert attempted_entry["auto_iteration_build_complete"] == details["platformer_autonomous_build_complete"]


def test_supervisor_platformer_auto_iteration_blocks_after_bounded_attempt_exhaustion(tmp_path, capsys):
    config = _make_config(tmp_path / "platformer_auto_iteration_exhausted")
    invalid_payload_sequence = [
        {
            "target_context": "platformer",
            "layout_validation_available": True,
            "layout_validation_status": "issues_found",
            "layout_validation_summary": "1 spatial issue(s) detected for platformer layout: 1 unreachable platform.",
            "layout_validation_issue_count": 1,
            "layout_validation_blocking_issue_count": 1,
            "layout_validation_issue_messages": [f"Unreachable platform on attempt {index}."],
            "layout_validation_issue_codes": ["unreachable_platform"],
            "layout_validation_issues": [
                {
                    "code": "unreachable_platform",
                    "severity": "error",
                    "message": f"Unreachable platform on attempt {index}.",
                }
            ],
        }
        for index in range(1, 5)
    ]
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "PLAT_AUTO_BLOCK_001",
                    priority=1,
                    execution_seconds=1,
                    result_payload_sequence=invalid_payload_sequence,
                ),
            ]
        },
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            platformer_auto_iteration_max_attempts=3,
            session_id="platformer-auto-iteration-block",
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_empty"
    assert result.tasks_completed == 0
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "blocked"
    assert int(queue[0].get("retry_count", 0)) == 0
    runtime_status = json.loads((config.runs_dir / "platformer-auto-iteration-block" / "runtime_status.json").read_text(encoding="utf-8"))
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "blocked"
    artifact = json.loads(
        (config.runs_dir / "platformer-auto-iteration-block" / "artifacts" / "PLAT_AUTO_BLOCK_001_attempt_01.json").read_text(encoding="utf-8")
    )
    details = artifact["result"]["details"]
    assert details["platformer_auto_iteration_attempt_count"] == 3
    assert details["platformer_auto_iteration_accepted_attempt"] is None
    assert details["platformer_auto_iteration_exhausted"] is True
    assert len(details["platformer_auto_iteration_attempts"]) == 3
    assert artifact["validation"]["queue_action"] == "block"
    assert artifact["validation"]["reason"] == "platformer_auto_iteration_exhausted"
    assert "No acceptable platformer variant found within bounded internal iteration." in artifact["validation"]["note"]

    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    attempted_entry = state["tasks_attempted"][0]
    assert attempted_entry["auto_iteration_attempt_count"] == 3
    assert attempted_entry["auto_iteration_exhausted"] is True
    assert attempted_entry["auto_iteration_accepted_attempt"] is None
    assert "attempt 3 rejected (Unreachable platform on attempt 3.)" in attempted_entry["auto_iteration_summary"]
    assert "attempt=1/3" in output
    assert "attempt=2/3" in output

    assert "attempt=3/3" in output
    assert "attempt=4/3" not in output


def test_supervisor_extended_stress_moderate_run_preserves_truthful_artifacts(tmp_path, capsys):
    config = _make_config(tmp_path / "stress_moderate")
    tasks = [
        _task(config, f"MOD_SUCCESS_{index:03d}", priority=index, execution_seconds=0)
        for index in range(1, 19)
    ]
    tasks.extend(
        _task(config, f"MOD_RETRY_{index:03d}", priority=100 + index, execution_seconds=0, simulated_outcome="retryable_failure")
        for index in range(1, 5)
    )
    tasks.append(
        {
            "task_id": "MOD_BLOCKED_PENDING_001",
            "priority": 250,
            "status": "pending",
            "content_policy_decision": "blocked",
            "contract_path": _create_runtime_payload(config, "MOD_BLOCKED_PENDING_001", execution_seconds=0),
        }
    )
    tasks.append(
        {
            "task_id": "MOD_NEEDS_APPROVAL_001",
            "priority": 260,
            "status": "needs_approval",
            "contract_path": _create_runtime_payload(config, "MOD_NEEDS_APPROVAL_001", execution_seconds=0),
        }
    )
    _write_queue(config.queue_path, {"tasks": tasks})
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=300,
            heartbeat_interval_seconds=5,
            poll_interval_seconds=1,
            max_task_executions=30,
            repeated_failure_threshold=50,
            session_id="stress-moderate-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(config, "stress-moderate-session")

    assert result.stop_reason == "max_task_executions_reached"
    assert result.tasks_completed == 18
    assert runtime_status["tasks_executed_count"] == 30
    assert runtime_status["loop_iterations"] == 30
    assert runtime_status["failure_streak_count"] == 12
    assert runtime_status["last_task_result_status"] == "blocked"
    assert runtime_status["queue_remaining"] == 2
    assert session_summary["tasks_completed"] == 18
    assert session_summary["tasks_blocked"] == 4
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert session_summary["loop_visibility"]["tasks_executed_count"] == 30
    assert session_summary["loop_visibility"]["loop_iterations"] == 30
    assert session_summary["loop_visibility"]["failure_streak_count"] == 12
    assert session_summary["selector_visibility"]["selected_task"] == session_summary["selector_visibility"]["top_candidates"][0]["task_id"]
    assert any(entry["task_id"] == "MOD_BLOCKED_PENDING_001" for entry in runtime_status["excluded_tasks"])
    assert any(entry["task_id"] == "MOD_NEEDS_APPROVAL_001" for entry in runtime_status["excluded_tasks"])
    _assert_truthful_output_counts(
        output,
        runtime_status=runtime_status,
        completed_count=18,
        retry_count=8,
        blocked_count=4,
    )
    _assert_report_contract_text(operator_report)
    assert "## AI-E Loop Summary" in session_summary_markdown
    assert "Tasks Executed Count: 30" in session_summary_markdown
    assert "Failure Streak Count: 12" in session_summary_markdown
    assert "tasks executed: 30" in operator_report
    assert "tasks completed: 18" in operator_report
    assert "tasks blocked: 4" in operator_report


def test_supervisor_extended_stress_heavy_run_has_no_counter_drift(tmp_path, capsys):
    config = _make_config(tmp_path / "stress_heavy")
    tasks = [
        _task(config, f"HEAVY_SUCCESS_{index:03d}", priority=index, execution_seconds=0)
        for index in range(1, 91)
    ]
    tasks.extend(
        _task(config, f"HEAVY_RETRY_{index:03d}", priority=200 + index, execution_seconds=0, simulated_outcome="retryable_failure")
        for index in range(1, 11)
    )
    _write_queue(config.queue_path, {"tasks": tasks})
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=600,
            heartbeat_interval_seconds=10,
            poll_interval_seconds=1,
            max_task_executions=120,
            repeated_failure_threshold=200,
            session_id="stress-heavy-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(config, "stress-heavy-session")

    assert result.stop_reason == "max_task_executions_reached"
    assert result.tasks_completed == 90
    assert runtime_status["tasks_executed_count"] == 120
    assert runtime_status["loop_iterations"] == 120
    assert runtime_status["failure_streak_count"] == 30
    assert runtime_status["last_task_result_status"] == "blocked"
    assert runtime_status["queue_remaining"] == 0
    assert session_summary["tasks_completed"] == 90
    assert session_summary["tasks_blocked"] == 10
    assert session_summary["loop_visibility"]["tasks_executed_count"] == 120
    assert session_summary["loop_visibility"]["loop_iterations"] == 120
    assert session_summary["loop_visibility"]["failure_streak_count"] == 30
    _assert_truthful_output_counts(
        output,
        runtime_status=runtime_status,
        completed_count=90,
        retry_count=20,
        blocked_count=10,
    )
    _assert_report_contract_text(operator_report)
    assert "Tasks Executed Count: 120" in session_summary_markdown
    assert "tasks executed: 120" in operator_report
    assert "tasks completed: 90" in operator_report
    assert "tasks blocked: 10" in operator_report


def test_supervisor_extended_stress_failure_run_keeps_failure_accounting_truthful(tmp_path, capsys):
    config = _make_config(tmp_path / "stress_failure")
    tasks = [
        _task(config, f"FAIL_STRESS_{index:03d}", priority=index, execution_seconds=0, simulated_outcome="retryable_failure")
        for index in range(1, 9)
    ]
    _write_queue(config.queue_path, {"tasks": tasks})
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=300,
            heartbeat_interval_seconds=5,
            poll_interval_seconds=1,
            max_task_executions=200,
            repeated_failure_threshold=5,
            session_id="stress-failure-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()
    output = capsys.readouterr().out
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(config, "stress-failure-session")
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    actual_retry_count = output.count("TASK RETRY task_id=")
    actual_blocked_count = output.count("TASK BLOCKED task_id=")
    blocked_queue_count = sum(1 for task in queue if task["status"] == "blocked")

    assert result.stop_reason == "repeated_failure_threshold_exceeded"
    assert result.tasks_completed == 0
    assert runtime_status["tasks_executed_count"] == 5
    assert runtime_status["loop_iterations"] == 5
    assert runtime_status["failure_streak_count"] == 5
    assert runtime_status["last_task_result_status"] == "retry_scheduled"
    assert session_summary["tasks_completed"] == 0
    assert session_summary["tasks_blocked"] == actual_blocked_count
    assert session_summary["stop_reason"] == "repeated_failure_threshold_exceeded"
    assert session_summary["loop_visibility"]["tasks_executed_count"] == 5
    assert session_summary["loop_visibility"]["failure_streak_count"] == 5
    assert blocked_queue_count == actual_blocked_count
    assert any(task["status"] == "pending" and int(task.get("retry_count", 0)) > 0 for task in queue)
    assert actual_retry_count + actual_blocked_count == runtime_status["tasks_executed_count"]
    _assert_truthful_output_counts(
        output,
        runtime_status=runtime_status,
        completed_count=0,
        retry_count=actual_retry_count,
        blocked_count=actual_blocked_count,
    )
    _assert_report_contract_text(operator_report)
    assert "Tasks Executed Count: 5" in session_summary_markdown
    assert "Failure Streak Count: 5" in session_summary_markdown
    assert "stop reason: repeated_failure_threshold_exceeded" in operator_report


def test_supervisor_resumes_interrupted_session_and_reclaims_running_task(tmp_path):
    config = _make_config(tmp_path / "resume")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RESUME_001",
                    "priority": 1,
                    "status": "running",
                    "current_session_id": "resume-session",
                    "execution_seconds": 1,
                    "contract_path": _create_runtime_payload(config, "RESUME_001", execution_seconds=1),
                },
                _task(config, "RESUME_002", priority=2, execution_seconds=1),
            ]
        },
    )
    session_dir = config.runs_dir / "resume-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "session_id": "resume-session",
                "status": "running",
                "elapsed_time_seconds": 2.0,
                "tasks_attempted": [],
                "tasks_completed": [],
                "artifacts_generated": [],
                "blockers_detected": [],
                "heartbeats_emitted": 0,
                "loop_iterations": 0,
                "queue_remaining": 2,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=2,
            poll_interval_seconds=1,
            session_id="resume-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    assert result.tasks_completed == 2
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "completed"]
    assert queue[0]["current_session_id"] is None
    artifacts_dir = config.runs_dir / "resume-session" / "artifacts"
    assert (artifacts_dir / "RESUME_001_attempt_01.json").exists()
    assert (artifacts_dir / "RESUME_002_attempt_01.json").exists()
    assert not (artifacts_dir / "RESUME_001_attempt_02.json").exists()

    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    assert state["resumed"] is True
    assert state["tasks_completed"] == ["RESUME_001", "RESUME_002"]
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-session",
    )
    recovery_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"
    )
    missing_artifact_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    )
    assert recovery_entry.get("details", []) == ["task_id:RESUME_001"]
    assert {
        "task_id:RESUME_001",
        "artifact:artifacts/RESUME_001_attempt_01.json",
        "artifact:artifacts/RESUME_001_attempt_01.md",
    }.issubset(set(missing_artifact_entry.get("details", [])))
    assert runtime_status["integrity_issues"]
    assert "recovered_interrupted_running_tasks" in session_summary_markdown
    assert "interrupted_task_missing_attempt_artifacts" in session_summary_markdown
    assert "task_id:RESUME_001" in operator_report
    assert "artifact:artifacts/RESUME_001_attempt_01.json" in operator_report


def test_supervisor_repeated_resume_merges_interrupted_task_recovery_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_recovery_merge")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RRT_001",
                    "priority": 1,
                    "status": "running",
                    "current_session_id": "rrt",
                    "contract_path": _create_runtime_payload(config, "RRT_001", execution_seconds=1),
                },
                {
                    "task_id": "RRT_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "RRT_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rrt"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rrt", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rrt",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    recovery_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"]
    missing_artifact_entries = [
        entry for entry in first_state["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    ]
    assert len(parse_entries) == 1
    assert len(recovery_entries) == 1
    assert len(missing_artifact_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert recovery_entries[0].get("details", []) == ["task_id:RRT_001"]
    assert {
        "task_id:RRT_001",
        "artifact:artifacts/RRT_001_attempt_01.json",
        "artifact:artifacts/RRT_001_attempt_01.md",
    }.issubset(set(missing_artifact_entries[0].get("details", [])))

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"].append(
        {
            "task_id": "RRT_003",
            "priority": 1,
            "status": "running",
            "current_session_id": "rrt",
            "contract_path": _create_runtime_payload(config, "RRT_003", execution_seconds=1),
        }
    )
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=2,
            session_id="rrt",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    second_result = second_supervisor.run()
    assert second_result.stop_reason == "max_task_executions_reached"

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rrt",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    recovery_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"]
    missing_artifact_entries = [
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    ]
    assert len(parse_entries) == 1
    assert len(recovery_entries) == 1
    assert len(missing_artifact_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert set(recovery_entries[0].get("details", [])) == {"task_id:RRT_001", "task_id:RRT_003"}
    assert {
        "task_id:RRT_001",
        "artifact:artifacts/RRT_001_attempt_01.json",
        "artifact:artifacts/RRT_001_attempt_01.md",
        "task_id:RRT_003",
        "artifact:artifacts/RRT_003_attempt_01.json",
        "artifact:artifacts/RRT_003_attempt_01.md",
    }.issubset(set(missing_artifact_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "recovered_interrupted_running_tasks" in session_summary_markdown
    assert "interrupted_task_missing_attempt_artifacts" in session_summary_markdown
    assert "task_id:RRT_003" in operator_report
    assert "artifact:artifacts/RRT_003_attempt_01.json" in operator_report
    final_state = json.loads(second_result.state_path.read_text(encoding="utf-8"))
    assert len(final_state["tasks_attempted"]) == 2


def test_supervisor_resume_surfaces_corrupt_summary_and_missing_operator_report(tmp_path):
    config = _make_config(tmp_path / "resume_integrity")
    _write_queue(
        config.queue_path,
        {"tasks": [_task(config, "RESUME_INTEGRITY_001", priority=1, execution_seconds=1)]},
    )
    session_dir = config.runs_dir / "resume-integrity-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "session_id": "resume-integrity-session",
                "status": "running",
                "elapsed_time_seconds": 1.0,
                "tasks_attempted": [],
                "tasks_completed": [],
                "tasks_failed": [],
                "artifacts_generated": ["session_summary.json", "session_summary.md", "operator_report.md"],
                "blockers_detected": [],
                "heartbeats_emitted": 0,
                "loop_iterations": 0,
                "queue_remaining": 1,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text("{ invalid", encoding="utf-8")
    (session_dir / "session_summary.md").write_text("stale markdown", encoding="utf-8")

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-integrity-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(config, "resume-integrity-session")
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "session_summary_json_invalid_json" in issue_names
    assert "missing_operator_report_md" in issue_names
    assert any(name.startswith("missing_artifact::operator_report.md") for name in issue_names)
    assert runtime_status["integrity_issues"]
    assert "## Integrity Issues" in session_summary_markdown
    assert "session_summary_json_invalid_json" in session_summary_markdown
    assert "integrity issue: session_summary_json_invalid_json" in operator_report
    assert "integrity issue: missing_operator_report_md" in operator_report


def test_supervisor_resume_recovers_from_invalid_session_state_shape(tmp_path):
    config = _make_config(tmp_path / "resume_invalid_state_shape")
    _write_queue(
        config.queue_path,
        {"tasks": [_task(config, "RESUME_INVALID_STATE_001", priority=1, execution_seconds=1)]},
    )
    session_dir = config.runs_dir / "resume-invalid-shape-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session_state.json").write_text(
        json.dumps([
            {"not": "a session state object"}
        ], indent=2),
        encoding="utf-8",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-invalid-shape-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-invalid-shape-session",
    )
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "session_state_invalid_shape" in issue_names
    invalid_shape_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_shape")
    assert "root_not_object" in invalid_shape_entry.get("details", [])
    assert runtime_status["integrity_issues"]
    assert runtime_status["tasks_executed_count"] == 1
    assert session_summary["tasks_completed"] == 1
    assert "details: root_not_object" in session_summary_markdown
    assert "session_state_invalid_shape" in session_summary_markdown
    assert "integrity issue: session_state_invalid_shape [details: root_not_object]" in operator_report


def test_supervisor_resume_recovers_from_truncated_session_state_json(tmp_path):
    config = _make_config(tmp_path / "resume_truncated_state_json")
    _write_queue(
        config.queue_path,
        {"tasks": [_task(config, "RESUME_TRUNCATED_STATE_001", priority=1, execution_seconds=1)]},
    )
    session_dir = config.runs_dir / "resume-truncated-state-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session_state.json").write_text(
        '{"session_id": "resume-truncated-state-session", "elapsed_time_seconds": ',
        encoding="utf-8",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-truncated-state-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-truncated-state-session",
    )
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "session_state_invalid_json" in issue_names
    invalid_json_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json")
    assert "decode_error:unexpected_eof" in invalid_json_entry.get("details", [])
    assert any(detail.startswith("line:") for detail in invalid_json_entry.get("details", []))
    assert runtime_status["integrity_issues"]
    assert runtime_status["tasks_executed_count"] == 1
    assert session_summary["tasks_completed"] == 1
    assert "decode_error:unexpected_eof" in session_summary_markdown
    assert "session_state_invalid_json" in session_summary_markdown
    assert "integrity issue: session_state_invalid_json [details:" in operator_report
    assert "decode_error:unexpected_eof" in operator_report


def test_supervisor_resume_normalizes_invalid_session_state_field_variants(tmp_path):
    config = _make_config(tmp_path / "resume_invalid_state_fields")
    _write_queue(
        config.queue_path,
        {"tasks": [_task(config, "RESUME_INVALID_FIELDS_001", priority=1, execution_seconds=1)]},
    )
    session_dir = config.runs_dir / "resume-invalid-fields-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "session_id": "resume-invalid-fields-session",
                "status": "running",
                "elapsed_time_seconds": "not-a-float",
                "tasks_attempted": "not-a-list",
                "tasks_completed": {"bad": "shape"},
                "tasks_failed": ["bad-entry"],
                "artifacts_generated": {"bad": "shape"},
                "blockers_detected": "not-a-list",
                "integrity_issues": ["bad-entry"],
                "heartbeats_emitted": "oops",
                "loop_iterations": "oops",
                "tasks_executed_count": "oops",
                "failure_streak_count": "oops",
                "queue_remaining": "oops",
                "polling_enabled": "not-a-bool",
                "idle_poll_count": "oops",
                "idle_duration_seconds": "oops",
                "idle_timeout_seconds": "oops",
                "idle_timeout_poll_limit": "oops",
                "last_generated_plan_steps": {"bad": "shape"},
                "top_candidates": {"bad": "shape"},
                "excluded_tasks": {"bad": "shape"},
                "phase_index": "oops",
                "phase_total": "oops",
                "progress_percent": "oops",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-invalid-fields-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-invalid-fields-session",
    )
    persisted_state = json.loads(result.state_path.read_text(encoding="utf-8"))
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "session_state_invalid_shape" in issue_names
    invalid_shape_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_shape")
    details = set(invalid_shape_entry.get("details", []))
    assert {"elapsed_time_seconds", "tasks_attempted", "tasks_completed", "tasks_failed", "polling_enabled", "phase_index", "phase_total"}.issubset(details)
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["failure_streak_count"] == 0
    assert runtime_status["integrity_issues"]
    assert persisted_state["elapsed_time_seconds"] >= 0.0
    assert isinstance(persisted_state["tasks_attempted"], list)
    assert isinstance(persisted_state["tasks_completed"], list)
    assert isinstance(persisted_state["tasks_failed"], list)
    assert isinstance(persisted_state["artifacts_generated"], list)
    assert isinstance(persisted_state["blockers_detected"], list)
    assert isinstance(persisted_state["integrity_issues"], list)
    assert isinstance(persisted_state["top_candidates"], list)
    assert isinstance(persisted_state["excluded_tasks"], list)
    assert persisted_state["polling_enabled"] is True
    assert "details: artifacts_generated, blockers_detected" in session_summary_markdown
    assert "session_state_invalid_shape" in session_summary_markdown
    assert "integrity issue: session_state_invalid_shape [details:" in operator_report
    assert "elapsed_time_seconds" in operator_report


def test_supervisor_fails_closed_when_queue_json_is_invalid(tmp_path, capsys):
    config = _make_config(tmp_path / "invalid_queue")
    config.queue_path.write_text('{"tasks": [', encoding="utf-8")

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="invalid-queue-session",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_state_invalid"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(config, "invalid-queue-session")
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "queue_json_invalid_json" in issue_names
    invalid_json_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_invalid_json")
    assert "decode_error:unexpected_eof" in invalid_json_entry.get("details", [])
    assert runtime_status["tasks_executed_count"] == 0
    assert runtime_status["last_task_result_status"] is None
    assert session_summary["tasks_completed"] == 0
    assert session_summary["stop_reason"] == "queue_state_invalid"
    assert "decode_error:unexpected_eof" in session_summary_markdown
    assert "queue_json_invalid_json" in session_summary_markdown
    assert "integrity issue: queue_json_invalid_json [details:" in operator_report
    assert "decode_error:unexpected_eof" in operator_report
    assert "QUEUE STATE INVALID" in output
    assert "TASK STARTED" not in output


def test_supervisor_fails_closed_when_queue_shape_is_invalid(tmp_path, capsys):
    config = _make_config(tmp_path / "invalid_queue_shape")
    config.queue_path.write_text(
        json.dumps({"tasks": "not-a-list"}, indent=2),
        encoding="utf-8",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="invalid-queue-shape-session",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_state_invalid"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "invalid-queue-shape-session",
    )
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "queue_json_invalid_shape" in issue_names
    invalid_shape_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_invalid_shape")
    assert "tasks_not_list" in invalid_shape_entry.get("details", [])
    assert runtime_status["tasks_executed_count"] == 0
    assert session_summary["stop_reason"] == "queue_state_invalid"
    assert "details: tasks_not_list" in session_summary_markdown
    assert "queue_json_invalid_shape" in session_summary_markdown
    assert "integrity issue: queue_json_invalid_shape [details: tasks_not_list]" in operator_report
    assert "QUEUE STATE INVALID" in output
    assert "TASK STARTED" not in output


def test_supervisor_fails_closed_when_queue_task_identifier_is_missing(tmp_path, capsys):
    config = _make_config(tmp_path / "invalid_queue_task_shape")
    config.queue_path.write_text(
        json.dumps(
            {"tasks": [{"priority": 1, "status": "pending", "contract_path": "missing-id.json"}]},
            indent=2,
        ),
        encoding="utf-8",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="invalid-queue-task-shape-session",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_state_invalid"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "invalid-queue-task-shape-session",
    )
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "queue_json_invalid_shape" in issue_names
    invalid_shape_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_invalid_shape")
    assert "task_missing_identifier:0" in invalid_shape_entry.get("details", [])
    assert runtime_status["tasks_executed_count"] == 0
    assert session_summary["stop_reason"] == "queue_state_invalid"
    assert "details: task_missing_identifier:0" in session_summary_markdown
    assert "queue_json_invalid_shape" in session_summary_markdown
    assert "integrity issue: queue_json_invalid_shape [details: task_missing_identifier:0]" in operator_report
    assert "QUEUE STATE INVALID" in output
    assert "TASK STARTED" not in output


def test_supervisor_resume_mixed_queue_preserves_retry_and_exclusion_truthfulness(tmp_path):
    config = _make_config(tmp_path / "resume_mixed_queue")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "RESUME_RUN_001", priority=1, execution_seconds=1),
                {
                    "task_id": "RESUME_BLOCKED_POLICY_001",
                    "priority": 2,
                    "status": "pending",
                    "content_policy_decision": "blocked",
                    "contract_path": _create_runtime_payload(config, "RESUME_BLOCKED_POLICY_001", execution_seconds=1),
                },
                {
                    "task_id": "RESUME_APPROVAL_001",
                    "priority": 3,
                    "status": "needs_approval",
                    "contract_path": _create_runtime_payload(config, "RESUME_APPROVAL_001", execution_seconds=1),
                },
                {
                    **_task(config, "RESUME_RETRY_001", priority=4, execution_seconds=1),
                    "retry_count": 1,
                    "last_error": "retry before restart",
                    "last_result_status": "retryable_failure",
                },
                {
                    "task_id": "RESUME_ALREADY_BLOCKED_001",
                    "priority": 5,
                    "status": "blocked",
                    "last_error": "already blocked before restart",
                    "contract_path": _create_runtime_payload(config, "RESUME_ALREADY_BLOCKED_001", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "resume-mixed-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "session_id": "resume-mixed-session",
                "status": "running",
                "elapsed_time_seconds": 2.0,
                "tasks_attempted": [
                    {
                        "task_id": "RESUME_RETRY_001",
                        "final_status": "retry_scheduled",
                        "note": "retry before restart",
                        "timestamp": "2026-03-19 10:00:00 -04:00 (Eastern Time â€” New York)",
                    }
                ],
                "tasks_completed": [],
                "tasks_failed": [
                    {
                        "task_id": "RESUME_RETRY_001",
                        "note": "retry before restart",
                        "timestamp": "2026-03-19 10:00:00 -04:00 (Eastern Time â€” New York)",
                    }
                ],
                "artifacts_generated": [],
                "blockers_detected": [],
                "heartbeats_emitted": 0,
                "loop_iterations": 1,
                "tasks_executed_count": 1,
                "failure_streak_count": 1,
                "queue_remaining": 4,
                "last_task_result_status": "retry_scheduled",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=3,
            session_id="resume-mixed-session",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["RESUME_RUN_001"]["status"] == "completed"
    assert queue_by_id["RESUME_RETRY_001"]["status"] == "completed"
    assert queue_by_id["RESUME_RETRY_001"]["retry_count"] == 1
    assert queue_by_id["RESUME_BLOCKED_POLICY_001"]["status"] == "pending"
    assert queue_by_id["RESUME_APPROVAL_001"]["status"] == "needs_approval"
    assert queue_by_id["RESUME_ALREADY_BLOCKED_001"]["status"] == "blocked"
    runtime_status, session_summary, _, operator_report = _load_session_outputs(config, "resume-mixed-session")
    assert runtime_status["tasks_executed_count"] == 3
    assert runtime_status["last_task_result_status"] == "completed"
    assert runtime_status["failure_streak_count"] == 0
    assert any(entry["task_id"] == "RESUME_BLOCKED_POLICY_001" for entry in runtime_status["excluded_tasks"])
    assert any(entry["task_id"] == "RESUME_APPROVAL_001" for entry in runtime_status["excluded_tasks"])
    assert session_summary["tasks_completed"] == 2
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert session_summary["selector_visibility"]["selected_task"] == "RESUME_RETRY_001"
    assert "selected task: RESUME_RETRY_001" in operator_report


def test_supervisor_repeated_resume_merges_integrity_details_without_duplicate_issue_entries(tmp_path):
    config = _make_config(tmp_path / "resume_multi_checkpoint")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(config, "RESUME_MULTI_001", priority=1, execution_seconds=1),
                _task(config, "RESUME_MULTI_002", priority=2, execution_seconds=1),
            ]
        },
    )
    session_dir = config.runs_dir / "resume-multi-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text(
        json.dumps(
            {
                "session_id": "resume-multi-session",
                "status": "running",
                "elapsed_time_seconds": "bad-first-pass",
                "tasks_attempted": [],
                "tasks_completed": [],
                "tasks_failed": [],
                "artifacts_generated": [],
                "blockers_detected": [],
                "heartbeats_emitted": 0,
                "loop_iterations": 0,
                "tasks_executed_count": 0,
                "failure_streak_count": 0,
                "queue_remaining": 2,
                "polling_enabled": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="resume-multi-session",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    first_entry = next(entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_shape")
    assert first_entry.get("details") == ["elapsed_time_seconds"]

    first_state["status"] = "running"
    first_state["finished_at"] = None
    first_state["stop_reason"] = None
    first_state["current_task"] = None
    first_state["progress_percent"] = "bad-second-pass"
    first_state["tasks_completed"] = {"bad": "shape"}
    state_path.write_text(json.dumps(first_state, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-multi-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-multi-session",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_shape"]
    assert len(entries) == 1
    merged_details = set(entries[0].get("details", []))
    assert {"elapsed_time_seconds", "progress_percent", "tasks_completed"}.issubset(merged_details)
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 1
    assert "progress_percent" in session_summary_markdown
    assert "tasks_completed" in session_summary_markdown
    assert "integrity issue: session_state_invalid_shape [details:" in operator_report


def test_supervisor_sanitizes_top_level_valid_queue_task_fields_and_surfaces_details(tmp_path):
    config = _make_config(tmp_path / "queue_sanitized_fields")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "QUEUE_SANITIZE_001",
                    "priority": {"bad": "shape"},
                    "status": ["pending"],
                    "retry_count": "oops",
                    "dependencies": {"bad": "shape"},
                    "plan_step_index": "oops",
                    "trust_score": "oops",
                    "current_session_id": {"bad": "shape"},
                    "contract_path": _create_runtime_payload(config, "QUEUE_SANITIZE_001", execution_seconds=1),
                }
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="queue-sanitized-fields-session",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["priority"] == 1000
    assert queue[0]["retry_count"] == 0
    assert queue[0]["dependencies"] == []
    assert queue[0]["plan_step_index"] == 0
    assert queue[0]["trust_score"] == 0
    assert queue[0]["current_session_id"] is None
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "queue-sanitized-fields-session",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_priority:0",
        "task_invalid_status:0",
        "task_invalid_retry_count:0",
        "task_invalid_dependencies:0",
        "task_invalid_plan_step_index:0",
        "task_invalid_trust_score:0",
        "task_invalid_current_session_id:0",
    }.issubset(details)
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["queue_remaining"] == 0
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "task_invalid_priority:0" in session_summary_markdown
    assert "integrity issue: queue_json_sanitized_shape [details:" in operator_report
    assert "task_invalid_current_session_id:0" in operator_report


def test_supervisor_repeated_resume_merges_multi_class_integrity_details(tmp_path):
    config = _make_config(tmp_path / "resume_multi_class_integrity")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "MULTI_CLASS_001",
                    "priority": {"bad": "shape"},
                    "contract_path": _create_runtime_payload(config, "MULTI_CLASS_001", execution_seconds=1),
                },
                {
                    "task_id": "MULTI_CLASS_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "MULTI_CLASS_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "resume-multi-class-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text(
        json.dumps(
            {
                "session_id": "resume-multi-class-session",
                "status": "running",
                "elapsed_time_seconds": "bad-first-pass",
                "tasks_attempted": [],
                "tasks_completed": [],
                "tasks_failed": [],
                "artifacts_generated": [],
                "blockers_detected": [],
                "heartbeats_emitted": 0,
                "loop_iterations": 0,
                "tasks_executed_count": 0,
                "failure_streak_count": 0,
                "queue_remaining": 2,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="resume-multi-class-session",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    session_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_shape"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(session_entries) == 1
    assert len(queue_entries) == 1
    assert session_entries[0].get("details") == ["elapsed_time_seconds"]
    assert "task_invalid_priority:0" in queue_entries[0].get("details", [])

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    second_state["progress_percent"] = "bad-second-pass"
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"][1]["dependencies"] = {"bad": "shape"}
    queue_payload["tasks"][1]["trust_score"] = "bad-second-pass"
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-multi-class-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-multi-class-session",
    )
    session_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_shape"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(session_entries) == 1
    assert len(queue_entries) == 1
    assert {"elapsed_time_seconds", "progress_percent"}.issubset(set(session_entries[0].get("details", [])))
    assert {"task_invalid_priority:0", "task_invalid_dependencies:1", "task_invalid_trust_score:1"}.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "task_invalid_dependencies:1" in session_summary_markdown
    assert "integrity issue: queue_json_sanitized_shape [details:" in operator_report


def test_supervisor_mixed_defect_queue_preserves_sanitization_evidence_before_fail_closed_stop(tmp_path, capsys):
    config = _make_config(tmp_path / "mixed_defect_queue")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "MIXED_DEFECT_001",
                    "priority": {"bad": "shape"},
                    "status": ["pending"],
                    "contract_path": _create_runtime_payload(config, "MIXED_DEFECT_001", execution_seconds=1),
                },
                "fatal-non-object-entry",
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="mixed-defect-queue-session",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_state_invalid"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "mixed-defect-queue-session",
    )
    issue_names = {entry["issue"] for entry in session_summary["integrity_issues"]}
    assert "queue_json_invalid_shape" in issue_names
    assert "queue_json_sanitized_shape" in issue_names
    invalid_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_invalid_shape")
    sanitized_entry = next(entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape")
    assert "task_entry_not_object:1" in invalid_entry.get("details", [])
    assert {"task_invalid_priority:0", "task_invalid_status:0"}.issubset(set(sanitized_entry.get("details", [])))
    assert runtime_status["tasks_executed_count"] == 0
    assert session_summary["stop_reason"] == "queue_state_invalid"
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "task_entry_not_object:1" in session_summary_markdown
    assert "integrity issue: queue_json_invalid_shape [details:" in operator_report
    assert "integrity issue: queue_json_sanitized_shape [details:" in operator_report
    assert "QUEUE STATE INVALID" in output
    assert "TASK STARTED" not in output


def test_supervisor_repeated_resume_merges_parse_and_queue_sanitization_integrity_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_parse_and_queue_sanitization")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "PARSE_SANITIZE_001",
                    "priority": {"bad": "shape"},
                    "contract_path": _create_runtime_payload(config, "PARSE_SANITIZE_001", execution_seconds=1),
                },
                {
                    "task_id": "PARSE_SANITIZE_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "PARSE_SANITIZE_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "resume-parse-sanitize-session"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "resume-parse-sanitize-session", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="resume-parse-sanitize-session",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert "task_invalid_priority:0" in queue_entries[0].get("details", [])

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    second_state["progress_percent"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"][1]["dependencies"] = {"bad": "shape"}
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="resume-parse-sanitize-session",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "resume-parse-sanitize-session",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {"task_invalid_priority:0", "task_invalid_dependencies:1"}.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "decode_error:unexpected_eof" in operator_report
    assert "task_invalid_dependencies:1" in operator_report


def test_supervisor_sanitizes_metadata_damage_in_top_level_valid_queue_payload(tmp_path):
    config = _make_config(tmp_path / "queue_metadata_sanitized_fields")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "QUEUE_METADATA_001",
                    "priority": 1,
                    "approval_required": {"bad": "shape"},
                    "auto_execution_enabled": {"bad": "shape"},
                    "rating_locked": ["bad"],
                    "decision_auto_execute": {"bad": "shape"},
                    "sandbox_verified": {"bad": "shape"},
                    "real_target_verified": {"bad": "shape"},
                    "rollback_verified": {"bad": "shape"},
                    "missing_evidence": {"bad": "shape"},
                    "requested_content_dimensions": {
                        "violence": "medium",
                        "gore": {"bad": "shape"}
                    },
                    "execution_lane": {"bad": "shape"},
                    "plan_id": {"bad": "shape"},
                    "plan_step_title": {"bad": "shape"},
                    "content_policy_decision": {"bad": "shape"},
                    "decision_summary": {"bad": "shape"},
                    "content_policy_summary": {"bad": "shape"},
                    "contract_path": _create_runtime_payload(config, "QUEUE_METADATA_001", execution_seconds=1),
                }
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="queue-metadata-sanitized-session",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["approval_required"] is True
    assert queue[0]["auto_execution_enabled"] is False
    assert queue[0]["rating_locked"] is True
    assert queue[0]["decision_auto_execute"] is False
    assert queue[0]["sandbox_verified"] is False
    assert queue[0]["real_target_verified"] is False
    assert queue[0]["rollback_verified"] is False
    assert queue[0]["missing_evidence"] == []
    assert queue[0]["requested_content_dimensions"] == {"violence": "medium"}
    assert queue[0]["execution_lane"] == "approval_required_mutation"
    assert queue[0]["plan_id"] is None
    assert queue[0]["plan_step_title"] is None
    assert queue[0]["content_policy_decision"] == "requires_review"
    assert queue[0]["decision_summary"] is None
    assert queue[0]["content_policy_summary"] is None
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "queue-metadata-sanitized-session",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_approval_required:0",
        "task_invalid_auto_execution_enabled:0",
        "task_invalid_rating_locked:0",
        "task_invalid_decision_auto_execute:0",
        "task_invalid_sandbox_verified:0",
        "task_invalid_real_target_verified:0",
        "task_invalid_rollback_verified:0",
        "task_invalid_missing_evidence:0",
        "task_invalid_requested_content_dimensions:0",
        "task_invalid_execution_lane:0",
        "task_invalid_plan_id:0",
        "task_invalid_plan_step_title:0",
        "task_invalid_content_policy_decision:0",
        "task_invalid_decision_summary:0",
        "task_invalid_content_policy_summary:0",
    }.issubset(details)
    assert runtime_status["tasks_executed_count"] == 1
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "task_invalid_approval_required:0" in session_summary_markdown
    assert "task_invalid_requested_content_dimensions:0" in operator_report


def test_supervisor_repeated_resume_merges_parse_and_metadata_sanitization_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_parse_meta")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "PARSE_METADATA_001",
                    "approval_required": {"bad": "shape"},
                    "contract_path": _create_runtime_payload(config, "PARSE_METADATA_001", execution_seconds=1),
                },
                {
                    "task_id": "PARSE_METADATA_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "PARSE_METADATA_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rps-meta"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rps-meta", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rps-meta",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert "task_invalid_approval_required:0" in queue_entries[0].get("details", [])

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"][1]["requested_content_dimensions"] = {"violence": "low", "gore": {"bad": "shape"}}
    queue_payload["tasks"][1]["execution_lane"] = {"bad": "shape"}
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="rps-meta",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rps-meta",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_invalid_approval_required:0",
        "task_invalid_requested_content_dimensions:1",
        "task_invalid_execution_lane:1",
    }.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "decode_error:unexpected_eof" in operator_report
    assert "task_invalid_requested_content_dimensions:1" in operator_report


def test_supervisor_sanitizes_nested_metadata_and_preserves_selector_truthfulness(tmp_path):
    config = _make_config(tmp_path / "queue_nested_metadata_sanitized")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "NESTED_META_CLEAN_001",
                    "priority": 1,
                    "contract_path": _create_runtime_payload(config, "NESTED_META_CLEAN_001", execution_seconds=1),
                },
                {
                    "task_id": "NESTED_META_DAMAGED_001",
                    "priority": 1,
                    "approval_boundary": {
                        "approval_reason": {"bad": "shape"}
                    },
                    "policy_payload": {
                        "violations": [
                            {"rule": "policy_missing_fields"}
                        ]
                    },
                    "contract_path": _create_runtime_payload(config, "NESTED_META_DAMAGED_001", execution_seconds=1),
                },
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="nested-meta-session",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["NESTED_META_CLEAN_001"]["status"] == "completed"
    assert queue_by_id["NESTED_META_DAMAGED_001"]["status"] == "pending"
    assert queue_by_id["NESTED_META_DAMAGED_001"]["approval_boundary"] == {
        "approval_required": True,
        "approval_reason": "Malformed approval boundary metadata requires review.",
        "blocked_until_approved": False,
    }
    assert queue_by_id["NESTED_META_DAMAGED_001"]["policy_payload"] == {
        "allowed": True,
        "risk_score": 0.5,
        "violations": [],
        "verdict": "ASK",
    }
    assert queue_by_id["NESTED_META_DAMAGED_001"]["approval_required"] is True
    assert queue_by_id["NESTED_META_DAMAGED_001"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["NESTED_META_DAMAGED_001"]["content_policy_block"] is False

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "nested-meta-session",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_approval_boundary:1",
        "task_invalid_approval_boundary_approval_required:1",
        "task_invalid_approval_boundary_blocked_until_approved:1",
        "task_invalid_approval_boundary_approval_reason:1",
        "task_invalid_policy_payload:1",
        "task_invalid_policy_payload_allowed:1",
        "task_invalid_policy_payload_verdict:1",
        "task_invalid_policy_payload_violations:1",
    }.issubset(details)
    assert runtime_status["last_selected_task_id"] == "NESTED_META_CLEAN_001"
    assert runtime_status["queue_remaining"] == 1
    assert [candidate["task_id"] for candidate in runtime_status["top_candidates"][:2]] == [
        "NESTED_META_CLEAN_001",
        "NESTED_META_DAMAGED_001",
    ]
    assert runtime_status["excluded_tasks"] == []
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert session_summary["selector_visibility"]["selected_task"] == "NESTED_META_CLEAN_001"
    assert "task_invalid_approval_boundary:1" in session_summary_markdown
    assert "task_invalid_policy_payload:1" in operator_report


def test_supervisor_repeated_resume_merges_parse_and_nested_metadata_sanitization_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_parse_nested_meta")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RPNM_001",
                    "approval_boundary": {
                        "approval_reason": {"bad": "shape"}
                    },
                    "contract_path": _create_runtime_payload(config, "RPNM_001", execution_seconds=1),
                },
                {
                    "task_id": "RPNM_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "RPNM_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rpnm"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rpnm", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rpnm",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert "task_invalid_approval_boundary:0" in queue_entries[0].get("details", [])

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"][1]["policy_payload"] = {
        "violations": [
            {"rule": "nested_policy_missing_fields"}
        ]
    }
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="rpnm",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rpnm",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_invalid_approval_boundary:0",
        "task_invalid_policy_payload:1",
        "task_invalid_policy_payload_allowed:1",
        "task_invalid_policy_payload_verdict:1",
        "task_invalid_policy_payload_violations:1",
    }.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "decode_error:unexpected_eof" in operator_report
    assert "task_invalid_policy_payload:1" in operator_report


def test_supervisor_sanitizes_contradictory_nested_metadata_without_false_blocked_behavior(tmp_path):
    config = _make_config(tmp_path / "queue_contradictory_nested_metadata")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "CONTRA_CLEAN_001",
                    "priority": 1,
                    "contract_path": _create_runtime_payload(config, "CONTRA_CLEAN_001", execution_seconds=1),
                },
                {
                    "task_id": "CONTRA_POLICY_001",
                    "priority": 1,
                    "policy_payload": {
                        "allowed": False,
                        "verdict": "ALLOW",
                        "risk_score": 0.2,
                        "violations": [
                            {
                                "rule": "content_rating",
                                "detail": "Contradictory nested policy evidence.",
                                "evidence": "policy_payload",
                                "severity": "hard",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "CONTRA_POLICY_001", execution_seconds=1),
                },
                {
                    "task_id": "CONTRA_APPROVAL_001",
                    "priority": 1,
                    "approval_boundary": {
                        "approval_required": False,
                        "approval_reason": "Operator approval still required.",
                        "blocked_until_approved": True,
                    },
                    "contract_path": _create_runtime_payload(config, "CONTRA_APPROVAL_001", execution_seconds=1),
                },
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="contradictory-nested-session",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["CONTRA_CLEAN_001"]["status"] == "completed"
    assert queue_by_id["CONTRA_POLICY_001"]["status"] == "pending"
    assert queue_by_id["CONTRA_APPROVAL_001"]["status"] == "pending"

    assert queue_by_id["CONTRA_POLICY_001"]["policy_payload"]["allowed"] is True
    assert queue_by_id["CONTRA_POLICY_001"]["policy_payload"]["verdict"] == "ASK"
    assert queue_by_id["CONTRA_POLICY_001"]["policy_payload"]["risk_score"] == 0.5
    assert queue_by_id["CONTRA_POLICY_001"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["CONTRA_POLICY_001"]["content_policy_block"] is False

    assert queue_by_id["CONTRA_APPROVAL_001"]["approval_boundary"]["approval_required"] is True
    assert queue_by_id["CONTRA_APPROVAL_001"]["approval_boundary"]["blocked_until_approved"] is True
    assert queue_by_id["CONTRA_APPROVAL_001"]["approval_required"] is True
    assert queue_by_id["CONTRA_APPROVAL_001"]["approval_state"] == "awaiting_approval"

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "contradictory-nested-session",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_policy_payload:1",
        "task_contradictory_policy_payload_allow_disallowed:1",
        "task_contradictory_policy_payload_allow_hard_violations:1",
        "task_invalid_approval_boundary:2",
        "task_contradictory_approval_boundary_blocked_until_approved:2",
    }.issubset(details)
    assert runtime_status["last_selected_task_id"] == "CONTRA_CLEAN_001"
    assert runtime_status["queue_remaining"] == 2
    assert [candidate["task_id"] for candidate in runtime_status["top_candidates"][:2]] == [
        "CONTRA_CLEAN_001",
        "CONTRA_POLICY_001",
    ]
    assert runtime_status["excluded_tasks"] == [
        {
            "task_id": "CONTRA_APPROVAL_001",
            "reason": "awaiting_approval",
            "exclusion_reason": "awaiting_approval",
        }
    ]
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert "task_contradictory_policy_payload_allow_disallowed:1" in session_summary_markdown
    assert "task_contradictory_approval_boundary_blocked_until_approved:2" in operator_report


def test_supervisor_repeated_resume_merges_parse_and_contradictory_nested_metadata_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_parse_contradictory_nested_meta")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RPCNM_001",
                    "approval_boundary": {
                        "approval_required": False,
                        "approval_reason": "Operator approval still required.",
                        "blocked_until_approved": True,
                    },
                    "contract_path": _create_runtime_payload(config, "RPCNM_001", execution_seconds=1),
                },
                {
                    "task_id": "RPCNM_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "RPCNM_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rpcnm"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rpcnm", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rpcnm",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert "task_contradictory_approval_boundary_blocked_until_approved:0" in queue_entries[0].get("details", [])

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"].append(
        {
            "task_id": "RPCNM_003",
            "priority": 1,
            "policy_payload": {
                "allowed": False,
                "verdict": "ALLOW",
                "violations": [
                    {
                        "rule": "content_rating",
                        "detail": "Contradictory nested policy evidence.",
                        "evidence": "policy_payload",
                        "severity": "hard",
                    }
                ],
            },
            "contract_path": _create_runtime_payload(config, "RPCNM_003", execution_seconds=1),
        }
    )
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=2,
            session_id="rpcnm",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "max_task_executions_reached"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rpcnm",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_approval_boundary_blocked_until_approved:0",
        "task_invalid_policy_payload:2",
        "task_contradictory_policy_payload_allow_disallowed:2",
        "task_contradictory_policy_payload_allow_hard_violations:2",
    }.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "decode_error:unexpected_eof" in operator_report
    assert "task_contradictory_policy_payload_allow_disallowed:2" in operator_report


def test_supervisor_sanitizes_multi_signal_contradictory_policy_payloads_without_false_allow_or_block(tmp_path):
    config = _make_config(tmp_path / "mspc")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "MPC_001",
                    "priority": 1,
                    "contract_path": _create_runtime_payload(config, "MPC_001", execution_seconds=1),
                },
                {
                    "task_id": "MPA_001",
                    "priority": 1,
                    "policy_payload": {
                        "allowed": True,
                        "verdict": "ALLOW",
                        "risk_score": 0.9,
                        "violations": [
                            {
                                "rule": "content_rating",
                                "detail": "High-risk contradictory allow signal.",
                                "evidence": "policy_payload",
                                "severity": "hard",
                            }
                        ],
                    },
                        "contract_path": _create_runtime_payload(config, "MPA_001", execution_seconds=1),
                },
                {
                    "task_id": "MPB_001",
                    "priority": 1,
                    "policy_payload": {
                        "allowed": False,
                        "verdict": "BLOCK",
                        "risk_score": 0.1,
                        "violations": [
                            {
                                "rule": "operator_review",
                                "detail": "Low-risk contradictory block signal.",
                                "evidence": "policy_payload",
                                "severity": "soft",
                            }
                        ],
                    },
                        "contract_path": _create_runtime_payload(config, "MPB_001", execution_seconds=1),
                },
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="mpc",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["MPC_001"]["status"] == "completed"
    assert queue_by_id["MPA_001"]["status"] == "pending"
    assert queue_by_id["MPB_001"]["status"] == "pending"

    assert queue_by_id["MPA_001"]["policy_payload"]["allowed"] is True
    assert queue_by_id["MPA_001"]["policy_payload"]["verdict"] == "ASK"
    assert queue_by_id["MPA_001"]["policy_payload"]["risk_score"] == 0.9
    assert queue_by_id["MPA_001"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["MPA_001"]["content_policy_block"] is False

    assert queue_by_id["MPB_001"]["policy_payload"]["allowed"] is True
    assert queue_by_id["MPB_001"]["policy_payload"]["verdict"] == "ASK"
    assert queue_by_id["MPB_001"]["policy_payload"]["risk_score"] == 0.5
    assert queue_by_id["MPB_001"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["MPB_001"]["content_policy_block"] is False

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "mpc",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_policy_payload:1",
        "task_contradictory_policy_payload_allow_hard_violations:1",
        "task_contradictory_policy_payload_allow_high_risk:1",
        "task_invalid_policy_payload:2",
        "task_contradictory_policy_payload_block_without_hard_violations:2",
        "task_contradictory_policy_payload_disallowed_low_risk:2",
        "task_contradictory_policy_payload_block_low_risk:2",
    }.issubset(details)
    assert runtime_status["last_selected_task_id"] == "MPC_001"
    assert runtime_status["queue_remaining"] == 2
    assert [candidate["task_id"] for candidate in runtime_status["top_candidates"][:3]] == [
        "MPC_001",
        "MPA_001",
        "MPB_001",
    ]
    assert runtime_status["excluded_tasks"] == []
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert "task_contradictory_policy_payload_allow_high_risk:1" in session_summary_markdown
    assert "task_contradictory_policy_payload_block_low_risk:2" in operator_report


def test_supervisor_repeated_resume_merges_parse_and_multi_signal_policy_contradictions_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_parse_multi_signal_policy")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RPSP_001",
                    "policy_payload": {
                        "allowed": True,
                        "verdict": "ALLOW",
                        "risk_score": 0.9,
                        "violations": [
                            {
                                "rule": "content_rating",
                                "detail": "High-risk contradictory allow signal.",
                                "evidence": "policy_payload",
                                "severity": "hard",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "RPSP_001", execution_seconds=1),
                },
                {
                    "task_id": "RPSP_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "RPSP_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rpsp"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rpsp", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rpsp",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_policy_payload_allow_hard_violations:0",
        "task_contradictory_policy_payload_allow_high_risk:0",
    }.issubset(set(queue_entries[0].get("details", [])))

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"].append(
        {
            "task_id": "RPSP_003",
            "priority": 1,
            "policy_payload": {
                "allowed": False,
                "verdict": "BLOCK",
                "risk_score": 0.1,
                "violations": [
                    {
                        "rule": "operator_review",
                        "detail": "Low-risk contradictory block signal.",
                        "evidence": "policy_payload",
                        "severity": "soft",
                    }
                ],
            },
            "contract_path": _create_runtime_payload(config, "RPSP_003", execution_seconds=1),
        }
    )
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=2,
            session_id="rpsp",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "max_task_executions_reached"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rpsp",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_policy_payload_allow_hard_violations:0",
        "task_contradictory_policy_payload_allow_high_risk:0",
        "task_contradictory_policy_payload_block_without_hard_violations:2",
        "task_contradictory_policy_payload_disallowed_low_risk:2",
        "task_contradictory_policy_payload_block_low_risk:2",
    }.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "decode_error:unexpected_eof" in operator_report
    assert "task_contradictory_policy_payload_block_low_risk:2" in operator_report


def test_supervisor_sanitizes_compound_policy_contradictions_without_false_confidence(tmp_path):
    config = _make_config(tmp_path / "cpc")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "CPC_001",
                    "priority": 1,
                    "contract_path": _create_runtime_payload(config, "CPC_001", execution_seconds=1),
                },
                {
                    "task_id": "CPA_001",
                    "priority": 1,
                    "policy_payload": {
                        "allowed": False,
                        "verdict": "ALLOW",
                        "risk_score": 0.95,
                        "violations": [
                            {
                                "rule": "content_rating",
                                "detail": "Dense false-allow contradiction.",
                                "evidence": "policy_payload",
                                "severity": "hard",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "CPA_001", execution_seconds=1),
                },
                {
                    "task_id": "CPB_001",
                    "priority": 1,
                    "policy_payload": {
                        "allowed": True,
                        "verdict": "BLOCK",
                        "risk_score": 0.1,
                        "violations": [
                            {
                                "rule": "operator_review",
                                "detail": "Dense false-block contradiction.",
                                "evidence": "policy_payload",
                                "severity": "soft",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "CPB_001", execution_seconds=1),
                },
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="cpc",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["CPC_001"]["status"] == "completed"
    assert queue_by_id["CPA_001"]["status"] == "pending"
    assert queue_by_id["CPB_001"]["status"] == "pending"

    assert queue_by_id["CPA_001"]["policy_payload"]["allowed"] is True
    assert queue_by_id["CPA_001"]["policy_payload"]["verdict"] == "ASK"
    assert queue_by_id["CPA_001"]["policy_payload"]["risk_score"] == 0.95
    assert queue_by_id["CPA_001"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["CPA_001"]["content_policy_block"] is False

    assert queue_by_id["CPB_001"]["policy_payload"]["allowed"] is True
    assert queue_by_id["CPB_001"]["policy_payload"]["verdict"] == "ASK"
    assert queue_by_id["CPB_001"]["policy_payload"]["risk_score"] == 0.5
    assert queue_by_id["CPB_001"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["CPB_001"]["content_policy_block"] is False

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "cpc",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_policy_payload:1",
        "task_contradictory_policy_payload_allow_disallowed:1",
        "task_contradictory_policy_payload_allow_hard_violations:1",
        "task_contradictory_policy_payload_allow_high_risk:1",
        "task_contradictory_policy_payload_compound_false_allow:1",
        "task_invalid_policy_payload:2",
        "task_contradictory_policy_payload_block_allowed:2",
        "task_contradictory_policy_payload_block_without_hard_violations:2",
        "task_contradictory_policy_payload_block_low_risk:2",
        "task_contradictory_policy_payload_compound_false_block:2",
    }.issubset(details)
    assert runtime_status["last_selected_task_id"] == "CPC_001"
    assert runtime_status["queue_remaining"] == 2
    assert [candidate["task_id"] for candidate in runtime_status["top_candidates"][:3]] == [
        "CPC_001",
        "CPA_001",
        "CPB_001",
    ]
    assert runtime_status["excluded_tasks"] == []
    assert session_summary["stop_reason"] == "max_task_executions_reached"
    assert "task_contradictory_policy_payload_compound_false_allow:1" in session_summary_markdown
    assert "task_contradictory_policy_payload_compound_false_block:2" in operator_report


def test_supervisor_repeated_resume_merges_parse_and_compound_policy_contradictions_without_duplication(tmp_path):
    config = _make_config(tmp_path / "resume_compound_policy")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RCPP_001",
                    "policy_payload": {
                        "allowed": False,
                        "verdict": "ALLOW",
                        "risk_score": 0.95,
                        "violations": [
                            {
                                "rule": "content_rating",
                                "detail": "Dense false-allow contradiction.",
                                "evidence": "policy_payload",
                                "severity": "hard",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "RCPP_001", execution_seconds=1),
                },
                {
                    "task_id": "RCPP_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "RCPP_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rcpp"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rcpp", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rcpp",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_policy_payload_allow_disallowed:0",
        "task_contradictory_policy_payload_allow_hard_violations:0",
        "task_contradictory_policy_payload_allow_high_risk:0",
        "task_contradictory_policy_payload_compound_false_allow:0",
    }.issubset(set(queue_entries[0].get("details", [])))

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"].append(
        {
            "task_id": "RCPP_003",
            "priority": 1,
            "policy_payload": {
                "allowed": True,
                "verdict": "BLOCK",
                "risk_score": 0.1,
                "violations": [
                    {
                        "rule": "operator_review",
                        "detail": "Dense false-block contradiction.",
                        "evidence": "policy_payload",
                        "severity": "soft",
                    }
                ],
            },
            "contract_path": _create_runtime_payload(config, "RCPP_003", execution_seconds=1),
        }
    )
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=2,
            session_id="rcpp",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "max_task_executions_reached"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rcpp",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_policy_payload_allow_disallowed:0",
        "task_contradictory_policy_payload_allow_hard_violations:0",
        "task_contradictory_policy_payload_allow_high_risk:0",
        "task_contradictory_policy_payload_compound_false_allow:0",
        "task_contradictory_policy_payload_block_allowed:2",
        "task_contradictory_policy_payload_block_without_hard_violations:2",
        "task_contradictory_policy_payload_block_low_risk:2",
        "task_contradictory_policy_payload_compound_false_block:2",
    }.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "queue_json_sanitized_shape" in session_summary_markdown
    assert "decode_error:unexpected_eof" in operator_report
    assert "task_contradictory_policy_payload_compound_false_block:2" in operator_report


def test_supervisor_sanitizes_dense_false_block_without_explicit_block_verdict(tmp_path):
    config = _make_config(tmp_path / "dfb")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "DFB_001",
                    "priority": 1,
                    "contract_path": _create_runtime_payload(config, "DFB_001", execution_seconds=1),
                },
                {
                    "task_id": "DFB_002",
                    "priority": 1,
                    "policy_payload": {
                        "allowed": False,
                        "verdict": "ASK",
                        "risk_score": 0.1,
                        "violations": [
                            {
                                "rule": "operator_review",
                                "detail": "Dense false-block without explicit block verdict.",
                                "evidence": "policy_payload",
                                "severity": "soft",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "DFB_002", execution_seconds=1),
                },
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="dfb",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["DFB_001"]["status"] == "completed"
    assert queue_by_id["DFB_002"]["status"] == "pending"
    assert queue_by_id["DFB_002"]["policy_payload"]["allowed"] is True
    assert queue_by_id["DFB_002"]["policy_payload"]["verdict"] == "ASK"
    assert queue_by_id["DFB_002"]["policy_payload"]["risk_score"] == 0.5
    assert queue_by_id["DFB_002"]["content_policy_decision"] == "requires_review"
    assert queue_by_id["DFB_002"]["content_policy_block"] is False

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "dfb",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_policy_payload:1",
        "task_contradictory_policy_payload_ask_disallowed:1",
        "task_contradictory_policy_payload_disallowed_low_risk:1",
        "task_contradictory_policy_payload_compound_false_block:1",
    }.issubset(details)
    assert runtime_status["last_selected_task_id"] == "DFB_001"
    assert runtime_status["queue_remaining"] == 1
    assert [candidate["task_id"] for candidate in runtime_status["top_candidates"][:2]] == [
        "DFB_001",
        "DFB_002",
    ]
    assert runtime_status["excluded_tasks"] == []
    assert "task_contradictory_policy_payload_compound_false_block:1" in session_summary_markdown
    assert "task_contradictory_policy_payload_ask_disallowed:1" in operator_report


def test_supervisor_repeated_resume_merges_parse_and_dense_false_block_without_explicit_block_verdict(tmp_path):
    config = _make_config(tmp_path / "resume_dense_false_block")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "RDFB_001",
                    "policy_payload": {
                        "allowed": False,
                        "verdict": "ASK",
                        "risk_score": 0.1,
                        "violations": [
                            {
                                "rule": "operator_review",
                                "detail": "Dense false-block without explicit block verdict.",
                                "evidence": "policy_payload",
                                "severity": "soft",
                            }
                        ],
                    },
                    "contract_path": _create_runtime_payload(config, "RDFB_001", execution_seconds=1),
                },
                {
                    "task_id": "RDFB_002",
                    "priority": 2,
                    "contract_path": _create_runtime_payload(config, "RDFB_002", execution_seconds=1),
                },
            ]
        },
    )
    session_dir = config.runs_dir / "rdfb"
    session_dir.mkdir(parents=True, exist_ok=True)
    state_path = session_dir / "session_state.json"
    state_path.write_text('{"session_id": "rdfb", "elapsed_time_seconds": ', encoding="utf-8")

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="rdfb",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()
    assert first_result.stop_reason == "max_task_executions_reached"

    first_state = json.loads(state_path.read_text(encoding="utf-8"))
    parse_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in first_state["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_policy_payload_ask_disallowed:0",
        "task_contradictory_policy_payload_disallowed_low_risk:0",
        "task_contradictory_policy_payload_compound_false_block:0",
    }.issubset(set(queue_entries[0].get("details", [])))

    second_state = dict(first_state)
    second_state["status"] = "running"
    second_state["finished_at"] = None
    second_state["stop_reason"] = None
    second_state["current_task"] = None
    state_path.write_text(json.dumps(second_state, indent=2), encoding="utf-8")

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    queue_payload["tasks"].append(
        {
            "task_id": "RDFB_003",
            "priority": 1,
            "failure_classification": {
                "failure_type": {"bad": "shape"},
                "failure_scope": ["task"],
                "retry_recommended": "yes",
                "retry_reason": {"bad": "shape"},
                "escalation_required": "maybe",
                "blocking": "no",
            },
            "contract_path": _create_runtime_payload(config, "RDFB_003", execution_seconds=1),
        }
    )
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    second_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=2,
            session_id="rdfb",
            resume=True,
            stop_when_queue_empty=False,
        ),
    )

    second_result = second_supervisor.run()

    assert second_result.stop_reason == "max_task_executions_reached"
    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "rdfb",
    )
    parse_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "session_state_invalid_json"]
    queue_entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(parse_entries) == 1
    assert len(queue_entries) == 1
    assert "decode_error:unexpected_eof" in parse_entries[0].get("details", [])
    assert {
        "task_contradictory_policy_payload_ask_disallowed:0",
        "task_contradictory_policy_payload_disallowed_low_risk:0",
        "task_contradictory_policy_payload_compound_false_block:0",
        "task_invalid_failure_classification:2",
        "task_invalid_failure_classification_failure_type:2",
        "task_invalid_failure_classification_failure_scope:2",
        "task_invalid_failure_classification_retry_recommended:2",
        "task_invalid_failure_classification_retry_reason:2",
        "task_invalid_failure_classification_escalation_required:2",
        "task_invalid_failure_classification_blocking:2",
    }.issubset(set(queue_entries[0].get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 2
    assert "session_state_invalid_json" in session_summary_markdown
    assert "task_invalid_failure_classification:2" in operator_report


def test_supervisor_sanitizes_failure_classification_contract_shape_without_false_blocked_behavior(tmp_path):
    config = _make_config(tmp_path / "fcs")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "FCS_001",
                    "priority": 1,
                    "contract_path": _create_runtime_payload(config, "FCS_001", execution_seconds=1),
                },
                {
                    "task_id": "FCS_002",
                    "priority": 1,
                    "failure_classification": {
                        "failure_type": {"bad": "shape"},
                        "failure_scope": ["task"],
                        "retry_recommended": "yes",
                        "retry_reason": {"bad": "shape"},
                        "escalation_required": "maybe",
                        "blocking": "no",
                    },
                    "contract_path": _create_runtime_payload(config, "FCS_002", execution_seconds=1),
                },
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="fcs",
            stop_when_queue_empty=False,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    queue_by_id = {task["task_id"]: task for task in queue}
    assert queue_by_id["FCS_001"]["status"] == "completed"
    assert queue_by_id["FCS_002"]["status"] == "pending"
    assert queue_by_id["FCS_002"]["failure_classification"] == {
        "failure_type": "",
        "failure_scope": "",
        "retry_recommended": False,
        "retry_reason": "",
        "escalation_required": False,
        "blocking": False,
    }

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "fcs",
    )
    entries = [entry for entry in session_summary["integrity_issues"] if entry["issue"] == "queue_json_sanitized_shape"]
    assert len(entries) == 1
    details = set(entries[0].get("details", []))
    assert {
        "task_invalid_failure_classification:1",
        "task_invalid_failure_classification_failure_type:1",
        "task_invalid_failure_classification_failure_scope:1",
        "task_invalid_failure_classification_retry_recommended:1",
        "task_invalid_failure_classification_retry_reason:1",
        "task_invalid_failure_classification_escalation_required:1",
        "task_invalid_failure_classification_blocking:1",
    }.issubset(details)
    assert runtime_status["last_selected_task_id"] == "FCS_001"
    assert runtime_status["queue_remaining"] == 1
    assert [candidate["task_id"] for candidate in runtime_status["top_candidates"][:2]] == [
        "FCS_001",
        "FCS_002",
    ]
    assert runtime_status["excluded_tasks"] == []
    assert "task_invalid_failure_classification:1" in session_summary_markdown
    assert "task_invalid_failure_classification_blocking:1" in operator_report


def test_scheduler_supports_list_queue_shape_and_retry_limit(tmp_path):
    queue_path = tmp_path / "queue.json"
    queue_path.write_text(
        json.dumps([
            {"task_id": "LIST_001", "priority": 1, "status": "pending"}
        ], indent=2),
        encoding="utf-8",
    )
    scheduler = Scheduler(queue_path, max_retries=3)

    next_task = scheduler.get_next_task()
    assert next_task is not None
    assert next_task["task_id"] == "LIST_001"

    scheduler.mark_running("LIST_001", session_id="session-a")
    updated, should_retry = scheduler.requeue_failed(
        "LIST_001",
        session_id="session-a",
        reason="retry once",
    )
    assert should_retry is True
    assert updated["status"] == "pending"

    scheduler.mark_running("LIST_001", session_id="session-a")
    scheduler.requeue_failed("LIST_001", session_id="session-a", reason="retry twice")
    scheduler.mark_running("LIST_001", session_id="session-a")
    updated, should_retry = scheduler.requeue_failed(
        "LIST_001",
        session_id="session-a",
        reason="retry exhausted",
    )

    assert should_retry is False
    assert updated["status"] == "blocked"
    raw = json.loads(queue_path.read_text(encoding="utf-8"))
    assert isinstance(raw, list)
    assert raw[0]["status"] == "blocked"
    assert raw[0]["retry_count"] == 3


def test_supervisor_detects_new_intake_task_while_idling_and_prints_status(tmp_path, capsys):
    config = _make_config(tmp_path / "idle_activation")
    _write_queue(config.queue_path, {"tasks": []})
    clock = FakeClock()
    router = _make_router(clock)
    intake = ConversationalTaskIntake(config)
    intake_done = {"value": False}

    def sleep_and_inject(seconds: float) -> None:
        if not intake_done["value"]:
            intake.accept_message(
                    "Stabilize LEVEL_0001 zombie animation.",
                session_id="live-intake-session",
            )
            intake_done["value"] = True
        clock.advance(seconds)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=6,
            heartbeat_interval_seconds=2,
            poll_interval_seconds=1,
            session_id="idle-activation-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=sleep_and_inject,
    )

    result = supervisor.run()
    output = capsys.readouterr().out

    assert result.stop_reason == "queue_empty_idle_timeout"
    assert "SESSION STARTED" in output
    assert "QUEUE EMPTY / WAITING FOR TASKS" in output
    assert "SESSION HEARTBEAT" in output

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert len(queue) == 1
    assert queue[0]["status"] == "blocked"
    assert queue[0]["task_type"] == "mutation_request"
    assert queue[0]["decision"] == "block"
    assert queue[0]["execution_lane"] == "approval_required_mutation"

    runtime_status = json.loads((config.runs_dir / "idle-activation-session" / "runtime_status.json").read_text(encoding="utf-8"))
    assert runtime_status["current_task"] is None
    assert runtime_status["last_started_task"] is None
    assert runtime_status["last_completed_task"] is None
    assert runtime_status["queue_tasks"] == []
    assert runtime_status["rating_system"] == "ESRB"
    assert runtime_status["rating_target"] == "M"
    assert runtime_status["rating_locked"] is True
    assert runtime_status["session_phase"] == "complete"
    assert runtime_status["phase_index"] == 7
    assert runtime_status["phase_total"] == 7
    assert runtime_status["phase_label"] == "Complete"


def test_scheduler_respects_plan_dependencies_for_multi_step_queue(tmp_path):
    config = _make_config(tmp_path / "plan_dependencies")
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                {
                    "task_id": "PLAN_A__STEP_01",
                    "title": "Inspect zombie animation pipeline",
                    "status": "pending",
                    "priority": 25,
                    "plan_id": "PLAN_A",
                    "plan_step_index": 1,
                    "dependencies": [],
                },
                {
                    "task_id": "PLAN_A__STEP_02",
                    "title": "Inspect weapon bootstrap",
                    "status": "pending",
                    "priority": 25,
                    "plan_id": "PLAN_A",
                    "plan_step_index": 2,
                    "dependencies": ["PLAN_A__STEP_01"],
                },
            ]
        },
    )

    scheduler = Scheduler(config.queue_path)

    assert scheduler.get_next_task()["task_id"] == "PLAN_A__STEP_01"
    scheduler.mark_running("PLAN_A__STEP_01", session_id="plan-session")
    scheduler.mark_completed("PLAN_A__STEP_01", session_id="plan-session", result={"status": "completed"})
    assert scheduler.get_next_task()["task_id"] == "PLAN_A__STEP_02"


def test_supervisor_terminates_after_idle_grace_when_queue_stays_empty(tmp_path):
    config = _make_config(tmp_path / "idle_timeout")
    _write_queue(config.queue_path, {"tasks": []})
    clock = FakeClock()
    router = _make_router(clock)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=3,
            idle_timeout_poll_limit=99,
            session_id="idle-timeout-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty_idle_timeout"
    assert result.tasks_completed == 0
    assert result.queue_remaining == 0

    runtime_status = json.loads((config.runs_dir / "idle-timeout-session" / "runtime_status.json").read_text(encoding="utf-8"))
    assert runtime_status["stop_reason"] == "queue_empty_idle_timeout"
    assert runtime_status["session_state"] == "complete"
    assert runtime_status["work_state"] == "halted"
    assert runtime_status["budget_mode"] == "terminating"

    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    assert state["idle_duration_seconds"] >= 3.0
    assert state["queue_remaining"] == 0


def test_supervisor_records_operator_interrupt_stop_reason(tmp_path):
    config = _make_config(tmp_path / "operator_interrupt")
    _write_queue(config.queue_path, {"tasks": []})
    clock = FakeClock()
    router = _make_router(clock)
    interrupt_requested = {"value": False}

    def sleep_and_interrupt(seconds: float) -> None:
        if not interrupt_requested["value"]:
            supervisor.request_stop(reason="operator_interrupt")
            interrupt_requested["value"] = True
        clock.advance(seconds)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=0,
            idle_timeout_poll_limit=0,
            session_id="operator-interrupt-session",
            stop_when_queue_empty=False,
        ),
        agent_router=router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=sleep_and_interrupt,
    )

    result = supervisor.run()

    assert result.stop_reason == "operator_interrupt"
    state = json.loads(result.state_path.read_text(encoding="utf-8"))
    assert state["stop_reason"] == "operator_interrupt"
    assert state["status"] == "completed"


def test_supervisor_resumes_true_in_flight_interruption_and_preserves_regenerated_artifacts(tmp_path):
    config = _make_config(tmp_path / "in_flight_interrupt")
    _write_queue(
        config.queue_path,
        {"tasks": [_task(config, "IFI_001", priority=1, execution_seconds=1)]},
    )
    clock = FakeClock()
    interrupted = {"value": False}

    first_router = AgentRouter()

    def interrupting_run(task):
        clock.advance(float(task.get("execution_seconds", 0)))
        if not interrupted["value"]:
            supervisor.request_stop(reason="operator_interrupt")
            interrupted["value"] = True
        return {
            "status": "completed",
            "summary": f"completed {task['task_id']}",
            "details": {"task_id": task["task_id"]},
        }

    first_router.register("copilot_coder_agent", interrupting_run)

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="ifi",
            stop_when_queue_empty=False,
        ),
        agent_router=first_router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    first_result = supervisor.run()

    assert first_result.stop_reason == "operator_interrupt"
    interrupted_queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert interrupted_queue[0]["status"] == "running"
    assert interrupted_queue[0]["current_session_id"] == "ifi"
    artifacts_dir = config.runs_dir / "ifi" / "artifacts"
    assert not (artifacts_dir / "IFI_001_attempt_01.json").exists()
    assert not (artifacts_dir / "IFI_001_attempt_01.md").exists()

    first_runtime_status, first_session_summary, first_session_summary_markdown, first_operator_report = _load_session_outputs(
        config,
        "ifi",
    )
    assert first_runtime_status["stop_reason"] == "operator_interrupt"
    assert first_runtime_status["current_task"] is None
    assert first_session_summary["stop_reason"] == "operator_interrupt"
    assert first_session_summary["tasks_completed"] == 0
    assert "operator_interrupt" in first_operator_report

    resume_router = _make_router(clock)
    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="ifi",
            resume=True,
            stop_when_queue_empty=True,
        ),
        agent_router=resume_router,
        time_source=clock.now,
        monotonic_source=clock.monotonic,
        sleep_fn=clock.sleep,
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert (artifacts_dir / "IFI_001_attempt_01.json").exists()
    assert (artifacts_dir / "IFI_001_attempt_01.md").exists()

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "ifi",
    )
    recovery_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"
    )
    missing_artifact_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    )
    assert recovery_entry.get("details", []) == ["task_id:IFI_001"]
    assert {
        "task_id:IFI_001",
        "artifact:artifacts/IFI_001_attempt_01.json",
        "artifact:artifacts/IFI_001_attempt_01.md",
    }.issubset(set(missing_artifact_entry.get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"
    assert "recovered_interrupted_running_tasks" in session_summary_markdown
    assert "interrupted_task_missing_attempt_artifacts" in session_summary_markdown
    assert "artifact:artifacts/IFI_001_attempt_01.json" in operator_report


def test_supervisor_resumes_real_external_process_interruption_and_preserves_partial_output_truth(tmp_path):
    config = _make_config(tmp_path / "external_process_interrupt")
    session_dir = config.runs_dir / "external-ifi"
    partial_output_path = session_dir / "external" / "partial_output.txt"
    final_output_path = session_dir / "external" / "final_output.txt"
    started_flag_path = session_dir / "external" / "started.flag"
    stdout_path = session_dir / "external" / "worker.stdout.log"
    stderr_path = session_dir / "external" / "worker.stderr.log"
    worker_script_path = config.root_dir / "contracts" / "test_runtime" / "external_worker.py"
    worker_script_path.parent.mkdir(parents=True, exist_ok=True)
    worker_script_path.write_text(
        "import sys\n"
        "import time\n"
        "from pathlib import Path\n"
        "partial_path = Path(sys.argv[1])\n"
        "final_path = Path(sys.argv[2])\n"
        "started_path = Path(sys.argv[3])\n"
        "partial_path.parent.mkdir(parents=True, exist_ok=True)\n"
        "started_path.parent.mkdir(parents=True, exist_ok=True)\n"
        "started_path.write_text('started', encoding='utf-8')\n"
        "partial_path.write_text('partial external output', encoding='utf-8')\n"
        "print('external worker started', flush=True)\n"
        "for _ in range(40):\n"
        "    time.sleep(0.05)\n"
        "final_path.write_text('final external output', encoding='utf-8')\n"
        "print('external worker completed', flush=True)\n",
        encoding="utf-8",
    )
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "EXT_IFI_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="external_process_agent",
                    external_command=[
                        sys.executable,
                        str(worker_script_path),
                        str(partial_output_path),
                        str(final_output_path),
                        str(started_flag_path),
                    ],
                    external_stdout_path=str(stdout_path),
                    external_stderr_path=str(stderr_path),
                    external_poll_interval_seconds=0.02,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="external-ifi",
            stop_when_queue_empty=False,
        ),
    )

    def request_stop_after_external_start() -> None:
        for _ in range(100):
            if started_flag_path.exists():
                supervisor.request_stop(reason="operator_interrupt")
                return
            supervisor.sleep_fn(0.02)

    stop_thread = Thread(target=request_stop_after_external_start, daemon=True)
    stop_thread.start()
    first_result = supervisor.run()
    stop_thread.join(timeout=1)

    assert first_result.stop_reason == "operator_interrupt"
    interrupted_queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert interrupted_queue[0]["status"] == "running"
    assert interrupted_queue[0]["current_session_id"] == "external-ifi"
    artifacts_dir = config.runs_dir / "external-ifi" / "artifacts"
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial external output"
    assert started_flag_path.exists()
    assert not final_output_path.exists()
    assert stdout_path.exists()
    assert "external worker started" in stdout_path.read_text(encoding="utf-8")
    assert not (artifacts_dir / "EXT_IFI_001_attempt_01.json").exists()
    assert not (artifacts_dir / "EXT_IFI_001_attempt_01.md").exists()

    first_runtime_status, first_session_summary, _, first_operator_report = _load_session_outputs(
        config,
        "external-ifi",
    )
    assert first_runtime_status["stop_reason"] == "operator_interrupt"
    assert first_session_summary["stop_reason"] == "operator_interrupt"
    assert first_session_summary["tasks_completed"] == 0
    assert "operator_interrupt" in first_operator_report

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="external-ifi",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert partial_output_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final external output"
    assert (artifacts_dir / "EXT_IFI_001_attempt_01.json").exists()
    assert (artifacts_dir / "EXT_IFI_001_attempt_01.md").exists()

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "external-ifi",
    )
    recovery_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"
    )
    missing_artifact_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    )
    assert recovery_entry.get("details", []) == ["task_id:EXT_IFI_001"]
    assert {
        "task_id:EXT_IFI_001",
        "artifact:artifacts/EXT_IFI_001_attempt_01.json",
        "artifact:artifacts/EXT_IFI_001_attempt_01.md",
    }.issubset(set(missing_artifact_entry.get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"
    assert "recovered_interrupted_running_tasks" in session_summary_markdown
    assert "interrupted_task_missing_attempt_artifacts" in session_summary_markdown
    assert "artifact:artifacts/EXT_IFI_001_attempt_01.json" in operator_report


def test_supervisor_resumes_unity_wrapper_interruption_and_preserves_partial_output_truth(tmp_path):
    config = _make_config(tmp_path / "unity_wrapper_interrupt")
    session_dir = config.runs_dir / "unity-ifi"
    partial_output_path = session_dir / "unity" / "partial_unity_output.txt"
    final_output_path = session_dir / "unity" / "final_unity_output.txt"
    started_flag_path = session_dir / "unity" / "started.flag"
    stdout_path = session_dir / "unity" / "unity.stdout.log"
    stderr_path = session_dir / "unity" / "unity.stderr.log"
    wrapper_script_path = config.root_dir / "contracts" / "test_runtime" / "fake_unity_wrapper.ps1"
    wrapper_script_path.parent.mkdir(parents=True, exist_ok=True)
    wrapper_script_path.write_text(
        "$partialPath = $args[0]\n"
        "$finalPath = $args[1]\n"
        "$startedPath = $args[2]\n"
        "New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($partialPath)) | Out-Null\n"
        "New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($startedPath)) | Out-Null\n"
        "Set-Content -Path $startedPath -Value 'started'\n"
        "Set-Content -Path $partialPath -Value 'partial unity output'\n"
        "[Console]::Out.WriteLine('unity wrapper started')\n"
        "[Console]::Out.Flush()\n"
        "for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 50 }\n"
        "Set-Content -Path $finalPath -Value 'final unity output'\n"
        "[Console]::Out.WriteLine('UNITY_EXIT_CODE=0')\n"
        "[Console]::Out.WriteLine('UNITY_EXIT_REASON=completed')\n"
        "[Console]::Out.Flush()\n",
        encoding="utf-8",
    )
    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UNITY_IFI_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    unity_control_script=str(wrapper_script_path),
                    unity_control_args=[
                        str(partial_output_path),
                        str(final_output_path),
                        str(started_flag_path),
                    ],
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.02,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="unity-ifi",
            stop_when_queue_empty=False,
        ),
    )

    def request_stop_after_unity_start() -> None:
        for _ in range(100):
            if started_flag_path.exists():
                supervisor.request_stop(reason="operator_interrupt")
                return
            supervisor.sleep_fn(0.02)

    stop_thread = Thread(target=request_stop_after_unity_start, daemon=True)
    stop_thread.start()
    first_result = supervisor.run()
    stop_thread.join(timeout=1)

    assert first_result.stop_reason == "operator_interrupt"
    interrupted_queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert interrupted_queue[0]["status"] == "running"
    assert interrupted_queue[0]["current_session_id"] == "unity-ifi"
    artifacts_dir = config.runs_dir / "unity-ifi" / "artifacts"
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity output\n"
    assert started_flag_path.exists()
    assert not final_output_path.exists()
    assert stdout_path.exists()
    assert not (artifacts_dir / "UNITY_IFI_001_attempt_01.json").exists()
    assert not (artifacts_dir / "UNITY_IFI_001_attempt_01.md").exists()

    first_runtime_status, first_session_summary, _, first_operator_report = _load_session_outputs(
        config,
        "unity-ifi",
    )
    assert first_runtime_status["stop_reason"] == "operator_interrupt"
    assert first_session_summary["stop_reason"] == "operator_interrupt"
    assert first_session_summary["tasks_completed"] == 0
    assert "operator_interrupt" in first_operator_report

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="unity-ifi",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert partial_output_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity output\n"
    assert (artifacts_dir / "UNITY_IFI_001_attempt_01.json").exists()
    assert (artifacts_dir / "UNITY_IFI_001_attempt_01.md").exists()

    artifact_payload = json.loads((artifacts_dir / "UNITY_IFI_001_attempt_01.json").read_text(encoding="utf-8"))
    assert "powershell.exe" in artifact_payload["result"]["details"]["shell"].lower()
    assert artifact_payload["result"]["details"]["type"] == "test"
    assert artifact_payload["result"]["details"]["stdout_log"].endswith("unity.stdout.log")
    assert artifact_payload["result"]["details"]["stderr_log"].endswith("unity.stderr.log")
    assert artifact_payload["result"]["details"]["unity_exit_code"] == "0"
    assert artifact_payload["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "unity-ifi",
    )
    recovery_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"
    )
    missing_artifact_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    )
    assert recovery_entry.get("details", []) == ["task_id:UNITY_IFI_001"]
    assert {
        "task_id:UNITY_IFI_001",
        "artifact:artifacts/UNITY_IFI_001_attempt_01.json",
        "artifact:artifacts/UNITY_IFI_001_attempt_01.md",
    }.issubset(set(missing_artifact_entry.get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"
    assert "recovered_interrupted_running_tasks" in session_summary_markdown
    assert "interrupted_task_missing_attempt_artifacts" in session_summary_markdown
    assert "artifact:artifacts/UNITY_IFI_001_attempt_01.json" in operator_report



def test_supervisor_resumes_real_unity_tool_surface_interruption_and_preserves_partial_output_truth(tmp_path):
    config = _make_config(tmp_path / "unity_tool_surface_interrupt")
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    target_repo = config.root_dir / "BABYLON_TEST"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "unity-tool-ifi"
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    (tools_dir / "unity_editor_stub.cmd").write_text(
        "@echo off\n"
        "setlocal\n"
        f"set \"STARTED_PATH={started_flag_path}\"\n"
        f"set \"PARTIAL_PATH={partial_output_path}\"\n"
        f"set \"FINAL_PATH={final_output_path}\"\n"
        f"set \"LOG_PATH={editor_log_path}\"\n"
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($env:STARTED_PATH)) | Out-Null; Set-Content -Path $env:STARTED_PATH -Value 'started'; Set-Content -Path $env:PARTIAL_PATH -Value 'partial unity tool output'; Set-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] started'; [Console]::Out.WriteLine('[unity_tool_stub] started'); [Console]::Out.Flush(); Start-Sleep -Seconds 4; Set-Content -Path $env:FINAL_PATH -Value 'final unity tool output'; if ($env:BABYLON_CI_ARTIFACT) { @{ scene = 'MainMenu'; status = 'ok' } | ConvertTo-Json | Set-Content -Path $env:BABYLON_CI_ARTIFACT }; Add-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] completed'; [Console]::Out.WriteLine('[unity_tool_stub] completed'); [Console]::Out.Flush()\"\n"
        "exit /b %errorlevel%\n",
        encoding="utf-8",
    )
    (tools_dir / "unity_editor_stub.ps1").write_text(
        "param()\n"
        "function Get-ArgValue {\n"
        "    param([string[]]$Args, [string]$Name)\n"
        "    for ($i = 0; $i -lt $Args.Count; $i++) {\n"
        "        if ($Args[$i] -ieq $Name -and ($i + 1) -lt $Args.Count) { return $Args[$i + 1] }\n"
        "    }\n"
        "    return $null\n"
        "}\n"
        "$projectPath = [System.IO.Path]::GetFullPath((Get-ArgValue -Args $args -Name '-projectPath'))\n"
        "$logPath = Get-ArgValue -Args $args -Name '-logFile'\n"
        "if (-not [System.IO.Path]::IsPathRooted($logPath)) { $logPath = [System.IO.Path]::GetFullPath((Join-Path $projectPath $logPath)) }\n"
        "$artifactPath = [System.Environment]::GetEnvironmentVariable('BABYLON_CI_ARTIFACT', 'Process')\n"
        "$logsDir = Join-Path $projectPath 'scripts\\logs'\n"
        "New-Item -ItemType Directory -Force -Path $logsDir | Out-Null\n"
        "$startedPath = Join-Path $logsDir 'tool_started.flag'\n"
        "$partialPath = Join-Path $logsDir 'tool_partial.txt'\n"
        "$finalPath = Join-Path $logsDir 'tool_final.txt'\n"
        "Set-Content -Path $startedPath -Value 'started'\n"
        "Set-Content -Path $partialPath -Value 'partial unity tool output'\n"
        "Set-Content -Path $logPath -Value '[unity_tool_stub] started'\n"
        "[Console]::Out.WriteLine('[unity_tool_stub] started')\n"
        "[Console]::Out.Flush()\n"
        "for ($i = 0; $i -lt 80; $i++) { Start-Sleep -Milliseconds 50 }\n"
        "Set-Content -Path $finalPath -Value 'final unity tool output'\n"
        "if ($artifactPath) { @{ scene = 'MainMenu'; status = 'ok' } | ConvertTo-Json | Set-Content -Path $artifactPath }\n"
        "Add-Content -Path $logPath -Value '[unity_tool_stub] completed'\n"
        "[Console]::Out.WriteLine('[unity_tool_stub] completed')\n"
        "[Console]::Out.Flush()\n"
        "exit 0\n",
        encoding="utf-8",
    )
    (tools_dir / "unity_editor_path.txt").write_text(
        str((tools_dir / "unity_editor_stub.cmd").resolve()),
        encoding="utf-8",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UNITY_TOOL_IFI_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "180",
                    ],
                    unity_environment={
                        "UNITY_EDITOR_EXE": str((tools_dir / "unity_editor_stub.cmd").resolve()),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.02,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="unity-tool-ifi",
            stop_when_queue_empty=False,
        ),
    )

    def request_stop_after_tool_start() -> None:
        for _ in range(600):
            if started_flag_path.exists():
                supervisor.request_stop(reason="operator_interrupt")
                return
            supervisor.sleep_fn(0.02)

    stop_thread = Thread(target=request_stop_after_tool_start, daemon=True)
    stop_thread.start()
    first_result = supervisor.run()
    stop_thread.join(timeout=1)

    assert first_result.stop_reason == "operator_interrupt"
    interrupted_queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert interrupted_queue[0]["status"] == "running"
    assert interrupted_queue[0]["current_session_id"] == "unity-tool-ifi"
    artifacts_dir = config.runs_dir / "unity-tool-ifi" / "artifacts"
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[unity_tool_stub] started" in editor_log_path.read_text(encoding="utf-8")
    assert not (artifacts_dir / "UNITY_TOOL_IFI_001_attempt_01.json").exists()
    assert not (artifacts_dir / "UNITY_TOOL_IFI_001_attempt_01.md").exists()

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="unity-tool-ifi",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert partial_output_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity tool output\n"
    assert artifact_output_path.exists()
    assert (artifacts_dir / "UNITY_TOOL_IFI_001_attempt_01.json").exists()
    assert (artifacts_dir / "UNITY_TOOL_IFI_001_attempt_01.md").exists()

    artifact_payload = json.loads((artifacts_dir / "UNITY_TOOL_IFI_001_attempt_01.json").read_text(encoding="utf-8"))
    assert "powershell.exe" in artifact_payload["result"]["details"]["shell"].lower()
    assert artifact_payload["result"]["details"]["type"] == "test"
    assert artifact_payload["result"]["details"]["unity_exit_code"] == "0"
    assert artifact_payload["result"]["details"]["unity_exit_reason"] == "completed"
    assert str(launcher_script_path) == artifact_payload["result"]["details"]["unity_script_path"]

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "unity-tool-ifi",
    )
    recovery_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "recovered_interrupted_running_tasks"
    )
    missing_artifact_entry = next(
        entry for entry in session_summary["integrity_issues"] if entry["issue"] == "interrupted_task_missing_attempt_artifacts"
    )
    assert recovery_entry.get("details", []) == ["task_id:UNITY_TOOL_IFI_001"]
    assert {
        "task_id:UNITY_TOOL_IFI_001",
        "artifact:artifacts/UNITY_TOOL_IFI_001_attempt_01.json",
        "artifact:artifacts/UNITY_TOOL_IFI_001_attempt_01.md",
    }.issubset(set(missing_artifact_entry.get("details", [])))
    assert runtime_status["tasks_executed_count"] == 2
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"
    assert "recovered_interrupted_running_tasks" in session_summary_markdown
    assert "interrupted_task_missing_attempt_artifacts" in session_summary_markdown
    assert "artifact:artifacts/UNITY_TOOL_IFI_001_attempt_01.json" in operator_report


def test_supervisor_records_real_unity_tool_surface_timeout_as_distinct_from_interrupt(tmp_path):
    config = _make_config(tmp_path / "unity_tool_surface_timeout")
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    target_repo = config.root_dir / "BABYLON_TEST"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "unity-tool-timeout"
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    (tools_dir / "unity_editor_stub.cmd").write_text(
        "@echo off\n"
        "setlocal\n"
        f"set \"STARTED_PATH={started_flag_path}\"\n"
        f"set \"PARTIAL_PATH={partial_output_path}\"\n"
        f"set \"FINAL_PATH={final_output_path}\"\n"
        f"set \"LOG_PATH={editor_log_path}\"\n"
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($env:STARTED_PATH)) | Out-Null; Set-Content -Path $env:STARTED_PATH -Value 'started'; Set-Content -Path $env:PARTIAL_PATH -Value 'partial unity tool output'; Set-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] started'; [Console]::Out.WriteLine('[unity_tool_stub] started'); [Console]::Out.Flush(); Start-Sleep -Seconds 4; Set-Content -Path $env:FINAL_PATH -Value 'final unity tool output'; if ($env:BABYLON_CI_ARTIFACT) { @{ scene = 'MainMenu'; status = 'ok' } | ConvertTo-Json | Set-Content -Path $env:BABYLON_CI_ARTIFACT }; Add-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] completed'; [Console]::Out.WriteLine('[unity_tool_stub] completed'); [Console]::Out.Flush()\"\n"
        "exit /b %errorlevel%\n",
        encoding="utf-8",
    )
    (tools_dir / "unity_editor_path.txt").write_text(
        str((tools_dir / "unity_editor_stub.cmd").resolve()),
        encoding="utf-8",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UNITY_TOOL_TIMEOUT_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "1",
                    ],
                    unity_timeout_seconds=1,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str((tools_dir / "unity_editor_stub.cmd").resolve()),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.02,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="unity-tool-timeout",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "blocked"
    assert queue[0]["current_session_id"] is None
    artifacts_dir = config.runs_dir / "unity-tool-timeout" / "artifacts"
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[unity_tool_stub] started" in editor_log_path.read_text(encoding="utf-8")
    assert stdout_path.exists()
    stdout_text = stdout_path.read_text(encoding="utf-8")
    assert "[run_unity_boot] Using Unity editor:" in stdout_text
    assert "UNITY_EXIT_REASON=completed" not in stdout_text
    assert (artifacts_dir / "UNITY_TOOL_TIMEOUT_001_attempt_01.json").exists()
    assert (artifacts_dir / "UNITY_TOOL_TIMEOUT_001_attempt_01.md").exists()

    artifact_payload = json.loads((artifacts_dir / "UNITY_TOOL_TIMEOUT_001_attempt_01.json").read_text(encoding="utf-8"))
    assert artifact_payload["result"]["status"] == "timed_out_unity_process"
    assert artifact_payload["result"]["error"] == "Unity/tool runner timed out after 1 seconds."
    assert artifact_payload["result"]["details"]["timed_out"] is True
    assert artifact_payload["result"]["details"].get("interrupted") is not True
    assert artifact_payload["result"]["details"].get("interrupt_reason") is None
    assert artifact_payload["result"]["details"]["returncode"] == -1
    assert artifact_payload["validation"]["queue_action"] == "block"
    assert artifact_payload["validation"]["note"] == "Unity/tool runner timed out after 1 seconds."

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "unity-tool-timeout",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["stop_reason"] == "queue_empty"
    assert runtime_status["last_task_result_status"] == "blocked"
    assert runtime_status["last_failed_task"]["note"] == "Unity/tool runner timed out after 1 seconds."
    assert session_summary["tasks_completed"] == 0
    assert session_summary["tasks_blocked"] == 1
    assert session_summary["stop_reason"] == "queue_empty"
    assert "operator_interrupt" not in operator_report


def test_supervisor_resumes_real_unity_tool_surface_hard_kill_and_preserves_first_attempt_truth(tmp_path):
    config = _make_config(tmp_path / "unity_tool_surface_hard_kill")
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    target_repo = config.root_dir / "BABYLON_TEST"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "unity-tool-hard-kill"
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    crash_marker_path = target_repo / "scripts" / "logs" / "tool_hard_kill_once.flag"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    (tools_dir / "unity_editor_stub.cmd").write_text(
        "@echo off\n"
        "setlocal\n"
        f"set \"STARTED_PATH={started_flag_path}\"\n"
        f"set \"PARTIAL_PATH={partial_output_path}\"\n"
        f"set \"FINAL_PATH={final_output_path}\"\n"
        f"set \"LOG_PATH={editor_log_path}\"\n"
        f"set \"CRASH_MARKER_PATH={crash_marker_path}\"\n"
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; $logsDir = [System.IO.Path]::GetDirectoryName($env:STARTED_PATH); New-Item -ItemType Directory -Force -Path $logsDir | Out-Null; if (-not (Test-Path $env:CRASH_MARKER_PATH)) { Set-Content -Path $env:CRASH_MARKER_PATH -Value 'crashed'; Set-Content -Path $env:STARTED_PATH -Value 'started'; Set-Content -Path $env:PARTIAL_PATH -Value 'partial unity tool output'; Set-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] started'; [Console]::Out.WriteLine('[unity_tool_stub] started'); [Console]::Out.Flush(); Stop-Process -Id $PID -Force } else { Set-Content -Path $env:STARTED_PATH -Value 'started'; Set-Content -Path $env:PARTIAL_PATH -Value 'partial unity tool output'; Set-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] started'; [Console]::Out.WriteLine('[unity_tool_stub] started'); [Console]::Out.Flush(); Start-Sleep -Seconds 2; Set-Content -Path $env:FINAL_PATH -Value 'final unity tool output'; if ($env:BABYLON_CI_ARTIFACT) { @{ scene = 'MainMenu'; status = 'ok' } | ConvertTo-Json | Set-Content -Path $env:BABYLON_CI_ARTIFACT }; Add-Content -Path $env:LOG_PATH -Value '[unity_tool_stub] completed'; [Console]::Out.WriteLine('[unity_tool_stub] completed'); [Console]::Out.Flush() }\"\n"
        "exit /b %errorlevel%\n",
        encoding="utf-8",
    )
    (tools_dir / "unity_editor_path.txt").write_text(
        str((tools_dir / "unity_editor_stub.cmd").resolve()),
        encoding="utf-8",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UNITY_TOOL_HARD_KILL_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "180",
                    ],
                    unity_retry_on_failure=True,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str((tools_dir / "unity_editor_stub.cmd").resolve()),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.02,
                )
            ]
        },
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="unity-tool-hard-kill",
            stop_when_queue_empty=False,
        ),
    )

    first_result = first_supervisor.run()

    assert first_result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "pending"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "retryable_failure"
    artifacts_dir = config.runs_dir / "unity-tool-hard-kill" / "artifacts"
    assert crash_marker_path.exists()
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[unity_tool_stub] started" in editor_log_path.read_text(encoding="utf-8")
    assert (artifacts_dir / "UNITY_TOOL_HARD_KILL_001_attempt_01.json").exists()
    assert (artifacts_dir / "UNITY_TOOL_HARD_KILL_001_attempt_01.md").exists()

    first_artifact = json.loads((artifacts_dir / "UNITY_TOOL_HARD_KILL_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "retryable_failure"
    assert first_artifact["validation"]["queue_action"] == "retry"
    assert first_artifact["result"]["details"].get("timed_out") is not True
    assert first_artifact["result"]["details"].get("interrupted") is not True
    assert first_artifact["result"]["details"]["unity_exit_code"] != "0"
    assert first_artifact["result"]["details"].get("unity_exit_reason") != "completed"

    first_runtime_status, first_session_summary, _, first_operator_report = _load_session_outputs(
        config,
        "unity-tool-hard-kill",
    )
    assert first_runtime_status["tasks_executed_count"] == 1
    assert first_runtime_status["last_task_result_status"] == "retry_scheduled"
    assert first_session_summary["stop_reason"] == "max_task_executions_reached"
    assert first_session_summary["tasks_completed"] == 0

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="unity-tool-hard-kill",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "completed"
    assert partial_output_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity tool output\n"
    assert artifact_output_path.exists()
    assert (artifacts_dir / "UNITY_TOOL_HARD_KILL_001_attempt_01.json").exists()
    assert (artifacts_dir / "UNITY_TOOL_HARD_KILL_001_attempt_02.json").exists()

    second_artifact = json.loads((artifacts_dir / "UNITY_TOOL_HARD_KILL_001_attempt_02.json").read_text(encoding="utf-8"))
    assert second_artifact["result"]["status"] == "completed"
    assert second_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert second_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, session_summary_markdown, operator_report = _load_session_outputs(
        config,
        "unity-tool-hard-kill",
    )
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert runtime_status["failure_streak_count"] == 0
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_supervisor_resumes_licensed_unity_boot_hard_kill_and_preserves_first_attempt_truth(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "luhk")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-hk"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    crash_marker_path = target_repo / "scripts" / "logs" / "tool_hard_kill_once.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    (editor_ci_dir / "BootProbe.cs").write_text(
        "using System;\n"
        "using System.IO;\n"
        "using System.Threading;\n"
        "using UnityEditor;\n"
        "using UnityEngine;\n"
        "\n"
        "namespace Babylon.CI\n"
        "{\n"
        "    public static class BootProbe\n"
        "    {\n"
        "        public static void Run()\n"
        "        {\n"
        "            var startedPath = Environment.GetEnvironmentVariable(\"BABYLON_CI_STARTED_PATH\");\n"
        "            var partialPath = Environment.GetEnvironmentVariable(\"BABYLON_CI_PARTIAL_PATH\");\n"
        "            var finalPath = Environment.GetEnvironmentVariable(\"BABYLON_CI_FINAL_PATH\");\n"
        "            var crashMarkerPath = Environment.GetEnvironmentVariable(\"BABYLON_CI_CRASH_MARKER_PATH\");\n"
        "            var artifactPath = Environment.GetEnvironmentVariable(\"BABYLON_CI_ARTIFACT\");\n"
        "\n"
        "            EnsureParent(startedPath);\n"
        "            EnsureParent(partialPath);\n"
        "            EnsureParent(finalPath);\n"
        "            EnsureParent(crashMarkerPath);\n"
        "            EnsureParent(artifactPath);\n"
        "\n"
        "            File.WriteAllText(startedPath, \"started\\n\");\n"
        "            File.WriteAllText(partialPath, \"partial unity tool output\\n\");\n"
        "            Debug.Log(\"[licensed_boot_probe] started\");\n"
        "\n"
        "            if (!File.Exists(crashMarkerPath))\n"
        "            {\n"
        "                File.WriteAllText(crashMarkerPath, \"crashed\\n\");\n"
        "                Thread.Sleep(TimeSpan.FromSeconds(30));\n"
        "                return;\n"
        "            }\n"
        "\n"
        "            Thread.Sleep(TimeSpan.FromSeconds(2));\n"
        "            File.WriteAllText(finalPath, \"final unity tool output\\n\");\n"
        "            File.WriteAllText(artifactPath, \"{\\\"scene\\\":\\\"MainMenu\\\",\\\"status\\\":\\\"ok\\\"}\");\n"
        "            Debug.Log(\"[licensed_boot_probe] completed\");\n"
        "            EditorApplication.Exit(0);\n"
        "        }\n"
        "\n"
        "        private static void EnsureParent(string path)\n"
        "        {\n"
        "            if (string.IsNullOrWhiteSpace(path))\n"
        "            {\n"
        "                return;\n"
        "            }\n"
        "\n"
        "            var directory = Path.GetDirectoryName(path);\n"
        "            if (!string.IsNullOrWhiteSpace(directory))\n"
        "            {\n"
        "                Directory.CreateDirectory(directory);\n"
        "            }\n"
        "        }\n"
        "    }\n"
        "}\n",
        encoding="utf-8",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UHK_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "180",
                    ],
                    unity_retry_on_failure=True,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                        "BABYLON_CI_CRASH_MARKER_PATH": str(crash_marker_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="lu-hk",
            stop_when_queue_empty=False,
        ),
    )
    first_result = first_supervisor.run()

    assert first_result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "pending"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "retryable_failure"
    artifacts_dir = config.runs_dir / "lu-hk" / "artifacts"
    assert crash_marker_path.exists()
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[licensed_boot_probe] started" in editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert (artifacts_dir / "UHK_001_attempt_01.json").exists()

    first_artifact = json.loads((artifacts_dir / "UHK_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "retryable_failure"
    assert first_artifact["validation"]["queue_action"] == "retry"
    assert first_artifact["result"]["details"].get("timed_out") is not True
    assert first_artifact["result"]["details"].get("interrupted") is not True
    assert first_artifact["result"]["details"]["unity_exit_code"] != "0"

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-hk",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["retry_count"] == 1
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity tool output\n"
    assert artifact_output_path.exists()
    assert (artifacts_dir / "UHK_001_attempt_02.json").exists()

    second_artifact = json.loads((artifacts_dir / "UHK_001_attempt_02.json").read_text(encoding="utf-8"))
    assert second_artifact["result"]["status"] == "completed"
    assert second_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert second_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-hk",
    )
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_licensed_unity_bootstrap_probe_minimal_scaffold(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lub")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-bootstrap"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=False,
        final_output_text="final unity bootstrap output\n",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UBOOT_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "300",
                    ],
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-bootstrap",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["last_result_status"] == "completed"
    assert started_flag_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity bootstrap output\n"
    assert artifact_output_path.exists()
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "[licensed_boot_probe] started" in editor_log_text
    assert "[licensed_boot_probe] completed" in editor_log_text

    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
    assert "[run_unity_boot] Unity exited with code 0" in stdout_text
    assert "UNITY_EXIT_REASON=completed" in stdout_text

    artifacts_dir = config.runs_dir / "lu-bootstrap" / "artifacts"
    first_artifact = json.loads((artifacts_dir / "UBOOT_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "completed"
    assert first_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-bootstrap",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_licensed_unity_ci_probe_bootstrap_minimal_scaffold(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lucib")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-cib"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_ci_probe.ps1", tools_dir / "run_unity_ci_probe.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=False,
        final_output_text="final unity ci probe bootstrap output\n",
    )

    launcher_script_path = tools_dir / "run_unity_ci_probe.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UCIB_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-MethodName",
                        "Babylon.CI.BootProbe.Run",
                        "-TimeoutSec",
                        "300",
                    ],
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-cib",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["last_result_status"] == "completed"
    assert started_flag_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity ci probe bootstrap output\n"
    assert artifact_output_path.exists()
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "[licensed_boot_probe] started" in editor_log_text
    assert "[licensed_boot_probe] completed" in editor_log_text
    assert "UNITY_EXE_RESOLVED=" in editor_log_text

    artifact_payload = json.loads(artifact_output_path.read_text(encoding="utf-8"))
    assert artifact_payload["scene"] == "MainMenu"
    assert artifact_payload["status"] == "ok"
    assert artifact_payload["timestamp"]

    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
    assert "[run_unity_ci_probe] Unity exited with code 0" in stdout_text
    assert "UNITY_EXIT_REASON=completed" in stdout_text

    artifacts_dir = config.runs_dir / "lu-cib" / "artifacts"
    first_artifact = json.loads((artifacts_dir / "UCIB_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "completed"
    assert first_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-cib",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_licensed_unity_bootstrap_probe_harness_shape(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lubh")
    _create_harness_shape_unity_repo(config, target_repo_name="BH")
    target_repo = config.root_dir / "BH"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-bh"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=False,
        final_output_text="final unity harness bootstrap output\n",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UBH_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "300",
                    ],
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-bh",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["last_result_status"] == "completed"
    assert started_flag_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity harness bootstrap output\n"
    assert artifact_output_path.exists()
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "[licensed_boot_probe] started" in editor_log_text
    assert "[licensed_boot_probe] completed" in editor_log_text

    artifacts_dir = config.runs_dir / "lu-bh" / "artifacts"
    first_artifact = json.loads((artifacts_dir / "UBH_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "completed"
    assert first_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-bh",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_licensed_unity_ci_probe_bootstrap_harness_shape(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lucibh")
    _create_harness_shape_unity_repo(config, target_repo_name="BH")
    target_repo = config.root_dir / "BH"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-cibh"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_ci_probe.ps1", tools_dir / "run_unity_ci_probe.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=False,
        final_output_text="final unity ci probe harness bootstrap output\n",
    )

    launcher_script_path = tools_dir / "run_unity_ci_probe.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UCIBH_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-MethodName",
                        "Babylon.CI.BootProbe.Run",
                        "-TimeoutSec",
                        "300",
                    ],
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-cibh",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["last_result_status"] == "completed"
    assert started_flag_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity ci probe harness bootstrap output\n"
    assert artifact_output_path.exists()
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "[licensed_boot_probe] started" in editor_log_text
    assert "[licensed_boot_probe] completed" in editor_log_text
    assert "UNITY_EXE_RESOLVED=" in editor_log_text

    artifact_payload = json.loads(artifact_output_path.read_text(encoding="utf-8"))
    assert artifact_payload["scene"] == "MainMenu"
    assert artifact_payload["status"] == "ok"
    assert artifact_payload["timestamp"]

    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
    assert "[run_unity_ci_probe] Unity exited with code 0" in stdout_text
    assert "UNITY_EXIT_REASON=completed" in stdout_text

    artifacts_dir = config.runs_dir / "lu-cibh" / "artifacts"
    first_artifact = json.loads((artifacts_dir / "UCIBH_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "completed"
    assert first_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-cibh",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_supervisor_resumes_licensed_unity_ci_probe_hard_kill_and_preserves_first_attempt_truth(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lcihk")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-cihk"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    crash_marker_path = target_repo / "scripts" / "logs" / "tool_hard_kill_once.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_ci_probe.ps1", tools_dir / "run_unity_ci_probe.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=True,
        final_output_text="final unity ci probe hard kill output\n",
        crash_marker_path_env="BABYLON_CI_CRASH_MARKER_PATH",
    )

    launcher_script_path = tools_dir / "run_unity_ci_probe.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UCIHK_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-MethodName",
                        "Babylon.CI.BootProbe.Run",
                        "-TimeoutSec",
                        "180",
                    ],
                    unity_retry_on_failure=True,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                        "BABYLON_CI_CRASH_MARKER_PATH": str(crash_marker_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="lu-cihk",
            stop_when_queue_empty=False,
        ),
    )

    project_path_text = str(target_repo).lower()

    def hard_kill_real_unity_after_start() -> None:
        command = (
            "$deadline = (Get-Date).AddMinutes(3); "
            f"$target = '{project_path_text}'; "
            f"$started = '{started_flag_path}'; "
            "while ((Get-Date) -lt $deadline) { "
            "if (Test-Path $started) { "
            "  $process = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Unity.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($target) } | Select-Object -First 1; "
            "  if ($process) { Stop-Process -Id $process.ProcessId -Force; break } "
            "} "
            "Start-Sleep -Milliseconds 250 "
            "}"
        )
        subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            check=False,
            capture_output=True,
            text=True,
        )

    kill_thread = Thread(target=hard_kill_real_unity_after_start, daemon=True)
    kill_thread.start()
    first_result = first_supervisor.run()
    kill_thread.join(timeout=5)

    assert first_result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "pending"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "retryable_failure"
    artifacts_dir = config.runs_dir / "lu-cihk" / "artifacts"
    assert crash_marker_path.exists()
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[licensed_boot_probe] started" in editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert (artifacts_dir / "UCIHK_001_attempt_01.json").exists()

    first_artifact = json.loads((artifacts_dir / "UCIHK_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "retryable_failure"
    assert first_artifact["validation"]["queue_action"] == "retry"
    assert first_artifact["result"]["details"].get("timed_out") is not True
    assert first_artifact["result"]["details"].get("interrupted") is not True
    assert first_artifact["result"]["details"]["unity_exit_code"] != "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"].startswith("unity_exit_")

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-cihk",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["retry_count"] == 1
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity ci probe hard kill output\n"
    assert artifact_output_path.exists()
    assert (artifacts_dir / "UCIHK_001_attempt_02.json").exists()

    second_artifact = json.loads((artifacts_dir / "UCIHK_001_attempt_02.json").read_text(encoding="utf-8"))
    assert second_artifact["result"]["status"] == "completed"
    assert second_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert second_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-cihk",
    )
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_supervisor_resumes_licensed_unity_ci_probe_hard_kill_on_harness_shape(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lcih2")
    _create_harness_shape_unity_repo(config, target_repo_name="BH")
    target_repo = config.root_dir / "BH"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-cih2"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    crash_marker_path = target_repo / "scripts" / "logs" / "tool_hard_kill_once.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_ci_probe.ps1", tools_dir / "run_unity_ci_probe.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=True,
        final_output_text="final unity ci probe harness hard kill output\n",
        crash_marker_path_env="BABYLON_CI_CRASH_MARKER_PATH",
    )

    launcher_script_path = tools_dir / "run_unity_ci_probe.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UCIHK2_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-MethodName",
                        "Babylon.CI.BootProbe.Run",
                        "-TimeoutSec",
                        "180",
                    ],
                    unity_retry_on_failure=True,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                        "BABYLON_CI_CRASH_MARKER_PATH": str(crash_marker_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="lu-cih2",
            stop_when_queue_empty=False,
        ),
    )

    project_path_text = str(target_repo).lower()

    def hard_kill_real_unity_after_start() -> None:
        command = (
            "$deadline = (Get-Date).AddMinutes(3); "
            f"$target = '{project_path_text}'; "
            f"$started = '{started_flag_path}'; "
            "while ((Get-Date) -lt $deadline) { "
            "if (Test-Path $started) { "
            "  $process = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Unity.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($target) } | Select-Object -First 1; "
            "  if ($process) { Stop-Process -Id $process.ProcessId -Force; break } "
            "} "
            "Start-Sleep -Milliseconds 250 "
            "}"
        )
        subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            check=False,
            capture_output=True,
            text=True,
        )

    kill_thread = Thread(target=hard_kill_real_unity_after_start, daemon=True)
    kill_thread.start()
    first_result = first_supervisor.run()
    kill_thread.join(timeout=5)

    assert first_result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "pending"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "retryable_failure"
    artifacts_dir = config.runs_dir / "lu-cih2" / "artifacts"
    assert crash_marker_path.exists()
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[licensed_boot_probe] started" in editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert (artifacts_dir / "UCIHK2_001_attempt_01.json").exists()

    first_artifact = json.loads((artifacts_dir / "UCIHK2_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "retryable_failure"
    assert first_artifact["validation"]["queue_action"] == "retry"
    assert first_artifact["result"]["details"].get("timed_out") is not True
    assert first_artifact["result"]["details"].get("interrupted") is not True
    assert first_artifact["result"]["details"]["unity_exit_code"] != "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"].startswith("unity_exit_")

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-cih2",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["retry_count"] == 1
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity ci probe harness hard kill output\n"
    assert artifact_output_path.exists()
    assert (artifacts_dir / "UCIHK2_001_attempt_02.json").exists()

    second_artifact = json.loads((artifacts_dir / "UCIHK2_001_attempt_02.json").read_text(encoding="utf-8"))
    assert second_artifact["result"]["status"] == "completed"
    assert second_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert second_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-cih2",
    )
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_supervisor_resumes_licensed_unity_boot_hard_kill_on_harness_shape(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "luh2")
    _create_harness_shape_unity_repo(config, target_repo_name="BH")
    target_repo = config.root_dir / "BH"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-h2"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    crash_marker_path = target_repo / "scripts" / "logs" / "tool_hard_kill_once.flag"
    artifact_output_path = target_repo / "scripts" / "logs" / "ui_boot_result.json"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_boot.ps1", tools_dir / "run_unity_boot.ps1")
    _write_licensed_boot_probe(
        editor_ci_dir / "BootProbe.cs",
        write_partial=True,
        final_output_text="final unity harness hard kill output\n",
        crash_marker_path_env="BABYLON_CI_CRASH_MARKER_PATH",
    )

    launcher_script_path = tools_dir / "run_unity_boot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "UHK2_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-ArtifactPath",
                        "scripts/logs/ui_boot_result.json",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-TimeoutSec",
                        "180",
                    ],
                    unity_retry_on_failure=True,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                        "BABYLON_CI_CRASH_MARKER_PATH": str(crash_marker_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="lu-h2",
            stop_when_queue_empty=False,
        ),
    )

    project_path_text = str(target_repo).lower()

    def hard_kill_real_unity_after_start() -> None:
        command = (
            "$deadline = (Get-Date).AddMinutes(3); "
            f"$target = '{project_path_text}'; "
            f"$started = '{started_flag_path}'; "
            "while ((Get-Date) -lt $deadline) { "
            "if (Test-Path $started) { "
            "  $process = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Unity.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($target) } | Select-Object -First 1; "
            "  if ($process) { Stop-Process -Id $process.ProcessId -Force; break } "
            "} "
            "Start-Sleep -Milliseconds 250 "
            "}"
        )
        subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            check=False,
            capture_output=True,
            text=True,
        )

    kill_thread = Thread(target=hard_kill_real_unity_after_start, daemon=True)
    kill_thread.start()
    first_result = first_supervisor.run()
    kill_thread.join(timeout=5)

    assert first_result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "pending"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "retryable_failure"
    artifacts_dir = config.runs_dir / "lu-h2" / "artifacts"
    assert crash_marker_path.exists()
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert partial_output_path.read_text(encoding="utf-8") == "partial unity tool output\n"
    assert not final_output_path.exists()
    assert not artifact_output_path.exists()
    assert editor_log_path.exists()
    assert "[licensed_boot_probe] started" in editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert (artifacts_dir / "UHK2_001_attempt_01.json").exists()

    first_artifact = json.loads((artifacts_dir / "UHK2_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "retryable_failure"
    assert first_artifact["validation"]["queue_action"] == "retry"
    assert first_artifact["result"]["details"].get("timed_out") is not True
    assert first_artifact["result"]["details"].get("interrupted") is not True
    assert first_artifact["result"]["details"]["unity_exit_code"] != "0"

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-h2",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["retry_count"] == 1
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity harness hard kill output\n"
    assert artifact_output_path.exists()
    assert (artifacts_dir / "UHK2_001_attempt_02.json").exists()

    second_artifact = json.loads((artifacts_dir / "UHK2_001_attempt_02.json").read_text(encoding="utf-8"))
    assert second_artifact["result"]["status"] == "completed"
    assert second_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert second_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-h2",
    )
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_licensed_unity_screenshot_probe_minimal_scaffold(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "luss")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-ss"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    screenshot_path = target_repo / "scripts" / "logs" / "mainmenu_proof.png"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_screenshot.ps1", tools_dir / "run_unity_screenshot.ps1")
    _write_licensed_screenshot_probe(
        editor_ci_dir / "ScreenshotProbe.cs",
        write_partial=True,
        final_output_text="final unity screenshot bootstrap output\n",
    )

    launcher_script_path = tools_dir / "run_unity_screenshot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "USS_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-OutPng",
                        "scripts/logs/mainmenu_proof.png",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-Width",
                        "1280",
                        "-Height",
                        "720",
                        "-TimeoutSec",
                        "300",
                        "-MinScreenshotBytes",
                        "1024",
                    ],
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-ss",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["last_result_status"] == "completed"
    assert started_flag_path.exists()
    assert partial_output_path.exists()
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity screenshot bootstrap output\n"
    assert screenshot_path.exists()
    assert screenshot_path.stat().st_size >= 1024
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "[licensed_screenshot_probe] started" in editor_log_text
    assert "[licensed_screenshot_probe] completed" in editor_log_text
    assert "[licensed_screenshot_probe] captured" in editor_log_text

    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
    assert "[run_unity_screenshot] Unity exited with code 0" in stdout_text
    assert "UNITY_EXIT_CODE=0" in stdout_text
    assert "UNITY_EXIT_REASON=completed" in stdout_text

    artifacts_dir = config.runs_dir / "lu-ss" / "artifacts"
    first_artifact = json.loads((artifacts_dir / "USS_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "completed"
    assert first_artifact["result"]["details"]["unity_exit_code"] == "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"] == "completed"

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-ss",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_supervisor_resumes_licensed_unity_screenshot_hard_kill_and_preserves_first_attempt_truth(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lusshk")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-sshk"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    crash_marker_path = target_repo / "scripts" / "logs" / "tool_hard_kill_once.flag"
    screenshot_path = target_repo / "scripts" / "logs" / "mainmenu_proof.png"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_screenshot.ps1", tools_dir / "run_unity_screenshot.ps1")
    _write_licensed_screenshot_probe(
        editor_ci_dir / "ScreenshotProbe.cs",
        write_partial=True,
        final_output_text="final unity screenshot hard kill output\n",
        crash_marker_path_env="BABYLON_CI_CRASH_MARKER_PATH",
    )

    launcher_script_path = tools_dir / "run_unity_screenshot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "USSHK_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-OutPng",
                        "scripts/logs/mainmenu_proof.png",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-Width",
                        "1280",
                        "-Height",
                        "720",
                        "-TimeoutSec",
                        "300",
                        "-MinScreenshotBytes",
                        "1024",
                    ],
                    unity_retry_on_failure=True,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                        "BABYLON_CI_CRASH_MARKER_PATH": str(crash_marker_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.05,
                )
            ]
        },
    )

    first_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            max_task_executions=1,
            session_id="lu-sshk",
            stop_when_queue_empty=False,
        ),
    )
    first_result = first_supervisor.run()

    assert first_result.stop_reason == "max_task_executions_reached"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "pending"
    assert queue[0]["current_session_id"] is None
    assert queue[0]["retry_count"] == 1
    assert queue[0]["last_result_status"] == "retryable_failure"
    artifacts_dir = config.runs_dir / "lu-sshk" / "artifacts"
    assert crash_marker_path.exists()
    assert not final_output_path.exists()
    assert not screenshot_path.exists()
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "Babylon.CI.ScreenshotProbe.Run" in editor_log_text
    assert "[licensed_screenshot_probe] completed" not in editor_log_text
    assert (artifacts_dir / "USSHK_001_attempt_01.json").exists()

    first_artifact = json.loads((artifacts_dir / "USSHK_001_attempt_01.json").read_text(encoding="utf-8"))
    assert first_artifact["result"]["status"] == "retryable_failure"
    assert first_artifact["validation"]["queue_action"] == "retry"
    assert first_artifact["result"]["details"].get("timed_out") is not True
    assert first_artifact["result"]["details"].get("interrupted") is not True
    assert first_artifact["result"]["details"]["unity_exit_code"] != "0"
    assert first_artifact["result"]["details"]["unity_exit_reason"].startswith("unity_exit_")

    resumed_supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=360,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-sshk",
            resume=True,
            stop_when_queue_empty=True,
        ),
    )

    second_result = resumed_supervisor.run()

    assert second_result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["retry_count"] == 1
    assert final_output_path.exists()
    assert final_output_path.read_text(encoding="utf-8") == "final unity screenshot hard kill output\n"
    assert screenshot_path.exists()
    assert screenshot_path.stat().st_size >= 1024
    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
    assert "UNITY_EXIT_CODE=0" in stdout_text
    assert "UNITY_EXIT_REASON=completed" in stdout_text

    runtime_status, session_summary, _, _ = _load_session_outputs(
        config,
        "lu-sshk",
    )
    assert runtime_status["tasks_executed_count"] == 2
    assert runtime_status["last_task_result_status"] == "completed"
    assert session_summary["tasks_completed"] == 1
    assert session_summary["stop_reason"] == "queue_empty"


def test_licensed_unity_screenshot_timeout_is_distinct_on_runner_surface(tmp_path):
    real_unity_path = Path(r"D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe")
    if not real_unity_path.exists():
        pytest.skip("Licensed Unity.exe not available on this host.")

    config = _make_config(tmp_path / "lussto")
    _create_minimal_real_unity_bootstrap_repo(config, target_repo_name="BT")
    target_repo = config.root_dir / "BT"
    tools_dir = target_repo / "Tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    editor_ci_dir = target_repo / "Assets" / "Editor" / "CI"
    editor_ci_dir.mkdir(parents=True, exist_ok=True)
    session_dir = config.runs_dir / "lu-ssto"
    (session_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    started_flag_path = target_repo / "scripts" / "logs" / "tool_started.flag"
    partial_output_path = target_repo / "scripts" / "logs" / "tool_partial.txt"
    final_output_path = target_repo / "scripts" / "logs" / "tool_final.txt"
    screenshot_path = target_repo / "scripts" / "logs" / "mainmenu_proof.png"
    editor_log_path = target_repo / "scripts" / "logs" / "Editor.log"
    stdout_path = session_dir / "unity" / "tool.stdout.log"
    stderr_path = session_dir / "unity" / "tool.stderr.log"

    repo_root = Path(__file__).resolve().parents[1]
    shutil.copy2(repo_root / "Tools" / "run_unity_screenshot.ps1", tools_dir / "run_unity_screenshot.ps1")
    _write_licensed_screenshot_probe(
        editor_ci_dir / "ScreenshotProbe.cs",
        write_partial=True,
        final_output_text="final unity screenshot timeout output\n",
        pre_capture_sleep_seconds=30,
    )

    launcher_script_path = tools_dir / "run_unity_screenshot.ps1"

    _write_queue(
        config.queue_path,
        {
            "tasks": [
                _task(
                    config,
                    "USSTO_001",
                    priority=1,
                    execution_seconds=0,
                    agent_type="unity_control_agent",
                    target_repo=str(target_repo),
                    unity_control_script=str(launcher_script_path),
                    unity_control_args=[
                        "-ProjectPath",
                        str(target_repo),
                        "-SceneName",
                        "MainMenu",
                        "-OutPng",
                        "scripts/logs/mainmenu_proof.png",
                        "-LogPath",
                        "scripts/logs/Editor.log",
                        "-Width",
                        "1280",
                        "-Height",
                        "720",
                        "-TimeoutSec",
                        "300",
                        "-MinScreenshotBytes",
                        "1024",
                    ],
                    unity_timeout_seconds=1,
                    unity_environment={
                        "UNITY_EDITOR_EXE": str(real_unity_path),
                        "BABYLON_CI_STARTED_PATH": str(started_flag_path),
                        "BABYLON_CI_PARTIAL_PATH": str(partial_output_path),
                        "BABYLON_CI_FINAL_PATH": str(final_output_path),
                    },
                    unity_stdout_path=str(stdout_path),
                    unity_stderr_path=str(stderr_path),
                    unity_poll_interval_seconds=0.02,
                )
            ]
        },
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=20,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            session_id="lu-ssto",
            stop_when_queue_empty=True,
        ),
    )

    result = supervisor.run()

    assert result.stop_reason == "queue_empty"
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "blocked"
    assert queue[0]["current_session_id"] is None
    artifacts_dir = config.runs_dir / "lu-ssto" / "artifacts"
    assert not final_output_path.exists()
    assert not screenshot_path.exists()
    assert editor_log_path.exists()
    editor_log_text = editor_log_path.read_text(encoding="utf-8", errors="replace")
    assert "Babylon.CI.ScreenshotProbe.Run" in editor_log_text
    assert "[licensed_screenshot_probe] completed" not in editor_log_text
    assert not started_flag_path.exists()
    assert not partial_output_path.exists()
    assert (artifacts_dir / "USSTO_001_attempt_01.json").exists()

    artifact_payload = json.loads((artifacts_dir / "USSTO_001_attempt_01.json").read_text(encoding="utf-8"))
    assert artifact_payload["result"]["status"] == "timed_out_unity_process"
    assert artifact_payload["result"]["error"] == "Unity/tool runner timed out after 1 seconds."
    assert artifact_payload["result"]["details"]["timed_out"] is True
    assert artifact_payload["result"]["details"].get("interrupted") is not True
    assert artifact_payload["result"]["details"].get("interrupt_reason") is None
    assert artifact_payload["result"]["details"]["returncode"] == -1
    assert artifact_payload["result"]["details"]["unity_exit_code"] == "UNKNOWN"
    assert artifact_payload["result"]["details"]["unity_exit_reason"] == "wrapper did not emit UNITY_EXIT_CODE"
    assert artifact_payload["validation"]["queue_action"] == "block"
    assert artifact_payload["validation"]["note"] == "Unity/tool runner timed out after 1 seconds."
    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
    assert "[run_unity_screenshot] Using Unity editor:" in stdout_text
    assert "UNITY_EXIT_CODE=" not in stdout_text

    runtime_status, session_summary, _, operator_report = _load_session_outputs(
        config,
        "lu-ssto",
    )
    assert runtime_status["tasks_executed_count"] == 1
    assert runtime_status["stop_reason"] == "queue_empty"
    assert runtime_status["last_task_result_status"] == "blocked"
    assert runtime_status["last_failed_task"]["note"] == "Unity/tool runner timed out after 1 seconds."
    assert session_summary["tasks_completed"] == 0
    assert session_summary["tasks_blocked"] == 1
    assert session_summary["stop_reason"] == "queue_empty"
    assert "operator_interrupt" not in operator_report


def test_supervisor_executes_approved_level0001_grass_mutation_and_records_evidence(tmp_path):
    config = _make_config(tmp_path / "grass_mutation")
    _write_grass_capability_contracts(config)
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    result = intake.accept_message(
        "make grass for level_0001",
        session_id="grass-mutation-session",
        target_repo=str((config.root_dir / "BABYLON_TEST").resolve()),
    )

    assert result.queue_entry["status"] == "needs_approval"

    approval = approve_mutation_task(
        config,
        task_id=result.task_id,
        approved_by="operator-test",
        notes="Approve first bounded grass mutation.",
    )
    assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="grass-mutation-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 1
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["approved_by"] == "operator-test"

    scene_path = config.root_dir / "BABYLON_TEST" / "Assets" / "AI_E_TestScenes" / "MinimalPlayableArena.unity"
    scene_text = scene_path.read_text(encoding="utf-8")
    assert "AIE_LEVEL_0001_GrassPatch_001" in scene_text

    evidence_store = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json")
    evidence = evidence_store.get("level_0001_add_grass")
    assert evidence is not None
    assert evidence["times_attempted"] == 1
    assert evidence["times_passed"] == 1
    assert evidence["last_validation_result"] == "passed"

    artifact_path = config.runs_dir / "grass-mutation-session" / "artifacts" / f"{result.task_id}_attempt_01.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["result"]["details"]["added_object_name"] == "AIE_LEVEL_0001_GrassPatch_001"
    assert artifact["result"]["details"]["validation"]["status"] == "passed"
    assert artifact["result"]["details"]["approval_state"] == "approved"


def test_supervisor_executes_normalized_move_zombie_forward_mutation_and_records_evidence(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "move_zombie_forward")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-PromptText") + 1] == "move zombie forward"
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_artifact_path = translator_artifact_path.parent / "intent_move_zombie_forward_probe_result.json"
        probe_log_path = translator_artifact_path.parent / "intent_move_zombie_forward_probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_entity_transform",
                    "object_name": "AIE_Zombie_001_Instance",
                    "previous_position": [0.0, 0.0, 0.0],
                    "new_position": [0.0, 0.0, 3.0],
                    "observed_position_before_reset": [0.0, 0.0, 0.0],
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": "2026-04-01T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": "move_entity_forward",
                    "route_kind": "single",
                    "executed_probe": "MutateEntityTransform",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_entity_transform",
                    "final_state_summary": {
                        "scene_name": "entity_test",
                        "action_name": "move_entity_forward",
                        "object_name": "AIE_Zombie_001_Instance",
                        "position": [0.0, 0.0, 3.0],
                        "final_action_type": "mutate_entity_transform",
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": "move zombie forward",
                    "normalized_prompt": "move zombie forward",
                    "translated_command": "move zombie forward",
                    "matched_prompt_pattern": "move zombie forward",
                    "action_name": "move_entity_forward",
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": "2026-04-01T00:00:00Z",
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "move zombie forward again",
        session_id="move-zombie-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "needs_approval"

    approval = approve_mutation_task(
        config,
        task_id=result.task_id,
        approved_by="operator-test",
        notes="Approve bounded move zombie forward mutation.",
    )
    assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="move-zombie-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 1
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["approved_by"] == "operator-test"

    evidence_store = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json")
    evidence = evidence_store.get("level_0001_move_zombie_forward")
    assert evidence is not None
    assert evidence["times_attempted"] == 1
    assert evidence["times_passed"] == 1
    assert evidence["last_validation_result"] == "passed"

    artifact_path = config.runs_dir / "move-zombie-session" / "artifacts" / f"{result.task_id}_attempt_01.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["result"]["details"]["action_type"] == "mutate_entity_transform"
    assert artifact["result"]["details"]["translated_command"] == "move zombie forward"
    assert artifact["result"]["details"]["executed_probe"] == "MutateEntityTransform"
    assert artifact["result"]["details"]["new_position"] == [0.0, 0.0, 3.0]
    assert artifact["result"]["details"]["validation"]["status"] == "passed"
    assert artifact["result"]["details"]["approval_state"] == "approved"


def test_supervisor_executes_make_zombie_faster_mutation_and_records_speed_change(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "make_zombie_faster")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-PromptText") + 1] == "make zombie faster"
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_faster_probe_result.json"
        probe_log_path = translator_artifact_path.parent / "intent_make_zombie_faster_probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_enemy_move_speed",
                    "object_name": "AIE_Zombie_001_Instance",
                    "previous_speed": 3.5,
                    "new_speed": 4.5,
                    "observed_speed_before_reset": 3.5,
                    "baseline_speed": 3.5,
                    "requested_speed": 4.5,
                    "minimum_speed": 2.0,
                    "maximum_speed": 5.0,
                    "speed_changed": True,
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": "2026-04-01T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": "increase_enemy_move_speed",
                    "route_kind": "single",
                    "executed_probe": "MutateEnemyMoveSpeed",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_enemy_move_speed",
                    "final_state_summary": {
                        "scene_name": "entity_test",
                        "action_name": "increase_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "final_action_type": "mutate_enemy_move_speed",
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": "make zombie faster",
                    "normalized_prompt": "make zombie faster",
                    "translated_command": "make zombie faster",
                    "matched_prompt_pattern": "make zombie faster",
                    "action_name": "increase_enemy_move_speed",
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": "2026-04-01T00:00:00Z",
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "speed up the zombie",
        session_id="make-zombie-faster-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "needs_approval"
    assert result.routing.capability_id == "level_0001_increase_zombie_speed"

    approval = approve_mutation_task(
        config,
        task_id=result.task_id,
        approved_by="operator-test",
        notes="Approve bounded zombie speed increase mutation.",
    )
    assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="make-zombie-faster-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 1
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    artifact_path = config.runs_dir / "make-zombie-faster-session" / "artifacts" / f"{result.task_id}_attempt_01.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    details = artifact["result"]["details"]
    assert details["action_type"] == "mutate_enemy_move_speed"
    assert details["translated_command"] == "make zombie faster"
    assert details["executed_probe"] == "MutateEnemyMoveSpeed"
    assert details["previous_speed"] == 3.5
    assert details["new_speed"] == 4.5
    assert details["minimum_speed"] == 2.0
    assert details["maximum_speed"] == 5.0
    assert details["minimum_speed"] <= details["new_speed"] <= details["maximum_speed"]
    assert details["validation"]["status"] == "passed"


def test_supervisor_executes_predefined_combat_variation_plan_sequentially_and_loads_combined_result(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "combat_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)

    def fake_run(command, cwd, capture_output, text, check):
        prompt_text = command[command.index("-PromptText") + 1]
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_log_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")

        if prompt_text == "make zombie faster":
            probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_faster_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "observed_speed_before_reset": 3.5,
                        "baseline_speed": 3.5,
                        "requested_speed": 4.5,
                        "minimum_speed": 2.0,
                        "maximum_speed": 5.0,
                        "speed_changed": True,
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-01T00:00:00Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "increase_enemy_move_speed",
                        "route_kind": "single",
                        "executed_probe": "MutateEnemyMoveSpeed",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_enemy_move_speed",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "make zombie faster",
                        "normalized_prompt": "make zombie faster",
                        "translated_command": "make zombie faster",
                        "matched_prompt_pattern": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-01T00:00:00Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        elif prompt_text == "make zombie more aggressive":
            probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_more_aggressive_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_enemy_aggression",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_attack_cooldown": 1.0,
                        "new_attack_cooldown": 0.6,
                        "observed_attack_cooldown_before_reset": 1.0,
                        "baseline_attack_cooldown": 1.0,
                        "requested_attack_cooldown": 0.6,
                        "minimum_attack_cooldown": 0.25,
                        "maximum_attack_cooldown": 2.0,
                        "aggression_changed": True,
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-01T00:00:01Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "increase_enemy_aggression",
                        "route_kind": "single",
                        "executed_probe": "MutateEnemyAggression",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_enemy_aggression",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "make zombie more aggressive",
                        "normalized_prompt": "make zombie more aggressive",
                        "translated_command": "make zombie more aggressive",
                        "matched_prompt_pattern": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-01T00:00:01Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            raise AssertionError(f"Unexpected prompt routed to translator: {prompt_text}")
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "test combat variation",
        session_id="combat-variation-session",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_plan_request"
    assert result.plan_step_titles == [
        "Increase zombie speed",
        "Increase zombie aggression",
    ]
    assert len(result.task_ids) == 2

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded zombie combat variation plan.",
        )
        assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="combat-variation-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 2
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "completed"]
    assert queue[0]["capability_id"] == "level_0001_increase_zombie_speed"
    assert queue[1]["capability_id"] == "level_0001_increase_zombie_aggression"
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]

    speed_evidence = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json").get(
        "level_0001_increase_zombie_speed"
    )
    aggression_evidence = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json").get(
        "level_0001_increase_zombie_aggression"
    )
    assert speed_evidence is not None
    assert aggression_evidence is not None
    assert speed_evidence["times_passed"] == 1
    assert aggression_evidence["times_passed"] == 1

    proof = home_surface.load_proof_result_surface(config.runs_dir / "combat-variation-session")

    assert proof.available is True
    assert proof.detected_action == "Test zombie combat variation"
    assert proof.proof_status == "Passed"
    assert len(proof.key_steps) == 2
    assert "Increase zombie speed" in proof.key_steps[0]
    assert "Increase zombie aggression" in proof.key_steps[1]
    assert "movement speed" in proof.change_summary.lower()
    assert "attack cooldown" in proof.change_summary.lower()
    assert "attack cooldown" in proof.before_after_summary.lower()
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."


def test_supervisor_executes_goal_intent_mapped_combat_variation_plan_and_loads_resolution_metadata(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "goal_intent_combat_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "make zombie more dangerous",
        session_id="goal-intent-combat-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.mapped_prompt == "make zombie faster and more aggressive"
    assert request_payload["conversational_request"]["context"]["routing"]["resolution_source"] == "goal_intent_mapping"

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded goal-intent combat variation plan.",
        )
        assert approval.queue_status == "pending"

    run_result = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="goal-intent-combat-session",
            stop_when_queue_empty=False,
        ),
    ).run()

    assert run_result.tasks_completed == 2
    assert runtime_state["speed"] == pytest.approx(4.5)
    assert runtime_state["attack_cooldown"] == pytest.approx(0.6)

    proof = home_surface.load_proof_result_surface(config.runs_dir / "goal-intent-combat-session")

    assert proof.available is True
    assert proof.original_request == "make zombie more dangerous"
    assert proof.normalized_request == "make zombie faster and more aggressive"
    assert proof.detected_action == "Test zombie combat variation"
    assert proof.key_steps[0].startswith("Resolution: AI-E mapped the gameplay goal 'make zombie more dangerous'")
    assert "bounded plan \"make zombie faster and more aggressive\"" in proof.key_steps[1]
    assert "Increase zombie speed" in proof.key_steps[2]
    assert "Increase zombie aggression" in proof.key_steps[3]


def test_supervisor_executes_goal_composed_fast_low_aggression_plan_and_loads_resolution_metadata(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "goal_composition_fast_low_aggression_plan")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)
    runtime_state["attack_cooldown"] = 0.6

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "make zombie faster but less aggressive",
        session_id="goal-composition-fast-low-aggression-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_composition"
    assert result.routing.mapped_prompt == "make zombie faster but less aggressive"
    assert result.routing.goal_components == [
        "increase zombie speed",
        "decrease zombie aggression",
    ]
    assert request_payload["conversational_request"]["context"]["routing"]["resolution_source"] == "goal_composition"

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded composed speed/aggression plan.",
        )
        assert approval.queue_status == "pending"

    run_result = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="goal-composition-fast-low-aggression-session",
            stop_when_queue_empty=False,
        ),
    ).run()

    assert run_result.tasks_completed == 2
    assert runtime_state["speed"] == pytest.approx(4.5)
    assert runtime_state["attack_cooldown"] == pytest.approx(1.0)

    proof = home_surface.load_proof_result_surface(config.runs_dir / "goal-composition-fast-low-aggression-session")

    assert proof.available is True
    assert proof.original_request == "make zombie faster but less aggressive"
    assert proof.normalized_request == ""
    assert proof.detected_action == "Test fast low-aggression zombie variation"
    assert proof.key_steps[0].startswith(
        "Resolution: AI-E combined the gameplay goals from 'make zombie faster but less aggressive'"
    )
    assert "bounded plan \"make zombie faster but less aggressive\"" in proof.key_steps[1]
    assert "Increase zombie speed" in proof.key_steps[2]
    assert "Restore zombie aggression to standard" in proof.key_steps[3]
    assert "Goal components: Increase zombie speed; Decrease zombie aggression." in proof.validation_checks


@pytest.mark.parametrize(
    (
        "capability_id",
        "capability_title",
        "operator_prompt",
        "action_name",
        "probe_name",
        "probe_action_type",
        "probe_payload",
    ),
    [
        (
            "level_0001_increase_zombie_speed",
            "LEVEL_0001 increase zombie speed",
            "make zombie faster",
            "increase_enemy_move_speed",
            "MutateEnemyMoveSpeed",
            "mutate_enemy_move_speed",
            {
                "previous_speed": 4.8,
                "new_speed": 4.8,
                "observed_speed_before_reset": 4.8,
                "baseline_speed": 3.5,
                "requested_speed": 4.5,
                "minimum_speed": 2.0,
                "maximum_speed": 5.0,
                "speed_changed": False,
            },
        ),
        (
            "level_0001_decrease_zombie_speed",
            "LEVEL_0001 decrease zombie speed",
            "make zombie slower",
            "decrease_enemy_move_speed",
            "MutateEnemyMoveSpeed",
            "mutate_enemy_move_speed",
            {
                "previous_speed": 2.0,
                "new_speed": 2.0,
                "observed_speed_before_reset": 2.0,
                "baseline_speed": 3.5,
                "requested_speed": 2.5,
                "minimum_speed": 2.0,
                "maximum_speed": 5.0,
                "speed_changed": False,
            },
        ),
        (
            "level_0001_increase_zombie_aggression",
            "LEVEL_0001 increase zombie aggression",
            "make zombie more aggressive",
            "increase_enemy_aggression",
            "MutateEnemyAggression",
            "mutate_enemy_aggression",
            {
                "previous_attack_cooldown": 0.5,
                "new_attack_cooldown": 0.5,
                "observed_attack_cooldown_before_reset": 0.5,
                "baseline_attack_cooldown": 1.0,
                "requested_attack_cooldown": 0.6,
                "minimum_attack_cooldown": 0.25,
                "maximum_attack_cooldown": 2.0,
                "aggression_changed": False,
            },
        ),
    ],
)
def test_state_aware_mutation_skips_when_requested_state_is_already_satisfied(
    tmp_path,
    monkeypatch,
    capability_id,
    capability_title,
    operator_prompt,
    action_name,
    probe_name,
    probe_action_type,
    probe_payload,
):
    config = _make_config(tmp_path / capability_id)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-PromptText") + 1] == operator_prompt
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_artifact_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe_result.json"
        probe_log_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": probe_action_type,
                    "object_name": "AIE_Zombie_001_Instance",
                    "action_name": action_name,
                    "executed": False,
                    "result_reason": "skipped_already_satisfied",
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": "2026-04-02T00:30:00Z",
                    **probe_payload,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": action_name,
                    "route_kind": "single",
                    "executed_probe": probe_name,
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": probe_action_type,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": operator_prompt,
                    "normalized_prompt": operator_prompt,
                    "translated_command": operator_prompt,
                    "matched_prompt_pattern": operator_prompt,
                    "action_name": action_name,
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": "2026-04-02T00:30:00Z",
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    task = {
        "capability_id": capability_id,
        "capability_title": capability_title,
        "requested_execution_lane": "approval_required_mutation",
        "handler_name": "level_0001_entity_transform_handler",
        "agent_type": "level_0001_entity_transform_mutation_agent",
        "approval_required": True,
        "approval_state": "approved",
        "execution_decision": "sandbox_first",
        "target_level": "LEVEL_0001",
        "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
        "capability_evidence_path": str(config.contracts_dir / "capabilities" / "evidence.json"),
        "target_repo": target_repo,
        "operator_prompt": operator_prompt,
        "task_id": f"{capability_id.upper()}_SKIP_001",
    }

    outcome = run_level_0001_entity_transform_mutation(task)

    assert outcome["status"] == "completed"
    assert outcome["details"]["executed"] is False
    assert outcome["details"]["result_reason"] == "skipped_already_satisfied"
    assert outcome["details"]["validation"]["status"] == "passed"


def test_supervisor_executes_predefined_combat_variation_plan_with_skipped_step_and_loads_combined_result(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "combat_plan_with_skip")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)

    def fake_run(command, cwd, capture_output, text, check):
        prompt_text = command[command.index("-PromptText") + 1]
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_log_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")

        if prompt_text == "make zombie faster":
            probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_faster_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "observed_speed_before_reset": 3.5,
                        "baseline_speed": 3.5,
                        "requested_speed": 4.5,
                        "minimum_speed": 2.0,
                        "maximum_speed": 5.0,
                        "speed_changed": True,
                        "executed": True,
                        "result_reason": "applied",
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-02T00:31:00Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "increase_enemy_move_speed",
                        "route_kind": "single",
                        "executed_probe": "MutateEnemyMoveSpeed",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_enemy_move_speed",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "make zombie faster",
                        "normalized_prompt": "make zombie faster",
                        "translated_command": "make zombie faster",
                        "matched_prompt_pattern": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-02T00:31:00Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        elif prompt_text == "make zombie more aggressive":
            probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_more_aggressive_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_enemy_aggression",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_attack_cooldown": 0.5,
                        "new_attack_cooldown": 0.5,
                        "observed_attack_cooldown_before_reset": 0.5,
                        "baseline_attack_cooldown": 1.0,
                        "requested_attack_cooldown": 0.6,
                        "minimum_attack_cooldown": 0.25,
                        "maximum_attack_cooldown": 2.0,
                        "aggression_changed": False,
                        "executed": False,
                        "result_reason": "skipped_already_satisfied",
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-02T00:31:01Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "increase_enemy_aggression",
                        "route_kind": "single",
                        "executed_probe": "MutateEnemyAggression",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_enemy_aggression",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "make zombie more aggressive",
                        "normalized_prompt": "make zombie more aggressive",
                        "translated_command": "make zombie more aggressive",
                        "matched_prompt_pattern": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-02T00:31:01Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            raise AssertionError(f"Unexpected prompt routed to translator: {prompt_text}")
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "test combat variation",
        session_id="combat-variation-skip-session",
        target_repo=target_repo,
    )

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded zombie combat variation plan with skip coverage.",
        )
        assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="combat-variation-skip-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 2
    proof = home_surface.load_proof_result_surface(config.runs_dir / "combat-variation-skip-session")

    assert proof.available is True
    assert proof.detected_action == "Test zombie combat variation"
    assert proof.proof_status == "Passed"
    assert "desired aggression threshold" in proof.key_steps[1].lower()
    assert "skipped the change" in proof.change_summary.lower()
    assert "1 step(s) were skipped" in proof.validation_outcome

    skipped_artifact_path = (
        config.runs_dir
        / "combat-variation-skip-session"
        / "artifacts"
        / f"{result.task_ids[1]}_attempt_01.json"
    )
    skipped_artifact = json.loads(skipped_artifact_path.read_text(encoding="utf-8"))
    assert skipped_artifact["result"]["details"]["executed"] is False
    assert skipped_artifact["result"]["details"]["result_reason"] == "skipped_already_satisfied"


def test_supervisor_executes_predefined_safety_plan_sequentially_and_loads_combined_result(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "zombie_safety_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)

    def fake_run(command, cwd, capture_output, text, check):
        prompt_text = command[command.index("-PromptText") + 1]
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_log_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")

        if prompt_text == "make zombie slower":
            probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_slower_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 2.5,
                        "observed_speed_before_reset": 3.5,
                        "baseline_speed": 3.5,
                        "requested_speed": 2.5,
                        "minimum_speed": 2.0,
                        "maximum_speed": 5.0,
                        "speed_changed": True,
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-01T00:10:00Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "decrease_enemy_move_speed",
                        "route_kind": "single",
                        "executed_probe": "MutateEnemyMoveSpeed",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_enemy_move_speed",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "make zombie slower",
                        "normalized_prompt": "make zombie slower",
                        "translated_command": "make zombie slower",
                        "matched_prompt_pattern": "make zombie slower",
                        "action_name": "decrease_enemy_move_speed",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-01T00:10:00Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        elif prompt_text == "move zombie forward":
            probe_artifact_path = translator_artifact_path.parent / "intent_move_zombie_forward_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 0.0],
                        "new_position": [0.0, 0.0, 3.0],
                        "movement_distance": 3.0,
                        "position_changed": True,
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-01T00:10:01Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "move_entity_forward",
                        "route_kind": "single",
                        "executed_probe": "MutateEntityTransform",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_entity_transform",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "move zombie forward",
                        "normalized_prompt": "move zombie forward",
                        "translated_command": "move zombie forward",
                        "matched_prompt_pattern": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-01T00:10:01Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            raise AssertionError(f"Unexpected prompt routed to translator: {prompt_text}")
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "make zombie safer",
        session_id="zombie-safety-session",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_plan_request"
    assert result.plan_step_titles == [
        "Decrease zombie movement speed",
        "Move zombie forward to validate the calmer behavior",
    ]
    assert len(result.task_ids) == 2

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded zombie safety plan.",
        )
        assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="zombie-safety-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 2
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "completed"]
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]

    speed_evidence = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json").get(
        "level_0001_decrease_zombie_speed"
    )
    move_evidence = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json").get(
        "level_0001_move_zombie_forward"
    )
    assert speed_evidence is not None
    assert move_evidence is not None
    assert speed_evidence["times_passed"] == 1
    assert move_evidence["times_passed"] == 1

    proof = home_surface.load_proof_result_surface(config.runs_dir / "zombie-safety-session")

    assert proof.available is True
    assert proof.detected_action == "Reduce zombie aggression"
    assert proof.proof_status == "Passed"
    assert len(proof.key_steps) == 2
    assert "Decrease zombie movement speed" in proof.key_steps[0]
    assert "Move zombie forward to validate the calmer behavior" in proof.key_steps[1]
    assert "from 3.5 to 2.5" in proof.change_summary
    assert "moved from" in proof.before_after_summary.lower()
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."


def test_supervisor_executes_predefined_variation_plan_sequentially_and_loads_combined_result(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "zombie_variation_plan")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)

    def fake_run(command, cwd, capture_output, text, check):
        prompt_text = command[command.index("-PromptText") + 1]
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_artifact_path.stem}.router.log")
        probe_log_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")

        if prompt_text == "move zombie farther forward":
            probe_artifact_path = translator_artifact_path.parent / "intent_move_zombie_farther_forward_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 0.0],
                        "new_position": [0.0, 0.0, 6.0],
                        "movement_distance": 6.0,
                        "position_changed": True,
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-02T00:20:00Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "move_entity_farther_forward",
                        "route_kind": "single",
                        "executed_probe": "MutateEntityTransform",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_entity_transform",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "move zombie farther forward",
                        "normalized_prompt": "move zombie farther forward",
                        "translated_command": "move zombie farther forward",
                        "matched_prompt_pattern": "move zombie farther forward",
                        "action_name": "move_entity_farther_forward",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-02T00:20:00Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        elif prompt_text == "move zombie forward":
            probe_artifact_path = translator_artifact_path.parent / "intent_move_zombie_forward_probe_result.json"
            probe_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "scene": "entity_test",
                        "scene_name": "entity_test",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 0.0],
                        "new_position": [0.0, 0.0, 3.0],
                        "movement_distance": 3.0,
                        "position_changed": True,
                        "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                        "timestamp": "2026-04-02T00:20:01Z",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            router_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "action_name": "move_entity_forward",
                        "route_kind": "single",
                        "executed_probe": "MutateEntityTransform",
                        "delegated_probe_artifact_path": str(probe_artifact_path),
                        "delegated_probe_log_path": str(probe_log_path),
                        "delegated_probe_action_type": "mutate_entity_transform",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            translator_artifact_path.write_text(
                json.dumps(
                    {
                        "status": "success",
                        "raw_prompt": "move zombie forward",
                        "normalized_prompt": "move zombie forward",
                        "translated_command": "move zombie forward",
                        "matched_prompt_pattern": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "router_artifact_path": str(router_artifact_path),
                        "router_log_path": str(router_log_path),
                        "router_status": "success",
                        "timestamp": "2026-04-02T00:20:01Z",
                        "message": "",
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            raise AssertionError(f"Unexpected prompt routed to translator: {prompt_text}")
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "try a variation",
        session_id="zombie-variation-session",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_plan_request"
    assert result.plan_step_titles == [
        "Move zombie farther forward for variation testing",
        "Move zombie forward to compare against the standard path",
    ]
    assert len(result.task_ids) == 2

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded zombie variation plan.",
        )
        assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="zombie-variation-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 2
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert [task["status"] for task in queue] == ["completed", "completed"]
    assert queue[0]["capability_id"] == "level_0001_move_zombie_farther_forward"
    assert queue[1]["capability_id"] == "level_0001_move_zombie_forward"
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]

    farther_evidence = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json").get(
        "level_0001_move_zombie_farther_forward"
    )
    move_evidence = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json").get(
        "level_0001_move_zombie_forward"
    )
    assert farther_evidence is not None
    assert move_evidence is not None
    assert farther_evidence["times_passed"] == 1
    assert move_evidence["times_passed"] == 1

    proof = home_surface.load_proof_result_surface(config.runs_dir / "zombie-variation-session")

    assert proof.available is True
    assert proof.detected_action == "Try zombie movement variation"
    assert proof.proof_status == "Passed"
    assert len(proof.key_steps) == 2
    assert "Move zombie farther forward for variation testing" in proof.key_steps[0]
    assert "Move zombie forward to compare against the standard path" in proof.key_steps[1]
    assert "to (0, 0, 6)" in proof.before_after_summary
    assert "to (0, 0, 3)" in proof.before_after_summary
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."


def test_speed_mutation_blocks_when_probe_reports_out_of_bounds_speed(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "out_of_bounds_speed")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")

    def fake_run(command, cwd, capture_output, text, check):
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_artifact_path = translator_artifact_path.parent / "intent_make_zombie_faster_probe_result.json"
        probe_log_path = translator_artifact_path.parent / "intent_make_zombie_faster_probe.log"

        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_enemy_move_speed",
                    "object_name": "AIE_Zombie_001_Instance",
                    "previous_speed": 3.5,
                    "new_speed": 7.5,
                    "observed_speed_before_reset": 3.5,
                    "baseline_speed": 3.5,
                    "requested_speed": 7.5,
                    "minimum_speed": 2.0,
                    "maximum_speed": 5.0,
                    "speed_changed": True,
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": "2026-04-01T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": "increase_enemy_move_speed",
                    "route_kind": "single",
                    "executed_probe": "MutateEnemyMoveSpeed",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_enemy_move_speed",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": "make zombie faster",
                    "normalized_prompt": "make zombie faster",
                    "translated_command": "make zombie faster",
                    "matched_prompt_pattern": "make zombie faster",
                    "action_name": "increase_enemy_move_speed",
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": "2026-04-01T00:00:00Z",
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    task = {
        "capability_id": "level_0001_increase_zombie_speed",
        "capability_title": "LEVEL_0001 increase zombie speed",
        "requested_execution_lane": "approval_required_mutation",
        "handler_name": "level_0001_entity_transform_handler",
        "agent_type": "level_0001_entity_transform_mutation_agent",
        "approval_required": True,
        "approval_state": "approved",
        "execution_decision": "sandbox_first",
        "target_level": "LEVEL_0001",
        "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
        "capability_evidence_path": str(config.contracts_dir / "capabilities" / "evidence.json"),
        "target_repo": target_repo,
        "operator_prompt": "make zombie faster",
        "task_id": "INTAKE_SPEED_BOUNDS_001",
    }

    outcome = run_level_0001_entity_transform_mutation(task)

    assert outcome["status"] == "blocked"
    assert "maximum bound" in outcome["error"]


def test_supervisor_creates_experiment_and_first_variant_for_initial_supported_run(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "exp")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "make zombie faster",
        session_id="ex",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=result.task_id,
        approved_by="operator-test",
        notes="Approve baseline experiment run.",
    )
    assert approval.queue_status == "pending"

    run_result = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="ex",
            stop_when_queue_empty=False,
        ),
    ).run()

    assert run_result.tasks_completed == 1
    assert runtime_state["speed"] == pytest.approx(4.5)

    state = json.loads((config.runs_dir / "ex" / "session_state.json").read_text(encoding="utf-8"))
    tracking = state["experiment_tracking"]
    assert tracking["active_experiment_id"] == "experiment_0001"
    assert state["latest_experiment_variant"]["variant_id"] == "variant_0001"
    variant = tracking["experiments"][0]["variants"][0]
    assert variant["variant_id"] == "variant_0001"
    assert variant["baseline_marker"] is True
    assert variant["variant_kind"] == "baseline"

    proof = home_surface.load_proof_result_surface(
        config.runs_dir / "ex" / "artifacts" / f"{result.task_id}_attempt_01.json"
    )
    assert proof.experiment_available is True
    assert proof.experiment_id == "experiment_0001"
    assert proof.variant_id == "variant_0001"
    assert proof.baseline_variant_id == "variant_0001"


def test_supervisor_resolves_session_speed_followup_and_revert_from_recorded_state(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "session_speed_followup_revert")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    initial = intake.accept_message(
        "make zombie faster",
        session_id="session-speed-followup",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=initial.task_id,
        approved_by="operator-test",
        notes="Approve initial bounded speed increase.",
    )
    assert approval.queue_status == "pending"

    first_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="session-speed-followup",
            stop_when_queue_empty=False,
        ),
    ).run()
    assert first_run.tasks_completed == 1
    assert runtime_state["speed"] == pytest.approx(4.5)

    initial_proof = home_surface.load_proof_result_surface(
        config.runs_dir / "session-speed-followup" / "artifacts" / f"{initial.task_id}_attempt_01.json"
    )
    assert initial_proof.available is True
    assert initial_proof.evaluation_available is False

    slower = intake.accept_message(
        "make it slower",
        session_id="session-speed-followup",
        target_repo=target_repo,
    )
    assert slower.routing.mapped_prompt == "restore zombie speed to standard"
    assert slower.routing.resolution_source == "session_followup_resolution"
    slower_payload = json.loads(slower.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    assert slower_payload["runtime_task"]["operator_prompt"] == "restore zombie speed to standard"
    assert slower_payload["runtime_task"]["source_prompt"] == "make it slower"
    approval = approve_mutation_task(
        config,
        task_id=slower.task_id,
        approved_by="operator-test",
        notes="Approve bounded speed follow-up.",
    )
    assert approval.queue_status == "pending"

    second_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="session-speed-followup",
            resume=True,
            stop_when_queue_empty=False,
        ),
    ).run()
    assert second_run.tasks_completed == 2
    assert runtime_state["speed"] == pytest.approx(3.5)

    revert = intake.accept_message(
        "revert last change",
        session_id="session-speed-followup",
        target_repo=target_repo,
    )
    assert revert.routing.mapped_prompt == "make zombie faster"
    assert revert.routing.revert_requested is True
    revert_payload = json.loads(revert.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    assert revert_payload["runtime_task"]["operator_prompt"] == "make zombie faster"
    assert revert_payload["runtime_task"]["source_prompt"] == "revert last change"
    approval = approve_mutation_task(
        config,
        task_id=revert.task_id,
        approved_by="operator-test",
        notes="Approve bounded revert to previous speed tier.",
    )
    assert approval.queue_status == "pending"

    third_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="session-speed-followup",
            resume=True,
            stop_when_queue_empty=False,
        ),
    ).run()
    assert third_run.tasks_completed == 3
    assert runtime_state["speed"] == pytest.approx(4.5)

    state = json.loads((config.runs_dir / "session-speed-followup" / "session_state.json").read_text(encoding="utf-8"))
    history = state["session_tuning_history"]
    assert [item["canonical_prompt"] for item in history] == [
        "make zombie faster",
        "restore zombie speed to standard",
        "make zombie faster",
    ]
    assert [item["resulting_tier"] for item in history] == ["fast", "standard", "fast"]
    assert state["session_tuning_state"]["last_mutation"]["resulting_tier"] == "fast"

    revert_artifact = json.loads(
        (
            config.runs_dir
            / "session-speed-followup"
            / "artifacts"
            / f"{revert.task_id}_attempt_01.json"
        ).read_text(encoding="utf-8")
    )
    revert_details = revert_artifact["result"]["details"]
    assert revert_details["resolution_source"] == "session_followup_resolution"
    assert revert_details["resolved_from_prompt"] == "revert last change"
    assert revert_details["revert_requested"] is True
    assert revert_details["previous_tier"] == "standard"
    assert revert_details["requested_tier"] == "fast"
    assert revert_details["resulting_tier"] == "fast"

    proof = home_surface.load_proof_result_surface(
        config.runs_dir / "session-speed-followup" / "artifacts" / f"{revert.task_id}_attempt_01.json"
    )
    assert proof.available is True
    assert proof.key_steps[0].startswith("Resolution: AI-E resolved the follow-up prompt 'revert last change'")
    assert "Session tier path: Speed standard -> fast." in proof.validation_checks
    assert "Resulting tier: Speed fast." in proof.validation_checks
    assert any("Revert the last zombie speed change from standard back to fast." == check for check in proof.validation_checks)

    slower_proof = home_surface.load_proof_result_surface(
        config.runs_dir / "session-speed-followup" / "artifacts" / f"{slower.task_id}_attempt_01.json"
    )
    assert slower_proof.available is True
    assert slower_proof.evaluation_available is True
    assert slower_proof.evaluation_summary == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current state vs previous version\n"
        "Speed: standard vs fast\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Lower movement speed."
    )
    assert slower_proof.evaluation_differences == ["Speed: fast -> standard"]
    assert slower_proof.evaluation_suggestion == ""
    assert slower_proof.experiment_available is True
    assert slower_proof.experiment_id == "experiment_0001"
    assert slower_proof.variant_id == "variant_0002"
    assert slower_proof.compared_variant_id == "variant_0001"
    assert slower_proof.baseline_variant_id == "variant_0001"
    assert slower_proof.experiment_summary == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current variant vs Variant 1\n"
        "Speed: standard vs fast\n\n"
        "Key differences\n"
        "Speed: fast -> standard\n\n"
        "Expected gameplay impact\n"
        "Lower movement speed."
    )

    assert len(state["result_state_history"]) == 3
    assert len(state["result_evaluation_history"]) == 2
    assert state["latest_result_evaluation"]["comparison_description"] == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current state vs previous version\n"
        "Speed: fast vs standard\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Higher movement speed."
    )
    assert state["latest_result_evaluation"]["evaluation_source"] == "deterministic_rules"
    assert state["latest_result_evaluation"]["experiment_comparison_description"] == (
        "What changed\n"
        "No supported deterministic differences were detected.\n\n"
        "Current variant vs baseline\n"
        "Supported deterministic checks match the baseline.\n\n"
        "Key differences\n"
        "No explicit deltas were recorded.\n\n"
        "Expected gameplay impact\n"
        "No deterministic gameplay-impact change detected."
    )
    tracking = state["experiment_tracking"]
    assert tracking["active_experiment_id"] == "experiment_0001"
    variants = tracking["experiments"][0]["variants"]
    assert [item["variant_id"] for item in variants] == ["variant_0001", "variant_0002", "variant_0003"]
    assert [item["parent_variant_id"] for item in variants] == ["", "variant_0001", "variant_0002"]
    assert variants[0]["baseline_marker"] is True
    assert variants[2]["variant_kind"] == "reverted_variant"
    assert state["latest_experiment_variant"]["variant_id"] == "variant_0003"

    revert_proof = home_surface.load_proof_result_surface(
        config.runs_dir / "session-speed-followup" / "artifacts" / f"{revert.task_id}_attempt_01.json"
    )
    assert revert_proof.experiment_available is True
    assert revert_proof.variant_id == "variant_0003"
    assert revert_proof.compared_variant_id == "variant_0001"
    assert revert_proof.experiment_summary == (
        "What changed\n"
        "No supported deterministic differences were detected.\n\n"
        "Current variant vs baseline\n"
        "Supported deterministic checks match the baseline.\n\n"
        "Key differences\n"
        "No explicit deltas were recorded.\n\n"
        "Expected gameplay impact\n"
        "No deterministic gameplay-impact change detected."
    )


def test_supervisor_resolves_session_aggression_followup_from_recorded_state(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "session_aggression_followup")
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    initial = intake.accept_message(
        "make zombie more aggressive",
        session_id="session-aggression-followup",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=initial.task_id,
        approved_by="operator-test",
        notes="Approve initial bounded aggression increase.",
    )
    assert approval.queue_status == "pending"

    first_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="session-aggression-followup",
            stop_when_queue_empty=False,
        ),
    ).run()
    assert first_run.tasks_completed == 1
    assert runtime_state["attack_cooldown"] == pytest.approx(0.6)

    followup = intake.accept_message(
        "make it less aggressive",
        session_id="session-aggression-followup",
        target_repo=target_repo,
    )
    assert followup.routing.mapped_prompt == "restore zombie aggression to standard"
    assert followup.routing.resolution_source == "session_followup_resolution"
    followup_payload = json.loads(followup.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    assert followup_payload["runtime_task"]["operator_prompt"] == "restore zombie aggression to standard"
    assert followup_payload["runtime_task"]["source_prompt"] == "make it less aggressive"
    approval = approve_mutation_task(
        config,
        task_id=followup.task_id,
        approved_by="operator-test",
        notes="Approve bounded aggression follow-up.",
    )
    assert approval.queue_status == "pending"

    second_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="session-aggression-followup",
            resume=True,
            stop_when_queue_empty=False,
        ),
    ).run()
    assert second_run.tasks_completed == 2
    assert runtime_state["attack_cooldown"] == pytest.approx(1.0)

    state = json.loads((config.runs_dir / "session-aggression-followup" / "session_state.json").read_text(encoding="utf-8"))
    history = state["session_tuning_history"]
    assert [item["canonical_prompt"] for item in history] == [
        "make zombie more aggressive",
        "restore zombie aggression to standard",
    ]
    assert [item["resulting_tier"] for item in history] == ["aggressive", "standard"]
    assert state["session_tuning_state"]["aggression"]["resulting_tier"] == "standard"

    followup_artifact = json.loads(
        (
            config.runs_dir
            / "session-aggression-followup"
            / "artifacts"
            / f"{followup.task_id}_attempt_01.json"
        ).read_text(encoding="utf-8")
    )
    followup_details = followup_artifact["result"]["details"]
    assert followup_details["resolution_source"] == "session_followup_resolution"
    assert followup_details["resolved_from_prompt"] == "make it less aggressive"
    assert followup_details["previous_tier"] == "aggressive"
    assert followup_details["requested_tier"] == "standard"
    assert followup_details["resulting_tier"] == "standard"

    proof = home_surface.load_proof_result_surface(
        config.runs_dir / "session-aggression-followup" / "artifacts" / f"{followup.task_id}_attempt_01.json"
    )
    assert proof.available is True
    assert proof.key_steps[0].startswith("Resolution: AI-E resolved the follow-up prompt 'make it less aggressive'")
    assert "Session tier path: Aggression aggressive -> standard." in proof.validation_checks
    assert "Resulting tier: Aggression standard." in proof.validation_checks
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Aggression changed.\n\n"
        "Current state vs previous version\n"
        "Aggression: standard vs aggressive\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Longer attack cooldown."
    )
    assert proof.evaluation_differences == ["Aggression: aggressive -> standard"]
    assert proof.evaluation_suggestion == ""
    assert proof.experiment_available is True
    assert proof.variant_id == "variant_0002"
    assert proof.compared_variant_id == "variant_0001"
    assert proof.experiment_summary == (
        "What changed\n"
        "Aggression changed.\n\n"
        "Current variant vs Variant 1\n"
        "Aggression: standard vs aggressive\n\n"
        "Key differences\n"
        "Aggression: aggressive -> standard\n\n"
        "Expected gameplay impact\n"
        "Longer attack cooldown."
    )


def test_supervisor_generates_evaluation_for_mixed_speed_and_aggression_plan(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "m")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    initial = intake.accept_message(
        "make zombie more aggressive",
        session_id="mx",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=initial.task_id,
        approved_by="operator-test",
        notes="Approve baseline aggression change for evaluation.",
    )
    assert approval.queue_status == "pending"

    first_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="mx",
            stop_when_queue_empty=False,
        ),
    ).run()
    assert first_run.tasks_completed == 1
    assert runtime_state["attack_cooldown"] == pytest.approx(0.6)

    plan = intake.accept_message(
        "make zombie faster but less aggressive",
        session_id="mx",
        target_repo=target_repo,
    )
    assert plan.routing.resolution_source == "goal_composition"
    for task_id in plan.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded mixed evaluation plan.",
        )
        assert approval.queue_status == "pending"

    second_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="mx",
            resume=True,
            stop_when_queue_empty=False,
        ),
    ).run()
    assert second_run.tasks_completed == 3
    assert runtime_state["speed"] == pytest.approx(4.5)
    assert runtime_state["attack_cooldown"] == pytest.approx(1.0)

    proof = home_surface.load_proof_result_surface(
        config.runs_dir / "mx" / "artifacts" / f"{plan.task_ids[-1]}_attempt_01.json"
    )
    assert proof.available is True
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Aggression changed.\n\n"
        "Current state vs previous version\n"
        "Aggression: standard vs aggressive\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Longer attack cooldown."
    )
    assert proof.evaluation_differences == [
        "Aggression: aggressive -> standard",
    ]
    assert proof.evaluation_suggestion == ""
    assert "better" not in proof.evaluation_summary.lower()
    assert "best" not in proof.evaluation_summary.lower()


def test_supervisor_generates_evaluation_for_movement_variation_comparison(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "variation_evaluation")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    initial = intake.accept_message(
        "move zombie forward",
        session_id="variation-evaluation-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=initial.task_id,
        approved_by="operator-test",
        notes="Approve baseline movement change for evaluation.",
    )
    assert approval.queue_status == "pending"

    first_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="variation-evaluation-session",
            stop_when_queue_empty=False,
        ),
    ).run()
    assert first_run.tasks_completed == 1
    assert runtime_state["position"] == pytest.approx([0.0, 0.0, 3.0])

    followup = intake.accept_message(
        "move zombie farther forward",
        session_id="variation-evaluation-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=followup.task_id,
        approved_by="operator-test",
        notes="Approve bounded movement variation comparison.",
    )
    assert approval.queue_status == "pending"

    second_run = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="variation-evaluation-session",
            resume=True,
            stop_when_queue_empty=False,
        ),
    ).run()
    assert second_run.tasks_completed == 2
    assert runtime_state["position"] == pytest.approx([0.0, 0.0, 6.0])

    proof = home_surface.load_proof_result_surface(
        config.runs_dir / "variation-evaluation-session" / "artifacts" / f"{followup.task_id}_attempt_01.json"
    )
    assert proof.available is True
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Movement target changed.\n\n"
        "Current state vs previous version\n"
        "Movement target: Z=6 vs Z=3\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Moves farther forward along the same path."
    )
    assert proof.evaluation_differences == ["Movement target: Z=3 -> Z=6"]
    assert proof.evaluation_suggestion == ""
    assert proof.experiment_available is True
    assert proof.variant_id == "variant_0002"
    assert proof.compared_variant_id == "variant_0001"
    assert proof.experiment_summary == (
        "What changed\n"
        "Movement target changed.\n\n"
        "Current variant vs Variant 1\n"
        "Movement target: Z=6 vs Z=3\n\n"
        "Key differences\n"
        "Movement target: Z=3 -> Z=6\n\n"
        "Expected gameplay impact\n"
        "Moves farther forward along the same path."
    )


def test_supervisor_executes_auto_promoted_level0001_grass_mutation_without_manual_approval(tmp_path):
    config = _make_config(tmp_path / "grass_mutation_auto")
    _write_grass_capability_contracts(config)
    _seed_auto_promoted_reference_capability_proof(config)
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    result = intake.accept_message(
        "make grass for level_0001",
        session_id="grass-mutation-auto-session",
        target_repo=str((config.root_dir / "BABYLON_TEST").resolve()),
    )

    assert result.queue_entry["status"] == "pending"
    assert result.queue_entry["approval_state"] == "auto_approved"
    assert result.queue_entry["approved_by"] == "system_intelligence_v1"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="grass-mutation-auto-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 1
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert queue[0]["status"] == "completed"
    assert queue[0]["approval_state"] == "auto_approved"
    assert queue[0]["approved_by"] == "system_intelligence_v1"
    assert queue[0]["execution_decision"] == "auto_execute"

    scene_path = config.root_dir / "BABYLON_TEST" / "Assets" / "AI_E_TestScenes" / "MinimalPlayableArena.unity"
    scene_text = scene_path.read_text(encoding="utf-8")
    assert "AIE_LEVEL_0001_GrassPatch_001" in scene_text

    artifact_path = config.runs_dir / "grass-mutation-auto-session" / "artifacts" / f"{result.task_id}_attempt_01.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["task"]["execution_decision"] == "auto_execute"
    assert artifact["task"]["auto_execution_enabled"] is True
    assert artifact["task"]["approval_state"] == "auto_approved"
    assert artifact["result"]["details"]["execution_decision"] == "auto_execute"
    assert artifact["result"]["details"]["auto_execution_enabled"] is True
    assert artifact["result"]["details"]["approval_state"] == "auto_approved"


def test_supervisor_executes_approved_level0001_grass_removal_and_records_evidence(tmp_path):
    config = _make_config(tmp_path / "grass_removal")
    _write_grass_capability_contracts(config)
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    target_repo = str((config.root_dir / "BABYLON_TEST").resolve())

    add_result = intake.accept_message(
        "make grass for level_0001",
        session_id="grass-removal-seed",
        target_repo=target_repo,
    )
    approve_mutation_task(
        config,
        task_id=add_result.task_id,
        approved_by="operator-test",
        notes="Seed grass patch before removal.",
    )
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="grass-removal-seed",
            stop_when_queue_empty=False,
        ),
    ).run()

    result = intake.accept_message(
        "remove grass for level_0001",
        session_id="grass-removal-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "needs_approval"

    approval = approve_mutation_task(
        config,
        task_id=result.task_id,
        approved_by="operator-test",
        notes="Approve bounded grass removal.",
    )
    assert approval.queue_status == "pending"

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="grass-removal-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 1
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    scene_path = config.root_dir / "BABYLON_TEST" / "Assets" / "AI_E_TestScenes" / "MinimalPlayableArena.unity"
    scene_text = scene_path.read_text(encoding="utf-8")
    assert "AIE_LEVEL_0001_GrassPatch_001" not in scene_text

    evidence_store = CapabilityEvidenceStore(config.contracts_dir / "capabilities" / "evidence.json")
    evidence = evidence_store.get("level_0001_remove_grass")
    assert evidence is not None
    assert evidence["times_attempted"] == 1
    assert evidence["times_passed"] == 1
    assert evidence["last_validation_result"] == "passed"
    assert evidence["sandbox_verified"] is True

    artifact_path = config.runs_dir / "grass-removal-session" / "artifacts" / f"{result.task_id}_attempt_01.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["result"]["details"]["removed_object_name"] == "AIE_LEVEL_0001_GrassPatch_001"
    assert artifact["result"]["details"]["validation"]["status"] == "passed"
    assert artifact["result"]["details"]["approval_state"] == "approved"


def test_supervisor_executes_chained_add_then_remove_grass_in_one_session(tmp_path):
    config = _make_config(tmp_path / "grass_chain")
    _write_grass_capability_contracts(config)
    _create_minimal_scene_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    target_repo = str((config.root_dir / "BABYLON_TEST").resolve())

    add_result = intake.accept_message(
        "make grass for level_0001",
        session_id="grass-chain-session",
        target_repo=target_repo,
    )
    remove_result = intake.accept_message(
        "remove grass for level_0001",
        session_id="grass-chain-session",
        target_repo=target_repo,
    )

    queue_payload = json.loads(config.queue_path.read_text(encoding="utf-8"))
    for task in queue_payload["tasks"]:
        if task["task_id"] == remove_result.task_id:
            task["dependencies"] = [add_result.task_id]
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    remove_runtime_payload = json.loads(remove_result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    remove_runtime_payload["runtime_task"]["dependencies"] = [add_result.task_id]
    remove_result.artifacts.runtime_task_payload_path.write_text(json.dumps(remove_runtime_payload, indent=2), encoding="utf-8")

    approve_mutation_task(
        config,
        task_id=add_result.task_id,
        approved_by="operator-test",
        notes="Approve chained add grass task.",
    )
    approve_mutation_task(
        config,
        task_id=remove_result.task_id,
        approved_by="operator-test",
        notes="Approve chained remove grass task.",
    )

    supervisor = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=10,
            heartbeat_interval_seconds=1,
            poll_interval_seconds=1,
            idle_timeout_seconds=2,
            idle_timeout_poll_limit=99,
            session_id="grass-chain-session",
            stop_when_queue_empty=False,
        ),
    )

    run_result = supervisor.run()

    assert run_result.tasks_completed == 2
    assert run_result.stop_reason == "queue_empty_idle_timeout"

    scene_path = config.root_dir / "BABYLON_TEST" / "Assets" / "AI_E_TestScenes" / "MinimalPlayableArena.unity"
    scene_text = scene_path.read_text(encoding="utf-8")
    assert "AIE_LEVEL_0001_GrassPatch_001" not in scene_text

    add_artifact_path = config.runs_dir / "grass-chain-session" / "artifacts" / f"{add_result.task_id}_attempt_01.json"
    remove_artifact_path = config.runs_dir / "grass-chain-session" / "artifacts" / f"{remove_result.task_id}_attempt_01.json"
    add_artifact = json.loads(add_artifact_path.read_text(encoding="utf-8"))
    remove_artifact = json.loads(remove_artifact_path.read_text(encoding="utf-8"))
    assert add_artifact["result"]["details"]["added_object_name"] == "AIE_LEVEL_0001_GrassPatch_001"
    assert remove_artifact["result"]["details"]["removed_object_name"] == "AIE_LEVEL_0001_GrassPatch_001"
    assert add_artifact["result"]["details"]["validation"]["status"] == "passed"
    assert remove_artifact["result"]["details"]["validation"]["status"] == "passed"


def _make_router(clock: FakeClock) -> AgentRouter:
    router = AgentRouter()

    def run_task(task):
        clock.advance(float(task.get("execution_seconds", 0)))
        attempt_index = max(int(task.get("platformer_auto_iteration_attempt", 1) or 1) - 1, 0)
        outcome_sequence = task.get("simulated_outcome_sequence")
        if isinstance(outcome_sequence, list) and outcome_sequence:
            sequence_index = min(attempt_index, len(outcome_sequence) - 1)
            outcome = str(outcome_sequence[sequence_index])
        else:
            outcome = str(task.get("simulated_outcome", "completed"))
        payload = dict(task.get("result_payload") or {})
        payload_sequence = task.get("result_payload_sequence")
        if isinstance(payload_sequence, list) and payload_sequence:
            sequence_index = min(attempt_index, len(payload_sequence) - 1)
            selected_payload = payload_sequence[sequence_index]
            if isinstance(selected_payload, dict):
                payload = dict(selected_payload)
        if outcome == "blocked":
            return {
                "status": "blocked",
                "summary": f"blocked {task['task_id']}",
                "details": payload,
                "error": "blocked by test",
            }
        if outcome == "retryable_failure":
            return {
                "status": "retryable_failure",
                "summary": f"retry {task['task_id']}",
                "details": payload,
                "error": "retry requested by test",
                "retryable": True,
            }
        return {
            "status": "completed",
            "summary": f"completed {task['task_id']}",
            "details": payload or {"task_id": task["task_id"]},
        }

    router.register("copilot_coder_agent", run_task)
    return router


def _make_config(tmp_path) -> OrchestratorConfig:
    root_dir = tmp_path / "repo_root"
    runs_dir = root_dir / "runs"
    workspaces_dir = root_dir / "workspaces"
    queue_path = root_dir / "backlog" / "queue.json"
    queue_contracts_dir = root_dir / "contracts" / "queue"
    agent_registry_path = root_dir / "agents" / "registry.json"
    contracts_dir = root_dir / "contracts"
    templates_dir = contracts_dir / "templates"
    approvals_path = root_dir / "backlog" / "approvals.json"
    command_allowlist_path = root_dir / "backlog" / "command_allowlist.json"

    for path in [
        runs_dir,
        workspaces_dir,
        queue_contracts_dir,
        templates_dir,
        approvals_path.parent,
        agent_registry_path.parent,
        root_dir / "logs",
    ]:
        path.mkdir(parents=True, exist_ok=True)
    approvals_path.write_text(json.dumps({"approvals": []}, indent=2), encoding="utf-8")
    command_allowlist_path.write_text(json.dumps({"exact": [], "prefix": []}, indent=2), encoding="utf-8")
    agent_registry_path.write_text(json.dumps({"agents": []}, indent=2), encoding="utf-8")

    return OrchestratorConfig(
        root_dir=root_dir,
        runs_dir=runs_dir,
        workspaces_dir=workspaces_dir,
        queue_path=queue_path,
        queue_contracts_dir=queue_contracts_dir,
        agent_registry_path=agent_registry_path,
        contracts_dir=contracts_dir,
        templates_dir=templates_dir,
        approvals_path=approvals_path,
        command_allowlist_path=command_allowlist_path,
    )


def _task(
    config: OrchestratorConfig,
    task_id: str,
    *,
    priority: int,
    execution_seconds: int,
    simulated_outcome: str = "completed",
    agent_type: str = "copilot_coder_agent",
    **runtime_fields,
):
    return {
        "task_id": task_id,
        "priority": priority,
        "status": "pending",
        "execution_seconds": execution_seconds,
        "simulated_outcome": simulated_outcome,
        "contract_path": _create_runtime_payload(
            config,
            task_id,
            execution_seconds=execution_seconds,
            simulated_outcome=simulated_outcome,
            agent_type=agent_type,
            **runtime_fields,
        ),
    }


def _write_queue(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _create_runtime_payload(
    config: OrchestratorConfig,
    task_id: str,
    *,
    execution_seconds: int,
    simulated_outcome: str = "completed",
    agent_type: str = "copilot_coder_agent",
    **runtime_fields,
) -> str:
    payload_dir = config.contracts_dir / "test_runtime"
    payload_dir.mkdir(parents=True, exist_ok=True)
    path = payload_dir / f"{task_id}.json"
    runtime_task = {
        "task_id": task_id,
        "agent_type": agent_type,
        "execution_seconds": execution_seconds,
        "simulated_outcome": simulated_outcome,
    }
    runtime_task.update(runtime_fields)
    path.write_text(
        json.dumps(
            {
                "runtime_task": runtime_task
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return str(path.relative_to(config.root_dir)).replace("\\", "/")


def _create_minimal_scene_repo(config: OrchestratorConfig, *, target_repo_name: str) -> None:
    repo_root = config.root_dir / target_repo_name
    scene_dir = repo_root / "Assets" / "AI_E_TestScenes"
    scene_dir.mkdir(parents=True, exist_ok=True)
    (scene_dir / "MinimalPlayableArena.unity").write_text(
        "%YAML 1.1\n"
        "%TAG !u! tag:unity3d.com,2011:\n"
        "--- !u!29 &1\n"
        "OcclusionCullingSettings:\n"
        "  m_ObjectHideFlags: 0\n"
        "  serializedVersion: 2\n"
        "  m_SceneGUID: 00000000000000000000000000000000\n"
        "  m_OcclusionCullingData: {fileID: 0}\n"
        "--- !u!1660057539 &9223372036854775807\n"
        "SceneRoots:\n"
        "  m_ObjectHideFlags: 0\n"
        "  m_Roots:\n",
        encoding="utf-8",
    )


def _create_real_unity_harness_repo(config: OrchestratorConfig, *, target_repo_name: str) -> None:
    source_root = Path(__file__).resolve().parents[1] / "Tools" / "PlaymodeHarness_QC" / "BABYLON_VER_2"
    if not source_root.exists():
        raise FileNotFoundError(f"Unity harness source not found: {source_root}")

    repo_root = config.root_dir / target_repo_name
    repo_root.mkdir(parents=True, exist_ok=True)

    for directory_name in ("Packages", "ProjectSettings"):
        shutil.copytree(source_root / directory_name, repo_root / directory_name)

    (repo_root / "Assets" / "AI_E_TestScenes").mkdir(parents=True, exist_ok=True)
    (repo_root / "scripts" / "logs").mkdir(parents=True, exist_ok=True)


def _create_harness_shape_unity_repo(config: OrchestratorConfig, *, target_repo_name: str) -> None:
    source_root = Path(__file__).resolve().parents[1] / "Tools" / "PlaymodeHarness_QC" / "BABYLON_VER_2"
    if not source_root.exists():
        raise FileNotFoundError(f"Unity harness source not found: {source_root}")

    repo_root = config.root_dir / target_repo_name
    packages_dir = repo_root / "Packages"
    repo_root.mkdir(parents=True, exist_ok=True)
    packages_dir.mkdir(parents=True, exist_ok=True)

    shutil.copytree(source_root / "ProjectSettings", repo_root / "ProjectSettings")

    (packages_dir / "manifest.json").write_text(
        json.dumps(
            {
                "dependencies": {
                    "com.unity.modules.accessibility": "1.0.0",
                    "com.unity.modules.ai": "1.0.0",
                    "com.unity.modules.androidjni": "1.0.0",
                    "com.unity.modules.animation": "1.0.0",
                    "com.unity.modules.assetbundle": "1.0.0",
                    "com.unity.modules.audio": "1.0.0",
                    "com.unity.modules.cloth": "1.0.0",
                    "com.unity.modules.director": "1.0.0",
                    "com.unity.modules.imageconversion": "1.0.0",
                    "com.unity.modules.imgui": "1.0.0",
                    "com.unity.modules.jsonserialize": "1.0.0",
                    "com.unity.modules.particlesystem": "1.0.0",
                    "com.unity.modules.physics": "1.0.0",
                    "com.unity.modules.physics2d": "1.0.0",
                    "com.unity.modules.screencapture": "1.0.0",
                    "com.unity.modules.terrain": "1.0.0",
                    "com.unity.modules.terrainphysics": "1.0.0",
                    "com.unity.modules.tilemap": "1.0.0",
                    "com.unity.modules.ui": "1.0.0",
                    "com.unity.modules.uielements": "1.0.0",
                    "com.unity.modules.umbra": "1.0.0",
                    "com.unity.modules.unityanalytics": "1.0.0",
                    "com.unity.modules.unitywebrequest": "1.0.0",
                    "com.unity.modules.unitywebrequestassetbundle": "1.0.0",
                    "com.unity.modules.unitywebrequestaudio": "1.0.0",
                    "com.unity.modules.unitywebrequesttexture": "1.0.0",
                    "com.unity.modules.unitywebrequestwww": "1.0.0",
                    "com.unity.modules.vehicles": "1.0.0",
                    "com.unity.modules.video": "1.0.0",
                    "com.unity.modules.vr": "1.0.0",
                    "com.unity.modules.wind": "1.0.0",
                    "com.unity.modules.xr": "1.0.0"
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    shutil.copytree(source_root / "Assets" / "Tests", repo_root / "Assets" / "Tests")
    scripts_dir = repo_root / "Assets" / "Scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_root / "Assets" / "Scripts" / "PlaymodeHarness.cs", scripts_dir / "PlaymodeHarness.cs")
    playmode_meta_path = source_root / "Assets" / "Scripts" / "PlaymodeHarness.cs.meta"
    if playmode_meta_path.exists():
        shutil.copy2(playmode_meta_path, scripts_dir / "PlaymodeHarness.cs.meta")

    (repo_root / "scripts" / "logs").mkdir(parents=True, exist_ok=True)


def _create_minimal_real_unity_bootstrap_repo(config: OrchestratorConfig, *, target_repo_name: str) -> None:
    source_root = Path(__file__).resolve().parents[1] / "Tools" / "PlaymodeHarness_QC" / "BABYLON_VER_2"
    repo_root = config.root_dir / target_repo_name
    packages_dir = repo_root / "Packages"
    project_settings_dir = repo_root / "ProjectSettings"

    repo_root.mkdir(parents=True, exist_ok=True)
    packages_dir.mkdir(parents=True, exist_ok=True)
    project_settings_dir.mkdir(parents=True, exist_ok=True)
    (repo_root / "Assets").mkdir(parents=True, exist_ok=True)
    (repo_root / "scripts" / "logs").mkdir(parents=True, exist_ok=True)

    (project_settings_dir / "ProjectVersion.txt").write_text(
        (source_root / "ProjectSettings" / "ProjectVersion.txt").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (packages_dir / "manifest.json").write_text(
        json.dumps(
            {
                "dependencies": {
                    "com.unity.modules.accessibility": "1.0.0",
                    "com.unity.modules.ai": "1.0.0",
                    "com.unity.modules.androidjni": "1.0.0",
                    "com.unity.modules.animation": "1.0.0",
                    "com.unity.modules.assetbundle": "1.0.0",
                    "com.unity.modules.audio": "1.0.0",
                    "com.unity.modules.cloth": "1.0.0",
                    "com.unity.modules.director": "1.0.0",
                    "com.unity.modules.imageconversion": "1.0.0",
                    "com.unity.modules.imgui": "1.0.0",
                    "com.unity.modules.jsonserialize": "1.0.0",
                    "com.unity.modules.particlesystem": "1.0.0",
                    "com.unity.modules.physics": "1.0.0",
                    "com.unity.modules.physics2d": "1.0.0",
                    "com.unity.modules.screencapture": "1.0.0",
                    "com.unity.modules.terrain": "1.0.0",
                    "com.unity.modules.terrainphysics": "1.0.0",
                    "com.unity.modules.tilemap": "1.0.0",
                    "com.unity.modules.ui": "1.0.0",
                    "com.unity.modules.uielements": "1.0.0",
                    "com.unity.modules.umbra": "1.0.0",
                    "com.unity.modules.unityanalytics": "1.0.0",
                    "com.unity.modules.unitywebrequest": "1.0.0",
                    "com.unity.modules.unitywebrequestassetbundle": "1.0.0",
                    "com.unity.modules.unitywebrequestaudio": "1.0.0",
                    "com.unity.modules.unitywebrequesttexture": "1.0.0",
                    "com.unity.modules.unitywebrequestwww": "1.0.0",
                    "com.unity.modules.vehicles": "1.0.0",
                    "com.unity.modules.video": "1.0.0",
                    "com.unity.modules.vr": "1.0.0",
                    "com.unity.modules.wind": "1.0.0",
                    "com.unity.modules.xr": "1.0.0"
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_licensed_boot_probe(
    probe_path: Path,
    *,
    write_partial: bool,
    final_output_text: str,
    crash_marker_path_env: str | None = None,
) -> None:
    lines = [
        "using System;",
        "using System.IO;",
    ]
    if write_partial:
        lines.append("using System.Threading;")
    lines.extend(
        [
            "using UnityEditor;",
            "using UnityEngine;",
            "",
            "namespace Babylon.CI",
            "{",
            "    public static class BootProbe",
            "    {",
            "        public static void Run()",
            "        {",
            '            var startedPath = Environment.GetEnvironmentVariable("BABYLON_CI_STARTED_PATH");',
        ]
    )
    if write_partial:
        lines.append('            var partialPath = Environment.GetEnvironmentVariable("BABYLON_CI_PARTIAL_PATH");')
    lines.extend(
        [
            '            var finalPath = Environment.GetEnvironmentVariable("BABYLON_CI_FINAL_PATH");',
            '            var artifactPath = Environment.GetEnvironmentVariable("BABYLON_CI_ARTIFACT");',
            "",
            "            EnsureParent(startedPath);",
        ]
    )
    if write_partial:
        lines.append("            EnsureParent(partialPath);")
    lines.extend(
        [
            "            EnsureParent(finalPath);",
            "            EnsureParent(artifactPath);",
            "",
            '            if (!string.IsNullOrWhiteSpace(startedPath))',
            "            {",
            '                File.WriteAllText(startedPath, "started\\n");',
            "            }",
            "",
            '            Debug.Log("[licensed_boot_probe] started");',
        ]
    )
    if write_partial:
        if crash_marker_path_env:
            lines.extend(
                [
                    f'            var crashMarkerPath = Environment.GetEnvironmentVariable("{crash_marker_path_env}");',
                    "            EnsureParent(crashMarkerPath);",
                ]
            )
        lines.append('            File.WriteAllText(partialPath, "partial unity tool output\\n");')
        if crash_marker_path_env:
            lines.extend(
                [
                    '            if (!File.Exists(crashMarkerPath))',
                    "            {",
                    '                File.WriteAllText(crashMarkerPath, "crashed\\n");',
                    "                Thread.Sleep(TimeSpan.FromSeconds(30));",
                    "                return;",
                    "            }",
                    "",
                    "            Thread.Sleep(TimeSpan.FromSeconds(2));",
                ]
            )
    lines.extend(
        [
            "",
            '            if (!string.IsNullOrWhiteSpace(finalPath))',
            "            {",
            f"                File.WriteAllText(finalPath, {json.dumps(final_output_text)});",
            "            }",
            "",
            '            var artifactJson = "{\\n" +',
            '                "  \\\"scene\\\": \\\"MainMenu\\\",\\n" +',
            '                "  \\\"status\\\": \\\"ok\\\",\\n" +',
            '                "  \\\"timestamp\\\": \\\"" + DateTime.UtcNow.ToString("o") + "\\\",\\n" +',
            '                "  \\\"probe\\\": \\\"licensed_boot_probe\\\",\\n" +',
            '                "  \\\"evidence\\\": \\\"launcher-surface validation artifact that intentionally exceeds the minimum JSON size threshold\\\",\\n" +',
            '                "  \\\"final_output\\\": \\\"written\\\"\\n" +',
            '                "}\\n";',
            '            File.WriteAllText(artifactPath, artifactJson);',
            '            Debug.Log("[licensed_boot_probe] completed");',
            "            EditorApplication.Exit(0);",
            "        }",
            "",
            "        private static void EnsureParent(string path)",
            "        {",
            "            if (string.IsNullOrWhiteSpace(path))",
            "            {",
            "                return;",
            "            }",
            "",
            "            var directory = Path.GetDirectoryName(path);",
            "            if (!string.IsNullOrWhiteSpace(directory))",
            "            {",
            "                Directory.CreateDirectory(directory);",
            "            }",
            "        }",
            "    }",
            "}",
            "",
        ]
    )
    probe_path.write_text("\n".join(lines), encoding="utf-8")


def _write_licensed_screenshot_probe(
    probe_path: Path,
    *,
    write_partial: bool,
    final_output_text: str,
    crash_marker_path_env: str | None = None,
    pre_capture_sleep_seconds: int = 0,
) -> None:
    lines = [
        "using System;",
        "using System.IO;",
        "using System.Threading;",
        "using UnityEditor;",
        "using UnityEngine;",
        "",
        "namespace Babylon.CI",
        "{",
        "    public static class ScreenshotProbe",
        "    {",
        "        public static void Run()",
        "        {",
        '            var startedPath = Environment.GetEnvironmentVariable("BABYLON_CI_STARTED_PATH");',
        '            var partialPath = Environment.GetEnvironmentVariable("BABYLON_CI_PARTIAL_PATH");',
        '            var finalPath = Environment.GetEnvironmentVariable("BABYLON_CI_FINAL_PATH");',
        '            var outPngPath = Environment.GetEnvironmentVariable("BABYLON_CI_OUT_PNG");',
        '            var widthText = Environment.GetEnvironmentVariable("BABYLON_CI_WIDTH");',
        '            var heightText = Environment.GetEnvironmentVariable("BABYLON_CI_HEIGHT");',
        '            var width = ParsePositiveInt(widthText, 1280);',
        '            var height = ParsePositiveInt(heightText, 720);',
        "",
        "            EnsureParent(startedPath);",
        "            EnsureParent(partialPath);",
        "            EnsureParent(finalPath);",
        "            EnsureParent(outPngPath);",
        "",
        '            if (!string.IsNullOrWhiteSpace(startedPath))',
        "            {",
        '                File.WriteAllText(startedPath, "started\\n");',
        "            }",
        '            Debug.Log("[licensed_screenshot_probe] started");',
    ]
    if write_partial:
        lines.extend(
            [
                '            if (!string.IsNullOrWhiteSpace(partialPath))',
                "            {",
                '                File.WriteAllText(partialPath, "partial unity screenshot output\\n");',
                "            }",
            ]
        )
    if crash_marker_path_env:
        lines.extend(
            [
                f'            var crashMarkerPath = Environment.GetEnvironmentVariable("{crash_marker_path_env}");',
                "            EnsureParent(crashMarkerPath);",
                '            if (!string.IsNullOrWhiteSpace(crashMarkerPath) && !File.Exists(crashMarkerPath))',
                "            {",
                '                File.WriteAllText(crashMarkerPath, "crashed\\n");',
                "                var currentProcessId = System.Diagnostics.Process.GetCurrentProcess().Id;",
                "                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo",
                "                {",
                '                    FileName = "cmd.exe",',
                '                    Arguments = $"/c ping -n 3 127.0.0.1 >nul & taskkill /PID {currentProcessId} /F",',
                "                    CreateNoWindow = true,",
                "                    UseShellExecute = false,",
                "                });",
                "                Thread.Sleep(TimeSpan.FromSeconds(30));",
                "                return;",
                "            }",
            ]
        )
    if pre_capture_sleep_seconds > 0:
        lines.append(f"            Thread.Sleep(TimeSpan.FromSeconds({pre_capture_sleep_seconds}));")
    lines.extend(
        [
            "",
            "            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);",
            "            var pixels = new Color32[width * height];",
            "            for (var y = 0; y < height; y++)",
            "            {",
            "                for (var x = 0; x < width; x++)",
            "                {",
            "                    var index = y * width + x;",
            "                    pixels[index] = new Color32(",
            "                        (byte)((x * 17 + y * 3) % 255),",
            "                        (byte)((y * 29 + x * 5) % 255),",
            "                        (byte)(((x + y) * 11) % 255),",
            "                        255);",
            "                }",
            "            }",
            "            texture.SetPixels32(pixels);",
            "            texture.Apply(false, false);",
            "            File.WriteAllBytes(outPngPath, texture.EncodeToPNG());",
            "            UnityEngine.Object.DestroyImmediate(texture);",
            '            Debug.Log("[licensed_screenshot_probe] captured");',
            "",
            '            if (!string.IsNullOrWhiteSpace(finalPath))',
            "            {",
            f"                File.WriteAllText(finalPath, {json.dumps(final_output_text)});",
            "            }",
            '            Debug.Log("[licensed_screenshot_probe] completed");',
            "            EditorApplication.Exit(0);",
            "        }",
            "",
            "        private static int ParsePositiveInt(string text, int fallback)",
            "        {",
            "            if (int.TryParse(text, out var parsed) && parsed > 0)",
            "            {",
            "                return parsed;",
            "            }",
            "",
            "            return fallback;",
            "        }",
            "",
            "        private static void EnsureParent(string path)",
            "        {",
            "            if (string.IsNullOrWhiteSpace(path))",
            "            {",
            "                return;",
            "            }",
            "",
            "            var directory = Path.GetDirectoryName(path);",
            "            if (!string.IsNullOrWhiteSpace(directory))",
            "            {",
            "                Directory.CreateDirectory(directory);",
            "            }",
            "        }",
            "    }",
            "}",
            "",
        ]
    )
    probe_path.write_text("\n".join(lines), encoding="utf-8")


def _write_grass_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_add_grass.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_add_grass",
                "title": "LEVEL_0001 add grass",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/MinimalPlayableArena.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_grass_handler",
                "agent_type": "level_0001_grass_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "match_terms": ["level_0001", "grass"],
                "match_verbs": ["make", "add", "create", "generate", "place", "build"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_remove_grass.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_remove_grass",
                "title": "LEVEL_0001 remove grass",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/MinimalPlayableArena.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_remove_grass_handler",
                "agent_type": "level_0001_grass_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "match_terms": ["level_0001", "grass"],
                "match_verbs": ["remove", "delete", "clear"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def test_supervisor_executes_runner_goal_intent_plan_and_tracks_experiment_metadata(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "runner_goal_intent_combat_plan")
    _write_runner_speed_capability_contracts(config)
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "make runner more dangerous",
        session_id="runner-goal-intent-session",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_plan_request"
    assert result.routing.plan_title == "Test runner combat variation"
    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded runner combat variation.",
        )
        assert approval.queue_status == "pending"

    run_result = Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="runner-goal-intent-session",
        ),
    ).run()
    assert run_result is not None

    state = StateStore(config.runs_dir, "runner-goal-intent-session").load()
    experiment_tracking = state["experiment_tracking"]
    assert experiment_tracking["active_experiment_id"] == "experiment_0001"
    assert experiment_tracking["experiments"][0]["target_entity"] == "runner"
    assert experiment_tracking["experiments"][0]["variants"][0]["target_entity"] == "runner"
    assert runtime_state["entities"]["runner"]["speed"] == 5.0
    assert runtime_state["entities"]["runner"]["attack_cooldown"] == 0.5

    proof = home_surface.load_proof_result_surface(config.runs_dir / "runner-goal-intent-session")
    assert proof.available is True
    assert proof.detected_action == "Test runner combat variation"
    assert proof.experiment_available is True
    assert proof.experiment_id == "experiment_0001"
    assert proof.variant_id == "variant_0001"


def test_supervisor_runner_session_followup_and_revert_work_with_active_entity(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "runner_followup_revert")
    _write_runner_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    initial = intake.accept_message(
        "make runner faster",
        session_id="runner-followup-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=initial.task_id,
        approved_by="operator-test",
        notes="Approve runner speed increase.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="runner-followup-session",
        ),
    ).run()

    followup = intake.accept_message(
        "make it slower",
        session_id="runner-followup-session",
        target_repo=target_repo,
    )
    assert followup.routing.mapped_prompt == "restore runner speed to standard"
    approval = approve_mutation_task(
        config,
        task_id=followup.task_id,
        approved_by="operator-test",
        notes="Approve runner speed follow-up.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="runner-followup-session",
            resume=True,
        ),
    ).run()

    revert = intake.accept_message(
        "revert last change",
        session_id="runner-followup-session",
        target_repo=target_repo,
    )
    assert revert.routing.mapped_prompt == "make runner faster"
    assert revert.routing.revert_requested is True
    approval = approve_mutation_task(
        config,
        task_id=revert.task_id,
        approved_by="operator-test",
        notes="Approve runner revert.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="runner-followup-session",
            resume=True,
        ),
    ).run()

    state = StateStore(config.runs_dir, "runner-followup-session").load()
    history = state["session_tuning_history"]
    assert [item["canonical_prompt"] for item in history] == [
        "make runner faster",
        "restore runner speed to standard",
        "make runner faster",
    ]
    assert [item["target_entity"] for item in history] == ["runner", "runner", "runner"]
    assert state["session_tuning_state"]["target_entity"] == "runner"
    assert runtime_state["entities"]["runner"]["speed"] == 5.0

    proof = home_surface.load_proof_result_surface(config.runs_dir / "runner-followup-session")
    assert proof.available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current state vs previous version\n"
        "Speed: fast vs standard\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Higher movement speed."
    )
    assert proof.evaluation_differences == ["Speed: standard -> fast"]
    assert any("runner" in check.lower() for check in proof.validation_checks)


def test_supervisor_runner_state_aware_skip_records_noop_and_evaluation(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "runner_state_aware_skip")
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    first = intake.accept_message(
        "make runner more aggressive",
        session_id="runner-skip-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=first.task_id,
        approved_by="operator-test",
        notes="Approve runner aggression increase.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="runner-skip-session",
        ),
    ).run()

    second = intake.accept_message(
        "make runner more aggressive",
        session_id="runner-skip-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=second.task_id,
        approved_by="operator-test",
        notes="Approve repeated runner aggression increase.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="runner-skip-session",
            resume=True,
        ),
    ).run()

    artifact = json.loads((config.runs_dir / "runner-skip-session" / "artifacts" / f"{second.task_id}_attempt_01.json").read_text(encoding="utf-8"))
    details = artifact["result"]["details"]
    assert details["entity_type"] == "runner"
    assert details["executed"] is False
    assert details["result_reason"] == "skipped_already_satisfied"
    assert runtime_state["entities"]["runner"]["attack_cooldown"] == 0.5

    proof = home_surface.load_proof_result_surface(config.runs_dir / "runner-skip-session")
    assert proof.available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "No supported deterministic differences were detected.\n\n"
        "Current state vs previous version\n"
        "Supported deterministic checks match previous version.\n\n"
        "Key differences\n"
        "No explicit deltas were recorded.\n\n"
        "Expected gameplay impact\n"
        "No deterministic gameplay-impact change detected."
    )
    assert proof.experiment_available is True


def test_supervisor_encounter_count_state_aware_skip_records_noop_and_evaluation(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "encounter_count_skip")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    first = intake.accept_message(
        "increase encounter count",
        session_id="encounter-skip-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=first.task_id,
        approved_by="operator-test",
        notes="Approve encounter count increase.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="encounter-skip-session",
        ),
    ).run()

    second = intake.accept_message(
        "increase encounter count",
        session_id="encounter-skip-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=second.task_id,
        approved_by="operator-test",
        notes="Approve repeated encounter count increase.",
    )
    assert approval.queue_status == "pending"
    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="encounter-skip-session",
            resume=True,
        ),
    ).run()

    artifact = json.loads((config.runs_dir / "encounter-skip-session" / "artifacts" / f"{second.task_id}_attempt_01.json").read_text(encoding="utf-8"))
    details = artifact["result"]["details"]
    assert details["entity_type"] == "encounter"
    assert details["executed"] is False
    assert details["result_reason"] == "skipped_already_satisfied"
    assert runtime_state["encounter"]["count"] == 7

    proof = home_surface.load_proof_result_surface(config.runs_dir / "encounter-skip-session")
    assert proof.available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "No supported deterministic differences were detected.\n\n"
        "Current state vs previous version\n"
        "Supported deterministic checks match previous version.\n\n"
        "Key differences\n"
        "No explicit deltas were recorded.\n\n"
        "Expected gameplay impact\n"
        "No deterministic gameplay-impact change detected."
    )
    assert proof.experiment_available is True


def test_supervisor_executes_goal_intent_mapped_encounter_plan_and_revert(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "encounter_plan")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    result = intake.accept_message(
        "make encounter more intense",
        session_id="encounter-plan-session",
        target_repo=target_repo,
    )
    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.mapped_prompt == "increase encounter intensity"

    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve bounded encounter intensity plan.",
        )
        assert approval.queue_status == "pending"

    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="encounter-plan-session",
        ),
    ).run()

    assert runtime_state["encounter"]["count"] == 7
    assert runtime_state["encounter"]["spawn_interval"] == 4.0

    proof = home_surface.load_proof_result_surface(config.runs_dir / "encounter-plan-session")
    assert proof.available is True
    assert proof.detected_action == "Increase encounter intensity"
    assert proof.experiment_available is True
    assert "encounter count" in proof.change_summary.lower()
    assert "spawn interval" in proof.before_after_summary.lower()

    followup = intake.accept_message(
        "revert last change",
        session_id="encounter-plan-session",
        target_repo=target_repo,
    )
    assert followup.routing.mapped_prompt == "restore spawn pressure to standard"
    approval = approve_mutation_task(
        config,
        task_id=followup.task_id,
        approved_by="operator-test",
        notes="Approve encounter revert.",
    )
    assert approval.queue_status == "pending"

    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="encounter-plan-session",
            resume=True,
        ),
    ).run()

    assert runtime_state["encounter"]["spawn_interval"] == 6.0


def test_supervisor_generates_structured_evaluation_for_encounter_plan_comparison(tmp_path, monkeypatch):
    config = _make_config(tmp_path / "encounter_evaluation")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config, target_repo_name="BABYLON_TEST")
    intake = ConversationalTaskIntake(config)
    fake_run, runtime_state = _make_stateful_zombie_mutation_fake_run(target_repo)

    monkeypatch.setattr("ai_e_runtime.level_0001_entity_transform_mutation.subprocess.run", fake_run)

    baseline = intake.accept_message(
        "restore encounter count to standard",
        session_id="encounter-evaluation-session",
        target_repo=target_repo,
    )
    approval = approve_mutation_task(
        config,
        task_id=baseline.task_id,
        approved_by="operator-test",
        notes="Approve encounter baseline capture.",
    )
    assert approval.queue_status == "pending"

    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="encounter-evaluation-session",
        ),
    ).run()

    result = intake.accept_message(
        "make encounter more intense",
        session_id="encounter-evaluation-session",
        target_repo=target_repo,
    )
    for task_id in result.task_ids:
        approval = approve_mutation_task(
            config,
            task_id=task_id,
            approved_by="operator-test",
            notes="Approve encounter comparison plan.",
        )
        assert approval.queue_status == "pending"

    Supervisor(
        config,
        SupervisorConfig(
            session_limit_seconds=30,
            stop_when_queue_empty=True,
            session_id="encounter-evaluation-session",
            resume=True,
        ),
    ).run()

    assert runtime_state["encounter"]["count"] == 7
    assert runtime_state["encounter"]["spawn_interval"] == 4.0

    proof = home_surface.load_proof_result_surface(
        config.runs_dir / "encounter-evaluation-session" / "artifacts" / f"{result.task_ids[-1]}_attempt_01.json"
    )
    assert proof.available is True
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Spawn count changed.\n\n"
        "Current state vs previous version\n"
        "Spawn count: 7 vs 5\n"
        "\nKey differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "More enemies per encounter."
    )
    assert proof.evaluation_differences == [
        "Spawn count: 5 -> 7",
    ]
    assert proof.evaluation_suggestion == ""
    assert proof.experiment_available is True
    assert "better" not in proof.evaluation_summary.lower()
    assert "best" not in proof.evaluation_summary.lower()


def _make_stateful_zombie_mutation_fake_run(target_repo: str):
    state = {
        "speed": 3.5,
        "attack_cooldown": 1.0,
        "position": [0.0, 0.0, 0.0],
        "tick": 0,
        "encounter": {
            "count": 5,
            "spawn_interval": 6.0,
            "baseline_count": 5,
            "baseline_spawn_interval": 6.0,
            "spawner_name": "EncounterSpawner_Main",
        },
        "entities": {
            "zombie": {
                "speed": 3.5,
                "attack_cooldown": 1.0,
                "position": [0.0, 0.0, 0.0],
                "baseline_speed": 3.5,
                "baseline_attack_cooldown": 1.0,
                "object_name": "AIE_Zombie_001_Instance",
            },
            "runner": {
                "speed": 4.5,
                "attack_cooldown": 0.8,
                "position": [0.0, 0.0, 0.0],
                "baseline_speed": 4.5,
                "baseline_attack_cooldown": 0.8,
                "object_name": "AIE_Runner_Profile_Instance",
            },
        },
    }

    def _timestamp() -> str:
        state["tick"] += 1
        return f"2026-04-02T03:00:{state['tick']:02d}Z"

    def _entity_state(entity: str) -> dict:
        return state["entities"][entity]

    def _sync_legacy_zombie_state() -> None:
        zombie_state = _entity_state("zombie")
        state["speed"] = zombie_state["speed"]
        state["attack_cooldown"] = zombie_state["attack_cooldown"]
        state["position"] = list(zombie_state["position"])

    def _write_transform_artifacts(
        *,
        entity: str,
        prompt_text: str,
        action_name: str,
        translator_artifact_path: Path,
        translator_log_path: Path,
        router_artifact_path: Path,
        router_log_path: Path,
        probe_log_path: Path,
        probe_artifact_name: str,
        new_position: list[float],
    ) -> None:
        entity_state = _entity_state(entity)
        previous_position = list(entity_state["position"])
        executed = previous_position != list(new_position)
        entity_state["position"] = list(new_position)
        if entity == "zombie":
            _sync_legacy_zombie_state()
        timestamp = _timestamp()
        probe_artifact_path = translator_artifact_path.parent / probe_artifact_name
        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_entity_transform",
                    "entity_type": entity,
                    "object_name": entity_state["object_name"],
                    "previous_position": previous_position,
                    "new_position": list(new_position),
                    "movement_distance": abs(float(new_position[2]) - float(previous_position[2])),
                    "position_changed": executed,
                    "executed": executed,
                    "result_reason": "applied" if executed else "skipped_already_satisfied",
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": timestamp,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": action_name,
                    "route_kind": "single",
                    "executed_probe": "MutateEntityTransform",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_entity_transform",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": prompt_text,
                    "normalized_prompt": prompt_text,
                    "translated_command": prompt_text,
                    "matched_prompt_pattern": prompt_text,
                    "action_name": action_name,
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": timestamp,
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    def _write_speed_artifacts(
        *,
        entity: str,
        prompt_text: str,
        action_name: str,
        requested_speed: float,
        translator_artifact_path: Path,
        translator_log_path: Path,
        router_artifact_path: Path,
        router_log_path: Path,
        probe_log_path: Path,
        probe_artifact_name: str,
    ) -> None:
        entity_state = _entity_state(entity)
        previous_speed = float(entity_state["speed"])
        executed = abs(previous_speed - requested_speed) > 0.0001
        new_speed = requested_speed if executed else previous_speed
        entity_state["speed"] = new_speed
        if entity == "zombie":
            _sync_legacy_zombie_state()
        timestamp = _timestamp()
        probe_artifact_path = translator_artifact_path.parent / probe_artifact_name
        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_enemy_move_speed",
                    "entity_type": entity,
                    "object_name": entity_state["object_name"],
                    "previous_speed": previous_speed,
                    "new_speed": new_speed,
                    "observed_speed_before_reset": previous_speed,
                    "baseline_speed": entity_state["baseline_speed"],
                    "requested_speed": requested_speed,
                    "minimum_speed": 2.0,
                    "maximum_speed": 5.0,
                    "speed_changed": executed,
                    "executed": executed,
                    "result_reason": "applied" if executed else "skipped_already_satisfied",
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": timestamp,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": action_name,
                    "route_kind": "single",
                    "executed_probe": "MutateEnemyMoveSpeed",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_enemy_move_speed",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": prompt_text,
                    "normalized_prompt": prompt_text,
                    "translated_command": prompt_text,
                    "matched_prompt_pattern": prompt_text,
                    "action_name": action_name,
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": timestamp,
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    def _write_aggression_artifacts(
        *,
        entity: str,
        prompt_text: str,
        action_name: str,
        requested_attack_cooldown: float,
        translator_artifact_path: Path,
        translator_log_path: Path,
        router_artifact_path: Path,
        router_log_path: Path,
        probe_log_path: Path,
        probe_artifact_name: str,
    ) -> None:
        entity_state = _entity_state(entity)
        previous_attack_cooldown = float(entity_state["attack_cooldown"])
        executed = abs(previous_attack_cooldown - requested_attack_cooldown) > 0.0001
        new_attack_cooldown = requested_attack_cooldown if executed else previous_attack_cooldown
        entity_state["attack_cooldown"] = new_attack_cooldown
        if entity == "zombie":
            _sync_legacy_zombie_state()
        timestamp = _timestamp()
        probe_artifact_path = translator_artifact_path.parent / probe_artifact_name
        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_enemy_aggression",
                    "entity_type": entity,
                    "object_name": entity_state["object_name"],
                    "previous_attack_cooldown": previous_attack_cooldown,
                    "new_attack_cooldown": new_attack_cooldown,
                    "observed_attack_cooldown_before_reset": previous_attack_cooldown,
                    "baseline_attack_cooldown": entity_state["baseline_attack_cooldown"],
                    "requested_attack_cooldown": requested_attack_cooldown,
                    "minimum_attack_cooldown": 0.25,
                    "maximum_attack_cooldown": 2.0,
                    "aggression_changed": executed,
                    "executed": executed,
                    "result_reason": "applied" if executed else "skipped_already_satisfied",
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": timestamp,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": action_name,
                    "route_kind": "single",
                    "executed_probe": "MutateEnemyAggression",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_enemy_aggression",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": prompt_text,
                    "normalized_prompt": prompt_text,
                    "translated_command": prompt_text,
                    "matched_prompt_pattern": prompt_text,
                    "action_name": action_name,
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": timestamp,
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    def _write_encounter_count_artifacts(
        *,
        prompt_text: str,
        action_name: str,
        requested_encounter_count: float,
        translator_artifact_path: Path,
        translator_log_path: Path,
        router_artifact_path: Path,
        router_log_path: Path,
        probe_log_path: Path,
        probe_artifact_name: str,
    ) -> None:
        encounter_state = state["encounter"]
        previous_encounter_count = float(encounter_state["count"])
        executed = abs(previous_encounter_count - requested_encounter_count) > 0.0001
        new_encounter_count = requested_encounter_count if executed else previous_encounter_count
        encounter_state["count"] = new_encounter_count
        timestamp = _timestamp()
        probe_artifact_path = translator_artifact_path.parent / probe_artifact_name
        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_encounter_count",
                    "entity_type": "encounter",
                    "spawner_name": encounter_state["spawner_name"],
                    "previous_encounter_count": previous_encounter_count,
                    "new_encounter_count": new_encounter_count,
                    "baseline_encounter_count": encounter_state["baseline_count"],
                    "requested_encounter_count": requested_encounter_count,
                    "minimum_encounter_count": 3,
                    "maximum_encounter_count": 7,
                    "encounter_count_changed": executed,
                    "executed": executed,
                    "result_reason": "applied" if executed else "skipped_already_satisfied",
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": timestamp,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": action_name,
                    "route_kind": "single",
                    "executed_probe": "MutateEncounterCount",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_encounter_count",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": prompt_text,
                    "normalized_prompt": prompt_text,
                    "translated_command": prompt_text,
                    "matched_prompt_pattern": prompt_text,
                    "action_name": action_name,
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": timestamp,
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    def _write_spawn_pressure_artifacts(
        *,
        prompt_text: str,
        action_name: str,
        requested_spawn_interval: float,
        translator_artifact_path: Path,
        translator_log_path: Path,
        router_artifact_path: Path,
        router_log_path: Path,
        probe_log_path: Path,
        probe_artifact_name: str,
    ) -> None:
        encounter_state = state["encounter"]
        previous_spawn_interval = float(encounter_state["spawn_interval"])
        executed = abs(previous_spawn_interval - requested_spawn_interval) > 0.0001
        new_spawn_interval = requested_spawn_interval if executed else previous_spawn_interval
        encounter_state["spawn_interval"] = new_spawn_interval
        timestamp = _timestamp()
        probe_artifact_path = translator_artifact_path.parent / probe_artifact_name
        translator_log_path.write_text("translator log", encoding="utf-8")
        router_log_path.write_text("router log", encoding="utf-8")
        probe_log_path.write_text("probe log", encoding="utf-8")
        probe_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "entity_test",
                    "scene_name": "entity_test",
                    "action_type": "mutate_spawn_pressure",
                    "entity_type": "encounter",
                    "spawner_name": encounter_state["spawner_name"],
                    "previous_spawn_interval": previous_spawn_interval,
                    "new_spawn_interval": new_spawn_interval,
                    "baseline_spawn_interval": encounter_state["baseline_spawn_interval"],
                    "requested_spawn_interval": requested_spawn_interval,
                    "minimum_spawn_interval": 4.0,
                    "maximum_spawn_interval": 8.0,
                    "spawn_pressure_changed": executed,
                    "executed": executed,
                    "result_reason": "applied" if executed else "skipped_already_satisfied",
                    "scene_path": "Assets/AI_E_TestScenes/entity_test.unity",
                    "timestamp": timestamp,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        router_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "action_name": action_name,
                    "route_kind": "single",
                    "executed_probe": "MutateSpawnPressure",
                    "delegated_probe_artifact_path": str(probe_artifact_path),
                    "delegated_probe_log_path": str(probe_log_path),
                    "delegated_probe_action_type": "mutate_spawn_pressure",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        translator_artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "raw_prompt": prompt_text,
                    "normalized_prompt": prompt_text,
                    "translated_command": prompt_text,
                    "matched_prompt_pattern": prompt_text,
                    "action_name": action_name,
                    "router_artifact_path": str(router_artifact_path),
                    "router_log_path": str(router_log_path),
                    "router_status": "success",
                    "timestamp": timestamp,
                    "message": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    def fake_run(command, cwd, capture_output, text, check):
        prompt_text = command[command.index("-PromptText") + 1]
        assert command[command.index("-ProjectPath") + 1] == target_repo
        translator_artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        translator_log_path = Path(command[command.index("-LogPath") + 1])
        translator_artifact_path.parent.mkdir(parents=True, exist_ok=True)
        translator_log_path.parent.mkdir(parents=True, exist_ok=True)

        router_artifact_path = translator_artifact_path.with_name(f"{translator_artifact_path.stem}.router_result.json")
        router_log_path = translator_log_path.with_name(f"{translator_log_path.stem}.router.log")
        probe_log_path = translator_artifact_path.parent / f"{translator_artifact_path.stem}.probe.log"

        if prompt_text == "make zombie faster":
            _write_speed_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="increase_enemy_move_speed",
                requested_speed=4.5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_make_zombie_faster_probe_result.json",
            )
        elif prompt_text == "make zombie slower":
            _write_speed_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="decrease_enemy_move_speed",
                requested_speed=2.5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_make_zombie_slower_probe_result.json",
            )
        elif prompt_text == "restore zombie speed to standard":
            _write_speed_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="set_enemy_move_speed",
                requested_speed=3.5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_restore_zombie_speed_to_standard_probe_result.json",
            )
        elif prompt_text == "make zombie more aggressive":
            _write_aggression_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="increase_enemy_aggression",
                requested_attack_cooldown=0.6,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_make_zombie_more_aggressive_probe_result.json",
            )
        elif prompt_text == "restore zombie aggression to standard":
            _write_aggression_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="set_enemy_aggression",
                requested_attack_cooldown=1.0,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_restore_zombie_aggression_to_standard_probe_result.json",
            )
        elif prompt_text == "move zombie forward":
            _write_transform_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="move_entity_forward",
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_move_zombie_forward_probe_result.json",
                new_position=[0.0, 0.0, 3.0],
            )
        elif prompt_text == "move zombie farther forward":
            _write_transform_artifacts(
                entity="zombie",
                prompt_text=prompt_text,
                action_name="move_entity_farther_forward",
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_move_zombie_farther_forward_probe_result.json",
                new_position=[0.0, 0.0, 6.0],
            )
        elif prompt_text == "make runner faster":
            _write_speed_artifacts(
                entity="runner",
                prompt_text=prompt_text,
                action_name="increase_enemy_move_speed",
                requested_speed=5.0,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_make_runner_faster_probe_result.json",
            )
        elif prompt_text == "make runner slower":
            _write_speed_artifacts(
                entity="runner",
                prompt_text=prompt_text,
                action_name="decrease_enemy_move_speed",
                requested_speed=3.5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_make_runner_slower_probe_result.json",
            )
        elif prompt_text == "restore runner speed to standard":
            _write_speed_artifacts(
                entity="runner",
                prompt_text=prompt_text,
                action_name="set_enemy_move_speed",
                requested_speed=4.5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_restore_runner_speed_to_standard_probe_result.json",
            )
        elif prompt_text == "make runner more aggressive":
            _write_aggression_artifacts(
                entity="runner",
                prompt_text=prompt_text,
                action_name="increase_enemy_aggression",
                requested_attack_cooldown=0.5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_make_runner_more_aggressive_probe_result.json",
            )
        elif prompt_text == "restore runner aggression to standard":
            _write_aggression_artifacts(
                entity="runner",
                prompt_text=prompt_text,
                action_name="set_enemy_aggression",
                requested_attack_cooldown=0.8,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_restore_runner_aggression_to_standard_probe_result.json",
            )
        elif prompt_text == "increase encounter count":
            _write_encounter_count_artifacts(
                prompt_text=prompt_text,
                action_name="increase_encounter_count",
                requested_encounter_count=7,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_increase_encounter_count_probe_result.json",
            )
        elif prompt_text == "decrease encounter count":
            _write_encounter_count_artifacts(
                prompt_text=prompt_text,
                action_name="decrease_encounter_count",
                requested_encounter_count=3,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_decrease_encounter_count_probe_result.json",
            )
        elif prompt_text == "restore encounter count to standard":
            _write_encounter_count_artifacts(
                prompt_text=prompt_text,
                action_name="set_encounter_count",
                requested_encounter_count=5,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_restore_encounter_count_to_standard_probe_result.json",
            )
        elif prompt_text == "increase spawn pressure":
            _write_spawn_pressure_artifacts(
                prompt_text=prompt_text,
                action_name="increase_spawn_pressure",
                requested_spawn_interval=4.0,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_increase_spawn_pressure_probe_result.json",
            )
        elif prompt_text == "decrease spawn pressure":
            _write_spawn_pressure_artifacts(
                prompt_text=prompt_text,
                action_name="decrease_spawn_pressure",
                requested_spawn_interval=8.0,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_decrease_spawn_pressure_probe_result.json",
            )
        elif prompt_text == "restore spawn pressure to standard":
            _write_spawn_pressure_artifacts(
                prompt_text=prompt_text,
                action_name="set_spawn_pressure",
                requested_spawn_interval=6.0,
                translator_artifact_path=translator_artifact_path,
                translator_log_path=translator_log_path,
                router_artifact_path=router_artifact_path,
                router_log_path=router_log_path,
                probe_log_path=probe_log_path,
                probe_artifact_name="intent_restore_spawn_pressure_to_standard_probe_result.json",
            )
        else:
            raise AssertionError(f"Unexpected prompt routed to translator: {prompt_text}")
        return subprocess.CompletedProcess(command, 0, stdout="translator ok", stderr="")

    return fake_run, state


def _write_move_zombie_capability_contract(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_move_zombie_forward.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_move_zombie_forward",
                "title": "LEVEL_0001 move zombie forward",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "match_terms": ["zombie", "forward"],
                "match_verbs": ["move", "translate", "shift", "reposition"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_move_zombie_farther_forward.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_move_zombie_farther_forward",
                "title": "LEVEL_0001 move zombie farther forward",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["zombie", "farther", "forward"],
                "match_verbs": ["move", "translate", "shift", "reposition"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_enemy_speed_capability_contracts(config: OrchestratorConfig, *, entity: str) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    for capability_id, title, match_terms, match_verbs in (
        (f"level_0001_increase_{entity}_speed", f"LEVEL_0001 increase {entity} speed", ("faster",), ("make",)),
        (f"level_0001_decrease_{entity}_speed", f"LEVEL_0001 decrease {entity} speed", ("slower",), ("make",)),
        (
            f"level_0001_restore_{entity}_speed_standard",
            f"LEVEL_0001 restore {entity} speed to standard",
            ("speed", "standard"),
            ("restore",),
        ),
    ):
        (capabilities_dir / f"{capability_id}.json").write_text(
            json.dumps(
                {
                    "capability_id": capability_id,
                    "title": title,
                    "intent": "mutate",
                    "target_level": "LEVEL_0001",
                    "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                    "requested_execution_lane": "approval_required_mutation",
                    "handler_name": "level_0001_entity_transform_handler",
                    "agent_type": "level_0001_entity_transform_mutation_agent",
                    "approval_required": True,
                    "eligible_for_auto": False,
                    "evidence_state": "experimental",
                    "safety_class": "approval_gated_automation",
                    "match_terms": [entity, *list(match_terms)],
                    "match_verbs": list(match_verbs),
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _write_zombie_speed_capability_contracts(config: OrchestratorConfig) -> None:
    _write_enemy_speed_capability_contracts(config, entity="zombie")


def _write_runner_speed_capability_contracts(config: OrchestratorConfig) -> None:
    _write_enemy_speed_capability_contracts(config, entity="runner")


def _write_enemy_aggression_capability_contract(config: OrchestratorConfig, *, entity: str) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    for capability_id, title, match_terms, match_verbs in (
        (
            f"level_0001_increase_{entity}_aggression",
            f"LEVEL_0001 increase {entity} aggression",
            ("aggressive",),
            ("make",),
        ),
        (
            f"level_0001_restore_{entity}_aggression_standard",
            f"LEVEL_0001 restore {entity} aggression to standard",
            ("aggression", "standard"),
            ("restore",),
        ),
    ):
        (capabilities_dir / f"{capability_id}.json").write_text(
            json.dumps(
                {
                    "capability_id": capability_id,
                    "title": title,
                    "intent": "mutate",
                    "target_level": "LEVEL_0001",
                    "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                    "requested_execution_lane": "approval_required_mutation",
                    "handler_name": "level_0001_entity_transform_handler",
                    "agent_type": "level_0001_entity_transform_mutation_agent",
                    "approval_required": True,
                    "eligible_for_auto": False,
                    "evidence_state": "experimental",
                    "safety_class": "approval_gated_automation",
                    "match_terms": [entity, *list(match_terms)],
                    "match_verbs": list(match_verbs),
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _write_zombie_aggression_capability_contract(config: OrchestratorConfig) -> None:
    _write_enemy_aggression_capability_contract(config, entity="zombie")


def _write_runner_aggression_capability_contract(config: OrchestratorConfig) -> None:
    _write_enemy_aggression_capability_contract(config, entity="runner")


def _write_encounter_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    for capability_id, title, match_terms, match_verbs in (
        ("level_0001_increase_encounter_count", "LEVEL_0001 increase encounter count", ("encounter", "count"), ("increase",)),
        ("level_0001_decrease_encounter_count", "LEVEL_0001 decrease encounter count", ("encounter", "count"), ("decrease",)),
        (
            "level_0001_restore_encounter_count_standard",
            "LEVEL_0001 restore encounter count to standard",
            ("encounter", "count", "standard"),
            ("restore",),
        ),
        ("level_0001_increase_spawn_pressure", "LEVEL_0001 increase spawn pressure", ("spawn", "pressure"), ("increase",)),
        ("level_0001_decrease_spawn_pressure", "LEVEL_0001 decrease spawn pressure", ("spawn", "pressure"), ("decrease",)),
        (
            "level_0001_restore_spawn_pressure_standard",
            "LEVEL_0001 restore spawn pressure to standard",
            ("spawn", "pressure", "standard"),
            ("restore",),
        ),
    ):
        (capabilities_dir / f"{capability_id}.json").write_text(
            json.dumps(
                {
                    "capability_id": capability_id,
                    "title": title,
                    "intent": "mutate",
                    "target_level": "LEVEL_0001",
                    "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                    "requested_execution_lane": "approval_required_mutation",
                    "handler_name": "level_0001_entity_transform_handler",
                    "agent_type": "level_0001_entity_transform_mutation_agent",
                    "approval_required": True,
                    "eligible_for_auto": False,
                    "evidence_state": "experimental",
                    "safety_class": "approval_gated_automation",
                    "match_terms": list(match_terms),
                    "match_verbs": list(match_verbs),
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _create_entity_transform_prompt_repo(config: OrchestratorConfig, *, target_repo_name: str = "BABYLON_TEST") -> str:
    target_repo = config.root_dir / target_repo_name
    tools_dir = target_repo / "Tools"
    scripts_logs_dir = target_repo / "scripts" / "logs"
    tools_dir.mkdir(parents=True, exist_ok=True)
    scripts_logs_dir.mkdir(parents=True, exist_ok=True)
    (tools_dir / "run_aie_prompt.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_entity_transform.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_enemy_move_speed.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_enemy_aggression.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_encounter_count.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_spawn_pressure.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "aie_prompt_aliases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "aliases": [
                    {
                        "normalized_prompt": "move zombie forward",
                        "translated_command": "move zombie forward",
                    },
                    {
                        "normalized_prompt": "move zombie farther forward",
                        "translated_command": "move zombie farther forward",
                    },
                    {
                        "normalized_prompt": "make zombie faster",
                        "translated_command": "make zombie faster",
                    },
                    {
                        "normalized_prompt": "make zombie slower",
                        "translated_command": "make zombie slower",
                    },
                    {
                        "normalized_prompt": "restore zombie speed to standard",
                        "translated_command": "restore zombie speed to standard",
                    },
                    {
                        "normalized_prompt": "make zombie more aggressive",
                        "translated_command": "make zombie more aggressive",
                    },
                    {
                        "normalized_prompt": "restore zombie aggression to standard",
                        "translated_command": "restore zombie aggression to standard",
                    },
                    {
                        "normalized_prompt": "make runner faster",
                        "translated_command": "make runner faster",
                    },
                    {
                        "normalized_prompt": "make runner slower",
                        "translated_command": "make runner slower",
                    },
                    {
                        "normalized_prompt": "restore runner speed to standard",
                        "translated_command": "restore runner speed to standard",
                    },
                    {
                        "normalized_prompt": "make runner more aggressive",
                        "translated_command": "make runner more aggressive",
                    },
                    {
                        "normalized_prompt": "restore runner aggression to standard",
                        "translated_command": "restore runner aggression to standard",
                    },
                    {
                        "normalized_prompt": "increase encounter count",
                        "translated_command": "increase encounter count",
                    },
                    {
                        "normalized_prompt": "decrease encounter count",
                        "translated_command": "decrease encounter count",
                    },
                    {
                        "normalized_prompt": "restore encounter count to standard",
                        "translated_command": "restore encounter count to standard",
                    },
                    {
                        "normalized_prompt": "increase spawn pressure",
                        "translated_command": "increase spawn pressure",
                    },
                    {
                        "normalized_prompt": "decrease spawn pressure",
                        "translated_command": "decrease spawn pressure",
                    },
                    {
                        "normalized_prompt": "restore spawn pressure to standard",
                        "translated_command": "restore spawn pressure to standard",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (tools_dir / "intent_layer_v1_routes.json").write_text(
        json.dumps(
            {
                "scene_name": "entity_test",
                "routes": [
                    {
                        "normalized_command": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "entity_type": "zombie",
                        "direction": "forward",
                        "probe_name": "MutateEntityTransform",
                        "wrapper_path": "Tools/run_unity_mutate_entity_transform.ps1",
                        "probe_artifact_file": "intent_move_zombie_forward_probe_result.json",
                        "probe_log_file": "intent_move_zombie_forward_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                        },
                    },
                    {
                        "normalized_command": "move zombie farther forward",
                        "action_name": "move_entity_farther_forward",
                        "entity_type": "zombie",
                        "direction": "forward_farther",
                        "probe_name": "MutateEntityTransform",
                        "wrapper_path": "Tools/run_unity_mutate_entity_transform.ps1",
                        "probe_artifact_file": "intent_move_zombie_farther_forward_probe_result.json",
                        "probe_log_file": "intent_move_zombie_farther_forward_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "TargetPositionX": 0.0,
                            "TargetPositionY": 0.0,
                            "TargetPositionZ": 6.0
                        },
                    },
                    {
                        "normalized_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_zombie_faster_probe_result.json",
                        "probe_log_file": "intent_make_zombie_faster_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedSpeed": 4.5,
                            "BaselineSpeed": 3.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make zombie slower",
                        "action_name": "decrease_enemy_move_speed",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_zombie_slower_probe_result.json",
                        "probe_log_file": "intent_make_zombie_slower_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedSpeed": 2.5,
                            "BaselineSpeed": 3.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_make_zombie_more_aggressive_probe_result.json",
                        "probe_log_file": "intent_make_zombie_more_aggressive_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedAttackCooldown": 0.6,
                            "BaselineAttackCooldown": 1.0,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "restore zombie speed to standard",
                        "action_name": "set_enemy_move_speed",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_restore_zombie_speed_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_zombie_speed_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedSpeed": 3.5,
                            "BaselineSpeed": 3.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "restore zombie aggression to standard",
                        "action_name": "set_enemy_aggression",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_restore_zombie_aggression_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_zombie_aggression_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedAttackCooldown": 1.0,
                            "BaselineAttackCooldown": 1.0,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "make runner faster",
                        "action_name": "increase_enemy_move_speed",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_runner_faster_probe_result.json",
                        "probe_log_file": "intent_make_runner_faster_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedSpeed": 5.0,
                            "BaselineSpeed": 4.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make runner slower",
                        "action_name": "decrease_enemy_move_speed",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_runner_slower_probe_result.json",
                        "probe_log_file": "intent_make_runner_slower_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedSpeed": 3.5,
                            "BaselineSpeed": 4.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "restore runner speed to standard",
                        "action_name": "set_enemy_move_speed",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_restore_runner_speed_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_runner_speed_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedSpeed": 4.5,
                            "BaselineSpeed": 4.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make runner more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_make_runner_more_aggressive_probe_result.json",
                        "probe_log_file": "intent_make_runner_more_aggressive_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedAttackCooldown": 0.5,
                            "BaselineAttackCooldown": 0.8,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "restore runner aggression to standard",
                        "action_name": "set_enemy_aggression",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_restore_runner_aggression_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_runner_aggression_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedAttackCooldown": 0.8,
                            "BaselineAttackCooldown": 0.8,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "increase encounter count",
                        "action_name": "increase_encounter_count",
                        "entity_type": "encounter",
                        "probe_name": "MutateEncounterCount",
                        "wrapper_path": "Tools/run_unity_mutate_encounter_count.ps1",
                        "probe_artifact_file": "intent_increase_encounter_count_probe_result.json",
                        "probe_log_file": "intent_increase_encounter_count_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedEncounterCount": 7,
                            "BaselineEncounterCount": 5,
                            "MinEncounterCount": 3,
                            "MaxEncounterCount": 7
                        }
                    },
                    {
                        "normalized_command": "decrease encounter count",
                        "action_name": "decrease_encounter_count",
                        "entity_type": "encounter",
                        "probe_name": "MutateEncounterCount",
                        "wrapper_path": "Tools/run_unity_mutate_encounter_count.ps1",
                        "probe_artifact_file": "intent_decrease_encounter_count_probe_result.json",
                        "probe_log_file": "intent_decrease_encounter_count_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedEncounterCount": 3,
                            "BaselineEncounterCount": 5,
                            "MinEncounterCount": 3,
                            "MaxEncounterCount": 7
                        }
                    },
                    {
                        "normalized_command": "restore encounter count to standard",
                        "action_name": "set_encounter_count",
                        "entity_type": "encounter",
                        "probe_name": "MutateEncounterCount",
                        "wrapper_path": "Tools/run_unity_mutate_encounter_count.ps1",
                        "probe_artifact_file": "intent_restore_encounter_count_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_encounter_count_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedEncounterCount": 5,
                            "BaselineEncounterCount": 5,
                            "MinEncounterCount": 3,
                            "MaxEncounterCount": 7
                        }
                    },
                    {
                        "normalized_command": "increase spawn pressure",
                        "action_name": "increase_spawn_pressure",
                        "entity_type": "encounter",
                        "probe_name": "MutateSpawnPressure",
                        "wrapper_path": "Tools/run_unity_mutate_spawn_pressure.ps1",
                        "probe_artifact_file": "intent_increase_spawn_pressure_probe_result.json",
                        "probe_log_file": "intent_increase_spawn_pressure_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedSpawnInterval": 4.0,
                            "BaselineSpawnInterval": 6.0,
                            "MinSpawnInterval": 4.0,
                            "MaxSpawnInterval": 8.0
                        }
                    },
                    {
                        "normalized_command": "decrease spawn pressure",
                        "action_name": "decrease_spawn_pressure",
                        "entity_type": "encounter",
                        "probe_name": "MutateSpawnPressure",
                        "wrapper_path": "Tools/run_unity_mutate_spawn_pressure.ps1",
                        "probe_artifact_file": "intent_decrease_spawn_pressure_probe_result.json",
                        "probe_log_file": "intent_decrease_spawn_pressure_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedSpawnInterval": 8.0,
                            "BaselineSpawnInterval": 6.0,
                            "MinSpawnInterval": 4.0,
                            "MaxSpawnInterval": 8.0
                        }
                    },
                    {
                        "normalized_command": "restore spawn pressure to standard",
                        "action_name": "set_spawn_pressure",
                        "entity_type": "encounter",
                        "probe_name": "MutateSpawnPressure",
                        "wrapper_path": "Tools/run_unity_mutate_spawn_pressure.ps1",
                        "probe_artifact_file": "intent_restore_spawn_pressure_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_spawn_pressure_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedSpawnInterval": 6.0,
                            "BaselineSpawnInterval": 6.0,
                            "MinSpawnInterval": 4.0,
                            "MaxSpawnInterval": 8.0
                        }
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return str(target_repo.resolve())


def _seed_auto_promoted_reference_capability_proof(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = capabilities_dir / "evidence.json"
    evidence_path.write_text(
        json.dumps(
            {
                "capabilities": {
                    "level_0001_add_grass": {
                        "capability_id": "level_0001_add_grass",
                        "handler_name": "level_0001_grass_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 4,
                        "times_passed": 4,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "experimental",
                        "sandbox_verified": False,
                        "real_target_verified": False,
                        "rollback_verified": False,
                        "notes": "Reference capability evidence seeded for auto-promotion derivation.",
                    }
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_dir = config.runs_dir / "live_real_grass_validation_20260317"
    post_dir = run_dir / "post_mutation"
    rollback_dir = run_dir / "rollback"
    post_dir.mkdir(parents=True, exist_ok=True)
    rollback_dir.mkdir(parents=True, exist_ok=True)

    (post_dir / "real_target_validation_report.json").write_text(
        json.dumps(
            {
                "session_id": "live_real_grass_validation_20260317",
                "capability_id": "level_0001_add_grass",
                "validation_result": "passed",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (rollback_dir / "rollback_validation_report.json").write_text(
        json.dumps(
            {
                "session_id": "live_real_grass_validation_20260317",
                "capability_id": "level_0001_add_grass",
                "rollback_validation_result": "passed",
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _load_session_outputs(config: OrchestratorConfig, session_id: str) -> tuple[dict, dict, str, str]:
    session_dir = config.runs_dir / session_id
    runtime_status = json.loads((session_dir / "runtime_status.json").read_text(encoding="utf-8"))
    session_summary = json.loads((session_dir / "session_summary.json").read_text(encoding="utf-8"))
    session_summary_markdown = (session_dir / "session_summary.md").read_text(encoding="utf-8")
    operator_report = (session_dir / "operator_report.md").read_text(encoding="utf-8")
    return runtime_status, session_summary, session_summary_markdown, operator_report


def _assert_truthful_output_counts(
    output: str,
    *,
    runtime_status: dict,
    completed_count: int,
    retry_count: int,
    blocked_count: int,
) -> None:
    assert output.count("TASK STARTED task_id=") == runtime_status["tasks_executed_count"]
    assert output.count("[AI-E LOOP]") == runtime_status["loop_iterations"]
    assert output.count("TASK COMPLETED task_id=") == completed_count
    assert output.count("TASK RETRY task_id=") == retry_count
    assert output.count("TASK BLOCKED task_id=") == blocked_count


def _assert_report_contract_text(operator_report: str) -> None:
    for section in ("SUMMARY", "FACTS", "ASSUMPTIONS", "RECOMMENDATIONS", "TIMESTAMP"):
        assert section in operator_report
