"""Bounded background runner for approved evaluation sessions."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
import re
from threading import Event, RLock, Thread
from time import sleep
from typing import TYPE_CHECKING

from .evaluation_session_models import (
    EvaluationComparisonKind,
    EvaluationJobDefinition,
    EvaluationRunRecord,
    EvaluationSessionRecord,
)
from .evaluation_session_store import EvaluationSessionStore
from .execution_models import LocalCommandExecutionRequest
from .execution_runner import ExecutionRunnerError
from .node_dispatcher import NodeDispatchError
from .node_models import NodeDispatchRecord
from .node_router import NodeRoutingError

if TYPE_CHECKING:
    from .app_service import ControllerService


class EvaluationRunner:
    def __init__(self, service: ControllerService, store: EvaluationSessionStore) -> None:
        self._service = service
        self._store = store
        self._lock = RLock()
        self._threads: dict[str, Thread] = {}
        self._stop_events: dict[str, Event] = {}

    def start_session(self, session_id: str) -> EvaluationSessionRecord:
        normalized = session_id.strip().upper()
        session = self._require_session(normalized)
        with self._lock:
            existing = self._threads.get(normalized)
            if existing is not None and existing.is_alive():
                return session
            stop_event = Event()
            approved = replace(
                session,
                approved_at=session.approved_at or self._now_iso(),
                status="running",
                latest_summary="Session started.",
                final_summary="",
                finished_at="",
                stop_reason="",
                next_run_at=self._now_iso(),
            )
            approved = self._store.update_session(approved)
            worker = Thread(target=self._run_session_loop, args=(normalized, stop_event), daemon=True, name=f"eval-{normalized.lower()}")
            self._stop_events[normalized] = stop_event
            self._threads[normalized] = worker
            worker.start()
            return approved

    def stop_session(self, session_id: str, *, reason: str) -> EvaluationSessionRecord:
        normalized = session_id.strip().upper()
        session = self._require_session(normalized)
        with self._lock:
            stop_event = self._stop_events.get(normalized)
            if stop_event is not None:
                stop_event.set()
        if session.status in {"completed", "failed", "stopped", "blocked"}:
            return session
        updated = replace(
            session,
            status="stopped",
            stop_reason=reason.strip(),
            finished_at=self._now_iso(),
            final_summary=reason.strip() or session.final_summary,
            next_run_at="",
        )
        return self._store.update_session(updated)

    def await_session(self, session_id: str, *, timeout_seconds: float) -> EvaluationSessionRecord | None:
        normalized = session_id.strip().upper()
        deadline = datetime.now().timestamp() + max(0.1, float(timeout_seconds))
        while datetime.now().timestamp() < deadline:
            session = self._store.get_session(normalized)
            if session is None:
                return None
            if session.status in {"completed", "failed", "stopped", "blocked"}:
                return session
            sleep(0.05)
        return self._store.get_session(normalized)

    def is_running(self, session_id: str) -> bool:
        with self._lock:
            thread = self._threads.get(session_id.strip().upper())
            return bool(thread is not None and thread.is_alive())

    def shutdown(self) -> None:
        with self._lock:
            session_ids = tuple(self._stop_events)
            for stop_event in self._stop_events.values():
                stop_event.set()
            threads = tuple(self._threads.items())
        for session_id in session_ids:
            session = self._store.get_session(session_id)
            if session is not None and session.status == "running":
                self._store.update_session(
                    replace(
                        session,
                        status="stopped",
                        stop_reason="Controller shutdown stopped the evaluation session.",
                        finished_at=self._now_iso(),
                        final_summary="Controller shutdown stopped the evaluation session.",
                        next_run_at="",
                    )
                )
        for _, thread in threads:
            thread.join(timeout=1.0)

    def _run_session_loop(self, session_id: str, stop_event: Event) -> None:
        try:
            while not stop_event.is_set():
                session = self._store.get_session(session_id)
                if session is None:
                    return
                if session.status != "running":
                    return
                if session.runs_completed >= session.max_runs:
                    self._finish_session(session, status="completed", summary=f"No regressions detected across {session.runs_completed} runs" if session.regression_count == 0 else f"Completed with {session.regression_count} regression(s) detected")
                    return
                if session.failure_count >= session.max_failures:
                    self._finish_session(session, status="failed", summary=f"Stopped after reaching max_failures={session.max_failures}.")
                    return
                current_iteration = session.runs_completed + 1
                session = self._store.update_session(replace(session, last_started_at=self._now_iso(), next_run_at=""))
                run = self._execute_run(session=session, iteration=current_iteration)
                self._store.append_run(run)
                runs = self._store.runs_for_session(session.session_id)
                updated = self._apply_run_outcome(session=session, run=run, runs=runs)
                updated = self._store.update_session(updated)
                if updated.status in {"completed", "failed", "blocked", "stopped"}:
                    return
                if updated.runs_completed >= updated.max_runs:
                    self._finish_session(updated, status="completed", summary=updated.latest_summary or f"Completed {updated.runs_completed} evaluation runs.")
                    return
                if updated.failure_count >= updated.max_failures:
                    self._finish_session(updated, status="failed", summary=updated.latest_summary or f"Stopped after {updated.failure_count} failures.")
                    return
                if updated.interval_seconds <= 0:
                    continue
                next_run_at = (datetime.now().astimezone() + timedelta(seconds=updated.interval_seconds)).isoformat(timespec="seconds")
                self._store.update_session(replace(updated, next_run_at=next_run_at))
                if stop_event.wait(updated.interval_seconds):
                    self._finish_session(self._require_session(session_id), status="stopped", summary="Stopped by operator.")
                    return
        finally:
            with self._lock:
                self._stop_events.pop(session_id, None)
                self._threads.pop(session_id, None)

    def _execute_run(self, *, session: EvaluationSessionRecord, iteration: int) -> EvaluationRunRecord:
        job = session.allowed_jobs[0]
        if job.job_kind == "node_dispatch":
            return self._execute_dispatch_run(session=session, job=job, iteration=iteration)
        return self._execute_local_run(session=session, job=job, iteration=iteration)

    def _execute_local_run(self, *, session: EvaluationSessionRecord, job: EvaluationJobDefinition, iteration: int) -> EvaluationRunRecord:
        started_at = self._now_iso()
        request = self._build_local_request(job=job, session=session, iteration=iteration)
        target_node = self._service.resolve_execution_node().node if job.target_kind != "local" else self._service._node_registry.local_node()
        try:
            command_result = self._service._node_router.execute(node=target_node, request=request)
            status = "timed_out" if command_result.timed_out else ("success" if command_result.exit_code == 0 else "failed")
            run = EvaluationRunRecord(
                run_id=self._store.generate_run_id(),
                session_id=session.session_id,
                iteration=iteration,
                command_label=job.command_label,
                command_summary=job.command_summary,
                started_at=started_at,
                finished_at=command_result.completed_at or self._now_iso(),
                status=status,  # type: ignore[arg-type]
                result_summary=command_result.output_summary,
                target_node_id=target_node.node_id,
                target_node_name=target_node.display_name,
                target_node_role=target_node.role,
                exit_code=command_result.exit_code,
                duration_ms=command_result.duration_ms,
                failure_reason=command_result.first_issue if status != "success" else "",
                first_issue=command_result.first_issue,
            )
            return self._apply_test_counts(run=run, stdout=command_result.stdout, stderr=command_result.stderr)
        except (ExecutionRunnerError, NodeRoutingError) as exc:
            return EvaluationRunRecord(
                run_id=self._store.generate_run_id(),
                session_id=session.session_id,
                iteration=iteration,
                command_label=job.command_label,
                command_summary=job.command_summary,
                started_at=started_at,
                finished_at=self._now_iso(),
                status="unavailable" if getattr(exc, "code", "") in {"node_not_online", "command_not_found"} else "failed",
                result_summary=str(exc),
                target_node_id=target_node.node_id,
                target_node_name=target_node.display_name,
                target_node_role=target_node.role,
                failure_reason=str(exc),
                first_issue=str(exc),
            )

    def _execute_dispatch_run(self, *, session: EvaluationSessionRecord, job: EvaluationJobDefinition, iteration: int) -> EvaluationRunRecord:
        started_at = self._now_iso()
        target, code, message = self._service.resolve_dispatch_target(
            selector=job.target_selector,
            required_command_label=job.command_label,
            requested_command=job.command_text,
        )
        if target is None:
            return EvaluationRunRecord(
                run_id=self._store.generate_run_id(),
                session_id=session.session_id,
                iteration=iteration,
                command_label=job.command_label,
                command_summary=job.command_summary,
                started_at=started_at,
                finished_at=self._now_iso(),
                status="unavailable" if code != "dispatch_target_unknown" else "failed",
                result_summary=message,
                target_node_role=job.target_selector if job.target_kind == "role" else "",
                failure_reason=message,
                first_issue=message,
            )
        try:
            local_request = self._build_local_request(job=job, session=session, iteration=iteration, repo_root=target.node.repo_root)
        except ExecutionRunnerError as exc:
            return EvaluationRunRecord(
                run_id=self._store.generate_run_id(),
                session_id=session.session_id,
                iteration=iteration,
                command_label=job.command_label,
                command_summary=job.command_summary,
                started_at=started_at,
                finished_at=self._now_iso(),
                status="failed",
                result_summary=str(exc),
                target_node_id=target.node.node_id,
                target_node_name=target.node.display_name,
                target_node_role=target.node.role,
                failure_reason=str(exc),
                first_issue=str(exc),
            )
        try:
            queued = self._service.queue_dispatch_job(
                record=self._service.build_eval_dispatch_record(
                    session=session,
                    target=target,
                    local_request=local_request,
                    chat_id=session.chat_id,
                )
            )
        except NodeDispatchError as exc:
            return EvaluationRunRecord(
                run_id=self._store.generate_run_id(),
                session_id=session.session_id,
                iteration=iteration,
                command_label=job.command_label,
                command_summary=job.command_summary,
                started_at=started_at,
                finished_at=self._now_iso(),
                status="failed",
                result_summary=exc.message,
                target_node_id=target.node.node_id,
                target_node_name=target.node.display_name,
                target_node_role=target.node.role,
                failure_reason=exc.message,
                first_issue=exc.message,
            )
        completed = self._wait_for_dispatch_job(queued.job_id)
        if completed is None:
            return EvaluationRunRecord(
                run_id=self._store.generate_run_id(),
                session_id=session.session_id,
                iteration=iteration,
                command_label=job.command_label,
                command_summary=job.command_summary,
                started_at=started_at,
                finished_at=self._now_iso(),
                status="timed_out",
                result_summary="Dispatch job did not complete before the evaluation wait limit.",
                target_node_id=target.node.node_id,
                target_node_name=target.node.display_name,
                target_node_role=target.node.role,
                dispatch_job_id=queued.job_id,
                failure_reason="Dispatch job timed out while waiting for completion.",
                first_issue="Dispatch job timed out while waiting for completion.",
            )
        status: str = "success"
        if completed.status == "failed":
            status = "failed"
        elif completed.status == "refused":
            status = "refused"
        run = EvaluationRunRecord(
            run_id=self._store.generate_run_id(),
            session_id=session.session_id,
            iteration=iteration,
            command_label=job.command_label,
            command_summary=job.command_summary,
            started_at=started_at,
            finished_at=completed.finished_at or self._now_iso(),
            status=status,  # type: ignore[arg-type]
            result_summary=completed.result_summary or completed.failure_reason or completed.status,
            target_node_id=completed.target_node_id,
            target_node_name=completed.target_node_name,
            target_node_role=completed.target_node_role,
            dispatch_job_id=completed.job_id,
            failure_reason=completed.failure_reason,
            first_issue=completed.failure_reason,
        )
        payload = completed.execution_payload
        stdout = str(payload.get("stdout") or "")
        stderr = str(payload.get("stderr") or "")
        exit_code = payload.get("exit_code")
        if isinstance(exit_code, int):
            run = replace(run, exit_code=exit_code)
        return self._apply_test_counts(run=run, stdout=stdout, stderr=stderr)

    def _build_local_request(
        self,
        *,
        job: EvaluationJobDefinition,
        session: EvaluationSessionRecord,
        iteration: int,
        repo_root: str | None = None,
    ) -> LocalCommandExecutionRequest:
        effective_repo_root = (repo_root or self._service._config.repo_root).strip()
        operator_reason = f"evaluation session {session.session_id} run {iteration}"
        if job.command_label == "/run":
            return self._service._execution_runner.build_run_request(
                capability_id="shell.command.run",
                repo_root=effective_repo_root,
                command_text=job.command_argument,
                operator_reason=operator_reason,
                expected_scope=job.expected_scope or self._service._repo_display_name(effective_repo_root),
            )
        return self._service._execution_runner.build_test_request(
            capability_id="test.command.run",
            repo_root=effective_repo_root,
            target=job.command_argument,
            operator_reason=operator_reason,
            expected_scope=job.expected_scope or self._service._repo_display_name(effective_repo_root),
        )

    def _apply_run_outcome(
        self,
        *,
        session: EvaluationSessionRecord,
        run: EvaluationRunRecord,
        runs: tuple[EvaluationRunRecord, ...],
    ) -> EvaluationSessionRecord:
        previous = runs[-2] if len(runs) >= 2 else None
        comparison_kind, comparison_summary = self._comparison(previous=previous, current=run)
        if comparison_summary:
            run = run.with_comparison(comparison_kind=comparison_kind, comparison_summary=comparison_summary)
            self._store.append_run(run)
            runs = (*runs[:-1], run)
        success_count = session.success_count + (1 if run.status == "success" else 0)
        failure_count = session.failure_count + (0 if run.status == "success" else 1)
        regression_count = session.regression_count + (1 if run.comparison_kind == "regression" else 0)
        recovery_count = session.recovery_count + (1 if run.comparison_kind == "recovery" else 0)
        dispatch_error_streak = int(session.metadata.get("dispatch_error_streak", "0") or "0")
        if run.dispatch_job_id:
            dispatch_error_streak = 0 if run.status == "success" else dispatch_error_streak + 1
        if run.status == "success":
            streak_kind = "success"
            streak_count = session.current_streak_count + 1 if session.current_streak_kind == "success" else 1
        else:
            streak_kind = "failure"
            streak_count = session.current_streak_count + 1 if session.current_streak_kind == "failure" else 1
        latest_summary = self._session_summary(run=run, session=session, success_count=success_count, failure_count=failure_count)
        updated = replace(
            session,
            latest_run_id=run.run_id,
            runs_completed=session.runs_completed + 1,
            success_count=success_count,
            failure_count=failure_count,
            regression_count=regression_count,
            recovery_count=recovery_count,
            current_streak_kind=streak_kind,
            current_streak_count=streak_count,
            first_failure_run_id=session.first_failure_run_id or (run.run_id if run.status != "success" else ""),
            last_success_run_id=run.run_id if run.status == "success" else session.last_success_run_id,
            last_failure_reason=run.failure_reason if run.status != "success" else session.last_failure_reason,
            latest_summary=latest_summary,
            next_run_at="",
            metadata={**session.metadata, "dispatch_error_streak": str(dispatch_error_streak)},
        )
        if run.status == "unavailable" and "node" in (run.first_issue or "").lower():
            return replace(
                updated,
                status="blocked",
                stop_reason=run.failure_reason or run.result_summary,
                finished_at=self._now_iso(),
                final_summary=run.failure_reason or run.result_summary,
            )
        if run.dispatch_job_id and dispatch_error_streak >= updated.dispatch_error_threshold:
            return replace(
                updated,
                status="failed",
                stop_reason=f"Reached dispatch_error_threshold={updated.dispatch_error_threshold}.",
                finished_at=self._now_iso(),
                final_summary=f"Stopped after {dispatch_error_streak} consecutive dispatch failures.",
            )
        if updated.failure_count >= updated.max_failures:
            return replace(
                updated,
                status="failed",
                stop_reason=f"Reached max_failures={updated.max_failures}.",
                finished_at=self._now_iso(),
                final_summary=f"Stopped after reaching max_failures={updated.max_failures}.",
            )
        return updated

    def _comparison(
        self,
        *,
        previous: EvaluationRunRecord | None,
        current: EvaluationRunRecord,
    ) -> tuple[EvaluationComparisonKind, str]:
        if previous is None:
            return "baseline", "Baseline run recorded."
        if previous.status == "success" and current.status != "success":
            return "regression", f"Regression: {previous.status} -> {current.status}."
        if previous.status != "success" and current.status == "success":
            return "recovery", f"Recovery: {previous.status} -> success."
        if previous.status == current.status:
            return "steady", f"Steady: {current.status} repeated."
        return "changed", f"Changed: {previous.status} -> {current.status}."

    def _session_summary(
        self,
        *,
        run: EvaluationRunRecord,
        session: EvaluationSessionRecord,
        success_count: int,
        failure_count: int,
    ) -> str:
        if run.comparison_kind == "regression":
            return f"Regression began on run {run.iteration} and current status is {run.status}."
        if run.comparison_kind == "recovery":
            return f"Recovery detected on run {run.iteration}; success resumed."
        if failure_count == 0:
            return f"No regressions detected across {success_count} run{'s' if success_count != 1 else ''}."
        return f"Run {run.iteration} finished with {run.status}: {run.result_summary}"

    def _wait_for_dispatch_job(self, job_id: str) -> NodeDispatchRecord | None:
        for _ in range(200):
            record = self._service.get_dispatch_job(job_id)
            if record is not None and record.status in {"completed", "failed", "refused"}:
                return record
            sleep(0.05)
        return None

    def _apply_test_counts(self, *, run: EvaluationRunRecord, stdout: str, stderr: str) -> EvaluationRunRecord:
        text = f"{stdout}\n{stderr}".strip()
        passed = failed = total = 0
        match = re.search(r"Ran\s+(\d+)\s+tests?", text)
        if match:
            total = int(match.group(1))
            passed = total if run.status == "success" else max(0, total - 1)
            failed = max(0, total - passed)
        else:
            passed_match = re.search(r"(\d+)\s+passed", text)
            failed_match = re.search(r"(\d+)\s+failed", text)
            if passed_match:
                passed = int(passed_match.group(1))
            if failed_match:
                failed = int(failed_match.group(1))
            total = passed + failed
        return replace(run, test_count=total, passed_count=passed, failed_count=failed)

    def _finish_session(self, session: EvaluationSessionRecord, *, status: str, summary: str) -> EvaluationSessionRecord:
        final = replace(
            session,
            status=status,  # type: ignore[arg-type]
            finished_at=self._now_iso(),
            final_summary=summary.strip(),
            latest_summary=summary.strip(),
            stop_reason=session.stop_reason or summary.strip(),
            next_run_at="",
        )
        return self._store.update_session(final)

    def _require_session(self, session_id: str) -> EvaluationSessionRecord:
        session = self._store.get_session(session_id)
        if session is None:
            raise ValueError(f"Unknown evaluation session: {session_id}")
        return session

    @staticmethod
    def _now_iso() -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")
