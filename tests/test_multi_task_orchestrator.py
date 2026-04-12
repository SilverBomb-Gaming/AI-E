from __future__ import annotations

from pathlib import Path

from aie.core.models import (
    ArtifactBlockReason,
    ArtifactRequirement,
    ArtifactRequirementStatus,
    ArtifactStatus,
    ArtifactType,
    ConstraintReport,
    ConstraintRouterHandoff,
    DependencyBlockReason,
    DependencyStatus,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    MultiTaskAction,
    MultiTaskOrchestrationRequest,
    MultiTaskPriority,
    MultiTaskSessionRecord,
    MultiTaskSessionStatus,
    ResumeRequest,
    SessionArtifact,
    SessionDependency,
    SessionSelectionReason,
    TaskExecutionResult,
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


def _failed_record(
    orchestrator: MultiTaskOrchestrator,
    session_id: str,
    *,
    last_updated: str,
) -> MultiTaskSessionRecord:
    handoff = _handoff(session_id, (_step(f"{session_id}-analyze", "analyze"),))
    prior_result = TaskExecutionResult(
        status=ExecutorStatus.FAILED,
        summary_notes=("Executor failed for test setup.",),
    )
    return orchestrator.build_session_record(
        session_id=session_id,
        priority=MultiTaskPriority.NORMAL,
        router_handoff=handoff,
        prior_execution_result=prior_result,
        last_updated=last_updated,
    )


def _artifact(
    artifact_id: str,
    producer_session_id: str,
    artifact_name: str,
    artifact_type: ArtifactType,
    *,
    artifact_status: ArtifactStatus = ArtifactStatus.PRODUCED,
) -> SessionArtifact:
    return SessionArtifact(
        artifact_id=artifact_id,
        producer_session_id=producer_session_id,
        artifact_name=artifact_name,
        artifact_type=artifact_type,
        artifact_status=artifact_status,
        artifact_metadata={"source": producer_session_id},
    )


def _artifact_requirement(
    consumer_session_id: str,
    producer_session_id: str,
    artifact_name: str,
    artifact_type: ArtifactType,
) -> ArtifactRequirement:
    return ArtifactRequirement(
        consumer_session_id=consumer_session_id,
        producer_session_id=producer_session_id,
        required_artifact_name=artifact_name,
        required_artifact_type=artifact_type,
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


def test_multi_task_orchestrator_registers_dependencies_and_blocks_downstream_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(session_a, session_b),
            dependencies_to_register=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
        )
    )

    records = {record.session_id: record for record in result.session_registry}

    assert result.registered_dependencies[0].session_id == "session-b"
    assert records["session-a"].dependency_status == DependencyStatus.NO_DEPENDENCIES
    assert records["session-b"].dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY
    assert records["session-b"].dependency_block_reasons == (DependencyBlockReason.PREREQUISITE_NOT_COMPLETED,)
    assert records["session-b"].blocked_by_session_ids == ("session-a",)
    assert records["session-b"].session_status == MultiTaskSessionStatus.BLOCKED
    assert result.decision.dependency_blocked_session_ids == ("session-b",)


def test_multi_task_orchestrator_registers_produced_and_required_artifacts() -> None:
    orchestrator = MultiTaskOrchestrator()
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(producer, consumer),
            artifacts_to_register=(
                _artifact("artifact-combat-schema", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
        )
    )

    records = {record.session_id: record for record in result.session_registry}

    assert result.registered_artifacts[0].artifact_id == "artifact-combat-schema"
    assert result.registered_artifact_requirements[0].consumer_session_id == "session-b"
    assert records["session-a"].produced_artifacts[0].artifact_name == "combat-schema"
    assert records["session-b"].required_artifacts[0].required_artifact_name == "combat-schema"
    assert records["session-b"].requirement_status == ArtifactRequirementStatus.REQUIREMENTS_SATISFIED


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


def test_multi_task_orchestrator_unblocks_dependent_session_after_prerequisite_completion() -> None:
    orchestrator = MultiTaskOrchestrator()
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")
    dependency = SessionDependency(session_id="session-b", prerequisite_session_id="session-a")

    initial = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.EXECUTE_SELECTED,
            sessions_to_register=(session_a, session_b),
            dependencies_to_register=(dependency,),
            selected_session_id="session-a",
        )
    )

    records = {record.session_id: record for record in initial.session_registry}

    assert initial.selected_session_result is not None
    assert initial.selected_session_result.final_executor_status == ExecutorStatus.COMPLETED
    assert records["session-a"].session_status == MultiTaskSessionStatus.COMPLETED
    assert records["session-b"].dependency_status == DependencyStatus.DEPENDENCY_READY
    assert records["session-b"].session_status == MultiTaskSessionStatus.READY


