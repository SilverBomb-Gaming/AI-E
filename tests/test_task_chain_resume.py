from __future__ import annotations

from aie.core.models import (
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    ReentryStatus,
    ResumeReason,
    ResumeRequest,
    StopReason,
    TaskChain,
    TaskStep,
)
from aie.core.task_chain_executor import TaskChainExecutor
from aie.core.task_chain_resume import TaskChainResumeCoordinator


def _step(
    step_id: str,
    step_type: str,
    *,
    depends_on: tuple[str, ...] = (),
    requires_confirmation: bool = False,
    requires_human_review: bool = False,
    requires_playtest: bool = False,
) -> TaskStep:
    return TaskStep(
        step_id=step_id,
        step_type=step_type,
        title=step_id.replace("-", " ").title(),
        purpose=f"Execute {step_id}.",
        target_area="bounded_slice",
        engine_context="unity",
        requires_confirmation=requires_confirmation,
        requires_human_review=requires_human_review,
        requires_playtest=requires_playtest,
        depends_on=depends_on,
    )


def _handoff(
    steps: tuple[TaskStep, ...],
    *,
    plan_status: str = "supported_ready",
    chain_status: str = "execution_ready",
    scaffold_only: bool = False,
    implementation_allowed: bool = True,
    confirmation_required: bool = False,
    playtest_required: bool = False,
    human_review_required: bool = False,
    commit_preparation_allowed: bool = True,
    open_assumptions: tuple[str, ...] = (),
    blocked_items: tuple[str, ...] = (),
) -> ConstraintRouterHandoff:
    intent = IntentSpec(
        raw_request="Create a bounded Unity gameplay slice",
        goal="Create a bounded Unity gameplay slice",
        engine_target="unity",
        scope="gameplay_scaffold",
        features=("controller",),
    )
    report = ConstraintReport(
        supported=True,
        engine_target="unity",
        status=plan_status,
        implementation_allowed=implementation_allowed,
        scaffold_only=scaffold_only,
        confirmation_required=confirmation_required,
        playtest_required=playtest_required,
        human_review_required=human_review_required,
        commit_preparation_allowed=commit_preparation_allowed,
    )
    plan = ExecutionPlan(
        status=plan_status,
        summary="Bounded execution plan for resume tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep the executor deterministic.",),
        open_assumptions=open_assumptions,
        blocked_items=blocked_items,
        implementation_allowed=implementation_allowed,
        scaffold_only=scaffold_only,
        confirmation_required=confirmation_required,
        playtest_required=playtest_required,
        human_review_required=human_review_required,
        commit_preparation_allowed=commit_preparation_allowed,
        task_chain_ready=True,
    )
    task_chain = TaskChain(
        chain_id="tc-resume-test",
        status=chain_status,
        summary="Resume test chain.",
        bounded=True,
        engine_target="unity",
        steps=steps,
        open_assumptions=open_assumptions,
        blocked_items=blocked_items,
        confirmation_requirements=("Operator confirmation is required.",) if confirmation_required else (),
        playtest_required=playtest_required,
        human_review_required=human_review_required,
        codex_handoff_ready=True,
    )
    return ConstraintRouterHandoff(
        intent=intent,
        constraints=report,
        plan=plan,
        task_chain=task_chain,
        open_assumptions=open_assumptions,
        blocked_items=blocked_items,
        confirmation_requirements=task_chain.confirmation_requirements,
        requires_playtest=playtest_required,
        requires_human_review=human_review_required,
    )


def _run_ids(result, step_id: str) -> tuple[str, ...]:
    return tuple(run.status.value for run in result.step_runs if run.step_id == step_id)


def test_task_chain_resume_allows_review_gate_reentry() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("scaffold-first-slice", "scaffold", depends_on=("analyze-request",)),
            _step("request-review", "request_review", depends_on=("scaffold-first-slice",)),
            _step(
                "implement-reviewed-slice",
                "implement",
                depends_on=("request-review",),
                requires_human_review=True,
            ),
            _step("validate-reviewed-slice", "validate", depends_on=("implement-reviewed-slice",)),
        ),
        human_review_required=True,
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result, review_cleared=True),
    )

    assert resume_result.status == ReentryStatus.RESUMED
    assert resume_result.decision.reason == ResumeReason.REVIEW_CLEARED
    assert resume_result.execution_result is not None
    assert resume_result.execution_result.status == ExecutorStatus.COMPLETED
    assert resume_result.execution_result.completed_step_ids == (
        "analyze-request",
        "scaffold-first-slice",
        "implement-reviewed-slice",
        "validate-reviewed-slice",
    )
    assert resume_result.execution_result.blocked_step_ids == ("request-review",)
    assert _run_ids(resume_result.execution_result, "analyze-request") == ("completed",)
    assert _run_ids(resume_result.execution_result, "scaffold-first-slice") == ("completed",)


