"""Formatting helpers for operator-visible evaluation sessions."""
from __future__ import annotations

from .evaluation_session_models import EvaluationRunRecord, EvaluationSessionRecord


class EvaluationFormatter:
    @staticmethod
    def format_session_preview(*, session: EvaluationSessionRecord) -> str:
        job = session.allowed_jobs[0] if session.allowed_jobs else None
        lines = [
            "[EVALUATION SESSION]",
            f"Session: {session.title}",
            f"ID: {session.session_id}",
            f"Job: {job.command_summary if job is not None else '-'}",
            f"Runs: {session.max_runs}",
            f"Interval: {session.interval_seconds}s",
            f"Target: {job.target_display if job is not None and job.target_display else 'local controller'}",
            f"Status: {session.status}",
        ]
        if not session.approved_at:
            lines.append("Approval required before start")
        return "\n".join(lines)

    @staticmethod
    def format_session_list(*, sessions: tuple[EvaluationSessionRecord, ...]) -> str:
        lines = ["[EVALUATION SESSIONS]"]
        if not sessions:
            lines.append("No evaluation session is recorded yet.")
            return "\n".join(lines)
        for session in sessions:
            lines.extend(
                (
                    f"- {session.session_id}",
                    f"  Title: {session.title}",
                    f"  Status: {session.status}",
                    f"  Runs: {session.runs_completed}/{session.max_runs}",
                    f"  Summary: {session.latest_summary or session.final_summary or '-'}",
                )
            )
        return "\n".join(lines)

    @staticmethod
    def format_session_status(*, session: EvaluationSessionRecord, runs: tuple[EvaluationRunRecord, ...]) -> str:
        last_run = runs[-1] if runs else None
        lines = [
            "[EVALUATION STATUS]",
            f"Session: {session.title}",
            f"ID: {session.session_id}",
            f"Status: {session.status}",
            f"Runs completed: {session.runs_completed}/{session.max_runs}",
            f"Passes: {session.success_count}",
            f"Failures: {session.failure_count}",
            f"Regressions: {session.regression_count or 'none'}",
            f"Recoveries: {session.recovery_count or 'none'}",
            f"Last result: {last_run.status if last_run is not None else '-'}",
        ]
        if last_run is not None and last_run.comparison_summary:
            lines.append(f"Delta: {last_run.comparison_summary}")
        if session.next_run_at:
            lines.append(f"Next run: {session.next_run_at}")
        if session.stop_reason:
            lines.append(f"Stop reason: {session.stop_reason}")
        lines.append(f"Summary: {session.final_summary or session.latest_summary or '-'}")
        return "\n".join(lines)

    @staticmethod
    def format_session_runs(*, session: EvaluationSessionRecord, runs: tuple[EvaluationRunRecord, ...]) -> str:
        lines = ["[EVALUATION RUNS]", f"Session: {session.title}", f"ID: {session.session_id}"]
        if not runs:
            lines.append("No recorded runs yet.")
            return "\n".join(lines)
        for run in runs:
            lines.extend(
                (
                    f"- Run {run.iteration}: {run.run_id}",
                    f"  Status: {run.status}",
                    f"  Summary: {run.result_summary}",
                    f"  Delta: {run.comparison_summary or run.comparison_kind}",
                )
            )
        return "\n".join(lines)
