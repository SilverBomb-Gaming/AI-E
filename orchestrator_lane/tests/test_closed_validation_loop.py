import copy

import pytest

import orchestrator.closed_validation_loop as closed_validation_loop


pytestmark = pytest.mark.fast


def test_compare_playability_reports_detects_improvement():
    before = {
        "playability_status": "partially_broken",
        "analysis": {"jump_failures": [{}, {}]},
        "metrics": {"unreachable_count": 2, "gap_violations": 1},
        "readiness": {"blocking_issues": ["a", "b"]},
    }
    after = {
        "playability_status": "playable",
        "analysis": {"jump_failures": []},
        "metrics": {"unreachable_count": 0, "gap_violations": 0},
        "readiness": {"blocking_issues": []},
    }

    comparison = closed_validation_loop.compare_playability_reports(before, after)

    assert comparison["improved"] is True
    assert comparison["status_change"] == "partially_broken->playable"
    assert comparison["metrics_delta"]["unreachable_count"] == -2
    assert comparison["metrics_delta"]["jump_failures"] == -2
    assert comparison["metrics_delta"]["blocking_issues"] == -2
    assert comparison["metrics_delta"]["gap_violations"] == -1


def test_run_closed_validation_cycle_executes_deterministically():
    first = _normalize_cycle_result(closed_validation_loop.run_closed_validation_cycle("LEVEL_0001", max_iterations=3))
    second = _normalize_cycle_result(closed_validation_loop.run_closed_validation_cycle("LEVEL_0001", max_iterations=3))

    assert first == second
    assert first["termination_reason"] == "playable_reached"
    assert first["final_status"] == "playable"


def test_run_closed_validation_cycle_stops_on_stagnation(monkeypatch):
    original_apply = closed_validation_loop.apply_scene_action_plan

    def no_op_apply(action_plan: dict) -> dict:
        result = original_apply(action_plan)
        result["level_data"] = copy.deepcopy(action_plan["level_data"])
        for action_result in result["action_results"]:
            action_result["status"] = "skipped"
            action_result["notes"] = "Deterministic no-op for stagnation validation."
        result["status"] = "skipped"
        return result

    monkeypatch.setattr(closed_validation_loop, "apply_scene_action_plan", no_op_apply)

    cycle = closed_validation_loop.run_closed_validation_cycle("LEVEL_0001", max_iterations=3)

    assert cycle["termination_reason"] == "stagnation"
    assert cycle["iterations_used"] == 1
    assert cycle["improvement"] is False


def test_run_closed_validation_cycle_never_exceeds_iteration_limit(monkeypatch):
    call_counter = {"count": 0}

    def synthetic_report(level_id: str, level_data: dict, player_capabilities: dict) -> dict:
        call_counter["count"] += 1
        remaining = max(0, 3 - call_counter["count"])
        return {
            "level_id": level_id,
            "timestamp": f"synthetic-{call_counter['count']}",
            "playability_status": "partially_broken",
            "analysis": {"jump_failures": [{}] * max(1, remaining)},
            "redesign": {"required": True, "tasks": []},
            "metrics": {
                "unreachable_count": max(0, remaining),
                "gap_violations": max(0, remaining),
                "max_jump_required": 2.0,
                "player_jump_capacity": 1.2,
            },
            "readiness": {"playable": False, "blocking_issues": ["still blocked"] if remaining >= 0 else []},
            "recommendations": [],
        }

    monkeypatch.setattr(closed_validation_loop, "_build_report_from_level_state", synthetic_report)
    monkeypatch.setattr(
        closed_validation_loop,
        "apply_scene_action_plan",
        lambda action_plan: {"status": "completed", "level_data": copy.deepcopy(action_plan["level_data"]), "action_results": [], "validation": {}},
    )
    monkeypatch.setattr(
        closed_validation_loop,
        "build_scene_action_plan",
        lambda report: {"source": "scene_modification_bridge", "playability_status": report["playability_status"], "redesign_task_count": 0, "action_count": 0, "actions": [], "validation": {"valid": True, "errors": [], "total_actions": 0, "supported_action_count": 0, "unresolved_action_count": 0, "unsupported_task_ids": []}},
    )

    cycle = closed_validation_loop.run_closed_validation_cycle("LEVEL_0001", max_iterations=2)

    assert cycle["iterations_used"] == 2
    assert cycle["termination_reason"] == "iteration_limit_reached"


def _normalize_cycle_result(cycle: dict) -> dict:
    normalized = copy.deepcopy(cycle)
    normalized["final_report"]["timestamp"] = "<normalized-timestamp>"
    return normalized