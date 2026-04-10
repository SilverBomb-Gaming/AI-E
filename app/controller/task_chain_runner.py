"""Bounded background runner for approved task chains."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from threading import Event, RLock, Thread
from time import sleep
from typing import TYPE_CHECKING

from .execution_models import LocalCommandExecutionRequest
from .execution_runner import ExecutionRunnerError
from .node_dispatcher import NodeDispatchError
from .node_models import NodeDispatchRecord, NodeDispatchTarget
from .node_router import NodeRoutingError
from .task_chain_models import TaskChainRecord, TaskChainStepFamily, TaskChainStepRecord
from .task_chain_store import TaskChainStore

if TYPE_CHECKING:
    from .app_service import ControllerService


class TaskChainRunner:
    def __init__(self, service: ControllerService, store: TaskChainStore) -> None:
        self._service = service
        self._store = store
        self._lock = RLock()
        self._threads: dict[str, Thread] = {}
        self._stop_events: dict[str, Event] = {}

    def start_chain(self, chain_id: str) -> TaskChainRecord:
        normalized = chain_id.strip().upper()
        chain = self._require_chain(normalized)
        with self._lock:
            existing = self._threads.get(normalized)
            if existing is not None and existing.is_alive():
                return chain
            stop_event = Event()
            started = replace(
                chain,
                approved_at=chain.approved_at or self._now_iso(),
                status="running",
                latest_summary="Chain started.",
                final_summary="",
                finished_at="",
                stop_reason="",
            )
            started = self._store.update_chain(started)
            worker = Thread(target=self._run_chain_loop, args=(normalized, stop_event), daemon=True, name=f"chain-{normalized.lower()}")
            self._stop_events[normalized] = stop_event
            self._threads[normalized] = worker
            worker.start()
            return started

    def stop_chain(self, chain_id: str, *, reason: str) -> TaskChainRecord:
        normalized = chain_id.strip().upper()
        chain = self._require_chain(normalized)
        with self._lock:
            stop_event = self._stop_events.get(normalized)
            if stop_event is not None:
                stop_event.set()
        if chain.status in {"completed", "failed", "stopped", "blocked"}:
            return chain
        updated = replace(
            chain,
            status="stopped",
            stop_reason=reason.strip(),
            finished_at=self._now_iso(),
            final_summary=reason.strip() or chain.final_summary,
        )
        return self._store.update_chain(updated)

    def await_chain(self, chain_id: str, *, timeout_seconds: float) -> TaskChainRecord | None:
        normalized = chain_id.strip().upper()
        deadline = datetime.now().timestamp() + max(0.1, float(timeout_seconds))
        while datetime.now().timestamp() < deadline:
            chain = self._store.get_chain(normalized)
            if chain is None:
                return None
            if chain.status in {"completed", "failed", "stopped", "blocked"}:
                return chain
            sleep(0.05)
        return self._store.get_chain(normalized)

    def is_running(self, chain_id: str) -> bool:
        with self._lock:
            thread = self._threads.get(chain_id.strip().upper())
            return bool(thread is not None and thread.is_alive())

    def shutdown(self) -> None:
        with self._lock:
            chain_ids = tuple(self._stop_events)
            for stop_event in self._stop_events.values():
                stop_event.set()
            threads = tuple(self._threads.items())
        for chain_id in chain_ids:
            chain = self._store.get_chain(chain_id)
            if chain is not None and chain.status == "running":
                self._store.update_chain(
                    replace(
                        chain,
                        status="stopped",
                        stop_reason="Controller shutdown stopped the task chain.",
                        finished_at=self._now_iso(),
                        final_summary="Controller shutdown stopped the task chain.",
                    )
                )
        for _, thread in threads:
            thread.join(timeout=1.0)

    def _run_chain_loop(self, chain_id: str, stop_event: Event) -> None:
        try:
            while not stop_event.is_set():
                chain = self._store.get_chain(chain_id)
                if chain is None or chain.status != "running":
                    return
                if chain.steps_completed >= chain.max_steps:
                    self._finish_chain(chain, status="completed", summary=chain.latest_summary or f"Completed {chain.steps_completed} steps.")
                    return
                if chain.failure_count >= chain.max_failures:
                    self._finish_chain(chain, status="failed", summary=chain.latest_summary or f"Stopped after {chain.failure_count} failures.")
                    return
                if chain.no_progress_count >= chain.max_no_progress:
                    self._finish_chain(chain, status="blocked", summary=f"Stopped after {chain.no_progress_count} no-progress steps.")
                    return
                next_family = self._next_step_family(chain)
                if next_family is None:
                    self._finish_chain(chain, status="completed", summary=chain.final_summary or chain.latest_summary or "Chain completed.")
                    return
                step = self._execute_step(chain=chain, family=next_family, step_number=chain.steps_completed + 1)
                self._store.append_step(step)
                updated = self._apply_step_outcome(chain=chain, step=step)
                updated = self._store.update_chain(updated)
                if updated.status in {"completed", "failed", "stopped", "blocked"}:
                    return
            chain = self._store.get_chain(chain_id)
            if chain is not None and chain.status == "running":
                self._finish_chain(chain, status="stopped", summary="Stopped by operator.")
        finally:
            with self._lock:
                self._stop_events.pop(chain_id, None)
                self._threads.pop(chain_id, None)

    def _next_step_family(self, chain: TaskChainRecord) -> TaskChainStepFamily | None:
        stage = chain.metadata.get("stage", "")
        if chain.chain_type == "validate_then_report":
            if stage in {"", "validate"}:
                return self._validation_family_for_target(chain.primary_target_kind, chain.command_label)
            if stage == "report":
                return "report"
            return None
        if chain.chain_type == "feature_validate_loop":
            if stage == "":
                return "feature_status"
            if stage == "validate":
                return self._validation_family_for_target(chain.primary_target_kind, chain.command_label)
            if stage == "feature_status_after":
                return "feature_status"
            if stage == "report":
                return "report"
            return None
        if chain.chain_type == "dispatch_validate_recover":
            if stage in {"", "primary_validate"}:
                return self._validation_family_for_target(chain.primary_target_kind, chain.command_label)
            if stage == "fallback_validate":
                return self._validation_family_for_target(chain.fallback_target_kind, chain.command_label)
            if stage.startswith("report"):
                return "report"
            return None
        return None

    def _execute_step(self, *, chain: TaskChainRecord, family: TaskChainStepFamily, step_number: int) -> TaskChainStepRecord:
        if family == "feature_status":
            return self._execute_feature_status_step(chain=chain, step_number=step_number)
        if family == "report":
            return self._execute_report_step(chain=chain, step_number=step_number)
        return self._execute_validation_step(chain=chain, family=family, step_number=step_number)

    def _execute_feature_status_step(self, *, chain: TaskChainRecord, step_number: int) -> TaskChainStepRecord:
        started_at = self._now_iso()
        bundle = self._service.active_feature_bundle_for_chat(chat_id=chain.chat_id)
        message = self._service.feature_bundle_status_reply(chat_id=chain.chat_id)
        status = "success" if bundle is not None else "failed"
        return TaskChainStepRecord(
            step_id=self._store.generate_step_id(),
            chain_id=chain.chain_id,
            step_number=step_number,
            family="feature_status",
            label="feature bundle status",
            started_at=started_at,
            finished_at=self._now_iso(),
            status=status,  # type: ignore[arg-type]
            result_summary=message,
            progress_made=bundle is not None,
            failure_reason="No active bounded feature bundle is available." if bundle is None else "",
            metadata={"bundle_id": bundle.bundle_id if bundle is not None else ""},
        )

    def _execute_report_step(self, *, chain: TaskChainRecord, step_number: int) -> TaskChainStepRecord:
        started_at = self._now_iso()
        steps = self._store.steps_for_chain(chain.chain_id, limit=4)
        last = steps[-1] if steps else None
        summary = chain.latest_summary or (last.result_summary if last is not None else "No steps were recorded.")
        return TaskChainStepRecord(
            step_id=self._store.generate_step_id(),
            chain_id=chain.chain_id,
            step_number=step_number,
            family="report",
            label="final report",
            started_at=started_at,
            finished_at=self._now_iso(),
            status="success",
            result_summary=summary,
            progress_made=True,
            metadata={"report_status": chain.metadata.get("report_status", "completed")},
        )

    def _execute_validation_step(self, *, chain: TaskChainRecord, family: TaskChainStepFamily, step_number: int) -> TaskChainStepRecord:
        started_at = self._now_iso()
        target_kind, target_selector = self._current_target_for_step(chain)
        if family == "dispatch":
            return self._execute_dispatch_validation_step(
                chain=chain,
                step_number=step_number,
                started_at=started_at,
                target_selector=target_selector,
            )
        return self._execute_local_validation_step(
            chain=chain,
            step_number=step_number,
            started_at=started_at,
            family=family,
            target_kind=target_kind,
        )

    def _execute_local_validation_step(
        self,
        *,
        chain: TaskChainRecord,
        step_number: int,
        started_at: str,
        family: TaskChainStepFamily,
        target_kind: str,
    ) -> TaskChainStepRecord:
        request = self._build_local_request(chain=chain)
        target_node = self._service._node_registry.local_node() if target_kind == "local" else self._service.resolve_execution_node().node
        try:
            command_result = self._service._node_router.execute(node=target_node, request=request)
            status = "timed_out" if command_result.timed_out else ("success" if command_result.exit_code == 0 else "failed")
            return TaskChainStepRecord(
                step_id=self._store.generate_step_id(),
                chain_id=chain.chain_id,
                step_number=step_number,
                family=family,
                label=request.command_summary,
                started_at=started_at,
                finished_at=command_result.completed_at or self._now_iso(),
                status=status,  # type: ignore[arg-type]
                result_summary=command_result.output_summary,
                progress_made=status == "success",
                target_node_id=target_node.node_id,
                target_node_name=target_node.display_name,
                target_node_role=target_node.role,
                failure_reason=command_result.first_issue if status != "success" else "",
                metadata={"command_label": chain.command_label, "command_argument": chain.command_argument},
            )
        except (ExecutionRunnerError, NodeRoutingError) as exc:
            return TaskChainStepRecord(
                step_id=self._store.generate_step_id(),
                chain_id=chain.chain_id,
                step_number=step_number,
                family=family,
                label=request.command_summary,
                started_at=started_at,
                finished_at=self._now_iso(),
                status="unavailable" if getattr(exc, "code", "") in {"node_not_online", "command_not_found"} else "failed",
                result_summary=str(exc),
                progress_made=False,
                target_node_id=target_node.node_id,
                target_node_name=target_node.display_name,
                target_node_role=target_node.role,
                failure_reason=str(exc),
            )

    def _execute_dispatch_validation_step(
        self,
        *,
        chain: TaskChainRecord,
        step_number: int,
        started_at: str,
        target_selector: str,
    ) -> TaskChainStepRecord:
        target, code, message = self._service.resolve_dispatch_target(
            selector=target_selector,
            required_command_label=chain.command_label,
            requested_command=chain.command_text,
        )
        if target is None:
            return TaskChainStepRecord(
                step_id=self._store.generate_step_id(),
                chain_id=chain.chain_id,
                step_number=step_number,
                family="dispatch",
                label=f"dispatch {chain.command_label} {chain.command_argument}".strip(),
                started_at=started_at,
                finished_at=self._now_iso(),
                status="unavailable" if code != "dispatch_target_unknown" else "failed",
                result_summary=message,
                progress_made=False,
                target_node_role=target_selector if target_selector.startswith("role:") else "",
                failure_reason=message,
            )
        try:
            local_request = self._build_local_request(chain=chain, repo_root=target.node.repo_root)
        except ExecutionRunnerError as exc:
            return TaskChainStepRecord(
                step_id=self._store.generate_step_id(),
                chain_id=chain.chain_id,
                step_number=step_number,
                family="dispatch",
                label=f"dispatch {chain.command_label} {chain.command_argument}".strip(),
                started_at=started_at,
                finished_at=self._now_iso(),
                status="failed",
                result_summary=str(exc),
                progress_made=False,
                target_node_id=target.node.node_id,
                target_node_name=target.node.display_name,
                target_node_role=target.node.role,
                failure_reason=str(exc),
            )
        try:
            queued = self._service.queue_dispatch_job(
                record=self._service.build_chain_dispatch_record(
                    chain=chain,
                    target=target,
                    local_request=local_request,
                    chat_id=chain.chat_id,
                )
            )
        except NodeDispatchError as exc:
            return TaskChainStepRecord(
                step_id=self._store.generate_step_id(),
                chain_id=chain.chain_id,
                step_number=step_number,
                family="dispatch",
                label=f"dispatch {chain.command_label} {chain.command_argument}".strip(),
                started_at=started_at,
                finished_at=self._now_iso(),
                status="failed",
                result_summary=exc.message,
                progress_made=False,
                target_node_id=target.node.node_id,
                target_node_name=target.node.display_name,
                target_node_role=target.node.role,
                failure_reason=exc.message,
            )
        completed = self._wait_for_dispatch_job(queued.job_id)
        if completed is None:
            return TaskChainStepRecord(
                step_id=self._store.generate_step_id(),
                chain_id=chain.chain_id,
                step_number=step_number,
                family="dispatch",
                label=f"dispatch {chain.command_label} {chain.command_argument}".strip(),
                started_at=started_at,
                finished_at=self._now_iso(),
                status="timed_out",
                result_summary="Dispatch job did not complete before the chain wait limit.",
                progress_made=False,
                target_node_id=target.node.node_id,
                target_node_name=target.node.display_name,
                target_node_role=target.node.role,
                dispatch_job_id=queued.job_id,
                failure_reason="Dispatch job timed out while waiting for completion.",
            )
        step_status = "success"
        if completed.status == "failed":
            step_status = "failed"
        elif completed.status == "refused":
            step_status = "refused"
        return TaskChainStepRecord(
            step_id=self._store.generate_step_id(),
            chain_id=chain.chain_id,
            step_number=step_number,
            family="dispatch",
            label=f"dispatch {chain.command_label} {chain.command_argument}".strip(),
            started_at=started_at,
            finished_at=completed.finished_at or self._now_iso(),
            status=step_status,  # type: ignore[arg-type]
            result_summary=completed.result_summary or completed.failure_reason or completed.status,
            progress_made=step_status == "success",
            target_node_id=completed.target_node_id,
            target_node_name=completed.target_node_name,
            target_node_role=completed.target_node_role,
            dispatch_job_id=completed.job_id,
            failure_reason=completed.failure_reason,
        )

    def _apply_step_outcome(self, *, chain: TaskChainRecord, step: TaskChainStepRecord) -> TaskChainRecord:
        metadata = dict(chain.metadata)
        metadata["last_step_family"] = step.family
        metadata["last_step_status"] = step.status
        success_count = chain.success_count + (1 if step.status == "success" else 0)
        failure_count = chain.failure_count + (0 if step.status == "success" else 1)
        no_progress_count = 0 if step.progress_made else chain.no_progress_count + 1
        latest_summary = self._step_summary(chain=chain, step=step)
        updated = replace(
            chain,
            latest_step_id=step.step_id,
            steps_completed=chain.steps_completed + 1,
            success_count=success_count,
            failure_count=failure_count,
            no_progress_count=no_progress_count,
            last_failure_reason=step.failure_reason if step.status != "success" else chain.last_failure_reason,
            latest_summary=latest_summary,
            metadata=self._advance_stage(chain=chain, step=step, metadata=metadata),
        )
        allow_fallback_on_unavailable = (
            chain.chain_type == "dispatch_validate_recover"
            and chain.metadata.get("stage", "") in {"", "primary_validate"}
            and chain.fallback_policy == "fallback_target"
            and bool(chain.fallback_target_display)
        )
        if step.status == "unavailable" and not allow_fallback_on_unavailable:
            return replace(
                updated,
                status="blocked",
                stop_reason=step.failure_reason or step.result_summary,
                finished_at=self._now_iso(),
                final_summary=step.failure_reason or step.result_summary,
            )
        if updated.failure_count >= updated.max_failures:
            return replace(
                updated,
                status="failed",
                stop_reason=f"Reached max_failures={updated.max_failures}.",
                finished_at=self._now_iso(),
                final_summary=f"Stopped after reaching max_failures={updated.max_failures}.",
            )
        if updated.no_progress_count >= updated.max_no_progress:
            return replace(
                updated,
                status="blocked",
                stop_reason=f"Reached max_no_progress={updated.max_no_progress}.",
                finished_at=self._now_iso(),
                final_summary=f"Stopped after {updated.no_progress_count} no-progress step(s).",
            )
        if step.family == "report":
            final_status = "completed"
            if chain.chain_type == "dispatch_validate_recover" and step.metadata.get("report_status") == "failed":
                final_status = "failed"
            return replace(
                updated,
                status=final_status,  # type: ignore[arg-type]
                finished_at=self._now_iso(),
                final_summary=step.result_summary,
                stop_reason=step.result_summary,
            )
        return updated

    def _advance_stage(self, *, chain: TaskChainRecord, step: TaskChainStepRecord, metadata: dict[str, str]) -> dict[str, str]:
        stage = chain.metadata.get("stage", "")
        if chain.chain_type == "validate_then_report":
            metadata["stage"] = "report" if step.family != "report" else "done"
            if step.family == "report":
                metadata["report_status"] = "completed"
            return metadata
        if chain.chain_type == "feature_validate_loop":
            if stage == "":
                metadata["stage"] = "validate"
            elif stage == "validate":
                metadata["stage"] = "feature_status_after"
            elif stage == "feature_status_after":
                metadata["stage"] = "report"
            else:
                metadata["stage"] = "done"
            if step.family == "report":
                metadata["report_status"] = "completed"
            return metadata
        if chain.chain_type == "dispatch_validate_recover":
            if stage in {"", "primary_validate"}:
                if step.status == "success":
                    metadata["stage"] = "report_success"
                    metadata["report_status"] = "completed"
                elif chain.fallback_policy == "fallback_target" and chain.fallback_target_display:
                    metadata["stage"] = "fallback_validate"
                else:
                    metadata["stage"] = "report_failed"
                    metadata["report_status"] = "failed"
            elif stage == "fallback_validate":
                metadata["stage"] = "report_recovery" if step.status == "success" else "report_failed"
                metadata["report_status"] = "completed" if step.status == "success" else "failed"
            else:
                metadata["stage"] = "done"
            return metadata
        return metadata

    def _step_summary(self, *, chain: TaskChainRecord, step: TaskChainStepRecord) -> str:
        if step.family == "report":
            return step.result_summary
        if step.status == "success":
            return f"Step {step.step_number} {step.family} succeeded: {step.result_summary}"
        return f"Step {step.step_number} {step.family} ended with {step.status}: {step.result_summary}"

    def _current_target_for_step(self, chain: TaskChainRecord) -> tuple[str, str]:
        stage = chain.metadata.get("stage", "")
        if chain.chain_type == "dispatch_validate_recover" and stage == "fallback_validate":
            return chain.fallback_target_kind, chain.fallback_target_selector
        return chain.primary_target_kind, chain.primary_target_selector

    def _build_local_request(self, *, chain: TaskChainRecord, repo_root: str | None = None) -> LocalCommandExecutionRequest:
        effective_repo_root = (repo_root or self._service._config.repo_root).strip()
        operator_reason = f"task chain {chain.chain_id}"
        if chain.command_label == "/run":
            return self._service._execution_runner.build_run_request(
                capability_id="shell.command.run",
                repo_root=effective_repo_root,
                command_text=chain.command_argument,
                operator_reason=operator_reason,
                expected_scope=self._service._repo_display_name(effective_repo_root),
            )
        return self._service._execution_runner.build_test_request(
            capability_id="test.command.run",
            repo_root=effective_repo_root,
            target=chain.command_argument,
            operator_reason=operator_reason,
            expected_scope=self._service._repo_display_name(effective_repo_root),
        )

    def _wait_for_dispatch_job(self, job_id: str) -> NodeDispatchRecord | None:
        for _ in range(200):
            record = self._service.get_dispatch_job(job_id)
            if record is not None and record.status in {"completed", "failed", "refused"}:
                return record
            sleep(0.05)
        return None

    def _finish_chain(self, chain: TaskChainRecord, *, status: str, summary: str) -> TaskChainRecord:
        final = replace(
            chain,
            status=status,  # type: ignore[arg-type]
            finished_at=self._now_iso(),
            final_summary=summary.strip(),
            latest_summary=summary.strip(),
            stop_reason=chain.stop_reason or summary.strip(),
        )
        return self._store.update_chain(final)

    def _require_chain(self, chain_id: str) -> TaskChainRecord:
        chain = self._store.get_chain(chain_id)
        if chain is None:
            raise ValueError(f"Unknown task chain: {chain_id}")
        return chain

    @staticmethod
    def _validation_family_for_target(target_kind: str, command_label: str) -> TaskChainStepFamily:
        if target_kind in {"node", "role"}:
            return "dispatch"
        return "test" if command_label == "/test" else "run"

    @staticmethod
    def _now_iso() -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")