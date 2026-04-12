from __future__ import annotations

from aie.core.execution_orchestrator import ExecutionOrchestrator
from aie.core.models import (
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    LifecycleState,
    OrchestrationAction,
    OrchestrationRequest,
    OrchestrationStatus,
    ResumeRequest,
    StopReason,
    TaskChain,
    TaskStep,
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
        summary="Bounded execution plan for orchestration tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep the orchestrator deterministic.",),
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
        chain_id="tc-orchestrator-test",
        status=chain_status,
        summary="Orchestrator test chain.",
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


def test_execution_orchestrator_executes_fresh_handoff() -> None:
    orchestrator = ExecutionOrchestrator()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("validate-slice", "validate", depends_on=("implement-slice",)),
        )
    )

    result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff))

    assert result.decision.lifecycle_state == LifecycleState.READY_TO_EXECUTE
    assert result.decision.chosen_action == OrchestrationAction.EXECUTE
    assert result.status == OrchestrationStatus.COMPLETED
    assert result.execution_result is not None
    assert result.execution_result.status == ExecutorStatus.COMPLETED
    assert result.final_executor_status == ExecutorStatus.COMPLETED


def test_execution_orchestrator_waits_for_review_without_clearance() -> None:
    executor = TaskChainExecutor()
    orchestrator = ExecutionOrchestrator(executor=executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("request-review", "request_review", depends_on=("analyze-request",)),
            _step("implement-reviewed-slice", "implement", depends_on=("request-review",)),
        ),
        human_review_required=True,
    )
    prior = executor.execute(handoff)

    result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff, prior_execution_result=prior))

    assert result.decision.lifecycle_state == LifecycleState.AWAITING_REVIEW
    assert result.decision.chosen_action == OrchestrationAction.WAIT
    assert result.status == OrchestrationStatus.AWAITING_REVIEW
    assert result.decision.required_human_action == prior.next_human_action


def test_execution_orchestrator_resumes_review_with_clearance() -> None:
    executor = TaskChainExecutor()
    orchestrator = ExecutionOrchestrator(executor=executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("request-review", "request_review", depends_on=("analyze-request",)),
            _step("implement-reviewed-slice", "implement", depends_on=("request-review",), requires_human_review=True),
            _step("validate-reviewed-slice", "validate", depends_on=("implement-reviewed-slice",)),
        ),
        human_review_required=True,
    )
    prior = executor.execute(handoff)

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            handoff=handoff,
            prior_execution_result=prior,
            resume_request=ResumeRequest.from_execution_result(prior, review_cleared=True),
        )
    )

    assert result.decision.lifecycle_state == LifecycleState.RESUMABLE
    assert result.decision.chosen_action == OrchestrationAction.RESUME
    assert result.status == OrchestrationStatus.COMPLETED
    assert result.resume_result is not None
    assert result.final_executor_status == ExecutorStatus.COMPLETED


def test_execution_orchestrator_waits_for_playtest_without_clearance() -> None:
    executor = TaskChainExecutor()
    orchestrator = ExecutionOrchestrator(executor=executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("request-playtest", "request_playtest", depends_on=("implement-slice",)),
            _step("prepare-commit", "prepare_commit", depends_on=("request-playtest",)),
        ),
        playtest_required=True,
    )
    prior = executor.execute(handoff)

    result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff, prior_execution_result=prior))

    assert result.decision.lifecycle_state == LifecycleState.AWAITING_PLAYTEST
    assert result.decision.chosen_action == OrchestrationAction.WAIT
    assert result.status == OrchestrationStatus.AWAITING_PLAYTEST


def test_execution_orchestrator_resumes_playtest_with_clearance() -> None:
    executor = TaskChainExecutor()
    orchestrator = ExecutionOrchestrator(executor=executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",)),
            _step("request-playtest", "request_playtest", depends_on=("implement-slice",)),
            _step("prepare-commit", "prepare_commit", depends_on=("request-playtest",)),
        ),
        playtest_required=True,
    )
    prior = executor.execute(handoff)

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            handoff=handoff,
            prior_execution_result=prior,
            resume_request=ResumeRequest.from_execution_result(prior, playtest_cleared=True),
        )
    )

    assert result.decision.lifecycle_state == LifecycleState.RESUMABLE
    assert result.decision.chosen_action == OrchestrationAction.RESUME
    assert result.status == OrchestrationStatus.COMPLETED
    assert result.final_executor_status == ExecutorStatus.COMPLETED


def test_execution_orchestrator_waits_for_confirmation_without_clearance() -> None:
    executor = TaskChainExecutor()
    orchestrator = ExecutionOrchestrator(executor=executor)
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("implement-slice", "implement", depends_on=("analyze-request",), requires_confirmation=True),
            _step("validate-slice", "validate", depends_on=("implement-slice",)),
        ),
        confirmation_required=True,
    )
    prior = executor.execute(handoff)

    result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff, prior_execution_result=prior))

    assert result.decision.lifecycle_state == LifecycleState.AWAITING_CONFIRMATION
    assert result.decision.chosen_action == OrchestrationAction.WAIT
    assert result.status == OrchestrationStatus.AWAITING_CONFIRMATION


def test_execution_orchestrator_stops_on_blocked_state() -> None:
    executor = TaskChainExecutor()
    orchestrator = ExecutionOrchestrator(executor=executor)
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
    prior = executor.execute(handoff)

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            handoff=handoff,
            prior_execution_result=prior,
            resume_request=ResumeRequest.from_execution_result(prior, review_cleared=True),
        )
    )

    assert result.decision.lifecycle_state == LifecycleState.BLOCKED
    assert result.decision.chosen_action == OrchestrationAction.STOP
    assert result.status == OrchestrationStatus.BLOCKED
    assert result.decision.required_human_action is not None


def test_execution_orchestrator_stops_on_completed_state() -> None:
    orchestrator = ExecutionOrchestrator()
    handoff = _handoff((_step("analyze-request", "analyze"),))
    prior = TaskChainExecutor().execute(handoff)

    result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff, prior_execution_result=prior))

    assert result.decision.lifecycle_state == LifecycleState.COMPLETED
    assert result.decision.chosen_action == OrchestrationAction.STOP
    assert result.status == OrchestrationStatus.COMPLETED


def test_execution_orchestrator_rejects_invalid_mixed_input() -> None:
    orchestrator = ExecutionOrchestrator()
    handoff = _handoff((_step("analyze-request", "analyze"),))

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            handoff=handoff,
            resume_request=ResumeRequest(prior_executor_status=ExecutorStatus.AWAITING_REVIEW, review_cleared=True),
        )
    )

    assert result.decision.lifecycle_state == LifecycleState.INVALID_REQUEST
    assert result.decision.chosen_action == OrchestrationAction.REJECT
    assert result.status == OrchestrationStatus.INVALID_REQUEST


def test_execution_orchestrator_returns_structured_result() -> None:
    orchestrator = ExecutionOrchestrator()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("request-review", "request_review", depends_on=("analyze-request",)),
        ),
        human_review_required=True,
    )

    result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff))
    payload = result.to_dict()

    assert payload["status"] == "awaiting_review"
    assert payload["decision"]["chosen_action"] == "execute"
    assert payload["final_executor_status"] == "awaiting_review"
    assert payload["execution_result"]["stop_reason"] == StopReason.REVIEW_REQUIRED.value