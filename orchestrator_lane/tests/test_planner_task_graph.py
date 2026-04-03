import pytest

from ai_e_runtime.planner import RuleBasedPlanner
from ai_e_runtime.planner_task_graph import build_plan_task_graph


pytestmark = pytest.mark.fast


def test_plan_task_graph_preserves_order_and_dependencies() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "Fix LEVEL_0001 zombie animation, weapon bootstrap, and KBM controls",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH123456",
    )

    graph = build_plan_task_graph(plan, request_id="REQ_GRAPH123456", task_id_prefix="INTAKE_GRAPH123456")

    assert [node.task_id for node in graph.nodes] == [
        "INTAKE_GRAPH123456__STEP_01",
        "INTAKE_GRAPH123456__STEP_02",
        "INTAKE_GRAPH123456__STEP_03",
        "INTAKE_GRAPH123456__STEP_04",
        "INTAKE_GRAPH123456__STEP_05",
    ]
    assert graph.nodes[0].dependencies == []
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH123456__STEP_01"]
    assert graph.nodes[4].dependencies == ["INTAKE_GRAPH123456__STEP_04"]
    assert graph.nodes[3].title == "Validate integrated result"


def test_plan_task_graph_preserves_operator_prompts_for_predefined_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "test combat variation",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_COMBAT",
    )

    graph = build_plan_task_graph(plan, request_id="REQ_GRAPH_COMBAT", task_id_prefix="INTAKE_GRAPH_COMBAT")

    assert [node.operator_prompt for node in graph.nodes] == [
        "make zombie faster",
        "make zombie more aggressive",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_COMBAT__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_predefined_safety_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "make zombie safer",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_SAFETY",
    )

    graph = build_plan_task_graph(plan, request_id="REQ_GRAPH_SAFETY", task_id_prefix="INTAKE_GRAPH_SAFETY")

    assert [node.operator_prompt for node in graph.nodes] == [
        "make zombie slower",
        "move zombie forward",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_SAFETY__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_restore_standard_zombie_danger_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "restore zombie danger to standard",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_RESTORE_DANGER",
    )

    graph = build_plan_task_graph(
        plan,
        request_id="REQ_GRAPH_RESTORE_DANGER",
        task_id_prefix="INTAKE_GRAPH_RESTORE_DANGER",
    )

    assert [node.operator_prompt for node in graph.nodes] == [
        "restore zombie speed to standard",
        "restore zombie aggression to standard",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_RESTORE_DANGER__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_runner_combat_variation_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "make runner more dangerous",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_RUNNER_COMBAT",
    )

    graph = build_plan_task_graph(
        plan,
        request_id="REQ_GRAPH_RUNNER_COMBAT",
        task_id_prefix="INTAKE_GRAPH_RUNNER_COMBAT",
    )

    assert [node.operator_prompt for node in graph.nodes] == [
        "make runner faster",
        "make runner more aggressive",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_RUNNER_COMBAT__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_restore_standard_runner_danger_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "make runner easier",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_RUNNER_EASIER",
    )

    graph = build_plan_task_graph(
        plan,
        request_id="REQ_GRAPH_RUNNER_EASIER",
        task_id_prefix="INTAKE_GRAPH_RUNNER_EASIER",
    )

    assert [node.operator_prompt for node in graph.nodes] == [
        "restore runner speed to standard",
        "restore runner aggression to standard",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_RUNNER_EASIER__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_fast_low_aggression_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "make zombie faster but less aggressive",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_FAST_LOW_AGGRO",
    )

    graph = build_plan_task_graph(
        plan,
        request_id="REQ_GRAPH_FAST_LOW_AGGRO",
        task_id_prefix="INTAKE_GRAPH_FAST_LOW_AGGRO",
    )

    assert [node.operator_prompt for node in graph.nodes] == [
        "make zombie faster",
        "restore zombie aggression to standard",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_FAST_LOW_AGGRO__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_lower_danger_slower_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "make zombie less dangerous and slower",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_SAFE_SLOW",
    )

    graph = build_plan_task_graph(
        plan,
        request_id="REQ_GRAPH_SAFE_SLOW",
        task_id_prefix="INTAKE_GRAPH_SAFE_SLOW",
    )

    assert [node.operator_prompt for node in graph.nodes] == [
        "restore zombie aggression to standard",
        "make zombie slower",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_SAFE_SLOW__STEP_01"]


def test_plan_task_graph_preserves_operator_prompts_for_predefined_variation_plan() -> None:
    planner = RuleBasedPlanner()
    plan = planner.plan(
        "try a different movement",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
        request_id="REQ_GRAPH_VARIATION",
    )

    graph = build_plan_task_graph(plan, request_id="REQ_GRAPH_VARIATION", task_id_prefix="INTAKE_GRAPH_VARIATION")

    assert [node.operator_prompt for node in graph.nodes] == [
        "move zombie farther forward",
        "move zombie forward",
    ]
    assert graph.nodes[1].dependencies == ["INTAKE_GRAPH_VARIATION__STEP_01"]
