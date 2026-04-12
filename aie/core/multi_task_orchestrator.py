from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from .execution_orchestrator import ExecutionOrchestrator
from .models import (
    ConstraintRouterHandoff,
    LifecycleState,
    MultiTaskAction,
    MultiTaskDecision,
    MultiTaskOrchestrationRequest,
    MultiTaskOrchestrationResult,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    OrchestrationRequest,
    OrchestrationResult,
    PersistedExecutionSession,
    ResumeRequest,
    SessionSelectionReason,
    TaskExecutionResult,
)


class MultiTaskOrchestrator:
    """Coordinate multiple bounded sessions without merging their execution state."""

    _SELECTION_BUCKETS: tuple[tuple[MultiTaskPriority, MultiTaskSessionStatus], ...] = (
        (MultiTaskPriority.URGENT, MultiTaskSessionStatus.RESUMABLE),
        (MultiTaskPriority.HIGH, MultiTaskSessionStatus.RESUMABLE),
        (MultiTaskPriority.URGENT, MultiTaskSessionStatus.READY),
        (MultiTaskPriority.HIGH, MultiTaskSessionStatus.READY),
        (MultiTaskPriority.NORMAL, MultiTaskSessionStatus.RESUMABLE),
        (MultiTaskPriority.NORMAL, MultiTaskSessionStatus.READY),
        (MultiTaskPriority.LOW, MultiTaskSessionStatus.RESUMABLE),
        (MultiTaskPriority.LOW, MultiTaskSessionStatus.READY),
    )

    def __init__(self, execution_orchestrator: ExecutionOrchestrator | None = None) -> None:
        self._execution_orchestrator = execution_orchestrator or ExecutionOrchestrator()

    def build_session_record(
        self,
        *,
        session_id: str | None = None,
        priority: MultiTaskPriority = MultiTaskPriority.NORMAL,
        router_handoff: ConstraintRouterHandoff | None = None,
        prior_execution_result: TaskExecutionResult | None = None,
        orchestration_result: OrchestrationResult | None = None,
        persisted_session: PersistedExecutionSession | None = None,
        resume_request: ResumeRequest | None = None,
        last_updated: str | None = None,
        notes: tuple[str, ...] = (),
    ) -> MultiTaskSessionRecord:
        if persisted_session is not None:
            session_id = session_id or persisted_session.session_id
            router_handoff = router_handoff or persisted_session.router_handoff
            prior_execution_result = prior_execution_result or persisted_session.task_execution_result
            orchestration_result = orchestration_result or persisted_session.orchestration_result
            if last_updated is None:
                last_updated = persisted_session.saved_at
            notes = tuple(dict.fromkeys(notes + persisted_session.notes))

        if orchestration_result is not None and prior_execution_result is None:
            prior_execution_result = orchestration_result.execution_result

        if session_id is None:
            raise ValueError("session_id is required to build a multi-task session record.")

        inspection = self._execution_orchestrator.inspect(
            OrchestrationRequest(
                handoff=router_handoff,
                prior_execution_result=prior_execution_result,
                resume_request=resume_request,
            )
        )
        session_status = self.classify_session_status(inspection.lifecycle_state)
        return MultiTaskSessionRecord(
            session_id=session_id,
            priority=priority,
            lifecycle_state=inspection.lifecycle_state,
            session_status=session_status,
            last_executor_status=inspection.prior_executor_status,
            required_human_action=inspection.required_human_action,
            resumable=inspection.lifecycle_state == LifecycleState.RESUMABLE,
            blocked=session_status == MultiTaskSessionStatus.BLOCKED,
            last_updated=last_updated or self._timestamp(),
            router_handoff=router_handoff,
            prior_execution_result=prior_execution_result,
            orchestration_result=orchestration_result,
            persisted_session=persisted_session,
            resume_request=resume_request,
            notes=notes,
        )

    def register_session(
        self,
        registry: tuple[MultiTaskSessionRecord, ...],
        session: MultiTaskSessionRecord,
    ) -> tuple[tuple[MultiTaskSessionRecord, ...], MultiTaskSessionRecord]:
        normalized = self._normalize_record(session)
        updated_registry = list(registry)
        for index, existing in enumerate(updated_registry):
            if existing.session_id == normalized.session_id:
                updated_registry[index] = normalized
                break
        else:
            updated_registry.append(normalized)
        return tuple(updated_registry), normalized

    def list_sessions(self, registry: tuple[MultiTaskSessionRecord, ...]) -> tuple[MultiTaskSessionRecord, ...]:
        return tuple(self._normalize_record(record) for record in registry)

    @staticmethod
    def classify_session_status(lifecycle_state: LifecycleState) -> MultiTaskSessionStatus:
        mapping = {
            LifecycleState.READY_TO_EXECUTE: MultiTaskSessionStatus.READY,
            LifecycleState.AWAITING_CONFIRMATION: MultiTaskSessionStatus.WAITING,
            LifecycleState.AWAITING_REVIEW: MultiTaskSessionStatus.WAITING,
            LifecycleState.AWAITING_PLAYTEST: MultiTaskSessionStatus.WAITING,
            LifecycleState.RESUMABLE: MultiTaskSessionStatus.RESUMABLE,
            LifecycleState.BLOCKED: MultiTaskSessionStatus.BLOCKED,
            LifecycleState.COMPLETED: MultiTaskSessionStatus.COMPLETED,
            LifecycleState.FAILED: MultiTaskSessionStatus.FAILED,
            LifecycleState.INVALID_REQUEST: MultiTaskSessionStatus.INVALID,
        }
        return mapping[lifecycle_state]

    def select_next_session(
        self,
        registry: tuple[MultiTaskSessionRecord, ...],
        *,
        allowed_statuses: tuple[MultiTaskSessionStatus, ...] = (
            MultiTaskSessionStatus.RESUMABLE,
            MultiTaskSessionStatus.READY,
        ),
    ) -> tuple[MultiTaskSessionRecord | None, SessionSelectionReason, tuple[str, ...]]:
        normalized_registry = self.list_sessions(registry)
        actionable_ids = tuple(
            record.session_id for record in normalized_registry if record.session_status in allowed_statuses
        )
        for priority, session_status in self._SELECTION_BUCKETS:
            if session_status not in allowed_statuses:
                continue
            candidates = [
                (index, record)
                for index, record in enumerate(normalized_registry)
                if record.priority == priority and record.session_status == session_status
            ]
            if not candidates:
                continue
            chosen_index, chosen = min(candidates, key=lambda item: (self._sort_timestamp(item[1].last_updated), item[0]))
            if len(candidates) > 1:
                return chosen, SessionSelectionReason.STABLE_TIEBREAKER, actionable_ids
            if session_status == MultiTaskSessionStatus.RESUMABLE:
                return chosen, SessionSelectionReason.HIGHEST_PRIORITY_RESUMABLE, actionable_ids
            return chosen, SessionSelectionReason.HIGHEST_PRIORITY_READY, actionable_ids
        return None, SessionSelectionReason.NO_ACTIONABLE_SESSIONS, actionable_ids

    def orchestrate(self, request: MultiTaskOrchestrationRequest) -> MultiTaskOrchestrationResult:
        registry, registered_session_ids = self._apply_registrations(
            registry=request.session_registry,
            sessions_to_register=request.sessions_to_register,
        )
        registry = self.list_sessions(registry)
        buckets = self._bucket_session_ids(registry)

        if request.requested_action == MultiTaskAction.REGISTER_SESSION:
            decision = MultiTaskDecision(
                chosen_action=MultiTaskAction.REGISTER_SESSION,
                actionable_session_ids=buckets["actionable"],
                waiting_session_ids=buckets["waiting"],
                blocked_session_ids=buckets["blocked"],
                completed_session_ids=buckets["completed"],
                invalid_session_ids=buckets["invalid"],
                decision_notes=("Registered bounded sessions without routing execution.",),
            )
            return MultiTaskOrchestrationResult(
                decision=decision,
                session_registry=registry,
                selected_session_result=None,
                registered_session_ids=registered_session_ids,
                notes=request.notes,
            )

        if request.requested_action == MultiTaskAction.INSPECT_SESSIONS:
            decision = MultiTaskDecision(
                chosen_action=MultiTaskAction.INSPECT_SESSIONS,
                actionable_session_ids=buckets["actionable"],
                waiting_session_ids=buckets["waiting"],
                blocked_session_ids=buckets["blocked"],
                completed_session_ids=buckets["completed"],
                invalid_session_ids=buckets["invalid"],
                decision_notes=("Inspected bounded multi-session registry state.",),
            )
            return MultiTaskOrchestrationResult(
                decision=decision,
                session_registry=registry,
                selected_session_result=None,
                registered_session_ids=registered_session_ids,
                notes=request.notes,
            )

        if request.requested_action == MultiTaskAction.SELECT_NEXT_SESSION:
            selected, selection_reason, actionable_ids = self.select_next_session(registry)
            chosen_action = MultiTaskAction.SELECT_NEXT_SESSION
            if selected is None:
                chosen_action = self._idle_action(registry)
            decision = MultiTaskDecision(
                chosen_action=chosen_action,
                selected_session_id=selected.session_id if selected else None,
                selection_reason=selection_reason,
                actionable_session_ids=actionable_ids,
                waiting_session_ids=buckets["waiting"],
                blocked_session_ids=buckets["blocked"],
                completed_session_ids=buckets["completed"],
                invalid_session_ids=buckets["invalid"],
                decision_notes=self._selection_notes(selected=selected, selection_reason=selection_reason),
            )
            return MultiTaskOrchestrationResult(
                decision=decision,
                session_registry=registry,
                selected_session_result=None,
                registered_session_ids=registered_session_ids,
                notes=request.notes,
            )

        if request.requested_action in {MultiTaskAction.EXECUTE_SELECTED, MultiTaskAction.RESUME_SELECTED}:
            target_status = (
                MultiTaskSessionStatus.READY
                if request.requested_action == MultiTaskAction.EXECUTE_SELECTED
                else MultiTaskSessionStatus.RESUMABLE
            )
            selected, selection_reason, actionable_ids = self._resolve_selected_session(
                registry=registry,
                selected_session_id=request.selected_session_id,
                target_status=target_status,
            )
            if selected is None:
                chosen_action = self._idle_action(registry) if selection_reason == SessionSelectionReason.NO_ACTIONABLE_SESSIONS else MultiTaskAction.REJECT
                decision = MultiTaskDecision(
                    chosen_action=chosen_action,
                    selected_session_id=request.selected_session_id,
                    selection_reason=selection_reason,
                    actionable_session_ids=actionable_ids,
                    waiting_session_ids=buckets["waiting"],
                    blocked_session_ids=buckets["blocked"],
                    completed_session_ids=buckets["completed"],
                    invalid_session_ids=buckets["invalid"],
                    decision_notes=self._selection_notes(selected=None, selection_reason=selection_reason),
                )
                return MultiTaskOrchestrationResult(
                    decision=decision,
                    session_registry=registry,
                    selected_session_result=None,
                    registered_session_ids=registered_session_ids,
                    notes=request.notes,
                )

            selected_result = self.orchestrate_selected_session(selected)
            updated_record = self.update_session_record(selected, selected_result)
            updated_registry = tuple(
                updated_record if record.session_id == updated_record.session_id else record for record in registry
            )
            updated_buckets = self._bucket_session_ids(updated_registry)
            decision = MultiTaskDecision(
                chosen_action=request.requested_action,
                selected_session_id=selected.session_id,
                selection_reason=selection_reason,
                actionable_session_ids=updated_buckets["actionable"],
                waiting_session_ids=updated_buckets["waiting"],
                blocked_session_ids=updated_buckets["blocked"],
                completed_session_ids=updated_buckets["completed"],
                invalid_session_ids=updated_buckets["invalid"],
                decision_notes=self._selection_notes(selected=selected, selection_reason=selection_reason),
            )
            return MultiTaskOrchestrationResult(
                decision=decision,
                session_registry=updated_registry,
                selected_session_result=selected_result,
                registered_session_ids=registered_session_ids,
                notes=request.notes,
            )

        decision = MultiTaskDecision(
            chosen_action=MultiTaskAction.REJECT,
            selection_reason=SessionSelectionReason.INVALID_SELECTION,
            actionable_session_ids=buckets["actionable"],
            waiting_session_ids=buckets["waiting"],
            blocked_session_ids=buckets["blocked"],
            completed_session_ids=buckets["completed"],
            invalid_session_ids=buckets["invalid"],
            decision_notes=("Unsupported multi-task action request.",),
        )
        return MultiTaskOrchestrationResult(
            decision=decision,
            session_registry=registry,
            selected_session_result=None,
            registered_session_ids=registered_session_ids,
            notes=request.notes,
        )

    def orchestrate_selected_session(self, session: MultiTaskSessionRecord) -> OrchestrationResult:
        return self._execution_orchestrator.orchestrate(
            OrchestrationRequest(
                handoff=session.router_handoff,
                prior_execution_result=session.prior_execution_result,
                resume_request=session.resume_request,
            )
        )

    def update_session_record(
        self,
        session: MultiTaskSessionRecord,
        orchestration_result: OrchestrationResult,
    ) -> MultiTaskSessionRecord:
        return self.build_session_record(
            session_id=session.session_id,
            priority=session.priority,
            router_handoff=session.router_handoff,
            prior_execution_result=orchestration_result.execution_result,
            orchestration_result=orchestration_result,
            persisted_session=None,
            resume_request=None,
            last_updated=self._timestamp(),
            notes=session.notes,
        )

    def _apply_registrations(
        self,
        *,
        registry: tuple[MultiTaskSessionRecord, ...],
        sessions_to_register: tuple[MultiTaskSessionRecord, ...],
    ) -> tuple[tuple[MultiTaskSessionRecord, ...], tuple[str, ...]]:
        updated_registry = registry
        registered_ids: list[str] = []
        for session in sessions_to_register:
            updated_registry, registered = self.register_session(updated_registry, session)
            registered_ids.append(registered.session_id)
        return updated_registry, tuple(registered_ids)

    def _normalize_record(self, record: MultiTaskSessionRecord) -> MultiTaskSessionRecord:
        normalized = self.build_session_record(
            session_id=record.session_id,
            priority=record.priority,
            router_handoff=record.router_handoff,
            prior_execution_result=record.prior_execution_result,
            orchestration_result=record.orchestration_result,
            persisted_session=record.persisted_session,
            resume_request=record.resume_request,
            last_updated=record.last_updated,
            notes=record.notes,
        )
        return replace(normalized, notes=record.notes)

    def _resolve_selected_session(
        self,
        *,
        registry: tuple[MultiTaskSessionRecord, ...],
        selected_session_id: str | None,
        target_status: MultiTaskSessionStatus,
    ) -> tuple[MultiTaskSessionRecord | None, SessionSelectionReason, tuple[str, ...]]:
        actionable_ids = tuple(record.session_id for record in registry if record.session_status == target_status)
        if selected_session_id is not None:
            for record in registry:
                if record.session_id == selected_session_id:
                    if record.session_status == target_status:
                        return record, SessionSelectionReason.EXPLICIT_SELECTION, actionable_ids
                    return None, SessionSelectionReason.INVALID_SELECTION, actionable_ids
            return None, SessionSelectionReason.INVALID_SELECTION, actionable_ids

        selected, reason, _ = self.select_next_session(registry, allowed_statuses=(target_status,))
        return selected, reason, actionable_ids

    @staticmethod
    def _bucket_session_ids(registry: tuple[MultiTaskSessionRecord, ...]) -> dict[str, tuple[str, ...]]:
        actionable = tuple(
            record.session_id
            for record in registry
            if record.session_status in {MultiTaskSessionStatus.READY, MultiTaskSessionStatus.RESUMABLE}
        )
        waiting = tuple(record.session_id for record in registry if record.session_status == MultiTaskSessionStatus.WAITING)
        blocked = tuple(
            record.session_id
            for record in registry
            if record.session_status in {MultiTaskSessionStatus.BLOCKED, MultiTaskSessionStatus.FAILED}
        )
        completed = tuple(record.session_id for record in registry if record.session_status == MultiTaskSessionStatus.COMPLETED)
        invalid = tuple(record.session_id for record in registry if record.session_status == MultiTaskSessionStatus.INVALID)
        return {
            "actionable": actionable,
            "waiting": waiting,
            "blocked": blocked,
            "completed": completed,
            "invalid": invalid,
        }

    @staticmethod
    def _idle_action(registry: tuple[MultiTaskSessionRecord, ...]) -> MultiTaskAction:
        if any(record.session_status == MultiTaskSessionStatus.WAITING for record in registry):
            return MultiTaskAction.WAIT
        return MultiTaskAction.STOP

    @staticmethod
    def _selection_notes(
        *,
        selected: MultiTaskSessionRecord | None,
        selection_reason: SessionSelectionReason,
    ) -> tuple[str, ...]:
        if selection_reason == SessionSelectionReason.NO_ACTIONABLE_SESSIONS:
            return ("No bounded sessions are currently actionable.",)
        if selection_reason == SessionSelectionReason.INVALID_SELECTION:
            return ("The requested session is not eligible for the requested action.",)
        if selected is None:
            return ()
        if selection_reason == SessionSelectionReason.STABLE_TIEBREAKER:
            return (f"Selected {selected.session_id} using the oldest last_updated tiebreaker.",)
        if selection_reason == SessionSelectionReason.EXPLICIT_SELECTION:
            return (f"Selected {selected.session_id} explicitly.",)
        if selection_reason == SessionSelectionReason.HIGHEST_PRIORITY_RESUMABLE:
            return (f"Selected {selected.session_id} as the highest-priority resumable session.",)
        return (f"Selected {selected.session_id} as the highest-priority ready session.",)

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @staticmethod
    def _sort_timestamp(value: str) -> datetime:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.max.replace(tzinfo=timezone.utc)