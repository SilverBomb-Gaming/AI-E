from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .models import (
    ConstraintRouterHandoff,
    ExecutorStatus,
    StopReason,
    TaskExecutionResult,
    TaskStep,
    TaskStepExecutionStatus,
    TaskStepRun,
)


def _load_policy_file(file_name: str) -> dict:
    policy_path = Path(__file__).resolve().parents[1] / "policies" / file_name
    return json.loads(policy_path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class _StepEligibility:
    can_run: bool
    step_status: TaskStepExecutionStatus
    stop_reason: StopReason | None = None
    notes: tuple[str, ...] = ()
    human_action_required: str | None = None
    depends_on_satisfied: bool = True


class TaskChainExecutor:
    """Execute a router-produced supervised task chain with deterministic gate handling."""

    def __init__(self) -> None:
        guardrails = _load_policy_file("execution_guardrails.json")
        supported_step_types = guardrails.get(
            "executor_supported_step_types",
            [
                "analyze",
                "scaffold",
                "implement",
                "validate",
                "document",
                "prepare_commit",
                "request_review",
                "request_playtest",
            ],
        )
        self._supported_step_types = tuple(supported_step_types)
        self._handlers = {
            "analyze": self._run_analyze_step,
            "scaffold": self._run_scaffold_step,
            "implement": self._run_implement_step,
            "validate": self._run_validate_step,
            "document": self._run_document_step,
            "prepare_commit": self._run_prepare_commit_step,
            "request_review": self._handle_request_review_step,
            "request_playtest": self._handle_request_playtest_step,
        }

    def execute(self, handoff: ConstraintRouterHandoff) -> TaskExecutionResult:
        completed_step_ids: list[str] = []
        blocked_step_ids: list[str] = []
        deferred_step_ids: list[str] = []
        step_runs: list[TaskStepRun] = []
        summary_notes: list[str] = []

        steps = handoff.task_chain.steps
        for index, step in enumerate(steps):
            eligibility = self._evaluate_step_eligibility(
                handoff=handoff,
                step=step,
                completed_step_ids=tuple(completed_step_ids),
            )
            if not eligibility.can_run:
                stop_run = TaskStepRun(
                    step_id=step.step_id,
                    step_type=step.step_type,
                    status=eligibility.step_status,
                    stop_reason=eligibility.stop_reason,
                    notes=eligibility.notes,
                    human_action_required=eligibility.human_action_required,
                    depends_on_satisfied=eligibility.depends_on_satisfied,
                )
                step_runs.append(stop_run)
                blocked_step_ids.append(step.step_id)
                step_runs.extend(
                    self._build_deferred_runs(
                        remaining_steps=steps[index + 1 :],
                        completed_step_ids=tuple(completed_step_ids),
                        stop_reason=eligibility.stop_reason,
                        human_action_required=eligibility.human_action_required,
                        deferred_step_ids=deferred_step_ids,
                    )
                )
                summary_notes.extend(stop_run.notes)
                return TaskExecutionResult(
                    status=self._resolve_executor_status(
                        stop_reason=eligibility.stop_reason,
                        completed_count=len(completed_step_ids),
                    ),
                    completed_step_ids=tuple(completed_step_ids),
                    blocked_step_ids=tuple(blocked_step_ids),
                    deferred_step_ids=tuple(deferred_step_ids),
                    step_runs=tuple(step_runs),
                    next_human_action=eligibility.human_action_required,
                    summary_notes=tuple(dict.fromkeys(summary_notes)),
                )

            handler = self._handlers[step.step_type]
            try:
                step_run = handler(step=step, handoff=handoff)
            except Exception as exc:
                failure_run = TaskStepRun(
                    step_id=step.step_id,
                    step_type=step.step_type,
                    status=TaskStepExecutionStatus.FAILED,
                    stop_reason=StopReason.EXECUTION_ERROR,
                    notes=(f"Execution failed for {step.step_id}: {exc}",),
                    depends_on_satisfied=True,
                )
                step_runs.append(failure_run)
                blocked_step_ids.append(step.step_id)
                step_runs.extend(
                    self._build_deferred_runs(
                        remaining_steps=steps[index + 1 :],
                        completed_step_ids=tuple(completed_step_ids),
                        stop_reason=StopReason.EXECUTION_ERROR,
                        human_action_required=None,
                        deferred_step_ids=deferred_step_ids,
                    )
                )
                summary_notes.extend(failure_run.notes)
                return TaskExecutionResult(
                    status=ExecutorStatus.FAILED,
                    completed_step_ids=tuple(completed_step_ids),
                    blocked_step_ids=tuple(blocked_step_ids),
                    deferred_step_ids=tuple(deferred_step_ids),
                    step_runs=tuple(step_runs),
                    next_human_action=None,
                    summary_notes=tuple(dict.fromkeys(summary_notes)),
                )

            step_runs.append(step_run)
            summary_notes.extend(step_run.notes)
            if step_run.status == TaskStepExecutionStatus.COMPLETED:
                completed_step_ids.append(step.step_id)
                continue

            blocked_step_ids.append(step.step_id)
            step_runs.extend(
                self._build_deferred_runs(
                    remaining_steps=steps[index + 1 :],
                    completed_step_ids=tuple(completed_step_ids),
                    stop_reason=step_run.stop_reason,
                    human_action_required=step_run.human_action_required,
                    deferred_step_ids=deferred_step_ids,
                )
            )
            return TaskExecutionResult(
                status=self._resolve_executor_status(
                    stop_reason=step_run.stop_reason,
                    completed_count=len(completed_step_ids),
                ),
                completed_step_ids=tuple(completed_step_ids),
                blocked_step_ids=tuple(blocked_step_ids),
                deferred_step_ids=tuple(deferred_step_ids),
                step_runs=tuple(step_runs),
                next_human_action=step_run.human_action_required,
                summary_notes=tuple(dict.fromkeys(summary_notes)),
            )

        summary_notes.append("All executable task steps completed in dependency-safe order.")
        return TaskExecutionResult(
            status=ExecutorStatus.COMPLETED,
            completed_step_ids=tuple(completed_step_ids),
            blocked_step_ids=(),
            deferred_step_ids=(),
            step_runs=tuple(step_runs),
            next_human_action=None,
            summary_notes=tuple(dict.fromkeys(summary_notes)),
        )

    def _evaluate_step_eligibility(
        self,
        *,
        handoff: ConstraintRouterHandoff,
        step: TaskStep,
        completed_step_ids: tuple[str, ...],
    ) -> _StepEligibility:
        depends_on_satisfied = all(dependency in completed_step_ids for dependency in step.depends_on)
        if not depends_on_satisfied:
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.BLOCKED,
                stop_reason=StopReason.DEPENDENCY_INCOMPLETE,
                notes=(
                    f"Step {step.step_id} is waiting on incomplete dependencies: {', '.join(step.depends_on)}.",
                ),
                depends_on_satisfied=False,
            )

        if step.step_type not in self._supported_step_types:
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.UNSUPPORTED,
                stop_reason=StopReason.UNSUPPORTED_STEP_TYPE,
                notes=(f"Unsupported step type for executor v1: {step.step_type}.",),
                depends_on_satisfied=True,
            )

        if handoff.blocked_items or handoff.task_chain.status == "blocked":
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.BLOCKED,
                stop_reason=StopReason.BLOCKED_BY_POLICY,
                notes=tuple(handoff.blocked_items) or ("Execution is blocked by router policy state.",),
                depends_on_satisfied=True,
            )

        if step.step_type == "implement":
            if handoff.plan.scaffold_only or not handoff.plan.implementation_allowed:
                return _StepEligibility(
                    can_run=False,
                    step_status=TaskStepExecutionStatus.BLOCKED,
                    stop_reason=StopReason.BLOCKED_BY_POLICY,
                    notes=("Implementation is disabled because the current handoff is scaffold-only.",),
                    depends_on_satisfied=True,
                )
            if handoff.plan.status == "bounded_draft_only" and handoff.open_assumptions:
                return _StepEligibility(
                    can_run=False,
                    step_status=TaskStepExecutionStatus.BLOCKED,
                    stop_reason=StopReason.BLOCKED_BY_ASSUMPTION,
                    notes=tuple(handoff.open_assumptions),
                    depends_on_satisfied=True,
                )

        if step.step_type == "prepare_commit" and not handoff.plan.commit_preparation_allowed:
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.BLOCKED,
                stop_reason=StopReason.BLOCKED_BY_POLICY,
                notes=("Commit preparation is disabled for the current handoff.",),
                depends_on_satisfied=True,
            )

        if step.requires_confirmation:
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.AWAITING_HUMAN,
                stop_reason=StopReason.CONFIRMATION_REQUIRED,
                notes=(f"Operator confirmation is required before {step.step_id} can run.",),
                human_action_required=f"Confirm execution of step {step.step_id}.",
                depends_on_satisfied=True,
            )

        if step.requires_human_review and step.step_type != "request_review":
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.AWAITING_HUMAN,
                stop_reason=StopReason.REVIEW_REQUIRED,
                notes=(f"Human review is required before {step.step_id} can run.",),
                human_action_required=f"Review and approve step {step.step_id}.",
                depends_on_satisfied=True,
            )

        if step.requires_playtest and step.step_type != "request_playtest":
            return _StepEligibility(
                can_run=False,
                step_status=TaskStepExecutionStatus.AWAITING_HUMAN,
                stop_reason=StopReason.PLAYTEST_REQUIRED,
                notes=(f"A supervised playtest is required before {step.step_id} can run.",),
                human_action_required=f"Complete a supervised playtest for {step.step_id}.",
                depends_on_satisfied=True,
            )

        return _StepEligibility(
            can_run=True,
            step_status=TaskStepExecutionStatus.COMPLETED,
            depends_on_satisfied=True,
        )

    def _build_deferred_runs(
        self,
        *,
        remaining_steps: tuple[TaskStep, ...],
        completed_step_ids: tuple[str, ...],
        stop_reason: StopReason | None,
        human_action_required: str | None,
        deferred_step_ids: list[str],
    ) -> list[TaskStepRun]:
        deferred_runs: list[TaskStepRun] = []
        for step in remaining_steps:
            deferred_step_ids.append(step.step_id)
            deferred_runs.append(
                TaskStepRun(
                    step_id=step.step_id,
                    step_type=step.step_type,
                    status=TaskStepExecutionStatus.DEFERRED,
                    stop_reason=stop_reason,
                    notes=(f"Deferred because execution stopped before {step.step_id}.",),
                    human_action_required=human_action_required,
                    depends_on_satisfied=all(dependency in completed_step_ids for dependency in step.depends_on),
                )
            )
        return deferred_runs

    @staticmethod
    def _resolve_executor_status(*, stop_reason: StopReason | None, completed_count: int) -> ExecutorStatus:
        if stop_reason == StopReason.CONFIRMATION_REQUIRED:
            return ExecutorStatus.AWAITING_CONFIRMATION
        if stop_reason == StopReason.REVIEW_REQUIRED:
            return ExecutorStatus.AWAITING_REVIEW
        if stop_reason == StopReason.PLAYTEST_REQUIRED:
            return ExecutorStatus.AWAITING_PLAYTEST
        if stop_reason == StopReason.UNSUPPORTED_STEP_TYPE:
            return ExecutorStatus.UNSUPPORTED
        if stop_reason == StopReason.EXECUTION_ERROR:
            return ExecutorStatus.FAILED
        if stop_reason in {
            StopReason.BLOCKED_BY_POLICY,
            StopReason.BLOCKED_BY_ASSUMPTION,
            StopReason.DEPENDENCY_INCOMPLETE,
        }:
            return ExecutorStatus.PARTIALLY_COMPLETED if completed_count else ExecutorStatus.BLOCKED
        return ExecutorStatus.PARTIALLY_COMPLETED if completed_count else ExecutorStatus.BLOCKED

    @staticmethod
    def _run_analyze_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.COMPLETED,
            notes=(
                f"Analyzed handoff {handoff.task_chain.chain_id} for {handoff.intent.goal or handoff.intent.raw_request}.",
            ),
            depends_on_satisfied=True,
        )

    @staticmethod
    def _run_scaffold_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.COMPLETED,
            notes=(f"Scaffolded the bounded slice for {handoff.task_chain.chain_id} without widening scope.",),
            depends_on_satisfied=True,
        )

    @staticmethod
    def _run_implement_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.COMPLETED,
            notes=(f"Implemented the bounded step {step.step_id} with deterministic v1 execution semantics.",),
            depends_on_satisfied=True,
        )

    @staticmethod
    def _run_validate_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.COMPLETED,
            notes=(f"Validated the bounded output for {handoff.task_chain.chain_id}.",),
            depends_on_satisfied=True,
        )

    @staticmethod
    def _run_document_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.COMPLETED,
            notes=("Documented the remaining manual hooks for the bounded slice.",),
            depends_on_satisfied=True,
        )

    @staticmethod
    def _run_prepare_commit_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.COMPLETED,
            notes=("Prepared a supervised commit summary without performing git mutation.",),
            depends_on_satisfied=True,
        )

    @staticmethod
    def _handle_request_review_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.AWAITING_HUMAN,
            stop_reason=StopReason.REVIEW_REQUIRED,
            notes=("Execution paused for a required human review gate.",),
            human_action_required="Review the scaffolded slice and approve the next supervised step.",
            depends_on_satisfied=True,
        )

    @staticmethod
    def _handle_request_playtest_step(*, step: TaskStep, handoff: ConstraintRouterHandoff) -> TaskStepRun:
        return TaskStepRun(
            step_id=step.step_id,
            step_type=step.step_type,
            status=TaskStepExecutionStatus.AWAITING_HUMAN,
            stop_reason=StopReason.PLAYTEST_REQUIRED,
            notes=("Execution paused for a required supervised playtest gate.",),
            human_action_required="Run a supervised playtest and record the outcome before continuing.",
            depends_on_satisfied=True,
        )