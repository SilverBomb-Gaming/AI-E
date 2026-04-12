from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from .models import (
    ConstraintRouterHandoff,
    ExecutorStatus,
    ReentryStatus,
    ResumeDecision,
    ResumeEligibility,
    ResumeReason,
    ResumeRequest,
    ResumeResult,
    StopReason,
    TaskExecutionResult,
    TaskStep,
    TaskStepRun,
)
from .task_chain_executor import TaskChainExecutor


def _load_policy_file(file_name: str) -> dict:
    policy_path = Path(__file__).resolve().parents[1] / "policies" / file_name
    return json.loads(policy_path.read_text(encoding="utf-8"))


class TaskChainResumeCoordinator:
    """Validate and continue bounded task-chain execution from truthful prior executor state."""

    def __init__(self, executor: TaskChainExecutor | None = None) -> None:
        self._executor = executor or TaskChainExecutor()
        guardrails = _load_policy_file("execution_guardrails.json")
        self._resume_allowed_statuses = tuple(guardrails.get("resume_allowed_statuses", []))
        self._resumable_stop_reasons = tuple(guardrails.get("resumable_stop_reasons", []))
        self._replay_completed_steps = bool(guardrails.get("replay_completed_steps", False))
        self._requires_explicit_clearance = bool(guardrails.get("requires_explicit_clearance", True))

    def evaluate_resume(
        self,
        *,
        handoff: ConstraintRouterHandoff,
        prior_result: TaskExecutionResult,
        request: ResumeRequest,
    ) -> ResumeDecision:
        if request.prior_executor_status != prior_result.status:
            return self._not_resumable(
                prior_result=prior_result,
                request=request,
                reason=ResumeReason.INCONSISTENT_PRIOR_STATE,
                notes=("Resume request status does not match the prior execution result.",),
            )

        if request.stop_reason != prior_result.stop_reason or request.blocked_step_id != prior_result.blocked_step_id:
            return self._not_resumable(
                prior_result=prior_result,
                request=request,
                reason=ResumeReason.INCONSISTENT_PRIOR_STATE,
                notes=("Resume request stop state does not match the prior execution result.",),
            )

        if handoff.blocked_items or prior_result.stop_reason in {
            StopReason.BLOCKED_BY_POLICY,
            StopReason.BLOCKED_BY_ASSUMPTION,
            StopReason.DEPENDENCY_INCOMPLETE,
        }:
            return self._not_resumable(
                prior_result=prior_result,
                request=request,
                reason=ResumeReason.BLOCKER_UNRESOLVED,
                notes=("Resume is blocked until policy or assumption blockers are actually resolved.",),
            )

        if prior_result.status.value not in self._resume_allowed_statuses:
            return self._not_resumable(
                prior_result=prior_result,
                request=request,
                reason=ResumeReason.UNSUPPORTED_PRIOR_STOP,
                notes=(f"Executor status {prior_result.status.value} is not resumable under the current policy.",),
            )

        stop_reason = prior_result.stop_reason
        blocked_step_id = prior_result.blocked_step_id
        incomplete_steps = self._remaining_step_ids(handoff=handoff, completed_step_ids=prior_result.completed_step_ids)
        if not incomplete_steps:
            return self._not_resumable(
                prior_result=prior_result,
                request=request,
                reason=ResumeReason.INVALID_RESUME_REQUEST,
                notes=("No incomplete steps remain to resume.",),
            )

        if stop_reason is None:
            next_step_id = incomplete_steps[0]
            return ResumeDecision(
                eligibility=ResumeEligibility.RESUMABLE,
                reason=ResumeReason.PRIOR_PARTIAL_COMPLETION,
                prior_executor_status=prior_result.status,
                stop_reason=stop_reason,
                blocked_step_id=blocked_step_id,
                next_resumable_step_id=next_step_id,
                human_action_cleared=request.human_action_cleared,
                confirmation_cleared=request.confirmation_cleared,
                review_cleared=request.review_cleared,
                playtest_cleared=request.playtest_cleared,
                resume_allowed=True,
                resume_notes=(f"Resume will continue from the first incomplete step: {next_step_id}.",),
            )

        if stop_reason.value not in self._resumable_stop_reasons:
            return self._not_resumable(
                prior_result=prior_result,
                request=request,
                reason=ResumeReason.UNSUPPORTED_PRIOR_STOP,
                notes=(f"Stop reason {stop_reason.value} is not resumable under the current policy.",),
            )

        if stop_reason == StopReason.CONFIRMATION_REQUIRED:
            if not (request.confirmation_cleared or request.human_action_cleared):
                return self._not_resumable(
                    prior_result=prior_result,
                    request=request,
                    reason=ResumeReason.INVALID_RESUME_REQUEST,
                    notes=("Confirmation must be explicitly cleared before resume is allowed.",),
                )
            if not blocked_step_id:
                return self._not_resumable(
                    prior_result=prior_result,
                    request=request,
                    reason=ResumeReason.INCONSISTENT_PRIOR_STATE,
                    notes=("Confirmation-gated execution is missing a blocked step id.",),
                )
            return ResumeDecision(
                eligibility=ResumeEligibility.RESUMABLE,
                reason=ResumeReason.CONFIRMATION_CLEARED,
                prior_executor_status=prior_result.status,
                stop_reason=stop_reason,
                blocked_step_id=blocked_step_id,
                next_resumable_step_id=blocked_step_id,
                human_action_cleared=request.human_action_cleared or request.confirmation_cleared,
                confirmation_cleared=request.confirmation_cleared,
                review_cleared=request.review_cleared,
                playtest_cleared=request.playtest_cleared,
                resume_allowed=True,
                resume_notes=(f"Resume will retry the previously confirmation-gated step {blocked_step_id}.",),
            )

        if stop_reason == StopReason.REVIEW_REQUIRED:
            if not (request.review_cleared or request.human_action_cleared):
                return self._not_resumable(
                    prior_result=prior_result,
                    request=request,
                    reason=ResumeReason.INVALID_RESUME_REQUEST,
                    notes=("Review must be explicitly cleared before resume is allowed.",),
                )
            next_step_id = self._next_step_after(handoff=handoff, step_id=blocked_step_id, completed_step_ids=prior_result.completed_step_ids)
            if not next_step_id:
                return self._not_resumable(
                    prior_result=prior_result,
                    request=request,
                    reason=ResumeReason.INCONSISTENT_PRIOR_STATE,
                    notes=("Review-gated execution has no remaining step after the blocked review gate.",),
                )
            return ResumeDecision(
                eligibility=ResumeEligibility.RESUMABLE,
                reason=ResumeReason.REVIEW_CLEARED,
                prior_executor_status=prior_result.status,
                stop_reason=stop_reason,
                blocked_step_id=blocked_step_id,
                next_resumable_step_id=next_step_id,
                human_action_cleared=request.human_action_cleared or request.review_cleared,
                confirmation_cleared=request.confirmation_cleared,
                review_cleared=request.review_cleared,
                playtest_cleared=request.playtest_cleared,
                resume_allowed=True,
                resume_notes=(f"Resume will continue from the reviewed step boundary at {next_step_id}.",),
            )

        if stop_reason == StopReason.PLAYTEST_REQUIRED:
            if not (request.playtest_cleared or request.human_action_cleared):
                return self._not_resumable(
                    prior_result=prior_result,
                    request=request,
                    reason=ResumeReason.INVALID_RESUME_REQUEST,
                    notes=("Playtest clearance must be explicit before resume is allowed.",),
                )
            next_step_id = self._next_step_after(handoff=handoff, step_id=blocked_step_id, completed_step_ids=prior_result.completed_step_ids)
            if not next_step_id:
                return self._not_resumable(
                    prior_result=prior_result,
                    request=request,
                    reason=ResumeReason.INCONSISTENT_PRIOR_STATE,
                    notes=("Playtest-gated execution has no remaining step after the blocked playtest gate.",),
                )
            return ResumeDecision(
                eligibility=ResumeEligibility.RESUMABLE,
                reason=ResumeReason.PLAYTEST_CLEARED,
                prior_executor_status=prior_result.status,
                stop_reason=stop_reason,
                blocked_step_id=blocked_step_id,
                next_resumable_step_id=next_step_id,
                human_action_cleared=request.human_action_cleared or request.playtest_cleared,
                confirmation_cleared=request.confirmation_cleared,
                review_cleared=request.review_cleared,
                playtest_cleared=request.playtest_cleared,
                resume_allowed=True,
                resume_notes=(f"Resume will continue from the post-playtest step {next_step_id}.",),
            )

        return self._not_resumable(
            prior_result=prior_result,
            request=request,
            reason=ResumeReason.UNSUPPORTED_PRIOR_STOP,
            notes=("The prior stop state is not resumable in v1.",),
        )

    def resume(
        self,
        *,
        handoff: ConstraintRouterHandoff,
        prior_result: TaskExecutionResult,
        request: ResumeRequest,
    ) -> ResumeResult:
        decision = self.evaluate_resume(handoff=handoff, prior_result=prior_result, request=request)
        if not decision.resume_allowed or not decision.next_resumable_step_id:
            return ResumeResult(
                status=ReentryStatus.NOT_RESUMABLE,
                decision=decision,
                execution_result=prior_result,
                resume_notes=decision.resume_notes,
            )

        resumed_handoff = self._build_resumed_handoff(handoff=handoff, decision=decision)
        continued_result = self._executor.execute(resumed_handoff)
        merged_result = self._merge_results(prior_result=prior_result, continued_result=continued_result, decision=decision)
        return ResumeResult(
            status=ReentryStatus.FAILED if continued_result.status == ExecutorStatus.FAILED else ReentryStatus.RESUMED,
            decision=decision,
            execution_result=merged_result,
            resume_notes=tuple(dict.fromkeys(decision.resume_notes + merged_result.summary_notes)),
        )

    def _build_resumed_handoff(self, *, handoff: ConstraintRouterHandoff, decision: ResumeDecision) -> ConstraintRouterHandoff:
        next_index = self._index_for_step(handoff=handoff, step_id=decision.next_resumable_step_id)
        remaining_steps = list(handoff.task_chain.steps[next_index:])
        cleared_dependency_ids = set()
        for step in handoff.task_chain.steps[:next_index]:
            cleared_dependency_ids.add(step.step_id)
        if decision.blocked_step_id and decision.reason in {
            ResumeReason.REVIEW_CLEARED,
            ResumeReason.PLAYTEST_CLEARED,
        }:
            cleared_dependency_ids.add(decision.blocked_step_id)

        normalized_steps: list[TaskStep] = []
        for step in remaining_steps:
            normalized_steps.append(
                replace(
                    step,
                    depends_on=tuple(dependency for dependency in step.depends_on if dependency not in cleared_dependency_ids),
                )
            )
        remaining_steps = normalized_steps

        if not self._replay_completed_steps and remaining_steps:
            first_step = remaining_steps[0]
            if decision.reason == ResumeReason.CONFIRMATION_CLEARED:
                remaining_steps[0] = replace(first_step, requires_confirmation=False)
            elif decision.reason == ResumeReason.REVIEW_CLEARED:
                remaining_steps[0] = replace(first_step, requires_human_review=False)
            elif decision.reason == ResumeReason.PLAYTEST_CLEARED:
                remaining_steps[0] = replace(first_step, requires_playtest=False)

        resumed_task_chain = replace(handoff.task_chain, steps=tuple(remaining_steps))
        return replace(handoff, task_chain=resumed_task_chain)

    @staticmethod
    def _merge_results(
        *,
        prior_result: TaskExecutionResult,
        continued_result: TaskExecutionResult,
        decision: ResumeDecision,
    ) -> TaskExecutionResult:
        completed_step_ids = tuple(dict.fromkeys(prior_result.completed_step_ids + continued_result.completed_step_ids))
        blocked_step_ids = tuple(dict.fromkeys(prior_result.blocked_step_ids + continued_result.blocked_step_ids))
        deferred_step_ids = tuple(dict.fromkeys(prior_result.deferred_step_ids + continued_result.deferred_step_ids))
        step_runs = prior_result.step_runs + continued_result.step_runs
        summary_notes = tuple(
            dict.fromkeys(prior_result.summary_notes + decision.resume_notes + continued_result.summary_notes)
        )
        return TaskExecutionResult(
            status=continued_result.status,
            completed_step_ids=completed_step_ids,
            blocked_step_ids=blocked_step_ids,
            deferred_step_ids=deferred_step_ids,
            step_runs=step_runs,
            next_human_action=continued_result.next_human_action,
            stop_reason=continued_result.stop_reason,
            blocked_step_id=continued_result.blocked_step_id,
            summary_notes=summary_notes,
        )

    @staticmethod
    def _remaining_step_ids(
        *,
        handoff: ConstraintRouterHandoff,
        completed_step_ids: tuple[str, ...],
    ) -> tuple[str, ...]:
        completed = set(completed_step_ids)
        return tuple(step.step_id for step in handoff.task_chain.steps if step.step_id not in completed)

    @staticmethod
    def _next_step_after(
        *,
        handoff: ConstraintRouterHandoff,
        step_id: str | None,
        completed_step_ids: tuple[str, ...],
    ) -> str | None:
        if step_id is None:
            return None
        seen_step = False
        completed = set(completed_step_ids)
        for step in handoff.task_chain.steps:
            if not seen_step:
                seen_step = step.step_id == step_id
                continue
            if step.step_id not in completed:
                return step.step_id
        return None

    @staticmethod
    def _index_for_step(*, handoff: ConstraintRouterHandoff, step_id: str) -> int:
        for index, step in enumerate(handoff.task_chain.steps):
            if step.step_id == step_id:
                return index
        raise ValueError(f"Unknown step id for resume: {step_id}")

    @staticmethod
    def _not_resumable(
        *,
        prior_result: TaskExecutionResult,
        request: ResumeRequest,
        reason: ResumeReason,
        notes: tuple[str, ...],
    ) -> ResumeDecision:
        return ResumeDecision(
            eligibility=ResumeEligibility.NOT_RESUMABLE,
            reason=reason,
            prior_executor_status=prior_result.status,
            stop_reason=prior_result.stop_reason,
            blocked_step_id=prior_result.blocked_step_id,
            next_resumable_step_id=None,
            human_action_cleared=request.human_action_cleared,
            confirmation_cleared=request.confirmation_cleared,
            review_cleared=request.review_cleared,
            playtest_cleared=request.playtest_cleared,
            resume_allowed=False,
            resume_notes=notes,
        )