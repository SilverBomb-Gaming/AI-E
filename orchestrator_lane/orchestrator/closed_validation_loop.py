from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()

from copy import deepcopy

from .level_playability_analyzer import (
    analyze_first_validation_target,
    analyze_level_playability,
)
from .playability_report_contract import build_playability_report
from .scene_modification_bridge import build_scene_action_plan


def run_closed_validation_cycle(level_id: str, max_iterations: int = 3) -> dict:
    normalized_level_id = str(level_id or "").strip()
    if not normalized_level_id:
        raise ValueError("level_id must be a non-empty string.")

    iteration_limit = max(1, int(max_iterations or 1))
    level_state, player_capabilities = _load_validation_state(normalized_level_id)
    current_report = _build_report_from_level_state(normalized_level_id, level_state, player_capabilities)
    initial_status = str(current_report.get("playability_status") or "")
    comparison_summary: list[dict] = []
    actions_applied: list[dict] = []
    termination_reason = "iteration_limit_reached"
    iterations_used = 0

    for iteration_index in range(1, iteration_limit + 1):
        iterations_used = iteration_index
        before_report = current_report
        action_plan = build_scene_action_plan(before_report)
        action_plan["level_id"] = normalized_level_id
        action_plan["level_data"] = deepcopy(level_state)

        execution_result = apply_scene_action_plan(action_plan)
        level_state = execution_result["level_data"]
        actions_applied.extend(
            [
                {
                    "iteration": iteration_index,
                    **dict(action_result),
                }
                for action_result in execution_result["action_results"]
            ]
        )

        after_report = _build_report_from_level_state(normalized_level_id, level_state, player_capabilities)
        comparison = compare_playability_reports(before_report, after_report)
        comparison_summary.append(
            {
                "iteration": iteration_index,
                "action_validation": dict(execution_result.get("validation") or {}),
                **comparison,
            }
        )

        current_report = after_report

        if bool(after_report.get("readiness", {}).get("playable", False)):
            termination_reason = "playable_reached"
            break

        if not comparison["improved"]:
            termination_reason = "stagnation"
            break

        if iteration_index == iteration_limit:
            termination_reason = "iteration_limit_reached"

    return {
        "level_id": normalized_level_id,
        "initial_status": initial_status,
        "final_status": str(current_report.get("playability_status") or ""),
        "iterations_used": iterations_used,
        "improvement": any(bool(item.get("improved")) for item in comparison_summary),
        "actions_applied": actions_applied,
        "final_report": current_report,
        "comparison_summary": comparison_summary,
        "termination_reason": termination_reason,
    }


def apply_scene_action_plan(action_plan: dict) -> dict:
    actions = action_plan.get("actions")
    level_data = action_plan.get("level_data")
    validation = dict(action_plan.get("validation") or {})

    if not isinstance(actions, list):
        raise ValueError("action_plan must include an actions list.")
    if not isinstance(level_data, dict):
        raise ValueError("action_plan must include level_data for deterministic application.")

    updated_level_data = deepcopy(level_data)
    action_results: list[dict] = []

    for action in actions:
        result = _apply_single_scene_action(dict(action), updated_level_data)
        action_results.append(result)

    return {
        "status": _execution_status(action_results),
        "level_data": updated_level_data,
        "action_results": action_results,
        "validation": validation,
    }


