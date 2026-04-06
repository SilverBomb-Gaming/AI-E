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


def test_planner_returns_predefined_runner_combat_variation_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make runner more dangerous",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_RUNNER_COMBAT123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Test runner combat variation"
    assert plan.plan_step_titles() == [
        "Increase runner speed",
        "Increase runner aggression",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "make runner faster",
        "make runner more aggressive",
    ]


def test_planner_returns_predefined_restore_standard_runner_danger_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make runner easier",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_RUNNER_EASIER123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Restore standard runner danger"
    assert plan.plan_step_titles() == [
        "Restore runner movement speed to standard",
        "Restore runner aggression to standard",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "restore runner speed to standard",
        "restore runner aggression to standard",
    ]


@pytest.mark.parametrize(
    ("prompt_text", "expected_title", "expected_step_prompts"),
    [
        (
            "use level set a",
            "Use level set a",
            [
                "make jump higher",
                "reduce gravity",
                "restore movement to standard",
                "make gaps smaller",
                "reduce obstacle density",
                "reduce enemy density",
                "restore segment count to standard",
            ],
        ),
        (
            "use level set b",
            "Use level set b",
            [
                "restore jump to standard",
                "restore gravity to standard",
                "make movement faster",
                "restore gap size to standard",
                "reduce obstacle density",
                "reduce enemy density",
                "make level longer",
            ],
        ),
        (
            "use level set c",
            "Use level set c",
            [
                "make jump lower",
                "increase gravity",
                "make movement faster",
                "make gaps larger",
                "increase obstacle density",
                "increase enemy density",
                "make level longer",
            ],
        ),
        (
            "use easy traversal",
            "Use easy traversal",
            [
                "make gaps smaller",
                "reduce obstacle density",
                "reduce enemy density",
                "restore segment count to standard",
            ],
        ),
        (
            "use balanced traversal",
            "Use balanced traversal",
            [
                "restore gap size to standard",
                "restore obstacle density to standard",
                "restore enemy density to standard",
                "restore segment count to standard",
            ],
        ),
        (
            "make the level more challenging",
            "Use challenge traversal",
            [
                "make gaps larger",
                "increase obstacle density",
                "increase enemy density",
                "make level longer",
            ],
        ),
        (
            "use long sparse run",
            "Use long sparse run",
            [
                "restore gap size to standard",
                "reduce obstacle density",
                "reduce enemy density",
                "make level longer",
            ],
        ),
        (
            "use short dense run",
            "Use short dense run",
            [
                "restore gap size to standard",
                "increase obstacle density",
                "increase enemy density",
                "make level shorter",
            ],
        ),
    ],
)
def test_planner_returns_platformer_profile_plan(
    prompt_text: str,
    expected_title: str,
    expected_step_prompts: list[str],
) -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        prompt_text,
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_PLATFORMER_PROFILE123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == expected_title
    assert [step.operator_prompt for step in plan.steps] == expected_step_prompts


def test_planner_returns_platformer_restore_level_set_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "restore level set to standard",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_PLATFORMER_LEVEL_SET_RESTORE123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Restore platformer level set to standard"
    assert [step.operator_prompt for step in plan.steps] == [
        "restore jump to standard",
        "restore gravity to standard",
        "restore movement to standard",
        "restore gap size to standard",
        "restore obstacle density to standard",
        "restore enemy density to standard",
        "restore segment count to standard",
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


def test_planner_returns_predefined_encounter_intensity_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make encounter more intense",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_ENCOUNTER_INTENSE123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Increase encounter intensity"
    assert plan.plan_step_titles() == [
        "Increase encounter count",
        "Increase spawn pressure",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "increase encounter count",
        "increase spawn pressure",
    ]


def test_planner_returns_predefined_restore_standard_encounter_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "restore encounter to standard",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_ENCOUNTER_STANDARD123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Restore encounter to standard"
    assert plan.plan_step_titles() == [
        "Restore encounter count to standard",
        "Restore spawn pressure to standard",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "restore encounter count to standard",
        "restore spawn pressure to standard",
    ]


def test_planner_returns_predefined_environment_theme_multi_intent_plan() -> None:
    planner = RuleBasedPlanner()

    plan = planner.plan(
        "make the ground gravel and damaged",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GROUND_THEME_MULTI123",
    )

    assert plan.request_type == "PREDEFINED_MUTATION_PLAN"
    assert plan.title == "Apply gravel then damaged ground theme"
    assert plan.expected_outcome.startswith("AI-E applies the reviewed gravel ground theme")
    assert plan.plan_step_titles() == [
        "Apply gravel ground theme",
        "Apply damaged-ground theme",
    ]
    assert [step.operator_prompt for step in plan.steps] == [
        "apply gravel ground theme",
        "apply damaged-ground theme",
    ]
