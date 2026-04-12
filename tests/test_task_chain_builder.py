from __future__ import annotations

from aie.core.constraint_resolver import ConstraintResolver
from aie.core.plan_builder import PlanBuilder
from aie.core.request_parser import RequestParser
from aie.core.task_chain_builder import TaskChainBuilder


def _build_chain(prompt: str):
    parser = RequestParser()
    resolver = ConstraintResolver()
    plan_builder = PlanBuilder()
    chain_builder = TaskChainBuilder()
    intent = parser.parse(prompt)
    report = resolver.resolve(intent)
    plan = plan_builder.build(intent, report)
    chain = chain_builder.build(intent, report, plan)
    return intent, report, plan, chain


def test_task_chain_builder_creates_execution_ready_chain_for_bounded_request() -> None:
    intent, report, plan, chain = _build_chain("Create a basic third-person controller in Unity")

    assert intent.engine_target == "unity"
    assert report.status == "supported_ready"
    assert chain.status == "execution_ready"
    assert tuple(step.step_type for step in chain.steps) == (
        "analyze",
        "implement",
        "validate",
        "document",
        "prepare_commit",
    )
    assert chain.confirmation_requirements
    assert chain.steps[1].requires_confirmation is True
    assert chain.steps[-1].step_type == "prepare_commit"
    assert chain.steps[-1].requires_confirmation is True


def test_task_chain_builder_keeps_vague_request_scaffold_first() -> None:
    _, report, _, chain = _build_chain("Add inventory")

    assert report.status == "bounded_draft_only"
    assert chain.status == "draft_supervised"
    assert tuple(step.step_type for step in chain.steps) == (
        "analyze",
        "scaffold",
        "request_review",
    )
    assert chain.human_review_required is True
    assert all(step.step_type != "implement" for step in chain.steps)


def test_task_chain_builder_inserts_review_and_playtest_for_broader_request() -> None:
    _, report, plan, chain = _build_chain("Build a polished Unity inventory system for mobile")

    assert report.status == "supported_with_warnings"
    assert plan.scaffold_only is True
    assert chain.status == "draft_supervised"
    assert tuple(step.step_type for step in chain.steps) == (
        "analyze",
        "scaffold",
        "request_review",
        "implement",
        "validate",
        "document",
        "request_playtest",
    )
    assert chain.playtest_required is True
    assert chain.human_review_required is True
    assert any(step.requires_playtest for step in chain.steps if step.step_type == "request_playtest")
    assert all(step.step_type != "prepare_commit" for step in chain.steps)


def test_task_chain_builder_blocks_unsupported_engine_requests_cleanly() -> None:
    _, report, _, chain = _build_chain("Make this work in Unreal")

    assert report.status == "unsupported_target"
    assert chain.status == "blocked"
    assert tuple(step.step_type for step in chain.steps) == (
        "analyze",
        "request_review",
    )
    assert chain.human_review_required is True
    assert chain.codex_handoff_ready is False
