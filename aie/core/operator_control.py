from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from .execution_loop_engine import ExecutionLoopEngine
from .models import (
    AwarenessRequest,
    AwarenessResult,
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
    ResumeRequest,
    SessionHealthSummary,
)
from .multi_task_orchestrator import MultiTaskOrchestrator
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
    ) -> None:
        self._multi_task_orchestrator = multi_task_orchestrator or MultiTaskOrchestrator()
        self._awareness = awareness or SystemAwareness(self._multi_task_orchestrator)
        self._loop_engine = loop_engine or ExecutionLoopEngine(self._multi_task_orchestrator)

    def handle_command(self, request: OperatorCommandRequest) -> OperatorCommandResult:
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
                notes=request.notes,
            )
        )
        validation = self._validate_command(request, command_type, target_type, awareness_snapshot)
        if validation is not None:
            rejection_reason, effect_summary = validation
            return self._rejected_result(
                request=request,
                awareness_snapshot=awareness_snapshot,
                command_type=command_type,
                target_type=target_type,
                rejection_reason=rejection_reason,
                effect_summary=effect_summary,
            )

        if command_type == OperatorCommandType.INSPECT_SYSTEM:
            return self._handle_inspect_system(request, awareness_snapshot)
        if command_type == OperatorCommandType.INSPECT_SESSION:
            return self._handle_inspect_session(request, awareness_snapshot)
        if command_type == OperatorCommandType.RUN_SINGLE_CYCLE:
            return self._handle_run_loop(request, awareness_snapshot, max_cycles=1, action_effect=OperatorActionEffect.LOOP_CYCLE_REQUESTED)
        if command_type == OperatorCommandType.RUN_BOUNDED_LOOP:
            return self._handle_run_loop(
                request,
                awareness_snapshot,
                max_cycles=request.max_cycles,
                action_effect=OperatorActionEffect.BOUNDED_LOOP_REQUESTED,
            )
        if command_type == OperatorCommandType.APPROVE_GATE:
            return self._handle_approve_gate(request, awareness_snapshot)
        if command_type == OperatorCommandType.REPRIORITIZE_SESSION:
            return self._handle_reprioritize_session(request, awareness_snapshot)
        return self._handle_select_session(request, awareness_snapshot)

    def _handle_inspect_system(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
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
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            updated_session_registry=request.session_registry,
            blocker_summaries=awareness_snapshot.blocker_summaries,
            executed_at=self._timestamp(),
        )

    def _handle_inspect_session(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
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
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            updated_session_registry=request.session_registry,
            session_summary=summary,
            blocker_summaries=blocker_summaries,
            resulting_session_status=summary.session_status if summary else None,
            executed_at=self._timestamp(),
        )

    def _handle_run_loop(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
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
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=resulting_awareness,
            loop_result=loop_result,
            updated_session_registry=updated_registry,
            blocker_summaries=resulting_awareness.blocker_summaries,
            resulting_loop_status=loop_result.status,
            executed_at=self._timestamp(),
        )

    def _handle_approve_gate(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
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
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=resulting_awareness,
            updated_session_registry=updated_registry,
            session_summary=updated_summary,
            blocker_summaries=tuple(
                blocker for blocker in resulting_awareness.blocker_summaries if blocker.session_id == request.target_session_id
            ),
            resulting_session_status=updated_summary.session_status if updated_summary else None,
            executed_at=self._timestamp(),
        )

    def _handle_reprioritize_session(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
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
            return OperatorCommandResult(
                decision=decision,
                awareness_snapshot_used=awareness_snapshot,
                resulting_awareness=awareness_snapshot,
                updated_session_registry=request.session_registry,
                session_summary=summary,
                resulting_session_status=summary.session_status if summary else None,
                executed_at=self._timestamp(),
            )
        updated_record = replace(current_record, priority=new_priority, last_updated=self._timestamp())
        updated_registry = self._replace_session(request.session_registry, updated_record)
        resulting_awareness = self._awareness.build_awareness_result(
            AwarenessRequest(
                session_registry=updated_registry,
                dependency_graph=request.dependency_graph,
                artifact_registry=request.artifact_registry,
                artifact_requirements=request.artifact_requirements,
                latest_loop_result=request.latest_loop_result,
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
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=resulting_awareness,
            updated_session_registry=updated_registry,
            session_summary=updated_summary,
            resulting_session_status=updated_summary.session_status if updated_summary else None,
            executed_at=self._timestamp(),
        )

    def _handle_select_session(
        self,
        request: OperatorCommandRequest,
        awareness_snapshot: AwarenessResult,
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
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            updated_session_registry=request.session_registry,
            session_summary=summary,
            resulting_session_status=summary.session_status if summary else None,
            executed_at=self._timestamp(),
        )

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
        command_type: OperatorCommandType | str | None = None,
        target_type: OperatorTargetType | str | None = None,
    ) -> OperatorCommandResult:
        decision = OperatorCommandDecision(
            command_id=request.command_id,
            command_type=command_type or request.command_type,
            target_type=target_type or request.target_type,
            target_session_id=request.target_session_id,
            command_status=(
                OperatorCommandStatus.INVALID_REQUEST
                if rejection_reason in {OperatorRejectionReason.UNKNOWN_COMMAND, OperatorRejectionReason.INVALID_TARGET}
                else OperatorCommandStatus.REJECTED
            ),
            action_effect=OperatorActionEffect.COMMAND_REJECTED,
            rejection_reason=rejection_reason,
            effect_summary=effect_summary,
            operator_notes=request.notes,
        )
        return OperatorCommandResult(
            decision=decision,
            awareness_snapshot_used=awareness_snapshot,
            resulting_awareness=awareness_snapshot,
            updated_session_registry=request.session_registry,
            executed_at=self._timestamp(),
        )

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()