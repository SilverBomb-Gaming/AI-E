from __future__ import annotations

from pathlib import Path

from .autonomy_policy import AutonomyPolicy
from .models import (
    ActivePolicyProfile,
    ArtifactAwareMultiTaskResult,
    ArtifactAwareSessionRecord,
    ArtifactRequirement,
    ArtifactRequirementStatus,
    AutonomyPolicyContext,
    AutonomyPolicyStatus,
    AwarenessRequest,
    DependencyStatus,
    LifecycleState,
    LoopCycleAction,
    LoopCycleReason,
    LoopCycleResult,
    LoopEngineRequest,
    LoopEngineResult,
    LoopEngineStatus,
    LoopTerminationReason,
    MultiTaskAction,
    MultiTaskOrchestrationRequest,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    PersistenceStatus,
    SaveResult,
    SessionArtifact,
    SessionArtifactRegistryRecord,
    SessionDependency,
)
from .multi_task_orchestrator import MultiTaskOrchestrator
from .policy_config import PolicyConfigLoader
from .state_persistence import StatePersistence
from .system_awareness import SystemAwareness


class ExecutionLoopEngine:
    """Run bounded inspect-select-execute-persist cycles above the multi-task orchestrator."""

    def __init__(
        self,
        multi_task_orchestrator: MultiTaskOrchestrator | None = None,
        state_persistence: StatePersistence | None = None,
        awareness: SystemAwareness | None = None,
        autonomy_policy: AutonomyPolicy | None = None,
        active_policy_profile: ActivePolicyProfile | None = None,
        policy_config_loader: PolicyConfigLoader | None = None,
    ) -> None:
        self._multi_task_orchestrator = multi_task_orchestrator or MultiTaskOrchestrator()
        self._state_persistence = state_persistence or StatePersistence()
        self._awareness = awareness or SystemAwareness(self._multi_task_orchestrator)
        self._policy_config_loader = policy_config_loader or PolicyConfigLoader()
        self._active_policy_profile = active_policy_profile or self._policy_config_loader.load_profile("standard")
        self._autonomy_policy = autonomy_policy or AutonomyPolicy(
            active_policy_profile=self._active_policy_profile,
            policy_config_loader=self._policy_config_loader,
        )

    def run_cycle(self, request: LoopEngineRequest) -> LoopCycleResult:
        cycle, _, _, _ = self._run_single_cycle(
            request=request,
            cycle_index=1,
            session_registry=request.session_registry,
            dependency_graph=request.dependency_graph,
            artifact_registry=request.artifact_registry,
            artifact_requirements=request.artifact_requirements,
        )
        return cycle

    def run_loop(self, request: LoopEngineRequest) -> LoopEngineResult:
        if request.max_cycles < 1:
            inspect_result = self._inspect_registry(
                session_registry=request.session_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
            )
            return LoopEngineResult(
                status=LoopEngineStatus.INVALID_REQUEST,
                cycles=(),
                final_registry=inspect_result.session_registry,
                dependency_graph=inspect_result.dependency_graph,
                artifact_registry=inspect_result.artifact_registry,
                termination_reason=LoopTerminationReason.INVALID_STATE,
                actions_run_count=0,
                max_cycles=request.max_cycles,
                notes=request.notes + ("max_cycles must be at least 1.",),
                last_policy_decision=None,
            )

        session_registry = request.session_registry
        dependency_graph = request.dependency_graph
        artifact_registry = request.artifact_registry
        artifact_requirements = request.artifact_requirements
        cycles: list[LoopCycleResult] = []
        final_registry: tuple[ArtifactAwareSessionRecord, ...] = ()
        final_dependency_graph = ()
        final_artifact_registry: tuple[SessionArtifactRegistryRecord, ...] = ()
        actions_run_count = 0

        for cycle_index in range(1, request.max_cycles + 1):
            cycle, final_registry, final_dependency_graph, final_artifact_registry = self._run_single_cycle(
                request=request,
                cycle_index=cycle_index,
                session_registry=session_registry,
                dependency_graph=dependency_graph,
                artifact_registry=artifact_registry,
                artifact_requirements=artifact_requirements,
            )
            cycles.append(cycle)
            actions_run_count += cycle.actions_run_count
            session_registry = tuple(record.base_record.base_record for record in final_registry)

            if cycle.termination_reason is not None:
                return LoopEngineResult(
                    status=self._overall_status_from_cycle(cycle),
                    cycles=tuple(cycles),
                    final_registry=final_registry,
                    dependency_graph=final_dependency_graph,
                    artifact_registry=final_artifact_registry,
                    termination_reason=cycle.termination_reason,
                    actions_run_count=actions_run_count,
                    max_cycles=request.max_cycles,
                    notes=request.notes + cycle.cycle_notes,
                    last_policy_decision=cycle.policy_evaluation,
                )

        return LoopEngineResult(
            status=LoopEngineStatus.MAX_CYCLES_REACHED,
            cycles=tuple(cycles),
            final_registry=final_registry,
            dependency_graph=final_dependency_graph,
            artifact_registry=final_artifact_registry,
            termination_reason=LoopTerminationReason.MAX_CYCLES_REACHED,
            actions_run_count=actions_run_count,
            max_cycles=request.max_cycles,
            notes=request.notes + ("Loop stopped after reaching the configured max cycle count.",),
            last_policy_decision=cycles[-1].policy_evaluation if cycles else None,
        )

    def _run_single_cycle(
        self,
        *,
        request: LoopEngineRequest,
        cycle_index: int,
        session_registry: tuple[MultiTaskSessionRecord, ...],
        dependency_graph: tuple[SessionDependency, ...],
        artifact_registry: tuple[SessionArtifact, ...],
        artifact_requirements: tuple[ArtifactRequirement, ...],
    ) -> tuple[
        LoopCycleResult,
        tuple[ArtifactAwareSessionRecord, ...],
        tuple,
        tuple[SessionArtifactRegistryRecord, ...],
    ]:
        inspect_result = self._inspect_registry(
            session_registry=session_registry,
            dependency_graph=dependency_graph,
            artifact_registry=artifact_registry,
            artifact_requirements=artifact_requirements,
        )
        awareness_snapshot = self._awareness.build_awareness_result(
            AwarenessRequest(
                session_registry=session_registry,
                dependency_graph=dependency_graph,
                artifact_registry=artifact_registry,
                artifact_requirements=artifact_requirements,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                notes=request.notes,
            )
        )
        policy_evaluation = self._autonomy_policy.evaluate(
            AutonomyPolicyContext(
                action_type=request.policy_action_type,
                awareness_snapshot=awareness_snapshot,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                operator_command_present=request.operator_command_present,
                current_cycle_index=cycle_index - 1,
                requested_max_cycles=request.max_cycles,
                notes=request.notes,
            )
        )
        if policy_evaluation.decision.decision_status != AutonomyPolicyStatus.ALLOWED:
            cycle = self._policy_denied_cycle(
                cycle_index=cycle_index,
                inspect_result=inspect_result,
                policy_evaluation=policy_evaluation,
            )
            return cycle, inspect_result.session_registry, inspect_result.dependency_graph, inspect_result.artifact_registry
        selected_session, _, _ = self._multi_task_orchestrator.select_next_session(
            session_registry,
            dependency_graph=dependency_graph,
            artifact_registry=artifact_registry,
            artifact_requirements=artifact_requirements,
        )

        if selected_session is None:
            status, reason, termination_reason, action, notes = self._classify_registry_state(inspect_result.session_registry)
            cycle = LoopCycleResult(
                cycle_index=cycle_index,
                status=status,
                selected_action=action,
                reason=reason,
                persisted_after_cycle=False,
                persistence_results=(),
                cycle_notes=notes,
                termination_reason=termination_reason,
                actions_run_count=0,
                multi_task_result=inspect_result,
                policy_evaluation=policy_evaluation,
            )
            return cycle, inspect_result.session_registry, inspect_result.dependency_graph, inspect_result.artifact_registry

        selected_action = (
            MultiTaskAction.RESUME_SELECTED
            if selected_session.session_status == MultiTaskSessionStatus.RESUMABLE
            else MultiTaskAction.EXECUTE_SELECTED
        )
        action_result = self._multi_task_orchestrator.orchestrate(
            MultiTaskOrchestrationRequest(
                requested_action=selected_action,
                session_registry=session_registry,
                dependency_graph=dependency_graph,
                artifact_registry=artifact_registry,
                artifact_requirements=artifact_requirements,
                selected_session_id=selected_session.session_id,
            )
        )
        updated_selected = next(
            record for record in action_result.session_registry if record.session_id == selected_session.session_id
        )
        persistence_results = self._persist_cycle_state(updated_selected, request)
        persistence_failed = any(result.status != PersistenceStatus.SAVED for result in persistence_results)
        cycle_notes = action_result.decision.decision_notes + tuple(
            note for result in persistence_results for note in result.notes
        )
        if persistence_failed:
            cycle = LoopCycleResult(
                cycle_index=cycle_index,
                status=LoopEngineStatus.FAILED,
                selected_action=self._loop_action_from_multi_task_action(selected_action),
                reason=LoopCycleReason.PERSISTENCE_FAILED,
                selected_session_id=selected_session.session_id,
                lifecycle_state_before=selected_session.lifecycle_state,
                lifecycle_state_after=updated_selected.lifecycle_state,
                persisted_after_cycle=False,
                persistence_results=persistence_results,
                cycle_notes=cycle_notes,
                termination_reason=LoopTerminationReason.PERSISTENCE_FAILED,
                actions_run_count=1,
                multi_task_result=action_result,
                policy_evaluation=policy_evaluation,
            )
            return cycle, action_result.session_registry, action_result.dependency_graph, action_result.artifact_registry

        termination_reason, termination_notes = self._post_action_termination(action_result.session_registry)
        cycle = LoopCycleResult(
            cycle_index=cycle_index,
            status=LoopEngineStatus.RAN_ACTION,
            selected_action=self._loop_action_from_multi_task_action(selected_action),
            reason=LoopCycleReason.SELECTED_ACTIONABLE_SESSION,
            selected_session_id=selected_session.session_id,
            lifecycle_state_before=selected_session.lifecycle_state,
            lifecycle_state_after=updated_selected.lifecycle_state,
            persisted_after_cycle=True,
            persistence_results=persistence_results,
            cycle_notes=cycle_notes + termination_notes,
            termination_reason=termination_reason,
            actions_run_count=1,
            multi_task_result=action_result,
            policy_evaluation=policy_evaluation,
        )
        return cycle, action_result.session_registry, action_result.dependency_graph, action_result.artifact_registry

    def _policy_denied_cycle(
        self,
        *,
        cycle_index: int,
        inspect_result: ArtifactAwareMultiTaskResult,
        policy_evaluation,
    ) -> LoopCycleResult:
        if policy_evaluation.decision.decision_status == AutonomyPolicyStatus.INVALID_REQUEST:
            return LoopCycleResult(
                cycle_index=cycle_index,
                status=LoopEngineStatus.INVALID_REQUEST,
                selected_action=LoopCycleAction.REJECT,
                reason=LoopCycleReason.INVALID_STATE,
                persisted_after_cycle=False,
                persistence_results=(),
                cycle_notes=policy_evaluation.decision.policy_notes,
                termination_reason=LoopTerminationReason.INVALID_STATE,
                actions_run_count=0,
                multi_task_result=inspect_result,
                policy_evaluation=policy_evaluation,
            )

        status, reason, termination_reason, action, notes = self._classify_registry_state(inspect_result.session_registry)
        return LoopCycleResult(
            cycle_index=cycle_index,
            status=status,
            selected_action=action,
            reason=reason,
            persisted_after_cycle=False,
            persistence_results=(),
            cycle_notes=tuple(dict.fromkeys(policy_evaluation.decision.policy_notes + notes)),
            termination_reason=termination_reason,
            actions_run_count=0,
            multi_task_result=inspect_result,
            policy_evaluation=policy_evaluation,
        )

    def _inspect_registry(
        self,
        *,
        session_registry: tuple[MultiTaskSessionRecord, ...],
        dependency_graph: tuple[SessionDependency, ...],
        artifact_registry: tuple[SessionArtifact, ...],
        artifact_requirements: tuple[ArtifactRequirement, ...],
    ) -> ArtifactAwareMultiTaskResult:
        return self._multi_task_orchestrator.orchestrate(
            MultiTaskOrchestrationRequest(
                requested_action=MultiTaskAction.INSPECT_SESSIONS,
                session_registry=session_registry,
                dependency_graph=dependency_graph,
                artifact_registry=artifact_registry,
                artifact_requirements=artifact_requirements,
            )
        )

    def _persist_cycle_state(
        self,
        record: ArtifactAwareSessionRecord,
        request: LoopEngineRequest,
    ) -> tuple[SaveResult, ...]:
        target_path = self._resolve_session_path(record.session_id, request)
        if target_path is None:
            return (
                SaveResult(
                    status=PersistenceStatus.FAILED,
                    path=None,
                    session_id=record.session_id,
                    notes=("No persistence path is configured for the selected session.",),
                ),
            )

        try:
            session = self._state_persistence.build_session_from_record(record)
        except ValueError as exc:
            return (
                SaveResult(
                    status=PersistenceStatus.FAILED,
                    path=str(target_path),
                    session_id=record.session_id,
                    notes=(f"Failed to build persisted session: {exc}",),
                ),
            )

        return (self._state_persistence.save_session(session, target_path),)

    @staticmethod
    def _classify_registry_state(
        registry: tuple[ArtifactAwareSessionRecord, ...],
    ) -> tuple[
        LoopEngineStatus,
        LoopCycleReason,
        LoopTerminationReason,
        LoopCycleAction,
        tuple[str, ...],
    ]:
        if not registry:
            return (
                LoopEngineStatus.NO_ACTIONABLE_SESSIONS,
                LoopCycleReason.NO_ACTIONABLE_SESSIONS,
                LoopTerminationReason.NO_ACTIONABLE_SESSIONS,
                LoopCycleAction.STOP,
                ("No bounded sessions are registered.",),
            )

        if all(record.session_status == MultiTaskSessionStatus.COMPLETED for record in registry):
            return (
                LoopEngineStatus.COMPLETED,
                LoopCycleReason.ALL_SESSIONS_COMPLETED,
                LoopTerminationReason.COMPLETED_ALL_SESSIONS,
                LoopCycleAction.STOP,
                ("All bounded sessions are completed.",),
            )

        if any(record.session_status == MultiTaskSessionStatus.INVALID for record in registry):
            invalid_ids = tuple(record.session_id for record in registry if record.session_status == MultiTaskSessionStatus.INVALID)
            return (
                LoopEngineStatus.INVALID_REQUEST,
                LoopCycleReason.INVALID_STATE,
                LoopTerminationReason.INVALID_STATE,
                LoopCycleAction.REJECT,
                (f"Invalid session state prevents bounded continuation: {', '.join(invalid_ids)}.",),
            )

        if any(record.session_status == MultiTaskSessionStatus.FAILED for record in registry):
            failed_ids = tuple(record.session_id for record in registry if record.session_status == MultiTaskSessionStatus.FAILED)
            return (
                LoopEngineStatus.FAILED,
                LoopCycleReason.EXECUTION_FAILED,
                LoopTerminationReason.EXECUTION_ERROR,
                LoopCycleAction.STOP,
                (f"Execution failed for bounded sessions: {', '.join(failed_ids)}.",),
            )

        if any(record.session_status == MultiTaskSessionStatus.WAITING for record in registry):
            waiting_ids = tuple(record.session_id for record in registry if record.session_status == MultiTaskSessionStatus.WAITING)
            return (
                LoopEngineStatus.WAITING,
                LoopCycleReason.WAITING_ON_HUMAN_GATE,
                LoopTerminationReason.HUMAN_GATE_REQUIRED,
                LoopCycleAction.WAIT,
                (f"Human input is required before continuation: {', '.join(waiting_ids)}.",),
            )

        if any(record.dependency_status == DependencyStatus.INVALID_DEPENDENCY for record in registry):
            invalid_ids = tuple(record.session_id for record in registry if record.dependency_status == DependencyStatus.INVALID_DEPENDENCY)
            return (
                LoopEngineStatus.INVALID_REQUEST,
                LoopCycleReason.INVALID_STATE,
                LoopTerminationReason.INVALID_STATE,
                LoopCycleAction.REJECT,
                (f"Invalid dependency state prevents bounded continuation: {', '.join(invalid_ids)}.",),
            )

        if any(record.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY for record in registry):
            blocked_ids = tuple(record.session_id for record in registry if record.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY)
            return (
                LoopEngineStatus.STOPPED,
                LoopCycleReason.BLOCKED_BY_DEPENDENCY,
                LoopTerminationReason.BLOCKED_BY_DEPENDENCIES,
                LoopCycleAction.STOP,
                (f"Dependency blockers prevent bounded continuation: {', '.join(blocked_ids)}.",),
            )

        if any(record.requirement_status == ArtifactRequirementStatus.INVALID_REQUIREMENT_REFERENCE for record in registry):
            invalid_ids = tuple(
                record.session_id for record in registry if record.requirement_status == ArtifactRequirementStatus.INVALID_REQUIREMENT_REFERENCE
            )
            return (
                LoopEngineStatus.INVALID_REQUEST,
                LoopCycleReason.INVALID_STATE,
                LoopTerminationReason.INVALID_STATE,
                LoopCycleAction.REJECT,
                (f"Invalid artifact references prevent bounded continuation: {', '.join(invalid_ids)}.",),
            )

        if any(
            record.requirement_status in {
                ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT,
                ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT,
            }
            for record in registry
        ):
            blocked_ids = tuple(
                record.session_id
                for record in registry
                if record.requirement_status in {
                    ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT,
                    ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT,
                }
            )
            return (
                LoopEngineStatus.STOPPED,
                LoopCycleReason.BLOCKED_BY_ARTIFACT,
                LoopTerminationReason.BLOCKED_BY_ARTIFACTS,
                LoopCycleAction.STOP,
                (f"Artifact requirements prevent bounded continuation: {', '.join(blocked_ids)}.",),
            )

        return (
            LoopEngineStatus.NO_ACTIONABLE_SESSIONS,
            LoopCycleReason.NO_ACTIONABLE_SESSIONS,
            LoopTerminationReason.NO_ACTIONABLE_SESSIONS,
            LoopCycleAction.STOP,
            ("No bounded sessions are currently actionable.",),
        )

    def _post_action_termination(
        self,
        registry: tuple[ArtifactAwareSessionRecord, ...],
    ) -> tuple[LoopTerminationReason | None, tuple[str, ...]]:
        if any(record.session_status in {MultiTaskSessionStatus.READY, MultiTaskSessionStatus.RESUMABLE} for record in registry):
            return None, ()

        _, _, termination_reason, _, notes = self._classify_registry_state(registry)
        return termination_reason, notes

    def _resolve_session_path(self, session_id: str, request: LoopEngineRequest) -> Path | None:
        for mapped_session_id, mapped_path in request.session_file_paths:
            if mapped_session_id == session_id:
                return Path(mapped_path)
        if request.session_storage_directory is not None:
            return Path(request.session_storage_directory) / f"{session_id}.json"
        return None

    @staticmethod
    def _loop_action_from_multi_task_action(action: MultiTaskAction) -> LoopCycleAction:
        if action == MultiTaskAction.EXECUTE_SELECTED:
            return LoopCycleAction.EXECUTE_SELECTED
        return LoopCycleAction.RESUME_SELECTED

    @staticmethod
    def _overall_status_from_cycle(cycle: LoopCycleResult) -> LoopEngineStatus:
        if cycle.termination_reason == LoopTerminationReason.COMPLETED_ALL_SESSIONS:
            return LoopEngineStatus.COMPLETED
        if cycle.termination_reason == LoopTerminationReason.HUMAN_GATE_REQUIRED:
            return LoopEngineStatus.WAITING
        if cycle.termination_reason == LoopTerminationReason.NO_ACTIONABLE_SESSIONS:
            return LoopEngineStatus.NO_ACTIONABLE_SESSIONS
        if cycle.termination_reason in {
            LoopTerminationReason.BLOCKED_BY_DEPENDENCIES,
            LoopTerminationReason.BLOCKED_BY_ARTIFACTS,
        }:
            return LoopEngineStatus.STOPPED
        if cycle.termination_reason == LoopTerminationReason.INVALID_STATE:
            return LoopEngineStatus.INVALID_REQUEST
        if cycle.termination_reason in {
            LoopTerminationReason.EXECUTION_ERROR,
            LoopTerminationReason.PERSISTENCE_FAILED,
        }:
            return LoopEngineStatus.FAILED
        return cycle.status