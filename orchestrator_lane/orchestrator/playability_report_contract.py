from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()

import json

from ai_e_runtime.time_utils import get_current_timestamp


def build_playability_report(
    level_id: str,
    analysis_result: dict,
    redesign_tasks: list[dict],
) -> dict:
    normalized_level_id = str(level_id or "").strip() or "unknown_level"
    normalized_analysis = dict(analysis_result or {})
    normalized_redesign_tasks = [dict(task) for task in redesign_tasks if isinstance(task, dict)]
    if not normalized_redesign_tasks:
        normalized_redesign_tasks = [
            dict(task) for task in normalized_analysis.get("redesigned_layout_tasks", []) if isinstance(task, dict)
        ]

    issues_found = _string_list(normalized_analysis.get("issues_found"))
    unreachable_areas = _dict_list(normalized_analysis.get("unreachable_areas"))
    jump_failures = _dict_list(normalized_analysis.get("jump_failures"))
    progression_breaks = _string_list(normalized_analysis.get("progression_breaks"))
    dead_zones = _derive_dead_zones(normalized_analysis)
    playable = bool(normalized_analysis.get("playable", False))
    core_traversal_exists = _core_traversal_exists(normalized_analysis)
    playability_status = _derive_playability_status(
        explicit_status=str(normalized_analysis.get("playability_status") or "").strip(),
        playable=playable,
        progression_breaks=progression_breaks,
        core_traversal_exists=core_traversal_exists,
    )

    redesign_required = bool(normalized_analysis.get("redesign_required", bool(normalized_redesign_tasks)))
    redesign_reason = _derive_redesign_reason(normalized_analysis, issues_found)
    metrics = _build_metrics(normalized_analysis, jump_failures, unreachable_areas)
    blocking_issues = _derive_blocking_issues(playability_status, issues_found, progression_breaks)
    testable = _derive_testable(normalized_analysis)
    readiness = {
        "testable": testable,
        "playable": playability_status == "playable",
        "blocking_issues": blocking_issues,
    }

    return {
        "level_id": normalized_level_id,
        "timestamp": get_current_timestamp(),
        "playability_status": playability_status,
        "analysis": {
            "playable": playable,
            "issues_found": issues_found,
            "unreachable_areas": unreachable_areas,
            "jump_failures": jump_failures,
            "dead_zones": dead_zones,
            "progression_breaks": progression_breaks,
        },
        "redesign": {
            "required": redesign_required,
            "reason": redesign_reason,
            "tasks": normalized_redesign_tasks,
        },
        "metrics": metrics,
        "readiness": readiness,
        "recommendations": _string_list(normalized_analysis.get("recommendations")),
    }


def _derive_playability_status(
    *,
    explicit_status: str,
    playable: bool,
    progression_breaks: list[str],
    core_traversal_exists: bool,
) -> str:
    if playable:
        return "playable"
    if explicit_status == "structurally_valid":
        return "playable"
    if explicit_status == "partially_broken":
        return "partially_broken"
    if explicit_status == "not_realistically_playable":
        return "not_playable"
    if progression_breaks and not core_traversal_exists:
        return "not_playable"
    if progression_breaks:
        return "partially_broken"
    return "partially_broken"


def _derive_dead_zones(analysis_result: dict) -> list[dict]:
    explicit_dead_zones = analysis_result.get("dead_zones")
    if isinstance(explicit_dead_zones, list):
        return [dict(item) for item in explicit_dead_zones if isinstance(item, dict)]

    unreachable_areas = _dict_list(analysis_result.get("unreachable_areas"))
    return [
        {
            "area_id": str(area.get("area_id") or "unknown_area"),
            "reason": str(area.get("reason") or "unreachable_area"),
        }
        for area in unreachable_areas
    ]


def _derive_redesign_reason(analysis_result: dict, issues_found: list[str]) -> list[str]:
    redesign_rationale = analysis_result.get("redesign_rationale")
    if isinstance(redesign_rationale, list):
        reasons = [str(item).strip() for item in redesign_rationale if str(item).strip()]
        if reasons:
            return reasons

    movement_mismatch = _string_list(analysis_result.get("movement_mismatch"))
    if movement_mismatch:
        return movement_mismatch
    return issues_found


def _build_metrics(analysis_result: dict, jump_failures: list[dict], unreachable_areas: list[dict]) -> dict:
    max_jump_required = 0.0
    player_jump_capacity = 0.0
    gap_violations = 0

    for failure in jump_failures:
        required_height = _float_value(failure.get("required_height"))
        jump_capacity = _float_value(failure.get("max_jump_height"))
        required_gap = _float_value(failure.get("required_gap"))
        jump_distance = _float_value(failure.get("max_jump_distance"))
        max_jump_required = max(max_jump_required, required_height)
        player_jump_capacity = max(player_jump_capacity, jump_capacity)
        if required_gap > jump_distance:
            gap_violations += 1

    if player_jump_capacity == 0.0:
        player_jump_capacity = _float_value(analysis_result.get("player_jump_capacity"))

    return {
        "max_jump_required": round(max_jump_required, 3),
        "player_jump_capacity": round(player_jump_capacity, 3),
        "gap_violations": gap_violations,
        "unreachable_count": len(unreachable_areas),
    }


def _derive_blocking_issues(
    playability_status: str,
    issues_found: list[str],
    progression_breaks: list[str],
) -> list[str]:
    if playability_status == "playable":
        return []
    if progression_breaks:
        return progression_breaks + [issue for issue in issues_found if issue not in progression_breaks]
    return issues_found


def _derive_testable(analysis_result: dict) -> bool:
    if analysis_result.get("testable") is not None:
        return bool(analysis_result.get("testable"))
    return bool(analysis_result)


def _core_traversal_exists(analysis_result: dict) -> bool:
    if analysis_result.get("traversal_continuity") is True:
        return True
    if analysis_result.get("traversal_continuity") is False:
        spawn_related_issue = any(
            "spawn" in issue.lower() for issue in _string_list(analysis_result.get("issues_found"))
        )
        return not spawn_related_issue
    return False


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _dict_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _float_value(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":
    from .level_playability_analyzer import analyze_first_validation_target

    validation = analyze_first_validation_target()
    analysis = dict(validation.get("analysis") or {})
    report = build_playability_report(
        level_id=str(validation.get("stabilization_report_summary", {}).get("level_id") or "LEVEL_0001"),
        analysis_result=analysis,
        redesign_tasks=[dict(task) for task in analysis.get("redesigned_layout_tasks", []) if isinstance(task, dict)],
    )
    print(json.dumps(report, indent=2))