def test_task_chain_resume_allows_playtest_gate_reentry() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("validate-slice", "validate", depends_on=("implement-slice",)),
            _step("request-playtest", "request_playtest", depends_on=("validate-slice",)),
            _step("prepare-commit", "prepare_commit", depends_on=("request-playtest",)),
        ),
        playtest_required=True,
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result, playtest_cleared=True),
    )

    assert resume_result.status == ReentryStatus.RESUMED
    assert resume_result.execution_result is not None
    assert resume_result.execution_result.status == ExecutorStatus.COMPLETED
    assert resume_result.execution_result.completed_step_ids == (
        "analyze-request",
        "implement-slice",
        "validate-slice",
        "prepare-commit",
    )
    assert resume_result.execution_result.blocked_step_ids == ("request-playtest",)
    assert _run_ids(resume_result.execution_result, "request-playtest") == ("awaiting_human",)


def test_task_chain_resume_allows_confirmation_gate_reentry() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step(
                "implement-slice",
                "implement",
                depends_on=("analyze-request",),
                requires_confirmation=True,
            ),
            _step("validate-slice", "validate", depends_on=("implement-slice",)),
        ),
        confirmation_required=True,
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result, confirmation_cleared=True),
    )

    assert resume_result.status == ReentryStatus.RESUMED
    assert resume_result.execution_result is not None
    assert resume_result.execution_result.status == ExecutorStatus.COMPLETED
    assert resume_result.execution_result.completed_step_ids == (
        "analyze-request",
        "implement-slice",
        "validate-slice",
    )
    assert resume_result.execution_result.blocked_step_ids == ("implement-slice",)
    assert _run_ids(resume_result.execution_result, "implement-slice") == ("awaiting_human", "completed")


def test_task_chain_resume_rejects_missing_gate_clearance() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step(
                "implement-slice",
                "implement",
                depends_on=("analyze-request",),
                requires_confirmation=True,
            ),
            _step("validate-slice", "validate", depends_on=("implement-slice",)),
        ),
        confirmation_required=True,
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result),
    )

    assert resume_result.status == ReentryStatus.NOT_RESUMABLE
    assert resume_result.decision.resume_allowed is False
    assert resume_result.execution_result == prior_result
    assert resume_result.decision.reason == ResumeReason.INVALID_RESUME_REQUEST


def test_task_chain_resume_rejects_unresolved_assumption_blocker() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
        ),
        plan_status="bounded_draft_only",
        chain_status="draft_supervised",
        scaffold_only=False,
        implementation_allowed=True,
        open_assumptions=("Engine target still needs confirmation.",),
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result, review_cleared=True),
    )

    assert prior_result.stop_reason == StopReason.BLOCKED_BY_ASSUMPTION
    assert resume_result.status == ReentryStatus.NOT_RESUMABLE
    assert resume_result.decision.reason == ResumeReason.BLOCKER_UNRESOLVED


def test_task_chain_resume_does_not_rerun_completed_steps() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("scaffold-first-slice", "scaffold", depends_on=("analyze-request",)),
            _step("request-review", "request_review", depends_on=("scaffold-first-slice",)),
            _step(
                "implement-reviewed-slice",
                "implement",
                depends_on=("request-review",),
                requires_human_review=True,
            ),
        ),
        human_review_required=True,
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result, review_cleared=True),
    )

    assert resume_result.execution_result is not None
    assert _run_ids(resume_result.execution_result, "analyze-request") == ("completed",)
    assert _run_ids(resume_result.execution_result, "scaffold-first-slice") == ("completed",)
    assert _run_ids(resume_result.execution_result, "implement-reviewed-slice") == ("deferred", "completed")


def test_task_chain_resume_preserves_prior_history_when_stopping_again() -> None:
    executor = TaskChainExecutor()
    resume = TaskChainResumeCoordinator(executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("request-review", "request_review", depends_on=("analyze-request",)),
            _step(
                "implement-reviewed-slice",
                "implement",
                depends_on=("request-review",),
                requires_human_review=True,
            ),
            _step(
                "prepare-commit",
                "prepare_commit",
                depends_on=("implement-reviewed-slice",),
                requires_confirmation=True,
            ),
        ),
        human_review_required=True,
        confirmation_required=True,
    )
    prior_result = executor.execute(handoff)

    resume_result = resume.resume(
        handoff=handoff,
        prior_result=prior_result,
        request=ResumeRequest.from_execution_result(prior_result, review_cleared=True),
    )

    assert resume_result.execution_result is not None
    assert resume_result.execution_result.status == ExecutorStatus.AWAITING_CONFIRMATION
    assert resume_result.execution_result.blocked_step_ids == ("request-review", "prepare-commit")
    assert resume_result.execution_result.stop_reason == StopReason.CONFIRMATION_REQUIRED
    assert resume_result.execution_result.blocked_step_id == "prepare-commit"