def test_multi_task_orchestrator_unblocks_session_when_required_artifact_exists() -> None:
    orchestrator = MultiTaskOrchestrator()
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(producer, consumer),
            artifacts_to_register=(
                _artifact("artifact-combat-schema", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
            selected_session_id=None,
        )
    )

    records = {record.session_id: record for record in result.session_registry}

    assert records["session-b"].requirement_status == ArtifactRequirementStatus.REQUIREMENTS_SATISFIED
    assert records["session-b"].artifact_ready is True
    assert result.decision.selected_session_id == "session-b"


def test_multi_task_orchestrator_blocks_session_when_required_artifact_is_missing() -> None:
    orchestrator = MultiTaskOrchestrator()
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(producer, consumer),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-a", "enemy-balance-table", ArtifactType.BALANCE_DATA),
            ),
        )
    )

    record = {entry.session_id: entry for entry in result.session_registry}["session-b"]

    assert record.requirement_status == ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT
    assert record.artifact_block_reasons == (ArtifactBlockReason.MISSING_REQUIRED_ARTIFACT,)
    assert record.session_status == MultiTaskSessionStatus.BLOCKED
    assert result.decision.artifact_blocked_session_ids == ("session-b",)


def test_multi_task_orchestrator_blocks_session_when_artifact_type_is_incompatible() -> None:
    orchestrator = MultiTaskOrchestrator()
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(producer, consumer),
            artifacts_to_register=(
                _artifact("artifact-combat-note", "session-a", "combat-schema", ArtifactType.TEXT_NOTE),
            ),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
        )
    )

    record = {entry.session_id: entry for entry in result.session_registry}["session-b"]

    assert record.requirement_status == ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT
    assert record.artifact_block_reasons == (ArtifactBlockReason.INCOMPATIBLE_ARTIFACT_TYPE,)
    assert record.blocked_by_artifact_ids == ("artifact-combat-note",)


def test_multi_task_orchestrator_flags_unknown_artifact_producer_reference() -> None:
    orchestrator = MultiTaskOrchestrator()
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(consumer,),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-z", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
        )
    )

    record = result.session_registry[0]

    assert record.requirement_status == ArtifactRequirementStatus.INVALID_REQUIREMENT_REFERENCE
    assert ArtifactBlockReason.INVALID_ARTIFACT_REFERENCE in record.artifact_block_reasons
    assert ArtifactBlockReason.ARTIFACT_FROM_UNKNOWN_SESSION in record.artifact_block_reasons
    assert record.session_status == MultiTaskSessionStatus.INVALID


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


def test_multi_task_orchestrator_handles_failed_prerequisite() -> None:
    orchestrator = MultiTaskOrchestrator()
    failed = _failed_record(orchestrator, "session-failed", last_updated="2026-04-12T10:00:00+00:00")
    dependent = _ready_record(orchestrator, "session-dependent", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(failed, dependent),
            dependencies_to_register=(
                SessionDependency(session_id="session-dependent", prerequisite_session_id="session-failed"),
            ),
        )
    )

    records = {record.session_id: record for record in result.session_registry}

    assert records["session-dependent"].dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY
    assert records["session-dependent"].dependency_block_reasons == (DependencyBlockReason.PREREQUISITE_FAILED,)
    assert records["session-dependent"].blocked_by_session_ids == ("session-failed",)


def test_multi_task_orchestrator_handles_missing_prerequisite_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    dependent = _ready_record(orchestrator, "session-dependent", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(dependent,),
            dependencies_to_register=(SessionDependency(session_id="session-dependent", prerequisite_session_id="session-z"),),
        )
    )

    record = result.session_registry[0]

    assert record.dependency_status == DependencyStatus.INVALID_DEPENDENCY
    assert record.dependency_block_reasons == (DependencyBlockReason.MISSING_PREREQUISITE_SESSION,)
    assert record.invalid_dependency is True
    assert record.session_status == MultiTaskSessionStatus.INVALID


def test_multi_task_orchestrator_rejects_self_dependency() -> None:
    orchestrator = MultiTaskOrchestrator()
    dependent = _ready_record(orchestrator, "session-self", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(dependent,),
            dependencies_to_register=(SessionDependency(session_id="session-self", prerequisite_session_id="session-self"),),
        )
    )

    record = result.session_registry[0]

    assert record.dependency_status == DependencyStatus.INVALID_DEPENDENCY
    assert DependencyBlockReason.INVALID_DEPENDENCY_REFERENCE in record.dependency_block_reasons


def test_multi_task_orchestrator_detects_dependency_cycle() -> None:
    orchestrator = MultiTaskOrchestrator()
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.INSPECT_SESSIONS,
            sessions_to_register=(session_a, session_b),
            dependencies_to_register=(
                SessionDependency(session_id="session-a", prerequisite_session_id="session-b"),
                SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),
            ),
        )
    )

    records = {record.session_id: record for record in result.session_registry}

    assert records["session-a"].dependency_status == DependencyStatus.INVALID_DEPENDENCY
    assert records["session-b"].dependency_status == DependencyStatus.INVALID_DEPENDENCY
    assert DependencyBlockReason.CYCLIC_DEPENDENCY in records["session-a"].dependency_block_reasons
    assert DependencyBlockReason.CYCLIC_DEPENDENCY in records["session-b"].dependency_block_reasons


def test_multi_task_orchestrator_prefers_dependency_eligible_session_over_higher_priority_blocked_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(session_a, session_b),
            dependencies_to_register=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
        )
    )

    assert result.decision.selected_session_id == "session-a"
    assert result.decision.selection_reason == SessionSelectionReason.HIGHEST_PRIORITY_READY


def test_multi_task_orchestrator_prefers_artifact_ready_session_over_higher_priority_blocked_session() -> None:
    orchestrator = MultiTaskOrchestrator()
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.NORMAL, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.SELECT_NEXT_SESSION,
            sessions_to_register=(session_a, session_b),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
        )
    )

    assert result.decision.selected_session_id == "session-a"
    assert result.decision.artifact_blocked_session_ids == ("session-b",)


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


def test_multi_task_orchestrator_routes_artifact_ready_session_through_execution_orchestrator() -> None:
    orchestrator = MultiTaskOrchestrator()
    producer = _completed_record(orchestrator, "session-a", last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.HIGH, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.EXECUTE_SELECTED,
            sessions_to_register=(producer, consumer),
            artifacts_to_register=(
                _artifact("artifact-combat-schema", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
            artifact_requirements_to_register=(
                _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC),
            ),
            selected_session_id="session-b",
        )
    )

    updated = {record.session_id: record for record in result.session_registry}["session-b"]

    assert result.selected_session_result is not None
    assert result.selected_session_result.final_executor_status == ExecutorStatus.COMPLETED
    assert updated.requirement_status == ArtifactRequirementStatus.REQUIREMENTS_SATISFIED
    assert updated.session_status == MultiTaskSessionStatus.COMPLETED


def test_multi_task_orchestrator_blocks_explicit_selection_when_dependency_not_ready() -> None:
    orchestrator = MultiTaskOrchestrator()
    session_a = _ready_record(orchestrator, "session-a", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    session_b = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")

    result = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.EXECUTE_SELECTED,
            sessions_to_register=(session_a, session_b),
            dependencies_to_register=(SessionDependency(session_id="session-b", prerequisite_session_id="session-a"),),
            selected_session_id="session-b",
        )
    )

    assert result.decision.chosen_action == MultiTaskAction.REJECT
    assert result.decision.selection_reason == SessionSelectionReason.INVALID_SELECTION


def test_multi_task_orchestrator_handles_dependency_and_artifact_unlock_together() -> None:
    orchestrator = MultiTaskOrchestrator()
    producer = _ready_record(orchestrator, "session-a", MultiTaskPriority.LOW, last_updated="2026-04-12T10:00:00+00:00")
    consumer = _ready_record(orchestrator, "session-b", MultiTaskPriority.URGENT, last_updated="2026-04-12T10:05:00+00:00")
    dependency = SessionDependency(session_id="session-b", prerequisite_session_id="session-a")
    artifact = _artifact("artifact-combat-schema", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC)
    requirement = _artifact_requirement("session-b", "session-a", "combat-schema", ArtifactType.DESIGN_SPEC)

    initial = orchestrator.orchestrate(
        MultiTaskOrchestrationRequest(
            requested_action=MultiTaskAction.EXECUTE_SELECTED,
            sessions_to_register=(producer, consumer),
            dependencies_to_register=(dependency,),
            artifacts_to_register=(artifact,),
            artifact_requirements_to_register=(requirement,),
            selected_session_id="session-a",
        )
    )

    records = {record.session_id: record for record in initial.session_registry}

    assert records["session-b"].dependency_status == DependencyStatus.DEPENDENCY_READY
    assert records["session-b"].requirement_status == ArtifactRequirementStatus.REQUIREMENTS_SATISFIED
    assert records["session-b"].session_status == MultiTaskSessionStatus.READY


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
    assert payload["session_registry"][0]["dependency_status"] == "no_dependencies"
    assert payload["session_registry"][0]["requirement_status"] == "no_requirements"