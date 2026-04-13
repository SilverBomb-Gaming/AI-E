from __future__ import annotations

from pathlib import Path

from aie.core.execution_orchestrator import ExecutionOrchestrator
from aie.core.models import (
    ConstraintReport,
    ConstraintRouterHandoff,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    OrchestrationRequest,
    PersistenceStatus,
    ResumeRequest,
    StopReason,
    TaskChain,
    TaskStep,
)
from aie.core.state_persistence import StatePersistence


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
        summary="Bounded execution plan for persistence tests.",
        bounded=True,
        engine_target="unity",
        verification_steps=("Run focused verification.",),
        limitations=("Keep persistence deterministic.",),
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
        chain_id="tc-persistence-test",
        status=chain_status,
        summary="Persistence test chain.",
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


def _persisted_review_session(tmp_path: Path):
    persistence = StatePersistence()
    orchestrator = ExecutionOrchestrator()
    handoff = _handoff(
        (
            _step("analyze-request", "analyze"),
            _step("request-review", "request_review", depends_on=("analyze-request",)),
            _step("implement-reviewed-slice", "implement", depends_on=("request-review",), requires_human_review=True),
        ),
        human_review_required=True,
    )
    orchestration_result = orchestrator.orchestrate(OrchestrationRequest(handoff=handoff))
    session = persistence.build_session(
        session_id="session-review-1",
        router_handoff=handoff,
        orchestration_result=orchestration_result,
        task_execution_result=orchestration_result.execution_result,
        notes=("Awaiting review.",),
    )
    session_path = tmp_path / "session-review.json"
    return persistence, orchestrator, session, session_path


def test_state_persistence_saves_valid_execution_session(tmp_path: Path) -> None:
    persistence, _, session, session_path = _persisted_review_session(tmp_path)

    save_result = persistence.save_session(session, session_path)

    assert save_result.status == PersistenceStatus.SAVED
    assert session_path.exists()
    raw_text = session_path.read_text(encoding="utf-8")
    assert '"session_id": "session-review-1"' in raw_text
    assert '"schema_version": 1' in raw_text


def test_state_persistence_loads_valid_persisted_session(tmp_path: Path) -> None:
    persistence, _, session, session_path = _persisted_review_session(tmp_path)
    persistence.save_session(session, session_path)

    load_result = persistence.load_session(session_path)

    assert load_result.status == PersistenceStatus.LOADED
    assert load_result.session is not None
    assert load_result.session.session_id == session.session_id
    assert load_result.session.lifecycle_snapshot.last_lifecycle_state == session.lifecycle_snapshot.last_lifecycle_state


def test_state_persistence_preserves_execution_truth_across_roundtrip(tmp_path: Path) -> None:
    persistence, _, session, session_path = _persisted_review_session(tmp_path)
    persistence.save_session(session, session_path)

    loaded = persistence.load_session(session_path).session

    assert loaded is not None
    assert loaded.task_execution_result.completed_step_ids == session.task_execution_result.completed_step_ids
    assert loaded.task_execution_result.blocked_step_ids == session.task_execution_result.blocked_step_ids
    assert loaded.task_execution_result.deferred_step_ids == session.task_execution_result.deferred_step_ids
    assert loaded.task_execution_result.step_runs[0].step_id == session.task_execution_result.step_runs[0].step_id


def test_state_persistence_preserves_stop_reason_and_blocked_step_id(tmp_path: Path) -> None:
    persistence, _, session, session_path = _persisted_review_session(tmp_path)
    persistence.save_session(session, session_path)

    loaded = persistence.load_session(session_path).session

    assert loaded is not None
    assert loaded.task_execution_result.stop_reason == StopReason.REVIEW_REQUIRED
    assert loaded.task_execution_result.blocked_step_id == "request-review"
    assert loaded.lifecycle_snapshot.stop_reason == StopReason.REVIEW_REQUIRED
    assert loaded.lifecycle_snapshot.blocked_step_id == "request-review"


def test_state_persistence_supports_orchestrator_friendly_reload(tmp_path: Path) -> None:
    persistence, orchestrator, session, session_path = _persisted_review_session(tmp_path)
    persistence.save_session(session, session_path)
    loaded_session = persistence.load_session(session_path).session

    orchestration_result = orchestrator.orchestrate_persisted_session(
        loaded_session,
        resume_request=ResumeRequest.from_execution_result(loaded_session.task_execution_result, review_cleared=True),
    )

    assert orchestration_result.final_executor_status == ExecutorStatus.COMPLETED
    assert orchestration_result.resume_result is not None


def test_state_persistence_rejects_corrupt_json(tmp_path: Path) -> None:
    persistence = StatePersistence()
    session_path = tmp_path / "corrupt-session.json"
    session_path.write_text("{not valid json", encoding="utf-8")

    load_result = persistence.load_session(session_path)

    assert load_result.status == PersistenceStatus.INVALID
    assert load_result.session is None


def test_state_persistence_rejects_missing_required_fields(tmp_path: Path) -> None:
    persistence = StatePersistence()
    session_path = tmp_path / "missing-fields.json"
    session_path.write_text('{"schema_version": 1, "session_id": "missing"}', encoding="utf-8")

    load_result = persistence.load_session(session_path)

    assert load_result.status == PersistenceStatus.INVALID
    assert load_result.session is None


def test_state_persistence_rejects_schema_version_mismatch(tmp_path: Path) -> None:
    persistence, _, session, session_path = _persisted_review_session(tmp_path)
    payload = persistence.serialize_session(session)
    payload["schema_version"] = 99
    session_path.write_text(__import__("json").dumps(payload, indent=2), encoding="utf-8")

    load_result = persistence.load_session(session_path)

    assert load_result.status == PersistenceStatus.VERSION_MISMATCH
    assert load_result.session is None