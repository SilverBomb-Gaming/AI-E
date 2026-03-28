from __future__ import annotations

from itertools import count
from pathlib import Path
from typing import Any, Dict, List

from .autonomous_selector import AutonomousSelectionResult, format_selection_report
from .time_utils import get_current_timestamp
from orchestrator.report_contract import format_operator_report, validate_operator_report
from orchestrator.utils import ensure_dir, safe_write_text, write_json


class ArtifactWriter:
    """Stores per-task runtime artifacts under runs/<session_id>."""

    def __init__(self, runs_dir: Path, session_id: str) -> None:
        self.session_dir = ensure_dir(Path(runs_dir) / session_id)
        self.artifacts_dir = ensure_dir(self.session_dir / "artifacts")

    def store(
        self,
        *,
        task: Dict[str, Any],
        result: Dict[str, Any],
        validation: Dict[str, Any],
    ) -> List[str]:
        task_id = self._task_id(task)
        attempt = int(task.get("retry_count", 0)) + 1
        stem = f"{task_id}_attempt_{attempt:02d}"
        artifact_path = self.artifacts_dir / f"{stem}.json"
        summary_path = self.artifacts_dir / f"{stem}.md"

        payload = {
            "task": dict(task),
            "result": dict(result),
            "validation": dict(validation),
            "timestamp": get_current_timestamp(),
        }
        write_json(artifact_path, payload)
        safe_write_text(summary_path, self._summary_markdown(task, result, validation))

        return [self._relative(artifact_path), self._relative(summary_path)]

    def write_session_summary(self, payload: Dict[str, Any]) -> List[str]:
        json_path = self.session_dir / "session_summary.json"
        markdown_path = self.session_dir / "session_summary.md"
        operator_report_path = self.session_dir / "operator_report.md"
        summary_payload = dict(payload)
        summary_payload.setdefault("timestamp", get_current_timestamp())
        loop_visibility = dict(summary_payload.get("loop_visibility") or {})
        selector_visibility = dict(summary_payload.get("selector_visibility") or {})
        integrity_issues = [dict(item) for item in summary_payload.get("integrity_issues", []) if isinstance(item, dict)]
        summary_payload["loop_visibility"] = loop_visibility
        summary_payload["selector_visibility"] = selector_visibility
        summary_payload["integrity_issues"] = integrity_issues
        write_json(json_path, summary_payload)
        safe_write_text(markdown_path, self._session_summary_markdown(summary_payload))
        safe_write_text(operator_report_path, self._session_operator_report(summary_payload))
        return [
            self._relative(json_path),
            self._relative(markdown_path),
            self._relative(operator_report_path),
        ]

    def write_autonomous_selection(self, selection: AutonomousSelectionResult) -> List[str]:
        index = self._next_selection_index()
        stem = f"selector_{index:02d}_{selection.selected_task_id or 'none'}"
        json_path = self.artifacts_dir / f"{stem}.json"
        text_path = self.artifacts_dir / f"{stem}.txt"
        write_json(json_path, selection.to_payload())
        safe_write_text(text_path, format_selection_report(selection))
        return [self._relative(json_path), self._relative(text_path)]

    def expected_attempt_artifacts(self, task: Dict[str, Any]) -> List[str]:
        task_id = self._task_id(task)
        attempt = int(task.get("retry_count", 0)) + 1
        stem = f"{task_id}_attempt_{attempt:02d}"
        return [
            self._relative(self.artifacts_dir / f"{stem}.json"),
            self._relative(self.artifacts_dir / f"{stem}.md"),
        ]

    def _summary_markdown(
        self,
        task: Dict[str, Any],
        result: Dict[str, Any],
        validation: Dict[str, Any],
    ) -> str:
        task_id = self._task_id(task)
        lines = [
            "SUMMARY",
            f"Task {task_id} executed in the persistent supervisor loop.",
            "",
            "FACTS",
            f"- result_status: {result.get('status', 'unknown')}",
            f"- validation_state: {validation.get('validation_state', validation.get('status', 'unknown'))}",
            f"- agent_type: {result.get('agent_type', task.get('agent_type', 'copilot_coder_agent'))}",
            "",
            "ASSUMPTIONS",
            "- This artifact captures one task attempt only.",
            "",
            "RECOMMENDATIONS",
            f"- queue_action: {validation.get('queue_action', 'complete')}",
            "",
            "TIMESTAMP",
            task.get("last_attempt_timestamp") or task.get("completed_timestamp") or get_current_timestamp(),
            "",
        ]
        return "\n".join(lines)

    def _session_summary_markdown(self, payload: Dict[str, Any]) -> str:
        loop_visibility = dict(payload.get("loop_visibility") or {})
        selector_visibility = dict(payload.get("selector_visibility") or {})
        integrity_issues = [dict(item) for item in payload.get("integrity_issues", []) if isinstance(item, dict)]
        top_candidates = selector_visibility.get("top_candidates", [])
        excluded_tasks = selector_visibility.get("excluded_tasks", [])
        lines = [
            "# AI-E Session Summary",
            "",
            f"Session ID: {payload.get('session_id', 'unknown')}",
            f"Stop Reason: {payload.get('stop_reason', 'unknown')}",
            f"Elapsed Time Seconds: {payload.get('elapsed_time_seconds', 'unknown')}",
            f"Tasks Attempted: {payload.get('tasks_attempted', 'unknown')}",
            f"Tasks Completed: {payload.get('tasks_completed', 'unknown')}",
            f"Tasks Blocked: {payload.get('tasks_blocked', 'unknown')}",
            f"Queue Remaining: {payload.get('queue_remaining', 'unknown')}",
            "",
            "## AI-E Loop Summary",
            "",
            f"Loop Iterations: {loop_visibility.get('loop_iterations', 'unknown')}",
            f"Tasks Executed Count: {loop_visibility.get('tasks_executed_count', 'unknown')}",
            f"Last Task Result Status: {loop_visibility.get('last_task_result_status') or 'None'}",
            f"Failure Streak Count: {loop_visibility.get('failure_streak_count', 'unknown')}",
            "",
            "## Integrity Issues",
            "",
            "## AI-E Decision Summary",
            "",
            "Selected Task:",
            self._selector_selected_line(selector_visibility),
            "",
            "Reason:",
            str(selector_visibility.get("reason") or "None"),
            "",
            "Top Candidates:",
        ]
        if integrity_issues:
            insert_at = lines.index("## AI-E Decision Summary")
            integrity_lines = []
            for entry in integrity_issues:
                issue = entry.get("issue") or "unknown"
                recovery = entry.get("recovery")
                details = ", ".join(str(item) for item in entry.get("details", []) if str(item).strip())
                line = f"- {issue}"
                if details:
                    line += f" | details: {details}"
                if recovery:
                    line += f" | recovery: {recovery}"
                integrity_lines.append(line)
            lines[insert_at:insert_at] = integrity_lines + [""]
        else:
            insert_at = lines.index("## AI-E Decision Summary")
            lines[insert_at:insert_at] = ["None", ""]
        if top_candidates:
            for index, candidate in enumerate(top_candidates[:3], start=1):
                lines.append(self._selector_candidate_line(index, candidate))
        else:
            lines.append("None")
        lines.extend(["", "Excluded Tasks:"])
        if excluded_tasks:
            for entry in excluded_tasks:
                lines.append(f"- {self._selector_excluded_line(entry)}")
        else:
            lines.append("None")
        lines.extend(["", "Timestamp:", str(payload.get("timestamp") or get_current_timestamp()), ""])
        return "\n".join(lines)

    def _session_operator_report(self, payload: Dict[str, Any]) -> str:
        loop_visibility = dict(payload.get("loop_visibility") or {})
        selector_visibility = dict(payload.get("selector_visibility") or {})
        integrity_issues = [dict(item) for item in payload.get("integrity_issues", []) if isinstance(item, dict)]
        selected_task = selector_visibility.get("selected_task")
        selected_score = selector_visibility.get("score")
        top_candidates = selector_visibility.get("top_candidates", [])
        excluded_tasks = selector_visibility.get("excluded_tasks", [])
        loop_iterations = loop_visibility.get("loop_iterations", 0)
        tasks_executed_count = loop_visibility.get("tasks_executed_count", 0)
        last_task_result_status = loop_visibility.get("last_task_result_status") or "none"
        failure_streak_count = loop_visibility.get("failure_streak_count", 0)
        tasks_completed = int(payload.get("tasks_completed", 0) or 0)
        tasks_blocked = int(payload.get("tasks_blocked", 0) or 0)
        stop_reason = str(payload.get("stop_reason") or "unknown")
        summary = (
            "AI-E executed a continuous autonomous loop, completing multiple tasks in sequence while maintaining policy compliance and runtime visibility."
            if tasks_executed_count
            else "AI-E entered the autonomous loop but did not execute a runnable task before the session stop condition was reached."
        )
        facts = [
            f"loop iterations: {loop_iterations}",
            f"tasks executed: {tasks_executed_count}",
            f"tasks completed: {tasks_completed}",
            f"tasks blocked: {tasks_blocked}",
            f"stop reason: {stop_reason}",
            f"last task result status: {last_task_result_status}",
            f"failure streak count: {failure_streak_count}",
            "selector decision recorded in session summary",
            f"selected task: {selected_task or 'none'}",
            f"selected task score: {selected_score if selected_score is not None else 'none'}",
            f"top candidates captured: {len(top_candidates[:3])}",
            f"excluded tasks captured: {len(excluded_tasks)}",
            f"integrity issues captured: {len(integrity_issues)}",
        ]
        facts.extend(self._selector_candidate_line(index, candidate) for index, candidate in enumerate(top_candidates[:3], start=1))
        facts.extend(f"excluded: {self._selector_excluded_line(entry)}" for entry in excluded_tasks[:5])
        for entry in integrity_issues[:5]:
            issue = entry.get("issue")
            if not issue:
                continue
            details = ", ".join(str(item) for item in entry.get("details", []) if str(item).strip())
            if details:
                facts.append(f"integrity issue: {issue} [details: {details}]")
            else:
                facts.append(f"integrity issue: {issue}")

        assumptions = [
            "selector scoring remained stable",
            "no runtime interruptions occurred" if stop_reason != "operator_interrupt" and not integrity_issues else "runtime interruption or persisted-state degradation affected the session",
        ]
        recommendations = [
            "proceed to validation phase" if tasks_completed > 0 else "review blocked or unrunnable queue entries before the next autonomous pass",
            "monitor loop behavior under stress conditions",
        ]
        if integrity_issues:
            recommendations.append("inspect integrity issues and repair persisted state before trusting resumed automation output")
        report = format_operator_report(
            summary=summary,
            facts=facts,
            assumptions=assumptions,
            recommendations=recommendations,
            timestamp=str(payload.get("timestamp") or get_current_timestamp()),
        )
        validation = validate_operator_report(report)
        if not validation.is_valid:
            raise ValueError(f"Invalid operator report contract: {', '.join(validation.errors)}")
        return report

    def _selector_selected_line(self, selector_visibility: Dict[str, Any]) -> str:
        selected_task = selector_visibility.get("selected_task")
        score = selector_visibility.get("score")
        if selected_task and score is not None:
            return f"{selected_task} (score={score})"
        if selected_task:
            return str(selected_task)
        return "None"

    def _selector_candidate_line(self, index: int, candidate: Dict[str, Any]) -> str:
        task_id = candidate.get("task_id") or "unknown_task"
        score = candidate.get("score", candidate.get("total_score", "unknown"))
        breakdown = candidate.get("score_breakdown") or {}
        if isinstance(breakdown, dict) and breakdown:
            detail = ", ".join(f"{key}={value}" for key, value in breakdown.items())
            return f"{index}. {task_id} ({score}) [{detail}]"
        return f"{index}. {task_id} ({score})"

    def _selector_excluded_line(self, entry: Dict[str, Any]) -> str:
        task_id = entry.get("task_id") or "unknown_task"
        reason = entry.get("exclusion_reason") or entry.get("reason") or "unknown"
        return f"{task_id} -> {reason}"

    def _task_id(self, task: Dict[str, Any]) -> str:
        return str(task.get("task_id") or task.get("id") or "unknown_task")

    def _relative(self, path: Path) -> str:
        return str(path.relative_to(self.session_dir)).replace("\\", "/")

    def _next_selection_index(self) -> int:
        for index in count(1):
            prefix = f"selector_{index:02d}_"
            if not any(path.name.startswith(prefix) for path in self.artifacts_dir.iterdir()):
                return index