from __future__ import annotations

from datetime import datetime, timezone

from .models import (
    ActivitySummary,
    ArtifactAwareSessionRecord,
    ArtifactRequirement,
    ArtifactRequirementStatus,
    AwarenessBlockerKind,
    AwarenessRequest,
    AwarenessResult,
    AwarenessStatus,
    BlockerSummary,
    DependencyGraphRecord,
    DependencyStatus,
    LifecycleState,
    LoopEngineResult,
    LoopEngineStatus,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    NextActionCandidate,
    SessionHealthSummary,
    SessionSelectionReason,
    SessionArtifactRegistryRecord,
    SystemHealthState,
    SystemSnapshot,
)
from .multi_task_orchestrator import MultiTaskOrchestrator


class SystemAwareness:
    """Build deterministic, read-only awareness summaries for bounded execution state."""

    def __init__(self, multi_task_orchestrator: MultiTaskOrchestrator | None = None) -> None:
        self._multi_task_orchestrator = multi_task_orchestrator or MultiTaskOrchestrator()

    def build_awareness_result(self, request: AwarenessRequest) -> AwarenessResult:
        (
            base_registry,
            inspected_registry,
            _dependency_graph_records,
            _artifact_registry_records,
            resolution_notes,
        ) = self._resolve_registry_state(request)
        recent_activity = self.summarize_recent_activity(request.latest_loop_result)
        selected_session, selection_reason, actionable_ids = self._select_next_session(
            base_registry,
            inspected_registry,
            request,
        )
        session_summaries = tuple(
            self.summarize_session(record, actionable_ids=actionable_ids) for record in inspected_registry
        )
        blocker_summaries = self.summarize_blockers(inspected_registry)
        next_action_candidates = self.derive_next_action_candidates(
            inspected_registry=inspected_registry,
            selected_session_id=selected_session.session_id if selected_session else None,
            selection_reason=selection_reason,
            actionable_ids=actionable_ids,
        )
        snapshot = SystemSnapshot(
            generated_at=self._timestamp(),
            total_sessions=len(inspected_registry),
            ready_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.READY
            ),
            resumable_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.RESUMABLE
            ),
            active_session_ids=tuple(actionable_ids),
            waiting_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.WAITING
            ),
            blocked_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.BLOCKED
            ),
            completed_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.COMPLETED
            ),
            failed_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.FAILED
            ),
            invalid_session_ids=tuple(
                record.session_id for record in inspected_registry if record.session_status == MultiTaskSessionStatus.INVALID
            ),
            latest_cycle_status=(
                recent_activity.latest_cycle_status if recent_activity else request.latest_loop_result.status if request.latest_loop_result else None
            ),
            latest_termination_reason=(
                recent_activity.latest_termination_reason if recent_activity else request.latest_loop_result.termination_reason if request.latest_loop_result else None
            ),
        )
        system_health_state = self.derive_system_health_state(snapshot)
        status = self.derive_awareness_status(snapshot, recent_activity)
        system_notes = self._build_system_notes(
            snapshot=snapshot,
            selected_session_id=selected_session.session_id if selected_session else None,
            request_notes=request.notes,
            resolution_notes=resolution_notes,
            recent_activity=recent_activity,
        )
        return AwarenessResult(
            status=status,
            system_health_state=system_health_state,
            snapshot=snapshot,
            session_summaries=session_summaries,
            blocker_summaries=blocker_summaries,
            recent_activity=recent_activity,
            next_action_candidates=next_action_candidates,
            system_notes=system_notes,
            last_policy_decision=request.latest_loop_result.last_policy_decision if request.latest_loop_result else None,
        )

    def summarize_session(
        self,
        record: ArtifactAwareSessionRecord,
        *,
        actionable_ids: tuple[str, ...],
    ) -> SessionHealthSummary:
        orchestration_result = record.orchestration_result
        summary_notes = tuple(
            dict.fromkeys(
                record.notes
                + record.dependency_notes
                + record.artifact_notes
                + (orchestration_result.orchestration_notes if orchestration_result else ())
            )
        )
        return SessionHealthSummary(
            session_id=record.session_id,
            priority=record.priority,
            lifecycle_state=record.lifecycle_state,
            session_status=record.session_status,
            dependency_status=record.dependency_status,
            requirement_status=record.requirement_status,
            effective_status=self._session_awareness_status(record),
            actionable=record.session_id in actionable_ids,
            required_human_action=record.required_human_action,
            last_executor_status=record.last_executor_status,
            last_orchestration_status=orchestration_result.status if orchestration_result else None,
            last_orchestration_action=orchestration_result.decision.chosen_action if orchestration_result else None,
            notes=summary_notes,
        )

    def summarize_blockers(self, registry: tuple[ArtifactAwareSessionRecord, ...]) -> tuple[BlockerSummary, ...]:
        blockers: list[BlockerSummary] = []
        for record in registry:
            if record.lifecycle_state == LifecycleState.AWAITING_CONFIRMATION:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.WAITING_ON_CONFIRMATION,
                        message=record.required_human_action or f"Session {record.session_id} is awaiting confirmation.",
                        session_id=record.session_id,
                        notes=record.notes,
                    )
                )
            if record.lifecycle_state == LifecycleState.AWAITING_REVIEW:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.WAITING_ON_REVIEW,
                        message=record.required_human_action or f"Session {record.session_id} is awaiting review.",
                        session_id=record.session_id,
                        notes=record.notes,
                    )
                )
            if record.lifecycle_state == LifecycleState.AWAITING_PLAYTEST:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.WAITING_ON_PLAYTEST,
                        message=record.required_human_action or f"Session {record.session_id} is awaiting playtest.",
                        session_id=record.session_id,
                        notes=record.notes,
                    )
                )
            if record.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.BLOCKED_BY_DEPENDENCY,
                        message=(
                            record.dependency_notes[0]
                            if record.dependency_notes
                            else f"Session {record.session_id} is blocked by prerequisite sessions."
                        ),
                        session_id=record.session_id,
                        related_session_ids=record.blocked_by_session_ids,
                        notes=record.dependency_notes,
                    )
                )
            if record.dependency_status == DependencyStatus.INVALID_DEPENDENCY:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.INVALID_DEPENDENCY_CONFIGURATION,
                        message=(
                            record.dependency_notes[0]
                            if record.dependency_notes
                            else f"Session {record.session_id} has an invalid dependency configuration."
                        ),
                        session_id=record.session_id,
                        related_session_ids=record.blocked_by_session_ids,
                        notes=record.dependency_notes,
                    )
                )
            if record.requirement_status in {
                ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT,
                ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT,
            }:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.BLOCKED_BY_ARTIFACT,
                        message=(
                            record.artifact_notes[0]
                            if record.artifact_notes
                            else f"Session {record.session_id} is blocked by required artifacts."
                        ),
                        session_id=record.session_id,
                        related_artifact_ids=record.blocked_by_artifact_ids,
                        notes=record.artifact_notes,
                    )
                )
            if record.requirement_status == ArtifactRequirementStatus.INVALID_REQUIREMENT_REFERENCE:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.INVALID_ARTIFACT_REQUIREMENT,
                        message=(
                            record.artifact_notes[0]
                            if record.artifact_notes
                            else f"Session {record.session_id} has an invalid artifact requirement."
                        ),
                        session_id=record.session_id,
                        related_artifact_ids=record.blocked_by_artifact_ids,
                        notes=record.artifact_notes,
                    )
                )
            if (
                record.session_status == MultiTaskSessionStatus.BLOCKED
                and record.lifecycle_state == LifecycleState.BLOCKED
                and record.dependency_status not in {DependencyStatus.BLOCKED_BY_DEPENDENCY, DependencyStatus.INVALID_DEPENDENCY}
                and record.requirement_status
                not in {
                    ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT,
                    ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT,
                    ArtifactRequirementStatus.INVALID_REQUIREMENT_REFERENCE,
                }
            ):
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.BLOCKED_BY_EXECUTION_STATE,
                        message=(
                            record.notes[0]
                            if record.notes
                            else f"Session {record.session_id} is blocked by its current execution state."
                        ),
                        session_id=record.session_id,
                        notes=record.notes,
                    )
                )
            if record.session_status == MultiTaskSessionStatus.FAILED:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.FAILED_SESSION,
                        message=f"Session {record.session_id} failed and requires manual recovery.",
                        session_id=record.session_id,
                        notes=record.notes,
                    )
                )
            if record.session_status == MultiTaskSessionStatus.INVALID:
                blockers.append(
                    BlockerSummary(
                        blocker_kind=AwarenessBlockerKind.INVALID_SESSION_STATE,
                        message=f"Session {record.session_id} is in an invalid bounded state.",
                        session_id=record.session_id,
                        notes=record.notes,
                    )
                )
        return tuple(blockers)

    def summarize_recent_activity(self, loop_result: LoopEngineResult | None) -> ActivitySummary | None:
        if loop_result is None:
            return None
        if not loop_result.cycles:
            return ActivitySummary(
                latest_cycle_status=loop_result.status,
                latest_termination_reason=loop_result.termination_reason,
                actions_run_count=loop_result.actions_run_count,
                activity_notes=loop_result.notes,
            )

        latest_cycle = loop_result.cycles[-1]
        return ActivitySummary(
            cycle_index=latest_cycle.cycle_index,
            selected_session_id=latest_cycle.selected_session_id,
            selected_action=latest_cycle.selected_action,
            latest_cycle_status=latest_cycle.status,
            latest_cycle_reason=latest_cycle.reason,
            latest_termination_reason=latest_cycle.termination_reason or loop_result.termination_reason,
            persisted_after_cycle=latest_cycle.persisted_after_cycle,
            persistence_statuses=tuple(result.status for result in latest_cycle.persistence_results),
            actions_run_count=loop_result.actions_run_count,
            activity_notes=tuple(dict.fromkeys(loop_result.notes + latest_cycle.cycle_notes)),
        )

    def derive_system_health_state(self, snapshot: SystemSnapshot) -> SystemHealthState:
        if snapshot.total_sessions == 0 or snapshot.total_sessions == len(snapshot.completed_session_ids):
            return SystemHealthState.COMPLETED
        if snapshot.invalid_session_ids or snapshot.failed_session_ids:
            return SystemHealthState.DEGRADED
        if snapshot.active_session_ids and not snapshot.waiting_session_ids and not snapshot.blocked_session_ids:
            return SystemHealthState.ACTIONABLE
        if snapshot.active_session_ids:
            return SystemHealthState.PARTIALLY_BLOCKED
        if snapshot.waiting_session_ids and not snapshot.blocked_session_ids:
            return SystemHealthState.WAITING_ON_HUMANS
        return SystemHealthState.FULLY_BLOCKED

    def derive_awareness_status(
        self,
        snapshot: SystemSnapshot,
        recent_activity: ActivitySummary | None,
    ) -> AwarenessStatus:
        if snapshot.total_sessions == 0 or snapshot.total_sessions == len(snapshot.completed_session_ids):
            return AwarenessStatus.COMPLETED
        if snapshot.invalid_session_ids and not (
            snapshot.active_session_ids or snapshot.waiting_session_ids or snapshot.blocked_session_ids or snapshot.failed_session_ids
        ):
            return AwarenessStatus.INVALID_STATE
        if (
            recent_activity is not None
            and recent_activity.latest_cycle_status == LoopEngineStatus.RAN_ACTION
            and snapshot.active_session_ids
        ):
            return AwarenessStatus.ACTIVE
        if snapshot.active_session_ids and not (
            snapshot.waiting_session_ids or snapshot.blocked_session_ids or snapshot.failed_session_ids or snapshot.invalid_session_ids
        ):
            return AwarenessStatus.HEALTHY
        if snapshot.waiting_session_ids and not (
            snapshot.active_session_ids or snapshot.blocked_session_ids or snapshot.failed_session_ids or snapshot.invalid_session_ids
        ):
            return AwarenessStatus.WAITING
        if (snapshot.blocked_session_ids or snapshot.failed_session_ids) and not (
            snapshot.active_session_ids or snapshot.waiting_session_ids
        ):
            return AwarenessStatus.BLOCKED
        if snapshot.invalid_session_ids and not snapshot.active_session_ids and not snapshot.waiting_session_ids:
            return AwarenessStatus.INVALID_STATE
        return AwarenessStatus.MIXED

    def derive_next_action_candidates(
        self,
        *,
        inspected_registry: tuple[ArtifactAwareSessionRecord, ...],
        selected_session_id: str | None,
        selection_reason: SessionSelectionReason,
        actionable_ids: tuple[str, ...],
    ) -> tuple[NextActionCandidate, ...]:
        ordered_records: list[ArtifactAwareSessionRecord] = []
        if selected_session_id is not None:
            ordered_records.extend(record for record in inspected_registry if record.session_id == selected_session_id)
        ordered_records.extend(
            record
            for record in inspected_registry
            if record.session_id in actionable_ids and record.session_id != selected_session_id
        )
        ordered_records.extend(
            record
            for record in inspected_registry
            if record.session_id not in actionable_ids and record.session_id != selected_session_id
        )

        candidates: list[NextActionCandidate] = []
        for record in ordered_records:
            actionable = record.session_id in actionable_ids
            selected_next = record.session_id == selected_session_id
            notes: tuple[str, ...]
            if selected_next:
                notes = ("This session would be selected next under current deterministic rules.",)
            elif actionable:
                notes = ("This session is actionable now but is outranked by the selected session.",)
            else:
                notes = ()
            candidates.append(
                NextActionCandidate(
                    session_id=record.session_id,
                    priority=record.priority,
                    session_status=record.session_status,
                    actionable=actionable,
                    selected_next=selected_next,
                    selection_reason=selection_reason if selected_next else None,
                    ineligible_reason=None if actionable else self._ineligible_reason(record),
                    notes=notes,
                )
            )
        return tuple(candidates)

    def _resolve_registry_state(
        self,
        request: AwarenessRequest,
    ) -> tuple[
        tuple[MultiTaskSessionRecord, ...],
        tuple[ArtifactAwareSessionRecord, ...],
        tuple[DependencyGraphRecord, ...],
        tuple[SessionArtifactRegistryRecord, ...],
        tuple[str, ...],
    ]:
        if request.session_registry:
            inspected_registry, dependency_graph_records, artifact_registry_records = self._multi_task_orchestrator.list_sessions(
                request.session_registry,
                request.dependency_graph,
                request.artifact_registry,
                request.artifact_requirements,
            )
            return (
                request.session_registry,
                inspected_registry,
                dependency_graph_records,
                artifact_registry_records,
                (),
            )
        if request.latest_loop_result and request.latest_loop_result.final_registry:
            inspected_registry = request.latest_loop_result.final_registry
            base_registry = tuple(record.base_record.base_record for record in inspected_registry)
            return (
                base_registry,
                inspected_registry,
                request.latest_loop_result.dependency_graph,
                request.latest_loop_result.artifact_registry,
                ("Using the latest loop result final registry as the current system snapshot.",),
            )
        return (), (), (), (), ("No bounded sessions are currently registered.",)

    def _select_next_session(
        self,
        base_registry: tuple[MultiTaskSessionRecord, ...],
        inspected_registry: tuple[ArtifactAwareSessionRecord, ...],
        request: AwarenessRequest,
    ) -> tuple[ArtifactAwareSessionRecord | None, SessionSelectionReason, tuple[str, ...]]:
        if not base_registry:
            return None, SessionSelectionReason.NO_ACTIONABLE_SESSIONS, ()
        if not request.session_registry:
            return self._select_from_inspected_registry(inspected_registry)
        return self._multi_task_orchestrator.select_next_session(
            base_registry,
            dependency_graph=request.dependency_graph,
            artifact_registry=request.artifact_registry,
            artifact_requirements=request.artifact_requirements,
        )

    def _select_from_inspected_registry(
        self,
        inspected_registry: tuple[ArtifactAwareSessionRecord, ...],
    ) -> tuple[ArtifactAwareSessionRecord | None, SessionSelectionReason, tuple[str, ...]]:
        actionable_ids = tuple(
            record.session_id
            for record in inspected_registry
            if record.session_status in {MultiTaskSessionStatus.RESUMABLE, MultiTaskSessionStatus.READY}
        )
        for priority, session_status in self._multi_task_orchestrator._SELECTION_BUCKETS:
            candidates = [
                (index, record)
                for index, record in enumerate(inspected_registry)
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

    @staticmethod
    def _session_awareness_status(record: ArtifactAwareSessionRecord) -> AwarenessStatus:
        if record.session_status == MultiTaskSessionStatus.COMPLETED:
            return AwarenessStatus.COMPLETED
        if record.session_status in {MultiTaskSessionStatus.READY, MultiTaskSessionStatus.RESUMABLE}:
            return AwarenessStatus.ACTIVE
        if record.session_status == MultiTaskSessionStatus.WAITING:
            return AwarenessStatus.WAITING
        if record.session_status in {MultiTaskSessionStatus.BLOCKED, MultiTaskSessionStatus.FAILED}:
            return AwarenessStatus.BLOCKED
        return AwarenessStatus.INVALID_STATE

    @staticmethod
    def _ineligible_reason(record: ArtifactAwareSessionRecord) -> str:
        if record.lifecycle_state == LifecycleState.AWAITING_CONFIRMATION:
            return record.required_human_action or "Awaiting confirmation before bounded execution can continue."
        if record.lifecycle_state == LifecycleState.AWAITING_REVIEW:
            return record.required_human_action or "Awaiting review approval before bounded execution can continue."
        if record.lifecycle_state == LifecycleState.AWAITING_PLAYTEST:
            return record.required_human_action or "Awaiting playtest clearance before bounded execution can continue."
        if record.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY:
            return (
                record.dependency_notes[0]
                if record.dependency_notes
                else "Blocked by prerequisite sessions under current dependency rules."
            )
        if record.dependency_status == DependencyStatus.INVALID_DEPENDENCY:
            return (
                record.dependency_notes[0]
                if record.dependency_notes
                else "Invalid dependency configuration prevents bounded execution."
            )
        if record.requirement_status in {
            ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT,
            ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT,
        }:
            return (
                record.artifact_notes[0]
                if record.artifact_notes
                else "Blocked by required artifacts under current artifact rules."
            )
        if record.requirement_status == ArtifactRequirementStatus.INVALID_REQUIREMENT_REFERENCE:
            return (
                record.artifact_notes[0]
                if record.artifact_notes
                else "Invalid artifact requirement prevents bounded execution."
            )
        if record.session_status == MultiTaskSessionStatus.COMPLETED:
            return "Session is already completed."
        if record.session_status == MultiTaskSessionStatus.FAILED:
            return "Session failed and requires manual recovery."
        if record.session_status == MultiTaskSessionStatus.INVALID:
            return "Session is in an invalid bounded state."
        return "Session is not actionable under current bounded execution rules."

    @staticmethod
    def _build_system_notes(
        *,
        snapshot: SystemSnapshot,
        selected_session_id: str | None,
        request_notes: tuple[str, ...],
        resolution_notes: tuple[str, ...],
        recent_activity: ActivitySummary | None,
    ) -> tuple[str, ...]:
        notes = list(request_notes + resolution_notes)
        if selected_session_id is not None:
            notes.append(f"Next selectable session under current deterministic rules is {selected_session_id}.")
        elif snapshot.total_sessions == 0:
            notes.append("No bounded sessions are registered.")
        else:
            notes.append("No sessions are currently actionable under dependency, artifact, and human-gate constraints.")
        if recent_activity and recent_activity.latest_termination_reason is not None:
            notes.append(f"Latest loop termination reason is {recent_activity.latest_termination_reason.value}.")
        return tuple(dict.fromkeys(notes))

    @staticmethod
    def _sort_timestamp(timestamp: str) -> datetime:
        return datetime.fromisoformat(timestamp)

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat()