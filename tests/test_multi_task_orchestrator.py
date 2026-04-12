from __future__ import annotations

from pathlib import Path

from aie.core.models import (
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    MultiTaskAction,
    MultiTaskOrchestrationRequest,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    ResumeRequest,
    SessionSelectionReason,
    TaskChain,
    TaskStep,
)
from aie.core.multi_task_orchestrator import MultiTaskOrchestrator
from aie.core.state_persistence import StatePersistence
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
    chain_id: str,
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
        summary="Bounded execution plan for multi-task tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep orchestration deterministic.",),
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
        chain_id=chain_id,
        status=chain_status,
        summary="Multi-task orchestrator test chain.",
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


def _ready_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    priority: MultiTaskPriority,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-implement", "implement", depends_on=(f"{session_id}-analyze",)),
        ),
    )
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=priority,
        router_handoff=handoff,
        last_updated=last_updated,
    )


def _waiting_review_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    priority: MultiTaskPriority,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-request-review", "request_review", depends_on=(f"{session_id}-analyze",)),
            _step(
                f"{session_id}-implement",
                "implement",
                depends_on=(f"{session_id}-request-review",),
                requires_human_review=True,
            ),
        ),
        human_review_required=True,
    )
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=priority,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def _resumable_review_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    priority: MultiTaskPriority,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-request-review", "request_review", depends_on=(f"{session_id}-analyze",)),
            _step(
                f"{session_id}-implement",
                "implement",
                depends_on=(f"{session_id}-request-review",),
                requires_human_review=True,
            ),
            _step(f"{session_id}-validate", "validate", depends_on=(f"{session_id}-implement",)),
        ),
        human_review_required=True,
    )
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=priority,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        resume_request=ResumeRequest.from_execution_result(prior_result, review_cleared=True),
        last_updated=last_updated,
    )


def _blocked_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(
        session_id,
        (
            _step(f"{session_id}-analyze", "analyze"),
            _step(f"{session_id}-implement", "implement", depends_on=(f"{session_id}-analyze",)),
        ),
        plan_status="bounded_draft_only",
        chain_status="draft_supervised",
        scaffold_only=False,
        implementation_allowed=True,
        open_assumptions=("Engine target still needs confirmation.",),
    )
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=MultiTaskPriority.NORMAL,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def _completed_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(session_id, (_step(f"{session_id}-analyze", "analyze"),))
    prior_result = TaskChainExecutor().execute(handoff)
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=MultiTaskPriority.LOW,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def test_multi_task_orchestrator_registers_and_inspects_multiple_sessions() -> None:
    orchestrator = MultiTaskOrchestrator()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T10:05:00+00:00",
    )
    blocked = _blocked_record(orchestrator, "session-blocked", last_updated="2026-04-12T10:10:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(ready, waiting, blocked),
        )
    )

    statuses = {record.session_id: record.session_status for record in result.session_registry}

    assert result.decision.chosen_action == MultiTaskAction.INSPECT_SESSIONS
    assert result.registered_session_ids == ("session-ready", "session-waiting", "session-blocked")
    assert statuses["session-ready"] == MultiTaskSessionStatus.READY
    assert statuses["session-waiting"] == MultiTaskSessionStatus.WAITING
    assert statuses["session-blocked"] == MultiTaskSessionStatus.BLOCKED
    assert result.decision.actionable_session_ids == ("session-ready",)
    assert result.decision.waiting_session_ids == ("session-waiting",)
    assert result.decision.blocked_session_ids == ("session-blocked",)


def test_multi_task_orchestrator_selects_highest_priority_resumable_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    urgent_ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:00:00+00:00")
    high_resumable = _resumable_review_record(
        orchestrator,
        "session-resumable",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T09:55:00+00:00",
    )

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(urgent_ready, high_resumable),
        )
    )

    assert result.decision.selected_session_id == "session-resumable"
    assert result.decision.selection_reason == SessionSelectionReason.HIGHEST_PRIORITY_RESUMABLE


def test_multi_task_orchestrator_selects_highest_priority_ready_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    low_ready = _ready_record(orchestrator, "session-low", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    urgent_ready = _ready_record(orchestrator, "session-urgent", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(low_ready, urgent_ready),
        )
    )

    assert result.decision.selected_session_id == "session-urgent"
    assert result.decision.selection_reason == SessionSelectionReason.HIGHEST_PRIORITY_READY


def test_multi_task_orchestrator_handles_no_actionable_sessions() -> None:
    orchestrator = MultiTaskOrchestrator()
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.NORMAL,
        last_updated="2026-04-12T10:00:00+00:00",
    )
    blocked = _blocked_record(orchestrator, "session-blocked", last_updated="2026-04-12T10:05:00+00:00")
    completed = _completed_record(orchestrator, "session-complete", last_updated="2026-04-12T10:10:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(waiting, blocked, completed),
        )
    )

    assert result.decision.chosen_action == MultiTaskAction.WAIT
    assert result.decision.selected_session_id is None
    assert result.decision.selection_reason == SessionSelectionReason.NO_ACTIONABLE_SESSIONS


