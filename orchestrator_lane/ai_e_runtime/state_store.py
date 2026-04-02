from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from .progress import phase_payload
from .time_utils import get_current_timestamp
from orchestrator.utils import ensure_dir, read_json, read_json_with_status_details, write_json


class StateStore:
    """Persists long-running supervisor session state under runs/<session_id>."""

    def __init__(self, runs_dir: Path, session_id: str) -> None:
        self.runs_dir = Path(runs_dir)
        self.session_id = session_id
        self.session_dir = ensure_dir(self.runs_dir / session_id)
        self.state_path = self.session_dir / "session_state.json"
        self._last_load_issue_details: List[str] = []

    def start_session(
        self,
        *,
        session_limit_seconds: int,
        heartbeat_interval_seconds: int,
        resume: bool,
    ) -> Dict[str, Any]:
        if resume and self.state_path.exists():
            state, issue = self.load_with_status()
            state["status"] = "running"
            state["resumed"] = True
            if issue is not None:
                self.record_integrity_issue(
                    state,
                    issue=f"session_state_{issue}",
                    recovery="Rebuild or restore the session state before trusting resumed lifecycle data.",
                    details=self.last_load_issue_details(),
                )
            state["updated_at"] = self._iso_now()
            self.save(state)
            return state

        state = {
            "session_id": self.session_id,
            "status": "running",
            "resumed": False,
            "session_limit_seconds": int(session_limit_seconds),
            "heartbeat_interval_seconds": int(heartbeat_interval_seconds),
            "started_at": self._iso_now(),
            "updated_at": self._iso_now(),
            "finished_at": None,
            "elapsed_time_seconds": 0.0,
            "current_task": None,
            "last_started_task": None,
            "last_completed_task": None,
            "last_task_result_status": None,
            "loop_iterations": 0,
            "tasks_executed_count": 0,
            "failure_streak_count": 0,
            "integrity_issues": [],
            "heartbeats_emitted": 0,
            "queue_remaining": 0,
            "tasks_attempted": [],
            "tasks_completed": [],
            "tasks_failed": [],
            "artifacts_generated": [],
            "blockers_detected": [],
            "last_heartbeat_timestamp": None,
            "stop_reason": None,
            "polling_enabled": True,
            "idle_poll_count": 0,
            "idle_duration_seconds": 0.0,
            "idle_timeout_seconds": 0,
            "idle_timeout_poll_limit": 0,
            "current_plan_id": None,
            "current_plan_step": None,
            "last_generated_plan_summary": None,
            "last_generated_plan_steps": [],
            "last_selected_task_id": None,
            "last_selection_score": None,
            "last_selection_reason": None,
            "top_candidates": [],
            "excluded_tasks": [],
            "selection_timestamp": None,
            "session_tuning_history": [],
            "session_tuning_state": {},
            "experiment_tracking": {},
            "latest_experiment_variant": {},
            "result_state_history": [],
            "result_evaluation_history": [],
            "latest_result_evaluation": {},
        }
        state.update(phase_payload("intake", waiting_reason="Waiting for new task intake."))
        self.save(state)
        return state

    def load(self) -> Dict[str, Any]:
        state, _ = self.load_with_status()
        return state

    def load_with_status(self) -> tuple[Dict[str, Any], str | None]:
        raw_state, issue, read_details = read_json_with_status_details(self.state_path, default={})
        state, issue, issue_details = self._normalize_loaded_state(raw_state, issue)
        self._last_load_issue_details = sorted(dict.fromkeys([*read_details, *issue_details]))
        state.setdefault("session_id", self.session_id)
        state.setdefault("tasks_attempted", [])
        state.setdefault("tasks_completed", [])
        state.setdefault("tasks_failed", [])
        state.setdefault("artifacts_generated", [])
        state.setdefault("blockers_detected", [])
        state.setdefault("elapsed_time_seconds", 0.0)
        state.setdefault("heartbeats_emitted", 0)
        state.setdefault("loop_iterations", 0)
        state.setdefault("tasks_executed_count", 0)
        state.setdefault("last_task_result_status", None)
        state.setdefault("failure_streak_count", 0)
        state.setdefault("integrity_issues", [])
        state.setdefault("queue_remaining", 0)
        state.setdefault("last_heartbeat_timestamp", None)
        state.setdefault("current_task", None)
        state.setdefault("last_started_task", None)
        state.setdefault("last_completed_task", None)
        state.setdefault("polling_enabled", True)
        state.setdefault("idle_poll_count", 0)
        state.setdefault("idle_duration_seconds", 0.0)
        state.setdefault("idle_timeout_seconds", 0)
        state.setdefault("idle_timeout_poll_limit", 0)
        state.setdefault("current_plan_id", None)
        state.setdefault("current_plan_step", None)
        state.setdefault("last_generated_plan_summary", None)
        state.setdefault("last_generated_plan_steps", [])
        state.setdefault("last_selected_task_id", None)
        state.setdefault("last_selection_score", None)
        state.setdefault("last_selection_reason", None)
        state.setdefault("top_candidates", [])
        state.setdefault("excluded_tasks", [])
        state.setdefault("selection_timestamp", None)
        state.setdefault("session_tuning_history", [])
        state.setdefault("session_tuning_state", {})
        state.setdefault("experiment_tracking", {})
        state.setdefault("latest_experiment_variant", {})
        state.setdefault("result_state_history", [])
        state.setdefault("result_evaluation_history", [])
        state.setdefault("latest_result_evaluation", {})
        state.setdefault("session_phase", "intake")
        state.setdefault("phase_index", 1)
        state.setdefault("phase_total", 7)
        state.setdefault("phase_label", "Intake")
        state.setdefault("progress_mode", "phase_based")
        state.setdefault("progress_percent", None)
        state.setdefault("waiting_reason", "Waiting for new task intake.")
        state.setdefault("blocked_reason", None)
        state.setdefault("timestamp", state.get("updated_at") or state.get("started_at"))
        return state, issue

    def last_load_issue_details(self) -> List[str]:
        return list(self._last_load_issue_details)

    def save(self, state: Dict[str, Any]) -> None:
        if self.state_path.exists():
            persisted = read_json(self.state_path, default={})
            if not isinstance(persisted, dict):
                persisted = {}
            if persisted.get("current_plan_id") and not state.get("current_plan_id"):
                state["current_plan_id"] = persisted.get("current_plan_id")
            if persisted.get("last_generated_plan_summary") and not state.get("last_generated_plan_summary"):
                state["last_generated_plan_summary"] = persisted.get("last_generated_plan_summary")
            if persisted.get("last_generated_plan_steps") and not state.get("last_generated_plan_steps"):
                state["last_generated_plan_steps"] = list(persisted.get("last_generated_plan_steps", []))
        state["updated_at"] = self._iso_now()
        state["timestamp"] = state["updated_at"]
        write_json(self.state_path, state)

    def update_runtime(
        self,
        state: Dict[str, Any],
        *,
        elapsed_time_seconds: float,
        current_task: str | None,
        queue_remaining: int,
    ) -> Dict[str, Any]:
        state["elapsed_time_seconds"] = round(float(elapsed_time_seconds), 3)
        state["current_task"] = current_task
        state["queue_remaining"] = int(queue_remaining)
        self.save(state)
        return state

    def record_loop_iteration(
        self,
        state: Dict[str, Any],
        *,
        elapsed_time_seconds: float,
        queue_remaining: int,
    ) -> Dict[str, Any]:
        state["elapsed_time_seconds"] = round(float(elapsed_time_seconds), 3)
        state["queue_remaining"] = int(queue_remaining)
        state["loop_iterations"] = int(state.get("loop_iterations", 0)) + 1
        self.save(state)
        return state

    def record_task_started(
        self,
        state: Dict[str, Any],
        *,
        task_id: str,
        elapsed_time_seconds: float,
        queue_remaining: int,
        plan_id: str | None = None,
        plan_step_title: str | None = None,
    ) -> Dict[str, Any]:
        state["elapsed_time_seconds"] = round(float(elapsed_time_seconds), 3)
        state["current_task"] = task_id
        state["last_started_task"] = task_id
        state["queue_remaining"] = int(queue_remaining)
        if plan_id is not None:
            state["current_plan_id"] = plan_id
        state["current_plan_step"] = plan_step_title
        state["tasks_executed_count"] = int(state.get("tasks_executed_count", 0)) + 1
        self.save(state)
        return state

    def record_task_result(
        self,
        state: Dict[str, Any],
        *,
        task_id: str,
        final_status: str,
        artifact_paths: List[str],
        note: str,
    ) -> Dict[str, Any]:
        attempted = list(state.get("tasks_attempted", []))
        attempted.append(
            {
                "task_id": task_id,
                "final_status": final_status,
                "note": note,
                "timestamp": self._iso_now(),
            }
        )
        state["tasks_attempted"] = attempted
        state["current_task"] = None
        state["current_plan_step"] = None
        state["last_task_result_status"] = final_status

        if final_status == "completed":
            completed = list(state.get("tasks_completed", []))
            if task_id not in completed:
                completed.append(task_id)
            state["tasks_completed"] = completed
            state["last_completed_task"] = task_id
            state["failure_streak_count"] = 0
        elif final_status == "blocked":
            blockers = list(state.get("blockers_detected", []))
            failure_record = {"task_id": task_id, "note": note, "timestamp": self._iso_now()}
            blockers.append(failure_record)
            state["blockers_detected"] = blockers
            failed = list(state.get("tasks_failed", []))
            failed.append(failure_record)
            state["tasks_failed"] = failed
            state["failure_streak_count"] = int(state.get("failure_streak_count", 0)) + 1
        elif final_status == "retry_scheduled":
            failure_record = {"task_id": task_id, "note": note, "timestamp": self._iso_now()}
            failed = list(state.get("tasks_failed", []))
            failed.append(failure_record)
            state["tasks_failed"] = failed
            state["failure_streak_count"] = int(state.get("failure_streak_count", 0)) + 1
        else:
            state["failure_streak_count"] = int(state.get("failure_streak_count", 0))

        artifacts = list(state.get("artifacts_generated", []))
        artifacts.extend(artifact_paths)
        state["artifacts_generated"] = artifacts
        self.save(state)
        return state

    def record_heartbeat(self, state: Dict[str, Any]) -> Dict[str, Any]:
        state["heartbeats_emitted"] = int(state.get("heartbeats_emitted", 0)) + 1
        state["last_heartbeat_timestamp"] = self._iso_now()
        self.save(state)
        return state

    def set_polling_enabled(self, state: Dict[str, Any], enabled: bool) -> Dict[str, Any]:
        state["polling_enabled"] = bool(enabled)
        self.save(state)
        return state

    def register_generated_plan(
        self,
        state: Dict[str, Any],
        *,
        plan_id: str,
        plan_summary: str,
        plan_steps: List[str],
    ) -> Dict[str, Any]:
        state["current_plan_id"] = plan_id
        state["current_plan_step"] = None
        state["last_generated_plan_summary"] = plan_summary
        state["last_generated_plan_steps"] = list(plan_steps)
        self.save(state)
        return state

    def record_integrity_issue(
        self,
        state: Dict[str, Any],
        *,
        issue: str,
        recovery: str | None = None,
        details: List[str] | None = None,
    ) -> Dict[str, Any]:
        issues = list(state.get("integrity_issues", []))
        payload = {"issue": str(issue), "timestamp": self._iso_now()}
        if recovery:
            payload["recovery"] = str(recovery)
        normalized_details = [str(item) for item in (details or []) if str(item).strip()]
        if normalized_details:
            payload["details"] = sorted(dict.fromkeys(normalized_details))
        existing_entry = next(
            (existing for existing in issues if isinstance(existing, dict) and existing.get("issue") == payload["issue"]),
            None,
        )
        if existing_entry is None:
            issues.append(payload)
        else:
            existing_details = [str(item) for item in existing_entry.get("details", []) if str(item).strip()]
            merged_details = sorted(dict.fromkeys(existing_details + normalized_details))
            if merged_details:
                existing_entry["details"] = merged_details
            if recovery and not existing_entry.get("recovery"):
                existing_entry["recovery"] = str(recovery)
        state["integrity_issues"] = issues
        self.save(state)
        return state

    def record_selection(self, state: Dict[str, Any], *, selection_payload: Dict[str, Any]) -> Dict[str, Any]:
        if selection_payload.get("selected_task_id") is not None:
            state["last_selected_task_id"] = selection_payload.get("selected_task_id")
            state["last_selection_score"] = selection_payload.get("score")
            state["last_selection_reason"] = selection_payload.get("reason")
        state["top_candidates"] = list(selection_payload.get("top_candidates", []))
        state["excluded_tasks"] = list(selection_payload.get("excluded_tasks", []))
        state["selection_timestamp"] = selection_payload.get("timestamp") or self._iso_now()
        self.save(state)
        return state

    def finalize(
        self,
        state: Dict[str, Any],
        *,
        stop_reason: str,
        elapsed_time_seconds: float,
        queue_remaining: int,
    ) -> Dict[str, Any]:
        state["status"] = "completed"
        state["stop_reason"] = stop_reason
        state["finished_at"] = self._iso_now()
        state["elapsed_time_seconds"] = round(float(elapsed_time_seconds), 3)
        state["queue_remaining"] = int(queue_remaining)
        state["current_task"] = None
        state["current_plan_step"] = None
        state.update(phase_payload("complete"))
        self.save(state)
        return state

    def update_progress(
        self,
        state: Dict[str, Any],
        *,
        session_phase: str,
        waiting_reason: str | None = None,
        blocked_reason: str | None = None,
        progress_percent: int | None = None,
    ) -> Dict[str, Any]:
        state.update(
            phase_payload(
                session_phase,
                waiting_reason=waiting_reason,
                blocked_reason=blocked_reason,
                progress_percent=progress_percent,
            )
        )
        self.save(state)
        return state

    def _iso_now(self) -> str:
        return get_current_timestamp()

    def _normalize_loaded_state(
        self,
        raw_state: Any,
        issue: str | None,
    ) -> tuple[Dict[str, Any], str | None, List[str]]:
        issue_details: List[str] = []
        if not isinstance(raw_state, dict):
            issue_details.append("root_not_object")
            return {}, issue or "invalid_shape", issue_details

        state = dict(raw_state)
        normalized_issue = issue

        def mark_invalid(detail: str) -> None:
            if detail not in issue_details:
                issue_details.append(detail)

        int_defaults = {
            "heartbeats_emitted": 0,
            "loop_iterations": 0,
            "tasks_executed_count": 0,
            "failure_streak_count": 0,
            "queue_remaining": 0,
            "idle_poll_count": 0,
            "idle_timeout_seconds": 0,
            "idle_timeout_poll_limit": 0,
            "phase_index": 1,
            "phase_total": 7,
        }
        for field, default in int_defaults.items():
            normalized_value, value_issue = self._coerce_int(state.get(field), default=default)
            if value_issue:
                normalized_issue = normalized_issue or "invalid_shape"
                mark_invalid(field)
            state[field] = normalized_value

        float_defaults = {
            "elapsed_time_seconds": 0.0,
            "idle_duration_seconds": 0.0,
        }
        for field, default in float_defaults.items():
            normalized_value, value_issue = self._coerce_float(state.get(field), default=default)
            if value_issue:
                normalized_issue = normalized_issue or "invalid_shape"
                mark_invalid(field)
            state[field] = normalized_value

        progress_percent, progress_issue = self._coerce_int(state.get("progress_percent"), default=None)
        if progress_issue:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("progress_percent")
        state["progress_percent"] = progress_percent

        polling_enabled, polling_issue = self._coerce_bool(state.get("polling_enabled"), default=True)
        if polling_issue:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("polling_enabled")
        state["polling_enabled"] = polling_enabled

        state["tasks_attempted"], changed = self._normalize_mapping_list(state.get("tasks_attempted"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("tasks_attempted")

        state["tasks_failed"], changed = self._normalize_mapping_list(state.get("tasks_failed"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("tasks_failed")

        state["blockers_detected"], changed = self._normalize_mapping_list(state.get("blockers_detected"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("blockers_detected")

        state["integrity_issues"], changed = self._normalize_mapping_list(state.get("integrity_issues"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("integrity_issues")

        state["top_candidates"], changed = self._normalize_mapping_list(state.get("top_candidates"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("top_candidates")

        state["excluded_tasks"], changed = self._normalize_mapping_list(state.get("excluded_tasks"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("excluded_tasks")

        state["session_tuning_history"], changed = self._normalize_mapping_list(state.get("session_tuning_history"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("session_tuning_history")

        if not isinstance(state.get("session_tuning_state"), dict):
            state["session_tuning_state"] = {}
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("session_tuning_state")

        if not isinstance(state.get("experiment_tracking"), dict):
            state["experiment_tracking"] = {}
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("experiment_tracking")

        if not isinstance(state.get("latest_experiment_variant"), dict):
            state["latest_experiment_variant"] = {}
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("latest_experiment_variant")

        state["result_state_history"], changed = self._normalize_mapping_list(state.get("result_state_history"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("result_state_history")

        state["result_evaluation_history"], changed = self._normalize_mapping_list(state.get("result_evaluation_history"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("result_evaluation_history")

        if not isinstance(state.get("latest_result_evaluation"), dict):
            state["latest_result_evaluation"] = {}
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("latest_result_evaluation")

        state["tasks_completed"], changed = self._normalize_string_list(state.get("tasks_completed"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("tasks_completed")

        state["artifacts_generated"], changed = self._normalize_string_list(state.get("artifacts_generated"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("artifacts_generated")

        state["last_generated_plan_steps"], changed = self._normalize_string_list(state.get("last_generated_plan_steps"))
        if changed:
            normalized_issue = normalized_issue or "invalid_shape"
            mark_invalid("last_generated_plan_steps")

        return state, normalized_issue, issue_details

    def _coerce_int(self, value: Any, *, default: int | None) -> tuple[int | None, bool]:
        if value is None:
            return default, False
        try:
            return int(value), False
        except (TypeError, ValueError):
            return default, True

    def _coerce_float(self, value: Any, *, default: float | None) -> tuple[float | None, bool]:
        if value is None:
            return default, False
        try:
            return float(value), False
        except (TypeError, ValueError):
            return default, True

    def _coerce_bool(self, value: Any, *, default: bool) -> tuple[bool, bool]:
        if value is None:
            return default, False
        if isinstance(value, bool):
            return value, False
        return default, True

    def _normalize_mapping_list(self, value: Any) -> tuple[List[Dict[str, Any]], bool]:
        if value is None:
            return [], False
        if not isinstance(value, list):
            return [], True
        normalized = [dict(item) for item in value if isinstance(item, dict)]
        return normalized, len(normalized) != len(value)

    def _normalize_string_list(self, value: Any) -> tuple[List[str], bool]:
        if value is None:
            return [], False
        if not isinstance(value, list):
            return [], True
        normalized = [str(item) for item in value if item is not None and not isinstance(item, (dict, list, tuple, set))]
        return normalized, len(normalized) != len(value)