def compare_playability_reports(before_report: dict, after_report: dict) -> dict:
    before_metrics = dict(before_report.get("metrics") or {})
    after_metrics = dict(after_report.get("metrics") or {})
    before_analysis = dict(before_report.get("analysis") or {})
    after_analysis = dict(after_report.get("analysis") or {})
    before_readiness = dict(before_report.get("readiness") or {})
    after_readiness = dict(after_report.get("readiness") or {})

    status_before = str(before_report.get("playability_status") or "")
    status_after = str(after_report.get("playability_status") or "")
    unreachable_delta = int(after_metrics.get("unreachable_count", 0) or 0) - int(before_metrics.get("unreachable_count", 0) or 0)
    jump_failures_delta = len(_dict_list(after_analysis.get("jump_failures"))) - len(_dict_list(before_analysis.get("jump_failures")))
    blocking_issues_delta = len(_string_list(after_readiness.get("blocking_issues"))) - len(_string_list(before_readiness.get("blocking_issues")))
    gap_violations_delta = int(after_metrics.get("gap_violations", 0) or 0) - int(before_metrics.get("gap_violations", 0) or 0)

    improved = any(
        [
            _status_rank(status_after) > _status_rank(status_before),
            unreachable_delta < 0,
            jump_failures_delta < 0,
            blocking_issues_delta < 0,
            gap_violations_delta < 0,
        ]
    )

    notes: list[str] = []
    if status_before != status_after:
        notes.append(f"playability_status changed from {status_before} to {status_after}.")
    if unreachable_delta != 0:
        notes.append(f"unreachable_count delta: {unreachable_delta}.")
    if jump_failures_delta != 0:
        notes.append(f"jump_failures delta: {jump_failures_delta}.")
    if blocking_issues_delta != 0:
        notes.append(f"blocking_issues delta: {blocking_issues_delta}.")
    if gap_violations_delta != 0:
        notes.append(f"gap_violations delta: {gap_violations_delta}.")
    if not notes:
        notes.append("No material report delta detected.")

    return {
        "improved": improved,
        "status_change": f"{status_before}->{status_after}",
        "metrics_delta": {
            "unreachable_count": unreachable_delta,
            "jump_failures": jump_failures_delta,
            "blocking_issues": blocking_issues_delta,
            "gap_violations": gap_violations_delta,
        },
        "notes": notes,
    }


def _load_validation_state(level_id: str) -> tuple[dict, dict]:
    validation = analyze_first_validation_target()
    detected_level_id = str(validation.get("stabilization_report_summary", {}).get("level_id") or "LEVEL_0001")
    if level_id != detected_level_id:
        raise ValueError(f"unsupported level_id for closed validation loop: {level_id}")
    return deepcopy(dict(validation.get("level_data") or {})), deepcopy(dict(validation.get("player_capabilities") or {}))


def _build_report_from_level_state(level_id: str, level_data: dict, player_capabilities: dict) -> dict:
    analysis = analyze_level_playability(dict(level_data), dict(player_capabilities))
    redesign_tasks = [dict(task) for task in analysis.get("redesigned_layout_tasks", []) if isinstance(task, dict)]
    return build_playability_report(
        level_id=level_id,
        analysis_result=analysis,
        redesign_tasks=redesign_tasks,
    )


def _apply_single_scene_action(action: dict, level_data: dict) -> dict:
    action_type = str(action.get("action_type") or "").strip()
    target_objects = [str(target).strip() for target in action.get("target_objects", []) if str(target).strip()]
    parameters = dict(action.get("parameters") or {})

    if action_type == "mark_unresolved_target":
        return {
            "action_id": str(action.get("action_id") or ""),
            "task_id": str(action.get("task_id") or ""),
            "status": "skipped",
            "notes": f"Unresolved target: {parameters.get('reason_code', 'unsupported_action')}",
        }

    platforms = level_data.get("platforms")
    if not isinstance(platforms, list):
        return {
            "action_id": str(action.get("action_id") or ""),
            "task_id": str(action.get("task_id") or ""),
            "status": "failed",
            "notes": "level_data.platforms missing or invalid.",
        }

    if action_type == "adjust_platform_height":
        matched = _adjust_platform_height(platforms, target_objects, parameters)
    elif action_type == "move_platform":
        matched = _move_platform(platforms, target_objects, parameters)
    elif action_type == "add_step_platform":
        matched = _add_step_platform(level_data, platforms, target_objects, parameters)
    elif action_type == "add_ramp":
        matched = _add_ramp(platforms, target_objects, parameters, level_data)
    elif action_type == "align_gap_distance":
        matched = _align_gap_distance(platforms, target_objects, parameters, level_data)
    else:
        return {
            "action_id": str(action.get("action_id") or ""),
            "task_id": str(action.get("task_id") or ""),
            "status": "failed",
            "notes": f"Unsupported scene action: {action_type}",
        }

    if matched <= 0:
        return {
            "action_id": str(action.get("action_id") or ""),
            "task_id": str(action.get("task_id") or ""),
            "status": "failed",
            "notes": f"No matching targets applied for action_type={action_type}.",
        }

    return {
        "action_id": str(action.get("action_id") or ""),
        "task_id": str(action.get("task_id") or ""),
        "status": "applied",
        "notes": f"Applied {action_type} to {matched} target(s).",
    }


