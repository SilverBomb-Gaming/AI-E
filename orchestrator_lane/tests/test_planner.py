import pytest

from ai_e_runtime.planner import RuleBasedPlanner


pytestmark = pytest.mark.fast


def test_planner_decomposes_composite_stabilization_request() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "Fix LEVEL_0001 zombie animation, weapon bootstrap, and KBM controls",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_ABC123DEF456",
    )

    assert plan.plan_id == "PLAN_ABC123DEF456"
    assert plan.request_type == "COMPOSITE_REQUEST"
    assert plan.plan_step_titles() == [
        "Inspect zombie animation pipeline",
        "Inspect weapon bootstrap",
        "Inspect KBM controls",
        "Validate integrated result",
        "Generate summary artifact",
    ]


def test_planner_handles_single_diagnostic_request() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "Inspect Unity logs",
        target_repo="E:/AI projects 2025/AI-E Orchestrator v1",
        request_id="REQ_DEF456ABC123",
    )

    assert plan.request_type == "DIAGNOSTIC_REQUEST"
    assert len(plan.steps) == 1
    assert plan.steps[0].title == "Inspect Unity logs"


def test_planner_decomposes_autonomous_gameplay_iteration_prompt() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "Expand LEVEL_0001 by adding pathways instead of only enlarging the map, test it by controlling the player, document world interactions, evolve follow-up tasks from the findings, and keep iterating until the session budget is used.",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_AUTONOMOUS123",
    )

    assert plan.request_type == "AUTONOMOUS_GAMEPLAY_ITERATION_REQUEST"
    assert plan.plan_step_titles() == [
        "Plan world layout and pathway improvement",
        "Implement world layout/pathway improvement",
        "Run runtime gameplay validation",
        "Execute player-controlled world interaction test",
        "Document world interaction findings",
        "Evolve follow-up tasks from findings",
        "Repeat iteration while session time remains",
    ]


def test_planner_returns_predefined_zombie_combat_variation_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "test combat variation",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_COMBAT123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Test zombie combat variation"
    assert plan.expected_outcome.startswith("AI-E increases zombie speed")
    assert plan.plan_step_titles() == [
        "Increase zombie speed",
        "Increase zombie aggression",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "make zombie faster",
        "make zombie more aggressive",
    ]


def test_planner_returns_predefined_zombie_safety_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make zombie safer",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_SAFETY123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Reduce zombie aggression"
    assert plan.expected_outcome.startswith("Zombie movement becomes slower")
    assert plan.plan_step_titles() == [
        "Decrease zombie movement speed",
        "Move zombie forward to validate the calmer behavior",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "make zombie slower",
        "move zombie forward",
    ]


def test_planner_returns_predefined_restore_standard_zombie_danger_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "restore zombie danger to standard",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_RESTORE_DANGER123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Restore standard zombie danger"
    assert plan.expected_outcome.startswith("AI-E restores zombie speed and aggression")
    assert plan.plan_step_titles() == [
        "Restore zombie movement speed to standard",
        "Restore zombie aggression to standard",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "restore zombie speed to standard",
        "restore zombie aggression to standard",
    ]


def test_planner_returns_predefined_fast_low_aggression_zombie_variation_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make zombie faster but less aggressive",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_FAST_LOW_AGGRO123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Test fast low-aggression zombie variation"
    assert plan.expected_outcome.startswith("AI-E increases zombie speed")
    assert plan.plan_step_titles() == [
        "Increase zombie speed",
        "Restore zombie aggression to standard",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "make zombie faster",
        "restore zombie aggression to standard",
    ]


def test_planner_returns_predefined_lower_danger_slower_zombie_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make zombie less dangerous and slower",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_SAFE_SLOW123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Make zombie less dangerous and slower"
    assert plan.expected_outcome.startswith("AI-E restores zombie aggression")
    assert plan.plan_step_titles() == [
        "Restore zombie aggression to standard",
        "Decrease zombie movement speed",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "restore zombie aggression to standard",
        "make zombie slower",
    ]


def test_planner_returns_predefined_zombie_variation_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "try a variation",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_VARIATION123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Try zombie movement variation"
    assert plan.expected_outcome.startswith("AI-E tests a visibly different zombie movement path")
    assert plan.plan_step_titles() == [
        "Move zombie farther forward for variation testing",
        "Move zombie forward to compare against the standard path",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "move zombie farther forward",
        "move zombie forward",
    ]
