from __future__ import annotations

from .models import (
    ExecutorStatus,
    LifecycleState,
    OrchestrationAction,
    OrchestrationDecision,
    OrchestrationRequest,
    OrchestrationResult,
    OrchestrationStatus,
    PersistedExecutionSession,
    ResumeRequest,
    StopReason,
)
from .task_chain_executor import TaskChainExecutor
from .task_chain_resume import TaskChainResumeCoordinator


class ExecutionOrchestrator:
    """Coordinate fresh execution and bounded resume/re-entry without widening autonomy."""

    def __init__(
        self,
        executor: TaskChainExecutor | None = None,
        resume_coordinator: TaskChainResumeCoordinator | None = None,
    ) -> None:
        self._executor = executor or TaskChainExecutor()
        self._resume_coordinator = resume_coordinator or TaskChainResumeCoordinator(self._executor)

    def orchestrate(self, request: OrchestrationRequest) -> OrchestrationResult:
        decision = self.inspect(request)

        if decision.chosen_action == OrchestrationAction.EXECUTE:
            return self._orchestrate_fresh_execution(request=request, decision=decision)
        if decision.chosen_action == OrchestrationAction.RESUME:
            return self._orchestrate_resume(request=request, decision=decision)
        if decision.chosen_action == OrchestrationAction.WAIT:
            return self._build_wait_result(request=request, decision=decision)
        if decision.chosen_action == OrchestrationAction.STOP:
            return self._build_stop_result(request=request, decision=decision)
        return self._build_reject_result(request=request, decision=decision)

    def inspect(self, request: OrchestrationRequest) -> OrchestrationDecision:
        lifecycle_state, lifecycle_notes = self._classify_lifecycle_state(request)
        return self._choose_action(request=request, lifecycle_state=lifecycle_state, lifecycle_notes=lifecycle_notes)

    def orchestrate_persisted_session(
        self,
        session: PersistedExecutionSession,
        *,
        resume_request: ResumeRequest | None = None,
    ) -> OrchestrationResult:
        return self.orchestrate(
            OrchestrationRequest(
                handoff=session.router_handoff,
                prior_execution_result=session.task_execution_result,
                resume_request=resume_request,
            )
        )

    def _classify_lifecycle_state(self, request: OrchestrationRequest) -> tuple[LifecycleState, tuple[str, ...]]:
        handoff = request.handoff
        prior_result = request.prior_execution_result
        resume_request = request.resume_request

        if prior_result is None:
            if handoff is None:
                return LifecycleState.INVALID_REQUEST, ("A fresh orchestration request requires a router handoff.",)
            if resume_request is not None:
                return LifecycleState.INVALID_REQUEST, ("Resume input is invalid without a prior execution result.",)
            return LifecycleState.READY_TO_EXECUTE, ("Fresh router handoff is ready for bounded execution.",)

        if handoff is None:
            return LifecycleState.INVALID_REQUEST, ("Resumed orchestration requires the preserved router handoff context.",)

        if prior_result.status == ExecutorStatus.COMPLETED:
            return LifecycleState.COMPLETED, ("The task chain is already complete.",)
        if prior_result.status == ExecutorStatus.FAILED:
            return LifecycleState.FAILED, ("The prior executor result failed and needs manual inspection.",)
        if prior_result.status in {ExecutorStatus.BLOCKED, ExecutorStatus.UNSUPPORTED}:
            return LifecycleState.BLOCKED, ("The prior executor result is blocked and cannot continue automatically.",)

        if prior_result.stop_reason in {
            StopReason.BLOCKED_BY_POLICY,
            StopReason.BLOCKED_BY_ASSUMPTION,
            StopReason.DEPENDENCY_INCOMPLETE,
            StopReason.UNSUPPORTED_STEP_TYPE,
        }:
            return LifecycleState.BLOCKED, ("Execution remains blocked until the underlying blocker is resolved.",)
        if prior_result.stop_reason == StopReason.EXECUTION_ERROR:
            return LifecycleState.FAILED, ("Execution stopped due to an execution error.",)

        if prior_result.status == ExecutorStatus.AWAITING_CONFIRMATION:
            if resume_request and (resume_request.confirmation_cleared or resume_request.human_action_cleared):
                return LifecycleState.RESUMABLE, ("Confirmation gate has been explicitly cleared.",)
            return LifecycleState.AWAITING_CONFIRMATION, ("Execution is waiting on explicit confirmation.",)

        if prior_result.status == ExecutorStatus.AWAITING_REVIEW:
            if resume_request and (resume_request.review_cleared or resume_request.human_action_cleared):
                return LifecycleState.RESUMABLE, ("Review gate has been explicitly cleared.",)
            return LifecycleState.AWAITING_REVIEW, ("Execution is waiting on human review.",)

        if prior_result.status == ExecutorStatus.AWAITING_PLAYTEST:
            if resume_request and (resume_request.playtest_cleared or resume_request.human_action_cleared):
                return LifecycleState.RESUMABLE, ("Playtest gate has been explicitly cleared.",)
            return LifecycleState.AWAITING_PLAYTEST, ("Execution is waiting on supervised playtest.",)

        if prior_result.status == ExecutorStatus.PARTIALLY_COMPLETED:
            if prior_result.stop_reason is None:
                return LifecycleState.RESUMABLE, ("Execution can resume from the next incomplete step.",)
            if prior_result.stop_reason == StopReason.CONFIRMATION_REQUIRED:
                if resume_request and (resume_request.confirmation_cleared or resume_request.human_action_cleared):
                    return LifecycleState.RESUMABLE, ("Confirmation gate has been explicitly cleared.",)
                return LifecycleState.AWAITING_CONFIRMATION, ("Execution is waiting on explicit confirmation.",)
            if prior_result.stop_reason == StopReason.REVIEW_REQUIRED:
                if resume_request and (resume_request.review_cleared or resume_request.human_action_cleared):
                    return LifecycleState.RESUMABLE, ("Review gate has been explicitly cleared.",)
                return LifecycleState.AWAITING_REVIEW, ("Execution is waiting on human review.",)
            if prior_result.stop_reason == StopReason.PLAYTEST_REQUIRED:
                if resume_request and (resume_request.playtest_cleared or resume_request.human_action_cleared):
                    return LifecycleState.RESUMABLE, ("Playtest gate has been explicitly cleared.",)
                return LifecycleState.AWAITING_PLAYTEST, ("Execution is waiting on supervised playtest.",)

        return LifecycleState.INVALID_REQUEST, ("The orchestration inputs do not map to a valid bounded lifecycle state.",)

    def _choose_action(
        self,
        *,
        request: OrchestrationRequest,
        lifecycle_state: LifecycleState,
        lifecycle_notes: tuple[str, ...],
    ) -> OrchestrationDecision:
        prior_result = request.prior_execution_result
        prior_status = prior_result.status if prior_result else None
        required_human_action = self._required_human_action(request=request, lifecycle_state=lifecycle_state)

        if lifecycle_state == LifecycleState.READY_TO_EXECUTE:
            return OrchestrationDecision(
                lifecycle_state=lifecycle_state,
                chosen_action=OrchestrationAction.EXECUTE,
                prior_executor_status=prior_status,
                resume_allowed=False,
                required_human_action=None,
                orchestration_notes=lifecycle_notes,
            )
        if lifecycle_state == LifecycleState.RESUMABLE:
            return OrchestrationDecision(
                lifecycle_state=lifecycle_state,
                chosen_action=OrchestrationAction.RESUME,
                prior_executor_status=prior_status,
                resume_allowed=True,
                required_human_action=None,
                orchestration_notes=lifecycle_notes,
            )
        if lifecycle_state in {
            LifecycleState.AWAITING_CONFIRMATION,
            LifecycleState.AWAITING_REVIEW,
            LifecycleState.AWAITING_PLAYTEST,
        }:
            return OrchestrationDecision(
                lifecycle_state=lifecycle_state,
                chosen_action=OrchestrationAction.WAIT,
                prior_executor_status=prior_status,
                resume_allowed=False,
                required_human_action=required_human_action,
                orchestration_notes=lifecycle_notes,
            )
        if lifecycle_state in {LifecycleState.BLOCKED, LifecycleState.COMPLETED, LifecycleState.FAILED}:
            return OrchestrationDecision(
                lifecycle_state=lifecycle_state,
                chosen_action=OrchestrationAction.STOP,
                prior_executor_status=prior_status,
                resume_allowed=False,
                required_human_action=required_human_action,
                orchestration_notes=lifecycle_notes,
            )
        return OrchestrationDecision(
            lifecycle_state=lifecycle_state,
            chosen_action=OrchestrationAction.REJECT,
            prior_executor_status=prior_status,
            resume_allowed=False,
            required_human_action=required_human_action,
            orchestration_notes=lifecycle_notes,
        )

    def _orchestrate_fresh_execution(
        self,
        *,
        request: OrchestrationRequest,
        decision: OrchestrationDecision,
    ) -> OrchestrationResult:
        execution_result = self._executor.execute(request.handoff)
        status = self._status_from_executor_status(execution_result.status)
        notes = tuple(dict.fromkeys(decision.orchestration_notes + execution_result.summary_notes))
        return OrchestrationResult(
            status=status,
            decision=decision,
            execution_result=execution_result,
            resume_result=None,
            final_executor_status=execution_result.status,
            orchestration_notes=notes,
        )

    def _orchestrate_resume(
        self,
        *,
        request: OrchestrationRequest,
        decision: OrchestrationDecision,
    ) -> OrchestrationResult:
        effective_resume_request = request.resume_request
        if effective_resume_request is None and request.prior_execution_result is not None:
            effective_resume_request = ResumeRequest.from_execution_result(request.prior_execution_result)

        resume_result = self._resume_coordinator.resume(
            handoff=request.handoff,
            prior_result=request.prior_execution_result,
            request=effective_resume_request,
        )
        execution_result = resume_result.execution_result
        final_executor_status = execution_result.status if execution_result else None
        status = self._status_from_resume_result(resume_result=resume_result)
        notes = tuple(dict.fromkeys(decision.orchestration_notes + resume_result.resume_notes))
        return OrchestrationResult(
            status=status,
            decision=decision,
            execution_result=execution_result,
            resume_result=resume_result,
            final_executor_status=final_executor_status,
            orchestration_notes=notes,
        )

    def _build_wait_result(
        self,
        *,
        request: OrchestrationRequest,
        decision: OrchestrationDecision,
    ) -> OrchestrationResult:
        return OrchestrationResult(
            status=self._status_from_lifecycle_state(decision.lifecycle_state),
            decision=decision,
            execution_result=request.prior_execution_result,
            resume_result=None,
            final_executor_status=request.prior_execution_result.status if request.prior_execution_result else None,
            orchestration_notes=decision.orchestration_notes,
        )

    def _build_stop_result(
        self,
        *,
        request: OrchestrationRequest,
        decision: OrchestrationDecision,
    ) -> OrchestrationResult:
        return OrchestrationResult(
            status=self._status_from_lifecycle_state(decision.lifecycle_state),
            decision=decision,
            execution_result=request.prior_execution_result,
            resume_result=None,
            final_executor_status=request.prior_execution_result.status if request.prior_execution_result else None,
            orchestration_notes=decision.orchestration_notes,
        )

    def _build_reject_result(
        self,
        *,
        request: OrchestrationRequest,
        decision: OrchestrationDecision,
    ) -> OrchestrationResult:
        return OrchestrationResult(
            status=OrchestrationStatus.INVALID_REQUEST,
            decision=decision,
            execution_result=request.prior_execution_result,
            resume_result=None,
            final_executor_status=request.prior_execution_result.status if request.prior_execution_result else None,
            orchestration_notes=decision.orchestration_notes,
        )

    @staticmethod
    def _required_human_action(
        *,
        request: OrchestrationRequest,
        lifecycle_state: LifecycleState,
    ) -> str | None:
        prior_result = request.prior_execution_result
        if lifecycle_state in {
            LifecycleState.AWAITING_CONFIRMATION,
            LifecycleState.AWAITING_REVIEW,
            LifecycleState.AWAITING_PLAYTEST,
        }:
            return prior_result.next_human_action if prior_result else None
        if lifecycle_state == LifecycleState.BLOCKED:
            if prior_result and prior_result.next_human_action:
                return prior_result.next_human_action
            if prior_result and prior_result.stop_reason == StopReason.BLOCKED_BY_ASSUMPTION:
                return "Resolve the blocked assumption before retrying continuation."
            if prior_result and prior_result.stop_reason == StopReason.BLOCKED_BY_POLICY:
                return "Resolve the policy blocker manually before continuing."
            return "Resolve the blocker before requesting continuation."
        if lifecycle_state == LifecycleState.FAILED:
            return "Inspect the execution failure manually before retrying."
        return None

    @staticmethod
    def _status_from_executor_status(executor_status: ExecutorStatus) -> OrchestrationStatus:
        mapping = {
            ExecutorStatus.COMPLETED: OrchestrationStatus.COMPLETED,
            ExecutorStatus.PARTIALLY_COMPLETED: OrchestrationStatus.RESUMABLE,
            ExecutorStatus.BLOCKED: OrchestrationStatus.BLOCKED,
            ExecutorStatus.AWAITING_CONFIRMATION: OrchestrationStatus.AWAITING_CONFIRMATION,
            ExecutorStatus.AWAITING_REVIEW: OrchestrationStatus.AWAITING_REVIEW,
            ExecutorStatus.AWAITING_PLAYTEST: OrchestrationStatus.AWAITING_PLAYTEST,
            ExecutorStatus.UNSUPPORTED: OrchestrationStatus.BLOCKED,
            ExecutorStatus.FAILED: OrchestrationStatus.FAILED,
        }
        return mapping[executor_status]

    def _status_from_resume_result(self, *, resume_result) -> OrchestrationStatus:
        if resume_result.execution_result is None:
            return OrchestrationStatus.INVALID_REQUEST if resume_result.status.value == "not_resumable" else OrchestrationStatus.FAILED
        return self._status_from_executor_status(resume_result.execution_result.status)

    @staticmethod
    def _status_from_lifecycle_state(lifecycle_state: LifecycleState) -> OrchestrationStatus:
        mapping = {
            LifecycleState.READY_TO_EXECUTE: OrchestrationStatus.READY_TO_EXECUTE,
            LifecycleState.AWAITING_CONFIRMATION: OrchestrationStatus.AWAITING_CONFIRMATION,
            LifecycleState.AWAITING_REVIEW: OrchestrationStatus.AWAITING_REVIEW,
            LifecycleState.AWAITING_PLAYTEST: OrchestrationStatus.AWAITING_PLAYTEST,
            LifecycleState.RESUMABLE: OrchestrationStatus.RESUMABLE,
            LifecycleState.BLOCKED: OrchestrationStatus.BLOCKED,
            LifecycleState.COMPLETED: OrchestrationStatus.COMPLETED,
            LifecycleState.FAILED: OrchestrationStatus.FAILED,
            LifecycleState.INVALID_REQUEST: OrchestrationStatus.INVALID_REQUEST,
        }
        return mapping[lifecycle_state]