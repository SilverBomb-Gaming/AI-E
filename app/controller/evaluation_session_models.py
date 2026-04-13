"""Durable bounded evaluation session models."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal


EvaluationJobKind = Literal["local_command", "node_dispatch"]
EvaluationTargetKind = Literal["local", "node", "role"]
EvaluationSessionStatus = Literal["created", "running", "completed", "stopped", "failed", "blocked"]
EvaluationRunStatus = Literal["success", "failed", "timed_out", "unavailable", "refused", "stopped"]
EvaluationComparisonKind = Literal["baseline", "steady", "regression", "recovery", "changed"]


@dataclass(frozen=True)
class EvaluationJobDefinition:
    job_id: str
    command_label: str
    command_text: str
    command_argument: str
    command_summary: str
    job_kind: EvaluationJobKind
    target_kind: EvaluationTargetKind
    target_selector: str = ""
    target_display: str = ""
    expected_scope: str = ""
    metadata: dict[str, str] = field(default_factory=dict)

    def to_payload(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "command_label": self.command_label,
            "command_text": self.command_text,
            "command_argument": self.command_argument,
            "command_summary": self.command_summary,
            "job_kind": self.job_kind,
            "target_kind": self.target_kind,
            "target_selector": self.target_selector,
            "target_display": self.target_display,
            "expected_scope": self.expected_scope,
            "metadata": dict(self.metadata),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> EvaluationJobDefinition:
        metadata = payload.get("metadata")
        return EvaluationJobDefinition(
            job_id=str(payload.get("job_id", "job-1")).strip() or "job-1",
            command_label=str(payload.get("command_label", "")).strip(),
            command_text=str(payload.get("command_text", "")).strip(),
            command_argument=str(payload.get("command_argument", "")).strip(),
            command_summary=str(payload.get("command_summary", "")).strip(),
            job_kind=str(payload.get("job_kind", "local_command")).strip().lower() or "local_command",  # type: ignore[arg-type]
            target_kind=str(payload.get("target_kind", "local")).strip().lower() or "local",  # type: ignore[arg-type]
            target_selector=str(payload.get("target_selector", "")).strip(),
            target_display=str(payload.get("target_display", "")).strip(),
            expected_scope=str(payload.get("expected_scope", "")).strip(),
            metadata={str(key): str(value) for key, value in (metadata.items() if isinstance(metadata, dict) else ())},
        )


@dataclass(frozen=True)
class EvaluationRunRecord:
    run_id: str
    session_id: str
    iteration: int
    command_label: str
    command_summary: str
    started_at: str
    finished_at: str
    status: EvaluationRunStatus
    result_summary: str
    target_node_id: str = ""
    target_node_name: str = ""
    target_node_role: str = ""
    exit_code: int | None = None
    duration_ms: int = 0
    failure_reason: str = ""
    first_issue: str = ""
    test_count: int = 0
    passed_count: int = 0
    failed_count: int = 0
    dispatch_job_id: str = ""
    comparison_kind: EvaluationComparisonKind = "baseline"
    comparison_summary: str = ""

    def with_comparison(
        self,
        *,
        comparison_kind: EvaluationComparisonKind,
        comparison_summary: str,
    ) -> EvaluationRunRecord:
        return replace(
            self,
            comparison_kind=comparison_kind,
            comparison_summary=comparison_summary.strip(),
        )

    def to_payload(self) -> dict[str, object]:
        return {
            "run_id": self.run_id,
            "session_id": self.session_id,
            "iteration": self.iteration,
            "command_label": self.command_label,
            "command_summary": self.command_summary,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "result_summary": self.result_summary,
            "target_node_id": self.target_node_id,
            "target_node_name": self.target_node_name,
            "target_node_role": self.target_node_role,
            "exit_code": self.exit_code,
            "duration_ms": self.duration_ms,
            "failure_reason": self.failure_reason,
            "first_issue": self.first_issue,
            "test_count": self.test_count,
            "passed_count": self.passed_count,
            "failed_count": self.failed_count,
            "dispatch_job_id": self.dispatch_job_id,
            "comparison_kind": self.comparison_kind,
            "comparison_summary": self.comparison_summary,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> EvaluationRunRecord:
        exit_code = payload.get("exit_code")
        return EvaluationRunRecord(
            run_id=str(payload.get("run_id", "")).strip(),
            session_id=str(payload.get("session_id", "")).strip(),
            iteration=max(1, int(payload.get("iteration", 1))),
            command_label=str(payload.get("command_label", "")).strip(),
            command_summary=str(payload.get("command_summary", "")).strip(),
            started_at=str(payload.get("started_at", "")).strip(),
            finished_at=str(payload.get("finished_at", "")).strip(),
            status=str(payload.get("status", "failed")).strip().lower() or "failed",  # type: ignore[arg-type]
            result_summary=str(payload.get("result_summary", "")).strip(),
            target_node_id=str(payload.get("target_node_id", "")).strip(),
            target_node_name=str(payload.get("target_node_name", "")).strip(),
            target_node_role=str(payload.get("target_node_role", "")).strip(),
            exit_code=int(exit_code) if isinstance(exit_code, int) else None,
            duration_ms=max(0, int(payload.get("duration_ms", 0))),
            failure_reason=str(payload.get("failure_reason", "")).strip(),
            first_issue=str(payload.get("first_issue", "")).strip(),
            test_count=max(0, int(payload.get("test_count", 0))),
            passed_count=max(0, int(payload.get("passed_count", 0))),
            failed_count=max(0, int(payload.get("failed_count", 0))),
            dispatch_job_id=str(payload.get("dispatch_job_id", "")).strip(),
            comparison_kind=str(payload.get("comparison_kind", "baseline")).strip().lower() or "baseline",  # type: ignore[arg-type]
            comparison_summary=str(payload.get("comparison_summary", "")).strip(),
        )


@dataclass(frozen=True)
class EvaluationSessionRecord:
    session_id: str
    title: str
    purpose: str
    created_at: str
    approved_at: str
    status: EvaluationSessionStatus
    owner_label: str
    source: str
    chat_id: str
    allowed_jobs: tuple[EvaluationJobDefinition, ...]
    interval_seconds: int
    max_runs: int
    max_failures: int
    dispatch_error_threshold: int
    stop_conditions: tuple[str, ...]
    latest_summary: str = ""
    final_summary: str = ""
    latest_run_id: str = ""
    runs_completed: int = 0
    success_count: int = 0
    failure_count: int = 0
    regression_count: int = 0
    recovery_count: int = 0
    current_streak_kind: str = ""
    current_streak_count: int = 0
    first_failure_run_id: str = ""
    last_success_run_id: str = ""
    last_failure_reason: str = ""
    next_run_at: str = ""
    last_started_at: str = ""
    finished_at: str = ""
    stop_reason: str = ""
    metadata: dict[str, str] = field(default_factory=dict)

    def to_payload(self) -> dict[str, object]:
        return {
            "session_id": self.session_id,
            "title": self.title,
            "purpose": self.purpose,
            "created_at": self.created_at,
            "approved_at": self.approved_at,
            "status": self.status,
            "owner_label": self.owner_label,
            "source": self.source,
            "chat_id": self.chat_id,
            "allowed_jobs": [job.to_payload() for job in self.allowed_jobs],
            "interval_seconds": self.interval_seconds,
            "max_runs": self.max_runs,
            "max_failures": self.max_failures,
            "dispatch_error_threshold": self.dispatch_error_threshold,
            "stop_conditions": list(self.stop_conditions),
            "latest_summary": self.latest_summary,
            "final_summary": self.final_summary,
            "latest_run_id": self.latest_run_id,
            "runs_completed": self.runs_completed,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "regression_count": self.regression_count,
            "recovery_count": self.recovery_count,
            "current_streak_kind": self.current_streak_kind,
            "current_streak_count": self.current_streak_count,
            "first_failure_run_id": self.first_failure_run_id,
            "last_success_run_id": self.last_success_run_id,
            "last_failure_reason": self.last_failure_reason,
            "next_run_at": self.next_run_at,
            "last_started_at": self.last_started_at,
            "finished_at": self.finished_at,
            "stop_reason": self.stop_reason,
            "metadata": dict(self.metadata),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> EvaluationSessionRecord:
        jobs = payload.get("allowed_jobs")
        metadata = payload.get("metadata")
        stop_conditions = payload.get("stop_conditions")
        return EvaluationSessionRecord(
            session_id=str(payload.get("session_id", "")).strip().upper(),
            title=str(payload.get("title", "")).strip(),
            purpose=str(payload.get("purpose", "")).strip(),
            created_at=str(payload.get("created_at", "")).strip(),
            approved_at=str(payload.get("approved_at", "")).strip(),
            status=str(payload.get("status", "created")).strip().lower() or "created",  # type: ignore[arg-type]
            owner_label=str(payload.get("owner_label", "")).strip(),
            source=str(payload.get("source", "local-cli")).strip(),
            chat_id=str(payload.get("chat_id", "local-cli")).strip(),
            allowed_jobs=tuple(
                EvaluationJobDefinition.from_payload(item)
                for item in jobs or ()
                if isinstance(item, dict)
            ),
            interval_seconds=max(0, int(payload.get("interval_seconds", 0))),
            max_runs=max(1, int(payload.get("max_runs", 1))),
            max_failures=max(1, int(payload.get("max_failures", 1))),
            dispatch_error_threshold=max(1, int(payload.get("dispatch_error_threshold", 1))),
            stop_conditions=tuple(str(item).strip() for item in stop_conditions or () if str(item).strip()),
            latest_summary=str(payload.get("latest_summary", "")).strip(),
            final_summary=str(payload.get("final_summary", "")).strip(),
            latest_run_id=str(payload.get("latest_run_id", "")).strip(),
            runs_completed=max(0, int(payload.get("runs_completed", 0))),
            success_count=max(0, int(payload.get("success_count", 0))),
            failure_count=max(0, int(payload.get("failure_count", 0))),
            regression_count=max(0, int(payload.get("regression_count", 0))),
            recovery_count=max(0, int(payload.get("recovery_count", 0))),
            current_streak_kind=str(payload.get("current_streak_kind", "")).strip(),
            current_streak_count=max(0, int(payload.get("current_streak_count", 0))),
            first_failure_run_id=str(payload.get("first_failure_run_id", "")).strip(),
            last_success_run_id=str(payload.get("last_success_run_id", "")).strip(),
            last_failure_reason=str(payload.get("last_failure_reason", "")).strip(),
            next_run_at=str(payload.get("next_run_at", "")).strip(),
            last_started_at=str(payload.get("last_started_at", "")).strip(),
            finished_at=str(payload.get("finished_at", "")).strip(),
            stop_reason=str(payload.get("stop_reason", "")).strip(),
            metadata={str(key): str(value) for key, value in (metadata.items() if isinstance(metadata, dict) else ())},
        )