def test_multi_task_orchestrator_uses_oldest_last_updated_tiebreaker() -> None:
    orchestrator = MultiTaskOrchestrator()
    older = _ready_record(orchestrator, "session-older", MultiTaskPriority.NORMAL, last_updated="2026-04-12T09:00:00+00:00")
    newer = _ready_record(orchestrator, "session-newer", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(newer, older),
        )
    )

    assert result.decision.selected_session_id == "session-older"
    assert result.decision.selection_reason == SessionSelectionReason.STABLE_TIEBREAKER


def test_multi_task_orchestrator_routes_selected_ready_session_through_execution_orchestrator() -> None:
    orchestrator = MultiTaskOrchestrator()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:00:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.EXECUTE_SELECTED,
            sessions_to_register=(ready,),
            selected_session_id="session-ready",
        )
    )

    updated = {record.session_id: record for record in result.session_registry}["session-ready"]

    assert result.decision.chosen_action == MultiTaskAction.EXECUTE_SELECTED
    assert result.selected_session_result is not None
    assert result.selected_session_result.final_executor_status == ExecutorStatus.COMPLETED
    assert updated.session_status == MultiTaskSessionStatus.COMPLETED
    assert updated.persisted_session is None


def test_multi_task_orchestrator_preserves_session_isolation_when_resuming_selected_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    resumable = _resumable_review_record(
        orchestrator,
        "session-resumable",
        MultiTaskPriority.HIGH,
        last_updated="2026-04-12T10:00:00+00:00",
    )
    waiting = _waiting_review_record(
        orchestrator,
        "session-waiting",
        MultiTaskPriority.URGENT,
        last_updated="2026-04-12T09:00:00+00:00",
    )

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.RESUME_SELECTED,
            sessions_to_register=(resumable, waiting),
            selected_session_id="session-resumable",
        )
    )

    updated = {record.session_id: record for record in result.session_registry}

    assert result.selected_session_result is not None
    assert result.selected_session_result.final_executor_status == ExecutorStatus.COMPLETED
    assert updated["session-resumable"].session_status == MultiTaskSessionStatus.COMPLETED
    assert updated["session-waiting"].session_status == MultiTaskSessionStatus.WAITING
    assert updated["session-waiting"].required_human_action == waiting.required_human_action
    assert updated["session-waiting"].prior_execution_result == waiting.prior_execution_result


def test_multi_task_orchestrator_supports_loaded_persisted_sessions(tmp_path: Path) -> None:
    orchestrator = MultiTaskOrchestrator()
    persistence = StatePersistence()
    handoff = _handoff(
        "session-persisted",
        (
            _step("persisted-analyze", "analyze"),
            _step("persisted-request-review", "request_review", depends_on=("persisted-analyze",)),
            _step("persisted-implement", "implement", depends_on=("persisted-request-review",), requires_human_review=True),
        ),
        human_review_required=True,
    )
    orchestration_result = orchestrator.orchestrate_selected_session(
        orchestrator.build_session_record(
            session_id="session-persisted",
            priority=MultiTaskPriority.NORMAL,
            router_handoff=handoff,
            last_updated="2026-04-12T10:00:00+00:00",
        )
    )
    session = persistence.build_session(
        session_id="session-persisted",
        router_handoff=handoff,
        orchestration_result=orchestration_result,
        task_execution_result=orchestration_result.execution_result,
    )
    session_path = tmp_path / "session-persisted.json"
    save_result = persistence.save_session(session, session_path)
    loaded_session = persistence.load_session(session_path).session
    loaded_record = orchestrator.build_session_record(
        persisted_session=loaded_session,
        priority=MultiTaskPriority.NORMAL,
    )

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(loaded_record,),
        )
    )

    assert save_result.status.value == "saved"
    assert result.session_registry[0].session_status == MultiTaskSessionStatus.WAITING
    assert result.session_registry[0].persisted_session is not None


def test_multi_task_orchestrator_returns_structured_result() -> None:
    orchestrator = MultiTaskOrchestrator()
    ready = _ready_record(orchestrator, "session-ready", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(ready,),
        )
    )
    payload = result.to_dict()

    assert payload["decision"]["chosen_action"] == "select_next_session"
    assert payload["decision"]["selected_session_id"] == "session-ready"
    assert payload["decision"]["selection_reason"] == "highest_priority_ready"
    assert payload["session_registry"][0]["session_status"] == "ready"