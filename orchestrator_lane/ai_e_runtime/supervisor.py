from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Lock
from time import monotonic, sleep
from typing import Any, Callable, Dict

from orchestrator.config import OrchestratorConfig
from orchestrator.utils import ensure_dir, read_json_with_status

from .agent_router import AgentRouter
from .autonomous_selector import select_next_task
from .artifact_writer import ArtifactWriter
from .experiment_tracking import apply_experiment_tracking
from .heartbeat import HeartbeatEmitter
from .outcome_evaluation import apply_result_evaluation
from .progress import format_progress_line
from .runtime_state import RuntimeState, RuntimeStateSnapshot, selector_visibility_payload
from .scheduler import Scheduler
from .session_tuning import apply_session_tuning_record
from .state_store import StateStore
from .time_utils import get_current_timestamp


@dataclass(frozen=True)
class SupervisorConfig:
    session_limit_seconds: int
    heartbeat_interval_seconds: int = 300
    max_retries: int = 3
    max_task_executions: int | None = None
    repeated_failure_threshold: int = 3
    poll_interval_seconds: int = 5
    idle_timeout_seconds: int = 30
    idle_timeout_poll_limit: int = 3
    session_id: str | None = None
    resume: bool = False
    stop_when_queue_empty: bool = False


@dataclass(frozen=True)
class SupervisorRunResult:
    session_id: str
    session_dir: Path
    state_path: Path
    heartbeat_log_path: Path
    stop_reason: str
    elapsed_time_seconds: float
    tasks_attempted: int
    tasks_completed: int
    queue_remaining: int
    heartbeats_emitted: int


