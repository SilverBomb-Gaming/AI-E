from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from .execution_orchestrator import ExecutionOrchestrator
from .models import (
    ConstraintRouterHandoff,
    DependencyAwareMultiTaskResult,
    DependencyAwareSessionRecord,
    DependencyBlockReason,
    DependencyEvaluationResult,
    DependencyGraphRecord,
    DependencyStatus,
    LifecycleState,
    MultiTaskAction,
    MultiTaskDecision,
    MultiTaskOrchestrationRequest,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    OrchestrationRequest,
    OrchestrationResult,
    PersistedExecutionSession,
    ResumeRequest,
    SessionDependency,
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

    def register_dependency(
        self,
        dependency_graph: tuple[SessionDependency, ...],
        dependency: SessionDependency,
    ) -> tuple[tuple[SessionDependency, ...], SessionDependency]:
        updated_graph = list(dependency_graph)
        if dependency not in updated_graph:
            updated_graph.append(dependency)
        return tuple(updated_graph), dependency

    def register_dependencies(
        self,
        dependency_graph: tuple[SessionDependency, ...],
        dependencies: tuple[SessionDependency, ...],
    ) -> tuple[tuple[SessionDependency, ...], tuple[SessionDependency, ...]]:
        updated_graph = dependency_graph
        registered: list[SessionDependency] = []
        for dependency in dependencies:
            updated_graph, registered_dependency = self.register_dependency(updated_graph, dependency)
            registered.append(registered_dependency)
        return updated_graph, tuple(registered)

    def list_sessions(
        self,
        registry: tuple[MultiTaskSessionRecord, ...],
        dependency_graph: tuple[SessionDependency, ...] = (),
    ) -> tuple[tuple[DependencyAwareSessionRecord, ...], tuple[DependencyGraphRecord, ...]]:
        normalized_registry = tuple(self._normalize_record(record) for record in registry)
        graph_records, evaluations = self.validate_dependency_graph(normalized_registry, dependency_graph)
        graph_records_by_id = {graph_record.session_id: graph_record for graph_record in graph_records}
        dependency_aware_registry = tuple(
            self.build_dependency_aware_session_record(
                record=record,
                graph_record=graph_records_by_id[record.session_id],
                evaluation=evaluations[record.session_id],
            )
            for record in normalized_registry
        )
        return dependency_aware_registry, graph_records

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

    def build_dependency_aware_session_record(
        self,
        *,
        record: MultiTaskSessionRecord,
        graph_record: DependencyGraphRecord,
        evaluation: DependencyEvaluationResult,
    ) -> DependencyAwareSessionRecord:
        return DependencyAwareSessionRecord(
            base_record=record,
            prerequisite_session_ids=graph_record.prerequisite_session_ids,
            dependent_session_ids=graph_record.dependent_session_ids,
            dependency_status=evaluation.dependency_status,
            dependency_block_reasons=evaluation.block_reasons,
            blocked_by_session_ids=evaluation.blocked_by_session_ids,
            dependency_notes=evaluation.dependency_notes,
            dependency_ready=evaluation.dependency_ready,
            invalid_dependency=evaluation.invalid_dependency,
            effective_session_status=self._effective_session_status(record=record, evaluation=evaluation),
        )

    def validate_dependency_graph(
        self,
        registry: tuple[MultiTaskSessionRecord, ...],
        dependency_graph: tuple[SessionDependency, ...],
    ) -> tuple[tuple[DependencyGraphRecord, ...], dict[str, DependencyEvaluationResult]]:
        record_by_id = {record.session_id: record for record in registry}
        prerequisite_map = {record.session_id: [] for record in registry}
        dependent_map = {record.session_id: [] for record in registry}

        for dependency in dependency_graph:
            if dependency.session_id in prerequisite_map:
                if dependency.prerequisite_session_id not in prerequisite_map[dependency.session_id]:
                    prerequisite_map[dependency.session_id].append(dependency.prerequisite_session_id)
            if dependency.prerequisite_session_id in dependent_map:
                if dependency.session_id not in dependent_map[dependency.prerequisite_session_id]:
                    dependent_map[dependency.prerequisite_session_id].append(dependency.session_id)

        cycle_nodes = self._detect_cycle_nodes(prerequisite_map)
        graph_records = tuple(
            DependencyGraphRecord(
                session_id=record.session_id,
                prerequisite_session_ids=tuple(prerequisite_map[record.session_id]),
                dependent_session_ids=tuple(dependent_map[record.session_id]),
            )
            for record in registry
        )

        evaluations: dict[str, DependencyEvaluationResult] = {}
        for record in registry:
            prerequisite_ids = tuple(prerequisite_map[record.session_id])
            if not prerequisite_ids:
                dependency_status = (
                    DependencyStatus.DEPENDENCY_COMPLETED
                    if record.session_status == MultiTaskSessionStatus.COMPLETED
                    else DependencyStatus.NO_DEPENDENCIES
                )
                evaluations[record.session_id] = DependencyEvaluationResult(
                    session_id=record.session_id,
                    dependency_status=dependency_status,
                    dependency_notes=("Session has no prerequisite sessions.",),
                    dependency_ready=True,
                    invalid_dependency=False,
                )
                continue

            dependency_notes: list[str] = []
            block_reasons: list[DependencyBlockReason] = []
            blocked_by: list[str] = []

            if any(prerequisite_id == record.session_id for prerequisite_id in prerequisite_ids):
                block_reasons.append(DependencyBlockReason.INVALID_DEPENDENCY_REFERENCE)
                dependency_notes.append("Session cannot depend on itself.")

            if record.session_id in cycle_nodes:
                block_reasons.append(DependencyBlockReason.CYCLIC_DEPENDENCY)
                dependency_notes.append("Session participates in a dependency cycle.")

            for prerequisite_id in prerequisite_ids:
                prerequisite_record = record_by_id.get(prerequisite_id)
                if prerequisite_record is None:
                    block_reasons.append(DependencyBlockReason.MISSING_PREREQUISITE_SESSION)
                    blocked_by.append(prerequisite_id)
                    dependency_notes.append(
                        f"Prerequisite session {prerequisite_id} is not present in the registry."
                    )
                    continue

                prerequisite_status = prerequisite_record.session_status
                if prerequisite_status == MultiTaskSessionStatus.COMPLETED:
                    continue

                blocked_by.append(prerequisite_id)
                if prerequisite_status == MultiTaskSessionStatus.FAILED:
                    block_reasons.append(DependencyBlockReason.PREREQUISITE_FAILED)
                    dependency_notes.append(
                        f"Prerequisite session {prerequisite_id} failed and must be resolved manually."
                    )
                elif prerequisite_status in {MultiTaskSessionStatus.BLOCKED, MultiTaskSessionStatus.INVALID}:
                    block_reasons.append(DependencyBlockReason.PREREQUISITE_BLOCKED)
                    dependency_notes.append(
                        f"Prerequisite session {prerequisite_id} is blocked and cannot unlock this session yet."
                    )
                else:
                    block_reasons.append(DependencyBlockReason.PREREQUISITE_NOT_COMPLETED)
                    dependency_notes.append(
                        f"Prerequisite session {prerequisite_id} must complete before this session is selectable."
                    )

            unique_reasons = tuple(dict.fromkeys(block_reasons))
            unique_blocked_by = tuple(dict.fromkeys(blocked_by))
            unique_notes = tuple(dict.fromkeys(dependency_notes))
            invalid_dependency = any(
                reason in {
                    DependencyBlockReason.INVALID_DEPENDENCY_REFERENCE,
                    DependencyBlockReason.MISSING_PREREQUISITE_SESSION,
                    DependencyBlockReason.CYCLIC_DEPENDENCY,
                }
                for reason in unique_reasons
            )

            if unique_reasons:
                evaluations[record.session_id] = DependencyEvaluationResult(
                    session_id=record.session_id,
                    dependency_status=(
                        DependencyStatus.INVALID_DEPENDENCY
                        if invalid_dependency
                        else DependencyStatus.BLOCKED_BY_DEPENDENCY
                    ),
                    block_reasons=unique_reasons,
                    blocked_by_session_ids=unique_blocked_by,
                    dependency_notes=unique_notes,
                    dependency_ready=False,
                    invalid_dependency=invalid_dependency,
                )
                continue

            evaluations[record.session_id] = DependencyEvaluationResult(
                session_id=record.session_id,
                dependency_status=(
                    DependencyStatus.DEPENDENCY_COMPLETED
                    if record.session_status == MultiTaskSessionStatus.COMPLETED
                    else DependencyStatus.DEPENDENCY_READY
                ),
                dependency_notes=("All prerequisite sessions are completed.",),
                dependency_ready=True,
                invalid_dependency=False,
            )

        return graph_records, evaluations

    def select_next_session(
        self,
        registry: tuple[MultiTaskSessionRecord, ...],
        *,
        dependency_graph: tuple[SessionDependency, ...] = (),
        allowed_statuses: tuple[MultiTaskSessionStatus, ...] = (
            MultiTaskSessionStatus.RESUMABLE,
            MultiTaskSessionStatus.READY,
        ),
    ) -> tuple[DependencyAwareSessionRecord | None, SessionSelectionReason, tuple[str, ...]]:
        dependency_aware_registry, _ = self.list_sessions(registry, dependency_graph)
        actionable_ids = tuple(
            record.session_id for record in dependency_aware_registry if record.session_status in allowed_statuses
        )
        for priority, session_status in self._SELECTION_BUCKETS:
            if session_status not in allowed_statuses:
                continue
            candidates = [
                (index, record)
                for index, record in enumerate(dependency_aware_registry)
                if record.priority == priority and record.session_status == session_status
            ]
            if not candidates:
                continue
            _, chosen = min(candidates, key=lambda item: (self._sort_timestamp(item[1].last_updated), item[0]))
            if len(candidates) > 1:
                return chosen, SessionSelectionReason.STABLE_TIEBREAKER, actionable_ids
            if session_status == MultiTaskSessionStatus.RESUMABLE:
                return chosen, SessionSelectionReason.HIGHEST_PRIORITY_RESUMABLE, actionable_ids
            return chosen, SessionSelectionReason.HIGHEST_PRIORITY_READY, actionable_ids
        return None, SessionSelectionReason.NO_ACTIONABLE_SESSIONS, actionable_ids

    def orchestrate(self, request: MultiTaskOrchestrationRequest) -> DependencyAwareMultiTaskResult:
        registry, registered_session_ids = self._apply_registrations(
            registry=request.session_registry,
            sessions_to_register=request.sessions_to_register,
        )
        dependency_graph, registered_dependencies = self.register_dependencies(
            request.dependency_graph,
            request.dependencies_to_register,
        )
        registry, graph_records = self.list_sessions(registry, dependency_graph)
        buckets = self._bucket_session_ids(registry)

        if request.requested_action == MultiTaskAction.REGISTER_SESSION:
            decision = self._build_decision(
                chosen_action=MultiTaskAction.REGISTER_SESSION,
                selected_session_id=None,
                selection_reason=SessionSelectionReason.NO_ACTIONABLE_SESSIONS,
                actionable_session_ids=buckets["actionable"],
                buckets=buckets,
                decision_notes=("Registered bounded sessions without routing execution.",),
            )
            return self._build_result(
                decision=decision,
                registry=registry,
                graph_records=graph_records,
                selected_session_result=None,
                registered_session_ids=registered_session_ids,
                registered_dependencies=registered_dependencies,
                notes=request.notes,
            )

        if request.requested_action == MultiTaskAction.INSPECT_SESSIONS:
            decision = self._build_decision(
                chosen_action=MultiTaskAction.INSPECT_SESSIONS,
                selected_session_id=None,
                selection_reason=SessionSelectionReason.NO_ACTIONABLE_SESSIONS,
                actionable_session_ids=buckets["actionable"],
                buckets=buckets,
                decision_notes=("Inspected bounded multi-session registry state.",),
            )
            return self._build_result(
                decision=decision,
                registry=registry,
                graph_records=graph_records,
                selected_session_result=None,
                registered_session_ids=registered_session_ids,
                registered_dependencies=registered_dependencies,
                notes=request.notes,
            )

        if request.requested_action == MultiTaskAction.SELECT_NEXT_SESSION:
            selected, selection_reason, actionable_ids = self.select_next_session(
                tuple(record.base_record for record in registry),
                dependency_graph=dependency_graph,
            )
            chosen_action = MultiTaskAction.SELECT_NEXT_SESSION if selected is not None else self._idle_action(registry)
            decision = self._build_decision(
                chosen_action=chosen_action,
                selected_session_id=selected.session_id if selected else None,
                selection_reason=selection_reason,
                actionable_session_ids=actionable_ids,
                buckets=buckets,
                decision_notes=self._selection_notes(selected=selected, selection_reason=selection_reason),
            )
            return self._build_result(
                decision=decision,
                registry=registry,
                graph_records=graph_records,
                selected_session_result=None,
                registered_session_ids=registered_session_ids,
                registered_dependencies=registered_dependencies,
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
                dependency_graph=dependency_graph,
                selected_session_id=request.selected_session_id,
                target_status=target_status,
            )
            if selected is None:
                chosen_action = (
                    self._idle_action(registry)
                    if selection_reason == SessionSelectionReason.NO_ACTIONABLE_SESSIONS
                    else MultiTaskAction.REJECT
                )
                decision = self._build_decision(
                    chosen_action=chosen_action,
                    selected_session_id=request.selected_session_id,
                    selection_reason=selection_reason,
                    actionable_session_ids=actionable_ids,
                    buckets=buckets,
                    decision_notes=self._selection_notes(selected=None, selection_reason=selection_reason),
                )
                return self._build_result(
                    decision=decision,
                    registry=registry,
                    graph_records=graph_records,
                    selected_session_result=None,
                    registered_session_ids=registered_session_ids,
                    registered_dependencies=registered_dependencies,
                    notes=request.notes,
                )

            selected_result = self.orchestrate_selected_session(selected)
            updated_record = self.update_session_record(selected.base_record, selected_result)
            updated_base_registry = tuple(
                updated_record if record.session_id == updated_record.session_id else record.base_record
                for record in registry
            )
            updated_registry, updated_graph_records = self.list_sessions(updated_base_registry, dependency_graph)
            updated_buckets = self._bucket_session_ids(updated_registry)
            decision = self._build_decision(
                chosen_action=request.requested_action,
                selected_session_id=selected.session_id,
                selection_reason=selection_reason,
                actionable_session_ids=updated_buckets["actionable"],
                buckets=updated_buckets,
                decision_notes=self._selection_notes(selected=selected, selection_reason=selection_reason),
            )
            return self._build_result(
                decision=decision,
                registry=updated_registry,
                graph_records=updated_graph_records,
                selected_session_result=selected_result,
                registered_session_ids=registered_session_ids,
                registered_dependencies=registered_dependencies,
                notes=request.notes,
            )

        decision = self._build_decision(
            chosen_action=MultiTaskAction.REJECT,
            selected_session_id=request.selected_session_id,
            selection_reason=SessionSelectionReason.INVALID_SELECTION,
            actionable_session_ids=buckets["actionable"],
            buckets=buckets,
            decision_notes=("Unsupported multi-task action request.",),
        )
        return self._build_result(
            decision=decision,
            registry=registry,
            graph_records=graph_records,
            selected_session_result=None,
            registered_session_ids=registered_session_ids,
            registered_dependencies=registered_dependencies,
            notes=request.notes,
        )

    def orchestrate_selected_session(
        self,
        session: MultiTaskSessionRecord | DependencyAwareSessionRecord,
    ) -> OrchestrationResult:
        base_record = session.base_record if isinstance(session, DependencyAwareSessionRecord) else session
        return self._execution_orchestrator.orchestrate(
            OrchestrationRequest(
                handoff=base_record.router_handoff,
                prior_execution_result=base_record.prior_execution_result,
                resume_request=base_record.resume_request,
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
        registry: tuple[DependencyAwareSessionRecord, ...],
        dependency_graph: tuple[SessionDependency, ...],
        selected_session_id: str | None,
        target_status: MultiTaskSessionStatus,
    ) -> tuple[DependencyAwareSessionRecord | None, SessionSelectionReason, tuple[str, ...]]:
        actionable_ids = tuple(record.session_id for record in registry if record.session_status == target_status)
        if selected_session_id is not None:
            for record in registry:
                if record.session_id == selected_session_id:
                    if record.session_status == target_status:
                        return record, SessionSelectionReason.EXPLICIT_SELECTION, actionable_ids
                    return None, SessionSelectionReason.INVALID_SELECTION, actionable_ids
            return None, SessionSelectionReason.INVALID_SELECTION, actionable_ids

        selected, reason, _ = self.select_next_session(
            tuple(record.base_record for record in registry),
            dependency_graph=dependency_graph,
            allowed_statuses=(target_status,),
        )
        return selected, reason, actionable_ids

    @staticmethod
    def _bucket_session_ids(registry: tuple[DependencyAwareSessionRecord, ...]) -> dict[str, tuple[str, ...]]:
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
        dependency_blocked = tuple(
            record.session_id
            for record in registry
            if record.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY
        )
        invalid_dependency = tuple(
            record.session_id
            for record in registry
            if record.dependency_status == DependencyStatus.INVALID_DEPENDENCY
        )
        return {
            "actionable": actionable,
            "waiting": waiting,
            "blocked": blocked,
            "completed": completed,
            "invalid": invalid,
            "dependency_blocked": dependency_blocked,
            "invalid_dependency": invalid_dependency,
        }

    @staticmethod
    def _idle_action(registry: tuple[DependencyAwareSessionRecord, ...]) -> MultiTaskAction:
        if any(record.session_status == MultiTaskSessionStatus.WAITING for record in registry):
            return MultiTaskAction.WAIT
        return MultiTaskAction.STOP

    @staticmethod
    def _selection_notes(
        *,
        selected: DependencyAwareSessionRecord | None,
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
    def _build_decision(
        *,
        chosen_action: MultiTaskAction,
        selected_session_id: str | None,
        selection_reason: SessionSelectionReason,
        actionable_session_ids: tuple[str, ...],
        buckets: dict[str, tuple[str, ...]],
        decision_notes: tuple[str, ...],
    ) -> MultiTaskDecision:
        return MultiTaskDecision(
            chosen_action=chosen_action,
            selected_session_id=selected_session_id,
            selection_reason=selection_reason,
            actionable_session_ids=actionable_session_ids,
            waiting_session_ids=buckets["waiting"],
            blocked_session_ids=buckets["blocked"],
            completed_session_ids=buckets["completed"],
            invalid_session_ids=buckets["invalid"],
            dependency_blocked_session_ids=buckets["dependency_blocked"],
            invalid_dependency_session_ids=buckets["invalid_dependency"],
            decision_notes=decision_notes,
        )

    @staticmethod
    def _build_result(
        *,
        decision: MultiTaskDecision,
        registry: tuple[DependencyAwareSessionRecord, ...],
        graph_records: tuple[DependencyGraphRecord, ...],
        selected_session_result: OrchestrationResult | None,
        registered_session_ids: tuple[str, ...],
        registered_dependencies: tuple[SessionDependency, ...],
        notes: tuple[str, ...],
    ) -> DependencyAwareMultiTaskResult:
        return DependencyAwareMultiTaskResult(
            decision=decision,
            session_registry=registry,
            dependency_graph=graph_records,
            selected_session_result=selected_session_result,
            registered_session_ids=registered_session_ids,
            registered_dependencies=registered_dependencies,
            notes=notes,
        )

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @staticmethod
    def _sort_timestamp(value: str) -> datetime:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.max.replace(tzinfo=timezone.utc)

    @staticmethod
    def _detect_cycle_nodes(prerequisite_map: dict[str, list[str]]) -> set[str]:
        cycle_nodes: set[str] = set()
        state = {session_id: 0 for session_id in prerequisite_map}
        stack: list[str] = []

        def visit(session_id: str) -> None:
            state[session_id] = 1
            stack.append(session_id)
            for prerequisite_id in prerequisite_map[session_id]:
                if prerequisite_id not in prerequisite_map:
                    continue
                if state[prerequisite_id] == 0:
                    visit(prerequisite_id)
                elif state[prerequisite_id] == 1 and prerequisite_id in stack:
                    cycle_start = stack.index(prerequisite_id)
                    cycle_nodes.update(stack[cycle_start:])
            stack.pop()
            state[session_id] = 2

        for session_id in prerequisite_map:
            if state[session_id] == 0:
                visit(session_id)
        return cycle_nodes

    @staticmethod
    def _effective_session_status(
        *,
        record: MultiTaskSessionRecord,
        evaluation: DependencyEvaluationResult,
    ) -> MultiTaskSessionStatus:
        if record.session_status in {
            MultiTaskSessionStatus.COMPLETED,
            MultiTaskSessionStatus.FAILED,
            MultiTaskSessionStatus.INVALID,
        }:
            return record.session_status
        if evaluation.dependency_status == DependencyStatus.INVALID_DEPENDENCY:
            return MultiTaskSessionStatus.INVALID
        if evaluation.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY:
            return MultiTaskSessionStatus.BLOCKED
        return record.session_status