def _adjust_platform_height(platforms: list[dict], target_objects: list[str], parameters: dict) -> int:
    delta_y = float(parameters.get("delta_y", 0.0) or 0.0)
    matched = 0
    for platform in platforms:
        if str(platform.get("name") or "") not in target_objects:
            continue
        platform["top_y"] = round(float(platform.get("top_y", 0.0)) + delta_y, 3)
        matched += 1
    return matched


def _move_platform(platforms: list[dict], target_objects: list[str], parameters: dict) -> int:
    translation = dict(parameters.get("translation") or {})
    dx = float(translation.get("x", 0.0) or 0.0)
    dy = float(translation.get("y", 0.0) or 0.0)
    dz = float(translation.get("z", 0.0) or 0.0)
    matched = 0
    for platform in platforms:
        if str(platform.get("name") or "") not in target_objects:
            continue
        platform["center_x"] = round(float(platform.get("center_x", 0.0)) + dx, 3)
        platform["top_y"] = round(float(platform.get("top_y", 0.0)) + dy, 3)
        platform["center_z"] = round(float(platform.get("center_z", 0.0)) + dz, 3)
        matched += 1
    return matched


def _add_step_platform(level_data: dict, platforms: list[dict], target_objects: list[str], parameters: dict) -> int:
    ground = dict(level_data.get("ground") or {})
    ground_top = float(ground.get("top_y", 0.0) or 0.0)
    step_height = float(parameters.get("step_height", 0.6) or 0.6)
    variant_index = int(parameters.get("variant_index", 0) or 0)
    matched = 0

    for platform in list(platforms):
        platform_name = str(platform.get("name") or "")
        if platform_name not in target_objects:
            continue
        helper_name = f"{platform_name}_StepHelper_V{variant_index or 0}"
        if any(str(existing.get("name") or "") == helper_name for existing in platforms):
            matched += 1
            continue
        platforms.append(
            {
                "name": helper_name,
                "center_x": float(platform.get("center_x", 0.0)),
                "center_z": float(platform.get("center_z", 0.0)),
                "top_y": round(ground_top + step_height, 3),
                "width": 1.0,
                "depth": 1.0,
            }
        )
        matched += 1
    return matched


def _add_ramp(platforms: list[dict], target_objects: list[str], parameters: dict, level_data: dict) -> int:
    ground_top = float(dict(level_data.get("ground") or {}).get("top_y", 0.0) or 0.0)
    matched = 0
    for platform in platforms:
        if str(platform.get("name") or "") not in target_objects:
            continue
        platform["top_y"] = round(min(float(platform.get("top_y", 0.0)), ground_top + 1.2), 3)
        matched += 1
    return matched


def _align_gap_distance(platforms: list[dict], target_objects: list[str], parameters: dict, level_data: dict) -> int:
    gap_delta = float(parameters.get("gap_delta", 0.0) or 0.0)
    ground = dict(level_data.get("ground") or {})
    ground_center_x = float(ground.get("center_x", 0.0) or 0.0)
    ground_center_z = float(ground.get("center_z", 0.0) or 0.0)
    matched = 0

    for platform in platforms:
        if str(platform.get("name") or "") not in target_objects:
            continue
        center_x = float(platform.get("center_x", 0.0))
        center_z = float(platform.get("center_z", 0.0))
        platform["center_x"] = round(center_x + _shift_toward(center_x, ground_center_x, gap_delta), 3)
        platform["center_z"] = round(center_z + _shift_toward(center_z, ground_center_z, gap_delta), 3)
        matched += 1
    return matched


def _shift_toward(current_value: float, target_value: float, magnitude: float) -> float:
    if magnitude == 0.0 or current_value == target_value:
        return 0.0
    direction = -1.0 if current_value > target_value else 1.0
    return direction * abs(magnitude)


def _execution_status(action_results: list[dict]) -> str:
    statuses = {str(item.get("status") or "") for item in action_results}
    if "failed" in statuses and "applied" not in statuses:
        return "failed"
    if "applied" in statuses:
        return "completed"
    return "skipped"


def _status_rank(status: str) -> int:
    normalized = str(status or "").strip()
    if normalized == "playable":
        return 3
    if normalized == "partially_broken":
        return 2
    if normalized == "not_playable":
        return 1
    return 0


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _dict_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]