class Supervisor:
    """Persistent runtime loop for continuous AI-E background sessions."""

    def __init__(
        self,
        orchestrator_config: OrchestratorConfig,
        supervisor_config: SupervisorConfig,
        *,
        agent_router: AgentRouter | None = None,
        scheduler: Scheduler | None = None,
        time_source: Callable[[], datetime] | None = None,
        monotonic_source: Callable[[], float] | None = None,
        sleep_fn: Callable[[float], None] | None = None,
    ) -> None:
        self.orchestrator_config = orchestrator_config
        self.supervisor_config = supervisor_config
        self.time_source = time_source or (lambda: datetime.now(timezone.utc))
        self.monotonic_source = monotonic_source or monotonic
        self.sleep_fn = sleep_fn or sleep
        self.session_id = supervisor_config.session_id or f"session_{self._timestamp_slug()}"
        self.scheduler = scheduler or Scheduler(
            orchestrator_config.queue_path,
            max_retries=supervisor_config.max_retries,
        )
        self.state_store = StateStore(orchestrator_config.runs_dir, self.session_id)
        self.heartbeat = HeartbeatEmitter(
            orchestrator_config.root_dir / "logs" / "session_heartbeat.log",
            interval_seconds=supervisor_config.heartbeat_interval_seconds,
            time_source=self.time_source,
        )
        self.runtime_state = RuntimeState(orchestrator_config, self.session_id, scheduler=self.scheduler)
        self.agent_router = agent_router or AgentRouter()
        self.agent_router.configure_runtime_controls(
            stop_requested=self.is_stop_requested,
            stop_reason=self.get_requested_stop_reason,
        )
        self.artifact_writer = ArtifactWriter(orchestrator_config.runs_dir, self.session_id)
        self._queue_idle_announced = False
        self._idle_started_monotonic: float | None = None
        self._idle_poll_count = 0
        self._polling_enabled = True
        self._polling_pause_announced = False
        self._control_lock = Lock()
        self._stop_requested = False
        self._stop_reason_override: str | None = None

    def run(self) -> SupervisorRunResult:
        ensure_dir(self.orchestrator_config.runs_dir)
        self._status(
            f"SESSION STARTED session_id={self.session_id} session_limit_seconds={self.supervisor_config.session_limit_seconds}"
        )
        state = self.state_store.start_session(
            session_limit_seconds=self.supervisor_config.session_limit_seconds,
            heartbeat_interval_seconds=self.supervisor_config.heartbeat_interval_seconds,
            resume=self.supervisor_config.resume,
        )
        if self.supervisor_config.resume:
            state = self._record_resume_integrity_issues(state)
            recovered_task_ids = self.scheduler.recover_running_tasks(self.session_id)
            if recovered_task_ids:
                recovered_tasks = {
                    str(task.get("task_id") or task.get("id") or ""): task
                    for task in self.scheduler.all_tasks()
                }
                missing_attempt_artifact_details: list[str] = []
                for task_id in recovered_task_ids:
                    recovered_task = recovered_tasks.get(task_id)
                    if recovered_task is None:
                        continue
                    for artifact_path in self.artifact_writer.expected_attempt_artifacts(recovered_task):
                        candidate = self.state_store.session_dir / artifact_path
                        if not candidate.exists():
                            missing_attempt_artifact_details.append(f"task_id:{task_id}")
                            missing_attempt_artifact_details.append(f"artifact:{artifact_path}")
                state = self.state_store.record_integrity_issue(
                    state,
                    issue="recovered_interrupted_running_tasks",
                    recovery="Audit reclaimed running tasks before trusting resumed execution continuity or timing assumptions.",
                    details=[f"task_id:{task_id}" for task_id in recovered_task_ids],
                )
                if missing_attempt_artifact_details:
                    state = self.state_store.record_integrity_issue(
                        state,
                        issue="interrupted_task_missing_attempt_artifacts",
                        recovery="Audit interrupted task attempt artifacts before trusting resumed execution continuity or artifact completeness.",
                        details=missing_attempt_artifact_details,
                    )
        self.runtime_state.write_snapshot()

        self._reset_idle_tracking(state)

        base_elapsed_seconds = float(state.get("elapsed_time_seconds", 0.0))
        session_started_monotonic = self.monotonic_source()
        self._emit_heartbeat(state, force=True)
        stop_reason = "time_limit_reached"

        while True:
            elapsed_seconds = base_elapsed_seconds + (self.monotonic_source() - session_started_monotonic)
            if self.is_stop_requested():
                stop_reason = self.get_requested_stop_reason() or "operator_exit"
                break
            if elapsed_seconds >= self.supervisor_config.session_limit_seconds:
                stop_reason = "time_limit_reached"
                break
            if self._max_task_executions_reached(state):
                stop_reason = "max_task_executions_reached"
                break

            queue_remaining = self.scheduler.remaining_count()
            queue_issue = self.scheduler.last_load_issue()
            queue_sanitization_details = self.scheduler.last_sanitization_details()
            if queue_sanitization_details:
                state = self.state_store.record_integrity_issue(
                    state,
                    issue="queue_json_sanitized_shape",
                    recovery="Audit the queue payload and regenerate malformed task fields before relying on queue ordering semantics.",
                    details=queue_sanitization_details,
                )
            if queue_issue is not None:
                state = self.state_store.record_integrity_issue(
                    state,
                    issue=f"queue_json_{queue_issue}",
                    recovery="Restore backlog/queue.json from a known-good state before resuming autonomous execution.",
                    details=self.scheduler.last_load_issue_details(),
                )
                stop_reason = "queue_state_invalid"
                self._status(
                    f"QUEUE STATE INVALID session_id={self.session_id} issue={queue_issue}"
                )
                break
            state = self.state_store.record_loop_iteration(
                state,
                elapsed_time_seconds=elapsed_seconds,
                queue_remaining=queue_remaining,
            )
            iteration_number = int(state.get("loop_iterations", 0))

            if not self.is_polling_enabled():
                self._reset_idle_tracking(state)
                state = self._sync_control_state(state)
                state = self.state_store.update_progress(
                    state,
                    session_phase="approval_auto_decision",
                    waiting_reason="Queue polling is paused by operator command.",
                )
                state = self.state_store.update_runtime(
                    state,
                    elapsed_time_seconds=elapsed_seconds,
                    current_task=None,
                    queue_remaining=queue_remaining,
                )
                if not self._polling_pause_announced:
                    self._status(
                        f"QUEUE POLLING PAUSED session_id={self.session_id} queue_remaining={queue_remaining}"
                    )
                    self._polling_pause_announced = True
                self._emit_heartbeat(state)
                self.sleep_fn(self.supervisor_config.poll_interval_seconds)
                continue

            self._polling_pause_announced = False

            all_tasks = self.scheduler.all_tasks()
            selection = select_next_task(
                all_tasks,
                self.runtime_state.get_snapshot().to_payload(),
                root_dir=self.orchestrator_config.root_dir,
            )
            selection_payload = selection.to_payload()
            should_persist_selection = (
                selection.selected_task_id is not None
                or queue_remaining > 0
                or not state.get("last_selected_task_id")
            )
            if should_persist_selection:
                state = self.state_store.record_selection(state, selection_payload=selection_payload)
                self.runtime_state.write_snapshot()
            self._emit_selection_visibility(selection)
            next_task = None
            if selection.selected_task_id is not None:
                next_task = next(
                    (task for task in all_tasks if str(task.get("task_id") or task.get("id") or "") == selection.selected_task_id),
                    None,
                )
            if next_task is None:
                if selection.selected_task_id is None and selection.top_candidates == [] and selection.excluded_tasks:
                    self._status(
                        "AUTONOMOUS SELECTOR no_valid_task "
                        f"evaluated={selection.evaluated_count} excluded={len(selection.excluded_tasks)}"
                    )
                awaiting_approval = any(
                    str(task.get("status", "pending")).lower() == "needs_approval"
                    for task in self.scheduler.all_tasks()
                )
                waiting_reason = "Waiting for operator approval." if awaiting_approval else (
                    selection.reason if queue_remaining > 0 else "Waiting for new task intake."
                )
                state = self.state_store.update_progress(
                    state,
                    session_phase="approval_auto_decision" if awaiting_approval else "intake",
                    waiting_reason=waiting_reason,
                )
                state = self._record_idle_runtime(
                    state,
                    elapsed_time_seconds=elapsed_seconds,
                    queue_remaining=queue_remaining,
                )
                loop_result = "waiting_for_approval" if awaiting_approval else "no_runnable_task"
                if self._all_remaining_tasks_blocked(all_tasks, selection):
                    loop_result = "all_remaining_tasks_blocked"
                if not self._queue_idle_announced:
                    status_text = "QUEUE WAITING FOR APPROVAL" if awaiting_approval else "QUEUE EMPTY / WAITING FOR TASKS"
                    self._status(f"{status_text} session_id={self.session_id} queue_remaining={queue_remaining}")
                    self._queue_idle_announced = True
                self._emit_loop_visibility(
                    iteration=iteration_number,
                    selected_task_id=selection.selected_task_id,
                    result=loop_result,
                )
                self._emit_heartbeat(state)
                if self._all_remaining_tasks_blocked(all_tasks, selection):
                    stop_reason = "all_remaining_tasks_blocked"
                    break
                if self.supervisor_config.stop_when_queue_empty and queue_remaining == 0:
                    stop_reason = "queue_empty"
                    break
                if self._should_terminate_for_idle(queue_remaining=queue_remaining):
                    stop_reason = "queue_empty_idle_timeout"
                    self._status(
                        "QUEUE EMPTY IDLE TIMEOUT "
                        f"session_id={self.session_id} queue_remaining={queue_remaining} "
                        f"idle_seconds={round(float(state.get('idle_duration_seconds', 0.0)), 3)} "
                        f"idle_polls={int(state.get('idle_poll_count', 0))}"
                    )
                    break
                self.sleep_fn(self.supervisor_config.poll_interval_seconds)
                continue

            selection_artifact_paths = self.artifact_writer.write_autonomous_selection(selection)
            state_artifacts = list(state.get("artifacts_generated", []))
            state_artifacts.extend(selection_artifact_paths)
            state["artifacts_generated"] = state_artifacts
            self.state_store.save(state)
            top_candidates_summary = ", ".join(
                f"{candidate.task_id}={candidate.total_score}" for candidate in selection.top_candidates[:3]
            ) or "none"
            self._status(
                "AUTONOMOUS SELECTOR "
                f"selected_task_id={selection.selected_task_id} "
                f"score={selection.selected_task_score.total_score if selection.selected_task_score else 'none'} "
                f"top_candidates={top_candidates_summary} "
                f"excluded={len(selection.excluded_tasks)}"
            )
            task_id = str(next_task.get("task_id") or next_task.get("id"))
            if self._queue_idle_announced:
                self._queue_idle_announced = False
            self._reset_idle_tracking(state)
            self._status(f"TASK ACCEPTED task_id={task_id} status={next_task.get('status', 'pending')}")
            payload_path = self._resolve_task_payload_path(next_task)
            if payload_path is None or not payload_path.exists():
                reason = "Task missing contract or payload file; activation denied."
                self.scheduler.mark_blocked(task_id, session_id=self.session_id, reason=reason, result={"status": "blocked"})
                state = self.state_store.update_runtime(
                    state,
                    elapsed_time_seconds=elapsed_seconds,
                    current_task=task_id,
                    queue_remaining=self.scheduler.remaining_count(),
                )
                state = self.state_store.record_task_result(
                    state,
                    task_id=task_id,
                    final_status="blocked",
                    artifact_paths=[],
                    note=reason,
                )
                self.runtime_state.write_snapshot()
                self._status(f"TASK BLOCKED task_id={task_id} reason={reason}")
                self._emit_loop_visibility(iteration=iteration_number, selected_task_id=task_id, result="blocked")
                self._emit_heartbeat(state)
                if self._repeated_failure_threshold_exceeded(state):
                    stop_reason = "repeated_failure_threshold_exceeded"
                    break
                continue

            next_task = self._merge_task_payload(next_task, payload_path)
            next_task["autonomous_selection"] = selection_payload
            running_task = self.scheduler.mark_running(task_id, session_id=self.session_id)
            running_task = self._merge_task_payload(running_task, payload_path)
            running_task["autonomous_selection"] = selection_payload
            state = self._sync_control_state(state)
            state = self.state_store.update_progress(state, session_phase="execution")
            self._status(self._progress_status_line(state, task_id=task_id))
            state = self.state_store.record_task_started(
                state,
                elapsed_time_seconds=elapsed_seconds,
                queue_remaining=queue_remaining,
                task_id=task_id,
                plan_id=running_task.get("plan_id"),
                plan_step_title=running_task.get("plan_step_title") or running_task.get("title"),
            )
            self.runtime_state.write_snapshot()

            self._status(f"TASK STARTED task_id={task_id} agent_type={running_task.get('agent_type', 'copilot_coder_agent')}")

            result = self.agent_router.run(running_task)
            if self.is_stop_requested():
                stop_reason = self.get_requested_stop_reason() or "operator_interrupt"
                state = self._sync_control_state(state)
                state = self.state_store.update_runtime(
                    state,
                    elapsed_time_seconds=base_elapsed_seconds + (self.monotonic_source() - session_started_monotonic),
                    current_task=task_id,
                    queue_remaining=self.scheduler.remaining_count(),
                )
                self.runtime_state.write_snapshot()
                self._status(f"TASK INTERRUPTED task_id={task_id} reason={stop_reason}")
                self._emit_loop_visibility(
                    iteration=iteration_number,
                    selected_task_id=task_id,
                    result=stop_reason,
                )
                self._emit_heartbeat(state)
                break
            state = self.state_store.update_progress(state, session_phase="validation")
            self._status(self._progress_status_line(state, task_id=task_id))
            validation = self.agent_router.validate(result, task=running_task)
            artifact_paths = self.artifact_writer.store(task=running_task, result=result, validation=validation)
            state = self.state_store.update_progress(state, session_phase="rollback_finalization")
            self._status(self._progress_status_line(state, task_id=task_id))

            queue_action = validation.get("queue_action", "complete")
            note = str(validation.get("note") or result.get("summary") or "Supervisor processed task.")
            if queue_action == "complete":
                self.scheduler.mark_completed(task_id, session_id=self.session_id, result=result)
                final_status = "completed"
            elif queue_action == "retry":
                _, should_retry = self.scheduler.requeue_failed(
                    task_id,
                    session_id=self.session_id,
                    reason=note,
                    result=result,
                )
                final_status = "retry_scheduled" if should_retry else "blocked"
            else:
                self.scheduler.mark_blocked(task_id, session_id=self.session_id, reason=note, result=result)
                final_status = "blocked"

            if final_status == "completed":
                state = self.state_store.update_progress(state, session_phase="complete")
            else:
                state = self.state_store.update_progress(
                    state,
                    session_phase="validation",
                    blocked_reason=note,
                )
            self._status(self._progress_status_line(state, task_id=task_id))

            state = self._sync_control_state(state)
            state = self.state_store.update_runtime(
                state,
                elapsed_time_seconds=base_elapsed_seconds + (self.monotonic_source() - session_started_monotonic),
                current_task=None,
                queue_remaining=self.scheduler.remaining_count(),
            )
            state = self._record_session_tuning(
                state,
                task=running_task,
                result=result,
                final_status=final_status,
            )

            state = self.state_store.record_task_result(
                state,
                task_id=task_id,
                final_status=final_status,
                artifact_paths=artifact_paths,
                note=note,
            )
            self.runtime_state.write_snapshot()
            terminal_status = "TASK RETRY" if final_status == "retry_scheduled" else f"TASK {final_status.upper()}"
            self._status(f"{terminal_status} task_id={task_id} note={note}")
            self._emit_loop_visibility(
                iteration=iteration_number,
                selected_task_id=task_id,
                result="success" if final_status == "completed" else final_status,
            )
            self._emit_heartbeat(state)
            if self._repeated_failure_threshold_exceeded(state):
                stop_reason = "repeated_failure_threshold_exceeded"
                break

        final_elapsed_seconds = base_elapsed_seconds + (self.monotonic_source() - session_started_monotonic)
        final_queue_remaining = self.scheduler.remaining_count()
        state = self._sync_control_state(state)
        state = self.state_store.finalize(
            state,
            stop_reason=stop_reason,
            elapsed_time_seconds=final_elapsed_seconds,
            queue_remaining=final_queue_remaining,
        )
        self.runtime_state.write_snapshot()
        final_snapshot = self.runtime_state.get_snapshot()
        self._emit_heartbeat(state, force=True)
        summary_artifacts = self.artifact_writer.write_session_summary(
            {
                "session_id": self.session_id,
                "stop_reason": stop_reason,
                "elapsed_time_seconds": round(final_elapsed_seconds, 3),
                "tasks_attempted": len(state.get("tasks_attempted", [])),
                "tasks_completed": len(state.get("tasks_completed", [])),
                "tasks_blocked": len(state.get("blockers_detected", [])),
                "queue_remaining": final_queue_remaining,
                "heartbeats_emitted": state.get("heartbeats_emitted", 0),
                "integrity_issues": list(state.get("integrity_issues", [])),
                "loop_visibility": {
                    "loop_iterations": int(state.get("loop_iterations", 0)),
                    "tasks_executed_count": int(state.get("tasks_executed_count", 0)),
                    "last_task_result_status": state.get("last_task_result_status"),
                    "failure_streak_count": int(state.get("failure_streak_count", 0)),
                },
                "selector_visibility": selector_visibility_payload(final_snapshot),
            }
        )
        state_artifacts = list(state.get("artifacts_generated", []))
        state_artifacts.extend(summary_artifacts)
        state["artifacts_generated"] = state_artifacts
        self.state_store.save(state)
        self._status(
            f"SESSION STOPPED session_id={self.session_id} stop_reason={stop_reason} queue_remaining={final_queue_remaining}"
        )

        return SupervisorRunResult(
            session_id=self.session_id,
            session_dir=self.state_store.session_dir,
            state_path=self.state_store.state_path,
            heartbeat_log_path=self.heartbeat.log_path,
            stop_reason=stop_reason,
            elapsed_time_seconds=round(final_elapsed_seconds, 3),
            tasks_attempted=len(state.get("tasks_attempted", [])),
            tasks_completed=len(state.get("tasks_completed", [])),
            queue_remaining=final_queue_remaining,
            heartbeats_emitted=int(state.get("heartbeats_emitted", 0)),
        )

    def get_runtime_state(self) -> RuntimeStateSnapshot:
        return self.runtime_state.get_snapshot()

    def pause_polling(self) -> bool:
        with self._control_lock:
            changed = self._polling_enabled
            self._polling_enabled = False
            state = self.state_store.load()
            self.state_store.set_polling_enabled(state, False)
            self.runtime_state.write_snapshot()
            return changed

    def resume_polling(self) -> bool:
        with self._control_lock:
            changed = not self._polling_enabled
            self._polling_enabled = True
            state = self.state_store.load()
            self.state_store.set_polling_enabled(state, True)
            self.runtime_state.write_snapshot()
            return changed

    def is_polling_enabled(self) -> bool:
        with self._control_lock:
            return self._polling_enabled

    def request_stop(self, reason: str = "operator_exit") -> None:
        with self._control_lock:
            self._stop_requested = True
            self._stop_reason_override = reason

    def is_stop_requested(self) -> bool:
        with self._control_lock:
            return self._stop_requested

    def get_requested_stop_reason(self) -> str | None:
        with self._control_lock:
            return self._stop_reason_override

    def _emit_heartbeat(self, state: Dict[str, Any], *, force: bool = False) -> None:
        state = self._sync_control_state(state)
        snapshot = self.runtime_state.get_snapshot()
        payload = self.heartbeat.emit(
            session_elapsed_time=float(state.get("elapsed_time_seconds", 0.0)),
            current_task=snapshot.current_task_id,
            queue_remaining=int(snapshot.queue_remaining),
            session_id=self.session_id,
            force=force,
        )
        if payload is not None:
            self.runtime_state.write_snapshot()
            self._status(
                f"SESSION HEARTBEAT session_id={self.session_id} elapsed={round(float(state.get('elapsed_time_seconds', 0.0)), 3)} current_task={snapshot.current_task_id or 'idle'} queue_remaining={int(snapshot.queue_remaining)}"
            )
            self.state_store.record_heartbeat(state)
            self.runtime_state.write_snapshot()

    def _sync_control_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        state["polling_enabled"] = self.is_polling_enabled()
        state.setdefault("idle_timeout_seconds", int(self.supervisor_config.idle_timeout_seconds))
        state.setdefault("idle_timeout_poll_limit", int(self.supervisor_config.idle_timeout_poll_limit))
        return state

    def _record_idle_runtime(
        self,
        state: Dict[str, Any],
        *,
        elapsed_time_seconds: float,
        queue_remaining: int,
    ) -> Dict[str, Any]:
        if self._idle_started_monotonic is None:
            self._idle_started_monotonic = self.monotonic_source()
        self._idle_poll_count += 1
        state = self._sync_control_state(state)
        state["idle_poll_count"] = self._idle_poll_count
        state["idle_duration_seconds"] = round(self.monotonic_source() - self._idle_started_monotonic, 3)
        state["idle_timeout_seconds"] = int(self.supervisor_config.idle_timeout_seconds)
        state["idle_timeout_poll_limit"] = int(self.supervisor_config.idle_timeout_poll_limit)
        return self.state_store.update_runtime(
            state,
            elapsed_time_seconds=elapsed_time_seconds,
            current_task=None,
            queue_remaining=queue_remaining,
        )

    def _reset_idle_tracking(self, state: Dict[str, Any]) -> Dict[str, Any]:
        self._idle_started_monotonic = None
        self._idle_poll_count = 0
        state["idle_poll_count"] = 0
        state["idle_duration_seconds"] = 0.0
        state["idle_timeout_seconds"] = int(self.supervisor_config.idle_timeout_seconds)
        state["idle_timeout_poll_limit"] = int(self.supervisor_config.idle_timeout_poll_limit)
        return state

    def _should_terminate_for_idle(self, *, queue_remaining: int) -> bool:
        if queue_remaining != 0:
            return False
        timeout_seconds = int(self.supervisor_config.idle_timeout_seconds)
        poll_limit = int(self.supervisor_config.idle_timeout_poll_limit)
        idle_duration = 0.0
        if self._idle_started_monotonic is not None:
            idle_duration = self.monotonic_source() - self._idle_started_monotonic
        timeout_reached = timeout_seconds > 0 and idle_duration >= float(timeout_seconds)
        poll_limit_reached = poll_limit > 0 and self._idle_poll_count >= poll_limit
        return timeout_reached or poll_limit_reached

    def _timestamp_slug(self) -> str:
        return self.time_source().strftime("%Y%m%d_%H%M%S")

    def _resolve_task_payload_path(self, task: Dict[str, Any]) -> Path | None:
        for key in ("contract_path", "payload_path", "request_payload_path"):
            value = task.get(key)
            if not value:
                continue
            candidate = Path(str(value))
            if not candidate.is_absolute():
                candidate = (self.orchestrator_config.root_dir / candidate).resolve()
            return candidate
        return None

    def _merge_task_payload(self, task: Dict[str, Any], payload_path: Path) -> Dict[str, Any]:
        merged = dict(task)
        if payload_path.suffix.lower() != ".json":
            return merged
        try:
            raw = json.loads(payload_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return merged
        payload = raw.get("runtime_task") if isinstance(raw, dict) else None
        if not isinstance(payload, dict):
            return merged
        for key, value in payload.items():
            merged.setdefault(key, value)
        return merged

    def _status(self, message: str) -> None:
        print(f"[{get_current_timestamp(self.time_source())}] {message}")

    def _status_block(self, header: str, lines: list[str]) -> None:
        print(f"[{get_current_timestamp(self.time_source())}] {header}")
        for line in lines:
            print(line)

    def _emit_loop_visibility(self, *, iteration: int, selected_task_id: str | None, result: str) -> None:
        lines = [
            f"Iteration: {iteration}",
            f"Selected: {selected_task_id or 'none'}",
            f"Result: {result}",
        ]
        self._status_block("[AI-E LOOP]", lines)

    def _record_resume_integrity_issues(self, state: Dict[str, Any]) -> Dict[str, Any]:
        session_summary_path = self.state_store.session_dir / "session_summary.json"
        operator_report_path = self.state_store.session_dir / "operator_report.md"
        summary_markdown_path = self.state_store.session_dir / "session_summary.md"
        summary_exists = session_summary_path.exists()
        if summary_exists:
            _, issue = read_json_with_status(session_summary_path, default={})
            if issue is not None:
                state = self.state_store.record_integrity_issue(
                    state,
                    issue=f"session_summary_json_{issue}",
                    recovery="Regenerate session summary artifacts before trusting prior closeout data.",
                )
        if summary_exists and not operator_report_path.exists():
            state = self.state_store.record_integrity_issue(
                state,
                issue="missing_operator_report_md",
                recovery="Regenerate the operator report so the prior session closeout remains auditable.",
            )
        if summary_exists and not summary_markdown_path.exists():
            state = self.state_store.record_integrity_issue(
                state,
                issue="missing_session_summary_md",
                recovery="Regenerate the markdown session summary so prior session state is visible to operators.",
            )
        for artifact in state.get("artifacts_generated", []):
            candidate = self.state_store.session_dir / str(artifact)
            if not candidate.exists():
                state = self.state_store.record_integrity_issue(
                    state,
                    issue=f"missing_artifact::{str(artifact)}",
                    recovery="Rebuild missing artifacts or audit the interrupted session before trusting completion history.",
                )
        return state

    def _emit_selection_visibility(self, selection: Any) -> None:
        selected_line = "Selected: none"
        if selection.selected_task_score is not None:
            selected_line = (
                f"Selected: {selection.selected_task_id} "
                f"(score={selection.selected_task_score.total_score})"
            )
        lines = [selected_line, "", "Top Candidates:"]
        if selection.top_candidates:
            for index, candidate in enumerate(selection.top_candidates[:3], start=1):
                lines.append(f"{index}. {candidate.task_id} ({candidate.total_score})")
        else:
            lines.append("none")
        lines.extend(["", "Reason:", selection.reason, "", "Excluded:"])
        if selection.excluded_tasks:
            for entry in selection.excluded_tasks[:5]:
                lines.append(f"{entry.task_id} -> {entry.reason}")
        else:
            lines.append("none")
        self._status_block("[AI-E SELECTOR]", lines)

    def _progress_status_line(self, state: Dict[str, Any], *, task_id: str | None = None) -> str:
        prefix = "PROGRESS"
        if task_id:
            prefix = f"PROGRESS task_id={task_id}"
        return f"{prefix} {format_progress_line(state)}"

    def _max_task_executions_reached(self, state: Dict[str, Any]) -> bool:
        limit = self.supervisor_config.max_task_executions
        if limit is None or int(limit) <= 0:
            return False
        return int(state.get("tasks_executed_count", 0)) >= int(limit)

    def _repeated_failure_threshold_exceeded(self, state: Dict[str, Any]) -> bool:
        threshold = int(self.supervisor_config.repeated_failure_threshold)
        if threshold <= 0:
            return False
        return int(state.get("failure_streak_count", 0)) >= threshold

    def _all_remaining_tasks_blocked(self, all_tasks: list[Dict[str, Any]], selection: Any) -> bool:
        remaining_tasks = [
            task for task in all_tasks if str(task.get("status", "pending")).lower() not in {"completed", "blocked"}
        ]
        if not remaining_tasks:
            return False
        if selection.selected_task_id is not None or selection.top_candidates:
            return False
        remaining_task_ids = {
            str(task.get("task_id") or task.get("id") or "")
            for task in remaining_tasks
            if str(task.get("task_id") or task.get("id") or "")
        }
        if any(
            entry.task_id in remaining_task_ids and entry.reason == "awaiting_approval"
            for entry in selection.excluded_tasks
        ):
            return False
        if any(str(task.get("status", "pending")).lower() == "needs_approval" for task in remaining_tasks):
            return False
        if any(str(task.get("status", "pending")).lower() == "running" for task in remaining_tasks):
            return False
        return all(str(task.get("status", "pending")).lower() == "pending" for task in remaining_tasks)

    def _record_session_tuning(
        self,
        state: Dict[str, Any],
        *,
        task: Dict[str, Any],
        result: Dict[str, Any],
        final_status: str,
    ) -> Dict[str, Any]:
        if str(final_status or "").strip().lower() != "completed":
            return state
        details = result.get("details")
        if not isinstance(details, dict):
            return state

        timestamp = str(details.get("timestamp") or get_current_timestamp(self.time_source()))
        state = apply_session_tuning_record(
            state,
            task=task,
            details=details,
            timestamp=timestamp,
        )
        state = apply_experiment_tracking(
            state,
            task=task,
            details=details,
            timestamp=timestamp,
        )
        state = apply_result_evaluation(
            state,
            task=task,
            timestamp=timestamp,
        )

        session_context_id = str(task.get("session_context_id") or "").strip()
        if session_context_id and session_context_id != self.session_id:
            context_store = StateStore(self.orchestrator_config.runs_dir, session_context_id)
            context_state = context_store.load()
            context_state = apply_session_tuning_record(
                context_state,
                task=task,
                details=details,
                timestamp=timestamp,
            )
            context_state = apply_experiment_tracking(
                context_state,
                task=task,
                details=details,
                timestamp=timestamp,
            )
            context_state = apply_result_evaluation(
                context_state,
                task=task,
                timestamp=timestamp,
            )
            context_store.save(context_state)
        return state
