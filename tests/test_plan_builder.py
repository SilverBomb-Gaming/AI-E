from __future__ import annotations

from aie.core.constraint_resolver import ConstraintResolver
from aie.core.plan_builder import PlanBuilder
from aie.core.request_parser import RequestParser


def test_plan_builder_generates_bounded_unity_scaffold_plan() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()
    builder = PlanBuilder()

    intent = parser.parse("Create a basic third-person controller in Unity")
    report = resolver.resolve(intent)
    plan = builder.build(intent, report)

    assert plan.status == "supported_ready"
    assert plan.bounded is True
    assert plan.engine_target == "unity"
    assert plan.codex_handoff_ready is True
    assert any("minimal third-person controller scaffold" in task["title"].lower() or "third-person controller scaffold" in task["title"].lower() for task in plan.tasks)
    assert any(operation.get("path") == "Assets/Scripts/Player/ThirdPersonController.cs" for operation in plan.file_operations)
    assert len(plan.verification_steps) >= 3


def test_plan_builder_keeps_ambiguous_request_as_draft() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()
    builder = PlanBuilder()

    intent = parser.parse("Add inventory")
    report = resolver.resolve(intent)
    plan = builder.build(intent, report)

    assert plan.status == "bounded_draft_only"
    assert plan.bounded is True
    assert plan.codex_handoff_ready is False
    assert any(task["id"] == "confirm-missing-inputs" for task in plan.tasks)
    assert any(operation.get("path_hint") == "Assets/Scripts/Inventory/InventoryService.cs" for operation in plan.file_operations)
    assert any("draft-only" in warning.lower() or "draft" in warning.lower() for warning in plan.warnings)


def test_plan_builder_does_not_fake_execution_for_unsupported_targets() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()
    builder = PlanBuilder()

    intent = parser.parse("Make this work in Unreal")
    report = resolver.resolve(intent)
    plan = builder.build(intent, report)

    assert plan.status == "unsupported_target"
    assert plan.engine_target == "unreal"
    assert plan.file_operations == ()
    assert plan.codex_handoff_ready is False


def test_plan_builder_includes_verification_for_warning_path() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()
    builder = PlanBuilder()

    intent = parser.parse("Build a polished Unity inventory system for mobile")
    report = resolver.resolve(intent)
    plan = builder.build(intent, report)

    assert plan.status == "supported_with_warnings"
    assert plan.engine_target == "unity"
    assert len(plan.verification_steps) >= 3
    assert any("mobile" in warning.lower() for warning in plan.warnings)
