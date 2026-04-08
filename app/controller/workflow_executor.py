"""Deterministic workflow executor for explicit multi-step operator commands."""
from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

from .telegram_service import TelegramInboundMessage
from .workflow_models import WorkflowRecord, WorkflowStep, WorkflowType

if TYPE_CHECKING:
    from .capability_executor import CapabilityExecutor
    from .execution_models import CapabilityExecutionResult
    from .models import ControllerSnapshot
    from .confirmation_models import PendingConfirmation
    from .context_models import BufferedContext
    from .app_service import ControllerService


class WorkflowExecutor:
    def __init__(self, service: ControllerService, capability_executor: CapabilityExecutor) -> None:
        self._service = service
        self._capability_executor = capability_executor

    def execute_repo_explain(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        relative_path: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        file_path = " ".join(relative_path.split())
        steps = [
            WorkflowStep(
                step_id="S1",
                step_type="repo_status",
                capability_id="repo.status.read",
                description="Read current repository status.",
                input_summary="/repo status",
            )
        ]
        if file_path:
            steps.append(
                WorkflowStep(
                    step_id="S2",
                    step_type="file_read",
                    capability_id="file.read",
                    description="Read the requested file preview.",
                    input_summary=file_path,
                )
            )
            ask_step_id = "S3"
            ask_prompt = (
                "Provide a concise operator-facing explanation of the repository status and how the selected file fits into it. "
                "Focus on branch state, current dirtiness, and the file's role."
            )
        else:
            ask_step_id = "S2"
            ask_prompt = (
                "Provide a concise operator-facing explanation of the current repository status, branch state, and recent changes."
            )
        steps.append(
            WorkflowStep(
                step_id=ask_step_id,
                step_type="ask",
                capability_id="ask.provider_query",
                description="Ask for a concise grounded explanation.",
                input_summary="workflow prompt hidden",
            )
        )
        record = self._create_workflow(
            workflow_type="repo.explain",
            name="repo.explain",
            description="Explain repository state with optional file grounding.",
            update=update,
            steps=tuple(steps),
            metadata={"relative_path": file_path, "ask_prompt": ask_prompt},
        )
        return self._execute_workflow(
            record=record,
            update=update,
            snapshot=snapshot,
            batch_busy=batch_busy,
        )

    def execute_file_explain(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        relative_path: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        file_path = " ".join(relative_path.split())
        record = self._create_workflow(
            workflow_type="file.explain",
            name="file.explain",
            description="Read one file and ask for a concise explanation.",
            update=update,
            steps=(
                WorkflowStep(
                    step_id="S1",
                    step_type="file_read",
                    capability_id="file.read",
                    description="Read the requested file preview.",
                    input_summary=file_path or "[missing]",
                ),
                WorkflowStep(
                    step_id="S2",
                    step_type="ask",
                    capability_id="ask.provider_query",
                    description="Ask for a concise grounded explanation.",
                    input_summary="workflow prompt hidden",
                ),
            ),
            metadata={
                "relative_path": file_path,
                "ask_prompt": "Provide a concise operator-facing explanation of this file, its role, and any notable boundaries or interfaces.",
            },
        )
        return self._execute_workflow(
            record=record,
            update=update,
            snapshot=snapshot,
            batch_busy=batch_busy,
        )

    def execute_web_summarize(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        target_url: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        record = self._create_workflow(
            workflow_type="web.summarize",
            name="web.summarize",
            description="Fetch one allowed URL and ask for a concise summary.",
            update=update,
            steps=(
                WorkflowStep(
                    step_id="S1",
                    step_type="web_fetch",
                    capability_id="web.fetch.read",
                    description="Fetch the requested web preview.",
                    input_summary=" ".join(target_url.split()) or "[missing]",
                ),
                WorkflowStep(
                    step_id="S2",
                    step_type="ask",
                    capability_id="ask.provider_query",
                    description="Ask for a concise grounded summary.",
                    input_summary="workflow prompt hidden",
                ),
            ),
            metadata={
                "target_url": " ".join(target_url.split()),
                "ask_prompt": "Provide a concise operator-facing summary of this page and why it may be relevant.",
            },
        )
        return self._execute_workflow(
            record=record,
            update=update,
            snapshot=snapshot,
            batch_busy=batch_busy,
        )

    def resume_confirmation(
        self,
        *,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult | None:
        workflow_id = confirmation.metadata.get("workflow_id", "").strip().upper()
        if not workflow_id:
            return None
        record = self._service._workflow_store.get(workflow_id)
        if record is None:
            return None
        update = TelegramInboundMessage(
            update_id=0,
            chat_id=chat_id,
            text=f"/confirm {confirmation.confirmation_id}",
            sender_label=confirmation.requester_label,
        )
        step_index = max(0, int(confirmation.metadata.get("workflow_step_index", str(max(1, record.current_step_index))) or "1") - 1)
        updated = replace(
            record,
            current_state="running",
            confirmation_state="approved",
            current_step_index=step_index + 1,
            audit_summary=self._workflow_audit_summary(
                replace(record, current_state="running", confirmation_state="approved", current_step_index=step_index + 1)
            ),
        )
        self._service._workflow_store.update(updated)
        return self._execute_workflow(
            record=updated,
            update=update,
            snapshot=snapshot,
            batch_busy=False,
            start_index=step_index,
            confirmation=confirmation,
        )

    def mark_confirmation_resolution(self, *, confirmation: PendingConfirmation | None, outcome: str) -> None:
        if confirmation is None:
            return
        workflow_id = confirmation.metadata.get("workflow_id", "").strip().upper()
        if not workflow_id:
            return
        record = self._service._workflow_store.get(workflow_id)
        if record is None:
            return
        state = "cancelled" if outcome == "rejected" else "failed"
        confirmation_state = "denied" if outcome == "rejected" else "expired"
        summary = (
            f"Workflow {record.workflow_type} cancelled at step {record.current_step_index}/{record.total_steps}."
            if outcome == "rejected"
            else f"Workflow {record.workflow_type} expired at step {record.current_step_index}/{record.total_steps}."
        )
        updated = replace(
            record,
            current_state=state,
            confirmation_state=confirmation_state,
            finished_at=self._service._now_iso(),
            audit_summary=summary,
            final_user_facing_summary=summary,
        )
        self._service._workflow_store.update(updated)

    def _execute_workflow(
        self,
        *,
        record: WorkflowRecord,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        batch_busy: bool,
        start_index: int = 0,
        confirmation: PendingConfirmation | None = None,
    ) -> CapabilityExecutionResult:
        running_record = record
        if running_record.started_at == "":
            running_record = replace(
                running_record,
                started_at=self._service._now_iso(),
                current_state="running",
                current_step_index=max(1, start_index + 1),
                audit_summary=self._workflow_audit_summary(
                    replace(record, started_at=self._service._now_iso(), current_state="running", current_step_index=max(1, start_index + 1))
                ),
            )
            self._service._workflow_store.update(running_record)

        for index in range(start_index, len(running_record.steps)):
            step = running_record.steps[index]
            context_inputs = self._context_inputs_for_step(running_record, index)
            running_record = self._update_step(
                running_record,
                index,
                outcome="running",
                context_input_ids=context_inputs,
                started_at=self._service._now_iso(),
                current_state="running",
                confirmation_state="none" if confirmation is None else "approved",
                current_step_index=index + 1,
            )

            step_result = self._run_step(
                record=running_record,
                step=running_record.steps[index],
                update=update,
                snapshot=snapshot,
                batch_busy=batch_busy,
                confirmation=confirmation if index == start_index else None,
            )
            output_context_id = self._output_context_id(step_result)
            running_record = self._update_step(
                running_record,
                index,
                outcome=step_result.outcome,
                outcome_reason=step_result.outcome_reason_code,
                context_input_ids=context_inputs,
                output_context_id=output_context_id,
                started_at=running_record.steps[index].started_at,
                finished_at=step_result.finished_at,
                duration_ms=step_result.duration_ms,
            )

            is_terminal = index == len(running_record.steps) - 1
            if step_result.outcome == "success":
                if not is_terminal:
                    self._service._remember_execution_result(step_result)
                    continue
                completed = replace(
                    running_record,
                    current_state="completed",
                    confirmation_state="approved" if confirmation is not None else running_record.confirmation_state,
                    finished_at=step_result.finished_at,
                    audit_summary=self._workflow_audit_summary(
                        replace(running_record, current_state="completed", finished_at=step_result.finished_at)
                    ),
                    final_user_facing_summary=self._workflow_user_summary(
                        running_record,
                        state="completed",
                        step=running_record.steps[index],
                        step_result=step_result,
                    ),
                )
                self._service._workflow_store.update(completed)
                return self._wrap_step_result(
                    step_result,
                    record=completed,
                    step=completed.steps[index],
                    state="completed",
                )

            if step_result.outcome == "confirmation_required":
                confirmation_id = str(step_result.telemetry.get("confirmation_id") or "").strip().upper()
                if confirmation_id:
                    self._service._attach_workflow_metadata_to_confirmation(
                        confirmation_id=confirmation_id,
                        workflow_id=running_record.workflow_id,
                        workflow_type=running_record.workflow_type,
                        workflow_step_id=running_record.steps[index].step_id,
                        workflow_step_index=index + 1,
                    )
                waiting = replace(
                    running_record,
                    current_state="waiting_confirmation",
                    confirmation_state="pending",
                    audit_summary=self._workflow_audit_summary(
                        replace(running_record, current_state="waiting_confirmation", confirmation_state="pending")
                    ),
                    final_user_facing_summary=self._workflow_user_summary(
                        running_record,
                        state="waiting_confirmation",
                        step=running_record.steps[index],
                        step_result=step_result,
                    ),
                )
                self._service._workflow_store.update(waiting)
                return self._wrap_step_result(
                    step_result,
                    record=waiting,
                    step=waiting.steps[index],
                    state="waiting_confirmation",
                )

            failed_state = "cancelled" if step_result.outcome == "denied" else ("blocked" if step_result.outcome in {"blocked", "out_of_scope", "unavailable", "degraded"} else "failed")
            failed = replace(
                running_record,
                current_state=failed_state,
                finished_at=step_result.finished_at,
                confirmation_state=running_record.confirmation_state,
                audit_summary=self._workflow_audit_summary(
                    replace(running_record, current_state=failed_state, finished_at=step_result.finished_at)
                ),
                final_user_facing_summary=self._workflow_user_summary(
                    running_record,
                    state=failed_state,
                    step=running_record.steps[index],
                    step_result=step_result,
                ),
            )
            self._service._workflow_store.update(failed)
            return self._wrap_step_result(
                step_result,
                record=failed,
                step=failed.steps[index],
                state=failed_state,
            )

        completed = replace(
            running_record,
            current_state="completed",
            finished_at=self._service._now_iso(),
            audit_summary=self._workflow_audit_summary(replace(running_record, current_state="completed", finished_at=self._service._now_iso())),
            final_user_facing_summary=f"Workflow {running_record.workflow_type} completed.",
        )
        self._service._workflow_store.update(completed)
        raise RuntimeError("Workflow execution ended without a terminal step result.")

    def _run_step(
        self,
        *,
        record: WorkflowRecord,
        step: WorkflowStep,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        batch_busy: bool,
        confirmation: PendingConfirmation | None,
    ) -> CapabilityExecutionResult:
        if step.capability_id == "repo.status.read":
            return self._capability_executor._execute_repo_status(update=update, snapshot=snapshot, argument="")
        if step.capability_id == "file.read":
            return self._capability_executor._execute_file_read(
                update=update,
                snapshot=snapshot,
                argument=record.metadata.get("relative_path", ""),
            )
        if step.capability_id == "web.fetch.read":
            if confirmation is not None:
                request = self._capability_executor._build_request(
                    capability_id="web.fetch.read",
                    snapshot=snapshot,
                    chat_id=update.chat_id,
                    requester_label=confirmation.requester_label,
                    original_command="/confirm",
                    parsed_arguments={"confirmation_id": confirmation.confirmation_id},
                    confirmation_context=confirmation.evaluation_context,
                    metadata={"argument_summary": f"/confirm {confirmation.confirmation_id}"},
                )
                return self._capability_executor._execute_confirmed_web_fetch(
                    request=request,
                    confirmation=confirmation,
                    snapshot=snapshot,
                    chat_id=update.chat_id,
                )
            return self._capability_executor._execute_web_fetch(
                update=update,
                snapshot=snapshot,
                argument=record.metadata.get("target_url", ""),
            )
        if step.capability_id == "ask.provider_query":
            context_entries = self._resolve_context_entries(record, step)
            if confirmation is not None:
                request = self._capability_executor._build_request(
                    capability_id="ask.provider_query",
                    snapshot=snapshot,
                    chat_id=update.chat_id,
                    requester_label=confirmation.requester_label,
                    original_command="/confirm",
                    parsed_arguments={"confirmation_id": confirmation.confirmation_id},
                    confirmation_context=confirmation.evaluation_context,
                    metadata={
                        "argument_summary": f"/confirm {confirmation.confirmation_id}",
                        "response_style": confirmation.response_style,
                    },
                )
                return self._capability_executor._execute_confirmed_provider_query(
                    request=request,
                    confirmation=confirmation,
                    snapshot=snapshot,
                    chat_id=update.chat_id,
                )
            return self._capability_executor._execute_provider_query(
                update=update,
                snapshot=snapshot,
                command_label="/ask",
                prompt=record.metadata.get("ask_prompt", ""),
                response_style="concise",
                batch_busy=batch_busy,
                context_entry=context_entries[0] if len(context_entries) == 1 else None,
                context_entries=context_entries if len(context_entries) > 1 else (),
            )
        raise RuntimeError(f"Unsupported workflow step capability: {step.capability_id}")

    def _resolve_context_entries(self, record: WorkflowRecord, step: WorkflowStep) -> tuple[BufferedContext, ...]:
        entries: list[BufferedContext] = []
        for context_id in step.context_input_ids:
            context_entry = self._service.resolve_context_for_chat(chat_id=record.chat_id, reference=context_id)
            if context_entry is not None:
                entries.append(context_entry)
        return tuple(entries)

    def _context_inputs_for_step(self, record: WorkflowRecord, step_index: int) -> tuple[str, ...]:
        context_ids: list[str] = []
        for prior_step in record.steps[:step_index]:
            if prior_step.output_context_id:
                context_ids.append(prior_step.output_context_id)
        return tuple(context_ids)

    def _output_context_id(self, step_result: CapabilityExecutionResult) -> str:
        return str(step_result.telemetry.get("context_created_id") or "").strip()

    def _create_workflow(
        self,
        *,
        workflow_type: WorkflowType,
        name: str,
        description: str,
        update: TelegramInboundMessage,
        steps: tuple[WorkflowStep, ...],
        metadata: dict[str, str],
    ) -> WorkflowRecord:
        created_at = self._service._now_iso()
        record = WorkflowRecord(
            workflow_id=self._service._workflow_store.generate_id(),
            workflow_type=workflow_type,
            name=name,
            description=description,
            created_at=created_at,
            current_state="pending",
            current_step_index=0,
            total_steps=len(steps),
            steps=steps,
            step_outcomes=tuple(step.outcome for step in steps),
            user_id=update.chat_id,
            chat_id=update.chat_id,
            confirmation_state="none",
            audit_summary=f"Workflow {workflow_type} pending.",
            final_user_facing_summary="",
            metadata=dict(metadata),
        )
        return self._service._workflow_store.create(record)

    def _update_step(
        self,
        record: WorkflowRecord,
        step_index: int,
        *,
        outcome: str,
        current_state: str | None = None,
        confirmation_state: str | None = None,
        current_step_index: int | None = None,
        context_input_ids: tuple[str, ...] | None = None,
        output_context_id: str | None = None,
        outcome_reason: str | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
        duration_ms: int | None = None,
    ) -> WorkflowRecord:
        steps = list(record.steps)
        current = steps[step_index]
        steps[step_index] = replace(
            current,
            outcome=outcome,  # type: ignore[arg-type]
            context_input_ids=current.context_input_ids if context_input_ids is None else context_input_ids,
            output_context_id=current.output_context_id if output_context_id is None else output_context_id,
            outcome_reason=current.outcome_reason if outcome_reason is None else outcome_reason,
            started_at=current.started_at if started_at is None else started_at,
            finished_at=current.finished_at if finished_at is None else finished_at,
            duration_ms=current.duration_ms if duration_ms is None else duration_ms,
        )
        updated = replace(
            record,
            steps=tuple(steps),
            step_outcomes=tuple(step.outcome for step in steps),
            current_state=record.current_state if current_state is None else current_state,  # type: ignore[arg-type]
            confirmation_state=record.confirmation_state if confirmation_state is None else confirmation_state,  # type: ignore[arg-type]
            current_step_index=record.current_step_index if current_step_index is None else current_step_index,
        )
        return self._service._workflow_store.update(
            replace(updated, audit_summary=self._workflow_audit_summary(updated))
        )

    def _wrap_step_result(
        self,
        step_result: CapabilityExecutionResult,
        *,
        record: WorkflowRecord,
        step: WorkflowStep,
        state: str,
    ) -> CapabilityExecutionResult:
        updated_request = replace(step_result.request, original_command=self._workflow_command(record.workflow_type))
        telemetry = dict(step_result.telemetry)
        telemetry.update(
            {
                "workflow_id": record.workflow_id,
                "workflow_type": record.workflow_type,
                "workflow_state": record.current_state,
                "workflow_step_id": step.step_id,
                "workflow_step_description": step.description,
                "workflow_summary": record.audit_summary,
            }
        )
        return replace(
            step_result,
            request=updated_request,
            command_label=self._workflow_command(record.workflow_type),
            user_message=record.final_user_facing_summary,
            internal_summary=record.audit_summary,
            telemetry=telemetry,
        )

    def _workflow_audit_summary(self, record: WorkflowRecord) -> str:
        attempted = sum(1 for step in record.steps if step.outcome != "pending")
        state_label = record.current_state.replace("_", " ")
        return f"Workflow {record.workflow_type} {state_label} after {attempted}/{record.total_steps} steps."

    def _workflow_user_summary(
        self,
        record: WorkflowRecord,
        *,
        state: str,
        step: WorkflowStep,
        step_result: CapabilityExecutionResult,
    ) -> str:
        if state == "completed":
            return "\n".join((f"Workflow: {record.workflow_type} completed.", step_result.user_message))
        if state == "waiting_confirmation":
            return "\n".join(
                (
                    f"Workflow paused: {record.workflow_type}",
                    f"Blocking step: {step.capability_id} ({record.current_step_index}/{record.total_steps})",
                    step_result.user_message,
                )
            )
        return "\n".join(
            (
                f"Workflow failed: {record.workflow_type}",
                f"Blocking step: {step.capability_id} ({record.current_step_index}/{record.total_steps})",
                step_result.user_message,
            )
        )

    @staticmethod
    def _workflow_command(workflow_type: WorkflowType) -> str:
        return {
            "repo.explain": "/explainrepo",
            "file.explain": "/explainfile",
            "web.summarize": "/summarizeweb",
        }[workflow_type]