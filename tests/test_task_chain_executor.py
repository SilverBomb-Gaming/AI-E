from __future__ import annotations

from aie.core.models import (
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    StopReason,
    TaskChain,
    TaskExecutionResult,
    TaskStep,
    TaskStepExecutionStatus,
)
from aie.core.task_chain_executor import TaskChainExecutor


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
        summary="Bounded execution plan for executor tests.",
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
        chain_id="tc-executor-test",
        status=chain_status,
        summary="Executor test chain.",
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


def _step_run_by_id(result: TaskExecutionResult, step_id: str):
    return next(run for run in result.step_runs if run.step_id == step_id)


def test_task_chain_executor_runs_simple_chain_in_order() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("validate-slice", "validate", depends_on=("implement-slice",)),
        )
    )

    result = executor.execute(handoff)

    assert result.status == ExecutorStatus.COMPLETED
    assert result.completed_step_ids == ("analyze-request", "implement-slice", "validate-slice")
    assert result.blocked_step_ids == ()
    assert result.deferred_step_ids == ()
    assert tuple(run.step_id for run in result.step_runs) == result.completed_step_ids
    assert all(run.status == TaskStepExecutionStatus.COMPLETED for run in result.step_runs)


def test_task_chain_executor_blocks_when_dependency_is_incomplete() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("validate-slice", "validate", depends_on=("missing-step",)),
        )
    )

    result = executor.execute(handoff)
    validate_run = _step_run_by_id(result, "validate-slice")

    assert result.status == ExecutorStatus.PARTIALLY_COMPLETED
    assert result.completed_step_ids == ("analyze-request",)
    assert result.blocked_step_ids == ("validate-slice",)
    assert validate_run.status == TaskStepExecutionStatus.BLOCKED
    assert validate_run.stop_reason == StopReason.DEPENDENCY_INCOMPLETE
    assert validate_run.depends_on_satisfied is False


def test_task_chain_executor_stops_for_confirmation_gate() -> None:
    executor = TaskChainExecutor()
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

    result = executor.execute(handoff)
    implement_run = _step_run_by_id(result, "implement-slice")

    assert result.status == ExecutorStatus.AWAITING_CONFIRMATION
    assert result.completed_step_ids == ("analyze-request",)
    assert result.blocked_step_ids == ("implement-slice",)
    assert result.deferred_step_ids == ("validate-slice",)
    assert implement_run.status == TaskStepExecutionStatus.AWAITING_HUMAN
    assert implement_run.stop_reason == StopReason.CONFIRMATION_REQUIRED
    assert result.next_human_action == "Confirm execution of step implement-slice."


def test_task_chain_executor_stops_at_review_gate() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("scaffold-first-slice", "scaffold", depends_on=("analyze-request",)),
            _step("request-review", "request_review", depends_on=("scaffold-first-slice",)),
            _step("implement-reviewed-slice", "implement", depends_on=("request-review",)),
        ),
        human_review_required=True,
    )

    result = executor.execute(handoff)
    review_run = _step_run_by_id(result, "request-review")
    implement_run = _step_run_by_id(result, "implement-reviewed-slice")

    assert result.status == ExecutorStatus.AWAITING_REVIEW
    assert result.completed_step_ids == ("analyze-request", "scaffold-first-slice")
    assert result.blocked_step_ids == ("request-review",)
    assert result.deferred_step_ids == ("implement-reviewed-slice",)
    assert review_run.status == TaskStepExecutionStatus.AWAITING_HUMAN
    assert review_run.stop_reason == StopReason.REVIEW_REQUIRED
    assert implement_run.status == TaskStepExecutionStatus.DEFERRED


def test_task_chain_executor_stops_at_playtest_gate() -> None:
    executor = TaskChainExecutor()
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

    result = executor.execute(handoff)
    playtest_run = _step_run_by_id(result, "request-playtest")

    assert result.status == ExecutorStatus.AWAITING_PLAYTEST
    assert result.completed_step_ids == ("analyze-request", "implement-slice", "validate-slice")
    assert result.blocked_step_ids == ("request-playtest",)
    assert result.deferred_step_ids == ("prepare-commit",)
    assert playtest_run.status == TaskStepExecutionStatus.AWAITING_HUMAN
    assert playtest_run.stop_reason == StopReason.PLAYTEST_REQUIRED


def test_task_chain_executor_blocks_implement_when_handoff_is_scaffold_only() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("scaffold-first-slice", "scaffold", depends_on=("analyze-request",)),
            _step("implement-slice", "implement", depends_on=("scaffold-first-slice",)),
        ),
        plan_status="supported_with_warnings",
        chain_status="draft_supervised",
        scaffold_only=True,
        implementation_allowed=False,
        human_review_required=True,
        commit_preparation_allowed=False,
    )

    result = executor.execute(handoff)
    implement_run = _step_run_by_id(result, "implement-slice")

    assert result.status == ExecutorStatus.PARTIALLY_COMPLETED
    assert result.completed_step_ids == ("analyze-request", "scaffold-first-slice")
    assert result.blocked_step_ids == ("implement-slice",)
    assert implement_run.status == TaskStepExecutionStatus.BLOCKED
    assert implement_run.stop_reason == StopReason.BLOCKED_BY_POLICY


def test_task_chain_executor_blocks_commit_preparation_when_disallowed() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("prepare-commit", "prepare_commit", depends_on=("implement-slice",)),
        ),
        commit_preparation_allowed=False,
    )

    result = executor.execute(handoff)
    prepare_run = _step_run_by_id(result, "prepare-commit")

    assert result.status == ExecutorStatus.PARTIALLY_COMPLETED
    assert result.completed_step_ids == ("analyze-request", "implement-slice")
    assert result.blocked_step_ids == ("prepare-commit",)
    assert prepare_run.stop_reason == StopReason.BLOCKED_BY_POLICY


def test_task_chain_executor_reports_unsupported_step_types() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("ship-build", "ship_build", depends_on=("analyze-request",)),
        )
    )

    result = executor.execute(handoff)
    unsupported_run = _step_run_by_id(result, "ship-build")

    assert result.status == ExecutorStatus.UNSUPPORTED
    assert result.completed_step_ids == ("analyze-request",)
    assert result.blocked_step_ids == ("ship-build",)
    assert unsupported_run.status == TaskStepExecutionStatus.UNSUPPORTED
    assert unsupported_run.stop_reason == StopReason.UNSUPPORTED_STEP_TYPE


def test_task_chain_executor_reports_partial_completion_cleanly() -> None:
    executor = TaskChainExecutor()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("document-hooks", "document", depends_on=("implement-slice",)),
            _step("prepare-commit", "prepare_commit", depends_on=("document-hooks",)),
        ),
        commit_preparation_allowed=False,
    )

    result = executor.execute(handoff)

    assert result.status == ExecutorStatus.PARTIALLY_COMPLETED
    assert result.completed_step_ids == ("analyze-request", "implement-slice", "document-hooks")
    assert result.blocked_step_ids == ("prepare-commit",)
    assert result.deferred_step_ids == ()
    assert any("deterministic" in note.lower() for note in result.summary_notes)