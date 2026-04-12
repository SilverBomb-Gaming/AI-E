from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from .autonomy_policy import AutonomyPolicy
from .execution_history import ExecutionHistory
from .execution_loop_engine import ExecutionLoopEngine
from .models import (
    ActivePolicyProfile,
    AwarenessRequest,
    AwarenessResult,
    AuditEventType,
    AutonomyActionType,
    AutonomyPolicyContext,
    AutonomyPolicyReason,
    AutonomyPolicyStatus,
    LifecycleState,
    LoopEngineRequest,
    LoopEngineResult,
    LoopEngineStatus,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    OperatorActionEffect,
    OperatorCommandDecision,
    OperatorCommandRequest,
    OperatorCommandResult,
    OperatorCommandStatus,
    OperatorCommandType,
    OperatorGateType,
    OperatorRejectionReason,
    OperatorTargetType,
    PolicyEvaluationResult,
    ResumeRequest,
    SessionHealthSummary,
)
from .multi_task_orchestrator import MultiTaskOrchestrator
from .policy_config import PolicyConfigLoader
from .system_awareness import SystemAwareness


class OperatorControl:
    """Accept explicit operator commands without bypassing bounded execution rules."""

    _SUPPORTED_COMMANDS = {
        OperatorCommandType.INSPECT_SYSTEM,
        OperatorCommandType.INSPECT_SESSION,
        OperatorCommandType.RUN_SINGLE_CYCLE,
        OperatorCommandType.RUN_BOUNDED_LOOP,
        OperatorCommandType.APPROVE_GATE,
        OperatorCommandType.REPRIORITIZE_SESSION,
        OperatorCommandType.SELECT_SESSION,
    }

    def __init__(
        self,
        *,
        awareness: SystemAwareness | None = None,
        loop_engine: ExecutionLoopEngine | None = None,
        multi_task_orchestrator: MultiTaskOrchestrator | None = None,
        autonomy_policy: AutonomyPolicy | None = None,
        active_policy_profile: ActivePolicyProfile | None = None,
        policy_config_loader: PolicyConfigLoader | None = None,
        execution_history: ExecutionHistory | None = None,
    ) -> None:
        self._execution_history = execution_history or getattr(multi_task_orchestrator, "_execution_history", None) or ExecutionHistory()
        self._multi_task_orchestrator = multi_task_orchestrator or MultiTaskOrchestrator(execution_history=self._execution_history)
        self._awareness = awareness or SystemAwareness(self._multi_task_orchestrator, self._execution_history)
        self._policy_config_loader = policy_config_loader or PolicyConfigLoader()
        self._active_policy_profile = active_policy_profile or self._policy_config_loader.load_profile("standard")
        self._loop_engine = loop_engine or ExecutionLoopEngine(
            self._multi_task_orchestrator,
            active_policy_profile=self._active_policy_profile,
            policy_config_loader=self._policy_config_loader,
            execution_history=self._execution_history,
        )
        self._autonomy_policy = autonomy_policy or AutonomyPolicy(
            active_policy_profile=self._active_policy_profile,
            policy_config_loader=self._policy_config_loader,
            execution_history=self._execution_history,
        )

    def handle_command(self, request: OperatorCommandRequest) -> OperatorCommandResult:
        self._execution_history.record_event(
            event_type=AuditEventType.OPERATOR_COMMAND_RECEIVED,
            session_id=request.target_session_id,
            operator_command=(request.command_type.value if hasattr(request.command_type, "value") else str(request.command_type)),
            operator_command_id=request.command_id,
            source_component="operator_control",
            notes=request.notes,
        )
        command_type = self._normalize_command_type(request.command_type)
        target_type = self._normalize_target_type(request.target_type)
        if command_type is None:
            return self._rejected_result(
                request=request,
                target_type=target_type or request.target_type,
                rejection_reason=OperatorRejectionReason.UNKNOWN_COMMAND,
                effect_summary="The requested operator command is not recognized.",
            )
        if command_type not in self._SUPPORTED_COMMANDS:
            return self._rejected_result(
                request=request,
                command_type=command_type,
                target_type=target_type or request.target_type,
                rejection_reason=OperatorRejectionReason.UNSUPPORTED_IN_V1,
                effect_summary=f"Command {command_type.value} is not supported in operator control v1.",
            )
        if target_type is None:
            return self._rejected_result(
                request=request,
                command_type=command_type,
                target_type=request.target_type,
                rejection_reason=OperatorRejectionReason.INVALID_TARGET,
                effect_summary="The requested operator target type is invalid.",
            )

        awareness_snapshot = self._awareness.build_awareness_result(
            AwarenessRequest(
                session_registry=request.session_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
                latest_loop_result=request.latest_loop_result,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                notes=request.notes,
            )
        )
        policy_evaluation = self._evaluate_policy(request, command_type, awareness_snapshot)
        if policy_evaluation.decision.decision_status != AutonomyPolicyStatus.ALLOWED:
            return self._policy_rejected_result(
                request=request,
                awareness_snapshot=awareness_snapshot,
                command_type=command_type,
                target_type=target_type,
                policy_evaluation=policy_evaluation,
            )
        validation = self._validate_command(request, command_type, target_type, awareness_snapshot)
        if validation is not None:
            rejection_reason, effect_summary = validation
            return self._rejected_result(
                request=request,
                awareness_snapshot=awareness_snapshot,
                policy_evaluation=policy_evaluation,
                command_type=command_type,
                target_type=target_type,
                rejection_reason=rejection_reason,
                effect_summary=effect_summary,
            )

        if command_type == OperatorCommandType.INSPECT_SYSTEM:
            return self._handle_inspect_system(request, awareness_snapshot, policy_evaluation)
        if command_type == OperatorCommandType.INSPECT_SESSION:
            return self._handle_inspect_session(request, awareness_snapshot, policy_evaluation)
        if command_type == OperatorCommandType.RUN_SINGLE_CYCLE:
            return self._handle_run_loop(
                request,
                awareness_snapshot,
                policy_evaluation,
                max_cycles=1,
                action_effect=OperatorActionEffect.LOOP_CYCLE_REQUESTED,
            )
        if command_type == OperatorCommandType.RUN_BOUNDED_LOOP:
            return self._handle_run_loop(
                request,
                awareness_snapshot,
                policy_evaluation,
                max_cycles=request.max_cycles,
                action_effect=OperatorActionEffect.BOUNDED_LOOP_REQUESTED,
            )
        if command_type == OperatorCommandType.APPROVE_GATE:
            return self._handle_approve_gate(request, awareness_snapshot, policy_evaluation)
        if command_type == OperatorCommandType.REPRIORITIZE_SESSION:
            return self._handle_reprioritize_session(request, awareness_snapshot, policy_evaluation)
        return self._handle_select_session(request, awareness_snapshot, policy_evaluation)

    def _record_command_outcome(
        self,
        request: OperatorCommandRequest,
        result: OperatorCommandResult,
    ) -> None:
        event_type = (
            AuditEventType.OPERATOR_COMMAND_REJECTED
            if result.decision.command_status in {
                OperatorCommandStatus.REJECTED,
                OperatorCommandStatus.INVALID_REQUEST,
                OperatorCommandStatus.BLOCKED,
            }
            else AuditEventType.OPERATOR_COMMAND_EXECUTED
        )
        self._execution_history.record_event(
            event_type=event_type,
            session_id=request.target_session_id,
            operator_command=(request.command_type.value if hasattr(request.command_type, "value") else str(request.command_type)),
            operator_command_id=request.command_id,
            action_type=(
                result.decision.command_type.value
                if hasattr(result.decision.command_type, "value")
                else str(result.decision.command_type)
            ),
            reason=result.decision.rejection_reason.value if result.decision.rejection_reason else None,
            source_component="operator_control",
            notes=(result.decision.effect_summary,),
        )

    def _handle_inspect_system(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        policy_evaluation: PolicyEvaluationResult,
    ) -> OperatorCommandResult:
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=OperatorCommandType.INSPECT_SYSTEM,
            target_type=OperatorTargetType.SYSTEM,
            command_status=OperatorCommandStatus.EXECUTED,
            action_effect=OperatorActionEffect.INSPECTED_SYSTEM,
            effect_summary="Returned the current bounded system awareness snapshot without mutating state.",
            operator_notes=request.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            policy_evaluation=policy_evaluation,
            updated_session_registry=request.session_registry,
            blocker_summaries=awareness_snapshot.blocker_summaries,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    def _handle_inspect_session(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        policy_evaluation: PolicyEvaluationResult,
    ) -> OperatorCommandResult:
        summary = self._find_session_summary(awareness_snapshot, request.target_session_id)
        blocker_summaries = tuple(
            blocker for blocker in awareness_snapshot.blocker_summaries if blocker.session_id == request.target_session_id
        )
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=OperatorCommandType.INSPECT_SESSION,
            target_type=OperatorTargetType.SESSION,
            target_session_id=request.target_session_id,
            command_status=OperatorCommandStatus.EXECUTED,
            action_effect=OperatorActionEffect.INSPECTED_SESSION,
            effect_summary=f"Returned the current summary for session {request.target_session_id} without mutating state.",
            operator_notes=request.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            policy_evaluation=policy_evaluation,
            updated_session_registry=request.session_registry,
            session_summary=summary,
            blocker_summaries=blocker_summaries,
            resulting_session_status=summary.session_status if summary else None,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    def _handle_run_loop(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        policy_evaluation: PolicyEvaluationResult,
        *,
        max_cycles: int,
        action_effect: OperatorActionEffect,
    ) -> OperatorCommandResult:
        loop_result = self._loop_engine.run_loop(
            LoopEngineRequest(
                session_registry=request.session_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
                max_cycles=max_cycles,
                session_storage_directory=request.session_storage_directory,
                session_file_paths=request.session_file_paths,
                policy_action_type=(
                    AutonomyActionType.RUN_SINGLE_CYCLE
                    if max_cycles == 1
                    else AutonomyActionType.RUN_BOUNDED_LOOP
                ),
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                operator_command_present=True,
                notes=request.notes,
            )
        )
        updated_registry = tuple(record.base_record.base_record for record in loop_result.final_registry)
        resulting_awareness = self._awareness.build_awareness_result(
            AwarenessRequest(
                session_registry=updated_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
                latest_loop_result=loop_result,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                notes=request.notes,
            )
        )
        command_status = self._command_status_from_loop_result(loop_result)
        effect_summary = self._loop_effect_summary(loop_result, max_cycles)
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=OperatorCommandType.RUN_SINGLE_CYCLE if max_cycles == 1 else OperatorCommandType.RUN_BOUNDED_LOOP,
            target_type=OperatorTargetType.LOOP,
            command_status=command_status,
            action_effect=action_effect,
            effect_summary=effect_summary,
            operator_notes=request.notes + loop_result.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=resulting_awareness,
            loop_result=loop_result,
            policy_evaluation=policy_evaluation,
            updated_session_registry=updated_registry,
            blocker_summaries=resulting_awareness.blocker_summaries,
            resulting_loop_status=loop_result.status,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    def _handle_approve_gate(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        policy_evaluation: PolicyEvaluationResult,
    ) -> OperatorCommandResult:
        gate_type = self._normalize_gate_type(request.gate_type)
        current_record = self._find_session_record(request.session_registry, request.target_session_id)
        if current_record is None or current_record.prior_execution_result is None:
            return self._rejected_result(
                request=request,
                awareness_snapshot=awareness_snapshot,
                command_type=OperatorCommandType.APPROVE_GATE,
                target_type=OperatorTargetType.GATE,
                rejection_reason=OperatorRejectionReason.INVALID_STATE_TRANSITION,
                effect_summary=f"Session {request.target_session_id} cannot accept gate approval in its current state.",
            )
        resume_request = ResumeRequest.from_execution_result(
            current_record.prior_execution_result,
            confirmation_cleared=gate_type == OperatorGateType.CONFIRMATION,
            review_cleared=gate_type == OperatorGateType.REVIEW,
            playtest_cleared=gate_type == OperatorGateType.PLAYTEST,
            human_action_cleared=True,
        )
        updated_record = self._multi_task_orchestrator.build_session_record(
            session_id=current_record.session_id,
            priority=current_record.priority,
            router_handoff=current_record.router_handoff,
            prior_execution_result=current_record.prior_execution_result,
            orchestration_result=current_record.orchestration_result,
            persisted_session=current_record.persisted_session,
            resume_request=resume_request,
            last_updated=self._timestamp(),
            notes=current_record.notes,
        )
        updated_registry = self._replace_session(request.session_registry, updated_record)
        resulting_awareness = self._awareness.build_awareness_result(
            AwarenessRequest(
                session_registry=updated_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
                latest_loop_result=request.latest_loop_result,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                notes=request.notes,
            )
        )
        updated_summary = self._find_session_summary(resulting_awareness, request.target_session_id)
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=OperatorCommandType.APPROVE_GATE,
            target_type=OperatorTargetType.GATE,
            target_session_id=request.target_session_id,
            command_status=OperatorCommandStatus.EXECUTED,
            action_effect=OperatorActionEffect.GATE_APPROVED,
            effect_summary=self._gate_approval_summary(request.target_session_id, gate_type, updated_summary),
            operator_notes=request.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=resulting_awareness,
            policy_evaluation=policy_evaluation,
            updated_session_registry=updated_registry,
            session_summary=updated_summary,
            blocker_summaries=tuple(
                blocker for blocker in resulting_awareness.blocker_summaries if blocker.session_id == request.target_session_id
            ),
            resulting_session_status=updated_summary.session_status if updated_summary else None,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    def _handle_reprioritize_session(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        policy_evaluation: PolicyEvaluationResult,
    ) -> OperatorCommandResult:
        new_priority = self._normalize_priority(request.new_priority)
        current_record = self._find_session_record(request.session_registry, request.target_session_id)
        if current_record is None or new_priority is None:
            return self._rejected_result(
                request=request,
                awareness_snapshot=awareness_snapshot,
                command_type=OperatorCommandType.REPRIORITIZE_SESSION,
                target_type=OperatorTargetType.SESSION,
                rejection_reason=OperatorRejectionReason.INVALID_TARGET,
                effect_summary="Reprioritize requires a valid session target and priority.",
            )
        if current_record.priority == new_priority:
            summary = self._find_session_summary(awareness_snapshot, request.target_session_id)
            decision = OperatorCommandDecision(
                command_id=request.command_id,
                command_type=OperatorCommandType.REPRIORITIZE_SESSION,
                target_type=OperatorTargetType.SESSION,
                target_session_id=request.target_session_id,
                command_status=OperatorCommandStatus.NO_OP,
                action_effect=OperatorActionEffect.NO_CHANGE,
                effect_summary=f"Session {request.target_session_id} already has priority {new_priority.value}.",
                operator_notes=request.notes,
            )
            result = OperatorCommandResult(
                decision=decision,
                awareness_snapshot_used=awareness_snapshot,
                resulting_awareness=awareness_snapshot,
                policy_evaluation=policy_evaluation,
                updated_session_registry=request.session_registry,
                session_summary=summary,
                resulting_session_status=summary.session_status if summary else None,
                executed_at=self._timestamp(),
            )
            self._record_command_outcome(request, result)
            return result
        updated_record = replace(current_record, priority=new_priority, last_updated=self._timestamp())
        updated_registry = self._replace_session(request.session_registry, updated_record)
        resulting_awareness = self._awareness.build_awareness_result(
            AwarenessRequest(
                session_registry=updated_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
                latest_loop_result=request.latest_loop_result,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                notes=request.notes,
            )
        )
        updated_summary = self._find_session_summary(resulting_awareness, request.target_session_id)
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=OperatorCommandType.REPRIORITIZE_SESSION,
            target_type=OperatorTargetType.SESSION,
            target_session_id=request.target_session_id,
            command_status=OperatorCommandStatus.EXECUTED,
            action_effect=OperatorActionEffect.PRIORITY_UPDATED,
            effect_summary=f"Updated session {request.target_session_id} priority to {new_priority.value}.",
            operator_notes=request.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=resulting_awareness,
            policy_evaluation=policy_evaluation,
            updated_session_registry=updated_registry,
            session_summary=updated_summary,
            resulting_session_status=updated_summary.session_status if updated_summary else None,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    def _handle_select_session(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        policy_evaluation: PolicyEvaluationResult,
    ) -> OperatorCommandResult:
        summary = self._find_session_summary(awareness_snapshot, request.target_session_id)
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=OperatorCommandType.SELECT_SESSION,
            target_type=OperatorTargetType.SESSION,
            target_session_id=request.target_session_id,
            command_status=OperatorCommandStatus.NO_OP,
            action_effect=OperatorActionEffect.SESSION_SELECTION_VALIDATED,
            effect_summary=(
                f"Validated that session {request.target_session_id} is currently actionable; "
                "operator selection is not persisted outside this command in v1."
            ),
            operator_notes=request.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            policy_evaluation=policy_evaluation,
            updated_session_registry=request.session_registry,
            session_summary=summary,
            resulting_session_status=summary.session_status if summary else None,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    def _evaluate_policy(
        self,
        request: OperatorCommandRequest,
        command_type: OperatorCommandType,
        awareness_snapshot: AwarenessResult,
    ) -> PolicyEvaluationResult:
        return self._autonomy_policy.evaluate(
            AutonomyPolicyContext(
                action_type=self._policy_action_type(command_type),
                awareness_snapshot=awareness_snapshot,
                latest_loop_result=request.latest_loop_result,
                active_policy_profile=request.active_policy_profile or self._active_policy_profile,
                operator_command_present=True,
                target_session_id=request.target_session_id,
                requested_max_cycles=(
                    request.max_cycles
                    if command_type in {OperatorCommandType.RUN_SINGLE_CYCLE, OperatorCommandType.RUN_BOUNDED_LOOP}
                    else None
                ),
                notes=request.notes,
            )
        )

    @staticmethod
    def _policy_action_type(command_type: OperatorCommandType) -> AutonomyActionType:
        mapping = {
            OperatorCommandType.INSPECT_SYSTEM: AutonomyActionType.INSPECT_ONLY,
            OperatorCommandType.INSPECT_SESSION: AutonomyActionType.INSPECT_ONLY,
            OperatorCommandType.RUN_SINGLE_CYCLE: AutonomyActionType.RUN_SINGLE_CYCLE,
            OperatorCommandType.RUN_BOUNDED_LOOP: AutonomyActionType.RUN_BOUNDED_LOOP,
            OperatorCommandType.APPROVE_GATE: AutonomyActionType.APPROVE_GATE,
            OperatorCommandType.REPRIORITIZE_SESSION: AutonomyActionType.REPRIORITIZE_SESSION,
            OperatorCommandType.SELECT_SESSION: AutonomyActionType.SELECT_SESSION,
        }
        return mapping[command_type]

    def _policy_rejected_result(
        self,
        *,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
        command_type: OperatorCommandType,
        target_type: OperatorTargetType,
        policy_evaluation: PolicyEvaluationResult,
    ) -> OperatorCommandResult:
        rejection_reason = self._policy_rejection_reason(policy_evaluation)
        command_status = self._policy_command_status(policy_evaluation.decision.decision_status)
        effect_summary = policy_evaluation.decision.policy_notes[0] if policy_evaluation.decision.policy_notes else "Policy blocked the requested command."
        return self._rejected_result(
            request=request,
            awareness_snapshot=awareness_snapshot,
            policy_evaluation=policy_evaluation,
            command_type=command_type,
            target_type=target_type,
            rejection_reason=rejection_reason,
            effect_summary=effect_summary,
            command_status=command_status,
        )

    @staticmethod
    def _policy_command_status(policy_status: AutonomyPolicyStatus) -> OperatorCommandStatus:
        if policy_status == AutonomyPolicyStatus.INVALID_REQUEST:
            return OperatorCommandStatus.INVALID_REQUEST
        if policy_status == AutonomyPolicyStatus.UNSUPPORTED:
            return OperatorCommandStatus.REJECTED
        return OperatorCommandStatus.BLOCKED

    @staticmethod
    def _policy_rejection_reason(policy_evaluation: PolicyEvaluationResult) -> OperatorRejectionReason:
        reasons = set(policy_evaluation.decision.reasons)
        if AutonomyPolicyReason.SESSION_NOT_ACTIONABLE in reasons:
            return OperatorRejectionReason.SESSION_NOT_ACTIONABLE
        if policy_evaluation.decision.decision_status == AutonomyPolicyStatus.UNSUPPORTED:
            return OperatorRejectionReason.UNSUPPORTED_IN_V1
        if policy_evaluation.decision.decision_status == AutonomyPolicyStatus.INVALID_REQUEST:
            return OperatorRejectionReason.INVALID_TARGET
        return OperatorRejectionReason.COMMAND_CONFLICTS_WITH_SYSTEM_STATE

    def _validate_command(
        self,
        request: OperatorCommandRequest,
        command_type: OperatorCommandType,
        target_type: OperatorTargetType,
        awareness_snapshot: AwarenessResult,
    ) -> tuple[OperatorRejectionReason, str] | None:
        expected_targets = {
            OperatorCommandType.INSPECT_SYSTEM: OperatorTargetType.SYSTEM,
            OperatorCommandType.INSPECT_SESSION: OperatorTargetType.SESSION,
            OperatorCommandType.RUN_SINGLE_CYCLE: OperatorTargetType.LOOP,
            OperatorCommandType.RUN_BOUNDED_LOOP: OperatorTargetType.LOOP,
            OperatorCommandType.APPROVE_GATE: OperatorTargetType.GATE,
            OperatorCommandType.REPRIORITIZE_SESSION: OperatorTargetType.SESSION,
            OperatorCommandType.SELECT_SESSION: OperatorTargetType.SESSION,
        }
        if expected_targets[command_type] != target_type:
            return OperatorRejectionReason.INVALID_TARGET, f"Command {command_type.value} requires target {expected_targets[command_type].value}."

        if command_type in {OperatorCommandType.RUN_SINGLE_CYCLE, OperatorCommandType.RUN_BOUNDED_LOOP}:
            if request.max_cycles < 1:
                return OperatorRejectionReason.INVALID_TARGET, "Bounded loop commands require max_cycles to be at least 1."

        if command_type in {
            OperatorCommandType.INSPECT_SESSION,
            OperatorCommandType.APPROVE_GATE,
            OperatorCommandType.REPRIORITIZE_SESSION,
            OperatorCommandType.SELECT_SESSION,
        }:
            if request.target_session_id is None:
                return OperatorRejectionReason.INVALID_TARGET, "A target session id is required for this command."
            if self._find_session_summary(awareness_snapshot, request.target_session_id) is None:
                return OperatorRejectionReason.SESSION_NOT_FOUND, f"Session {request.target_session_id} is not present in the current registry."

        if command_type == OperatorCommandType.APPROVE_GATE:
            gate_type = self._normalize_gate_type(request.gate_type)
            if gate_type is None:
                return OperatorRejectionReason.INVALID_TARGET, "Approve gate requires a valid gate type."
            summary = self._find_session_summary(awareness_snapshot, request.target_session_id)
            expected_lifecycle = {
                OperatorGateType.CONFIRMATION: LifecycleState.AWAITING_CONFIRMATION,
                OperatorGateType.REVIEW: LifecycleState.AWAITING_REVIEW,
                OperatorGateType.PLAYTEST: LifecycleState.AWAITING_PLAYTEST,
            }[gate_type]
            if summary is None or summary.lifecycle_state != expected_lifecycle:
                return OperatorRejectionReason.GATE_NOT_CLEARABLE, (
                    f"Session {request.target_session_id} is not currently waiting on {gate_type.value}."
                )

        if command_type == OperatorCommandType.REPRIORITIZE_SESSION and self._normalize_priority(request.new_priority) is None:
            return OperatorRejectionReason.INVALID_TARGET, "Reprioritize session requires a valid new priority."

        if command_type == OperatorCommandType.SELECT_SESSION:
            summary = self._find_session_summary(awareness_snapshot, request.target_session_id)
            if summary is None or not summary.actionable:
                return OperatorRejectionReason.SESSION_NOT_ACTIONABLE, (
                    f"Session {request.target_session_id} is not currently actionable and cannot be explicitly selected."
                )
        return None

    @staticmethod
    def _normalize_command_type(command_type: OperatorCommandType | str) -> OperatorCommandType | None:
        if isinstance(command_type, OperatorCommandType):
            return command_type
        try:
            return OperatorCommandType(command_type)
        except ValueError:
            return None

    @staticmethod
    def _normalize_target_type(target_type: OperatorTargetType | str) -> OperatorTargetType | None:
        if isinstance(target_type, OperatorTargetType):
            return target_type
        try:
            return OperatorTargetType(target_type)
        except ValueError:
            return None

    @staticmethod
    def _normalize_gate_type(gate_type: OperatorGateType | str | None) -> OperatorGateType | None:
        if gate_type is None:
            return None
        if isinstance(gate_type, OperatorGateType):
            return gate_type
        try:
            return OperatorGateType(gate_type)
        except ValueError:
            return None

    @staticmethod
    def _normalize_priority(priority: MultiTaskPriority | str | None) -> MultiTaskPriority | None:
        if priority is None:
            return None
        if isinstance(priority, MultiTaskPriority):
            return priority
        try:
            return MultiTaskPriority(priority)
        except ValueError:
            return None

    @staticmethod
    def _find_session_record(
        registry: tuple[MultiTaskSessionRecord, ...],
        session_id: str | None,
    ) -> MultiTaskSessionRecord | None:
        if session_id is None:
            return None
        for record in registry:
            if record.session_id == session_id:
                return record
        return None

    @staticmethod
    def _find_session_summary(
        awareness_snapshot: AwarenessResult,
        session_id: str | None,
    ) -> SessionHealthSummary | None:
        if session_id is None:
            return None
        for summary in awareness_snapshot.session_summaries:
            if summary.session_id == session_id:
                return summary
        return None

    @staticmethod
    def _replace_session(
        registry: tuple[MultiTaskSessionRecord, ...],
        updated_record: MultiTaskSessionRecord,
    ) -> tuple[MultiTaskSessionRecord, ...]:
        return tuple(updated_record if record.session_id == updated_record.session_id else record for record in registry)

    @staticmethod
    def _command_status_from_loop_result(loop_result: LoopEngineResult) -> OperatorCommandStatus:
        if loop_result.status in {LoopEngineStatus.RAN_ACTION, LoopEngineStatus.COMPLETED, LoopEngineStatus.MAX_CYCLES_REACHED}:
            return OperatorCommandStatus.EXECUTED
        if loop_result.status == LoopEngineStatus.INVALID_REQUEST:
            return OperatorCommandStatus.INVALID_REQUEST
        return OperatorCommandStatus.BLOCKED

    @staticmethod
    def _loop_effect_summary(loop_result: LoopEngineResult, max_cycles: int) -> str:
        if loop_result.status == LoopEngineStatus.RAN_ACTION:
            return f"Executed a bounded loop request for up to {max_cycles} cycle(s)."
        if loop_result.status == LoopEngineStatus.COMPLETED:
            return "Executed bounded loop work until all sessions completed."
        if loop_result.status == LoopEngineStatus.MAX_CYCLES_REACHED:
            return f"Executed bounded loop work until the configured max_cycles={max_cycles} limit was reached."
        if loop_result.status == LoopEngineStatus.WAITING:
            return "Loop command was blocked by a human gate and did not advance bounded execution."
        if loop_result.status == LoopEngineStatus.STOPPED:
            return "Loop command was blocked by dependency or artifact rules and did not advance bounded execution."
        if loop_result.status == LoopEngineStatus.NO_ACTIONABLE_SESSIONS:
            return "Loop command found no actionable sessions under current bounded rules."
        return "Loop command could not execute because the request state was invalid."

    @staticmethod
    def _gate_approval_summary(
        session_id: str | None,
        gate_type: OperatorGateType,
        summary: SessionHealthSummary | None,
    ) -> str:
        if summary is None:
            return f"Approved {gate_type.value} gate for session {session_id}."
        return (
            f"Approved {gate_type.value} gate for session {session_id}; "
            f"resulting session status is {summary.session_status.value}."
        )

    def _rejected_result(
        self,
        *,
        request: OperatorCommandRequest,
        rejection_reason: OperatorRejectionReason,
        effect_summary: str,
        awareness_snapshot: AwarenessResult | None = None,
        policy_evaluation: PolicyEvaluationResult | None = None,
        command_type: OperatorCommandType | str | None = None,
        target_type: OperatorTargetType | str | None = None,
        command_status: OperatorCommandStatus | None = None,
    ) -> OperatorCommandResult:
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=command_type or request.command_type,
            target_type=target_type or request.target_type,
            target_session_id=request.target_session_id,
            command_status=command_status
            or (
                OperatorCommandStatus.INVALID_REQUEST
                if rejection_reason in {OperatorRejectionReason.UNKNOWN_COMMAND, OperatorRejectionReason.INVALID_TARGET}
                else OperatorCommandStatus.REJECTED
            ),
            action_effect=OperatorActionEffect.COMMAND_REJECTED,
            rejection_reason=rejection_reason,
            effect_summary=effect_summary,
            operator_notes=request.notes,
        )
        result = OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            policy_evaluation=policy_evaluation,
            updated_session_registry=request.session_registry,
            executed_at=self._timestamp(),
        )
        self._record_command_outcome(request, result)
        return result

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()