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
    canonical_redesign_tasks = _normalize_redesign_tasks(
        redesign_tasks=normalized_redesign_tasks,
        analysis_result=normalized_analysis,
        redesign_reason=redesign_reason,
    )
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
            "tasks": canonical_redesign_tasks,
        },
        "metrics": metrics,
        "readiness": readiness,
        "recommendations": _string_list(normalized_analysis.get("recommendations")),
    }


def _normalize_redesign_tasks(redesign_tasks: list[dict], analysis_result: dict, redesign_reason: list[str]) -> list[dict]:
    canonical_tasks: list[dict] = []

    for task in redesign_tasks:
        canonical_task = _normalize_redesign_task(task, analysis_result, redesign_reason)
        if canonical_task:
            canonical_tasks.append(canonical_task)

    canonical_tasks.sort(key=lambda task: (int(task.get("priority", 0) or 0), str(task.get("task_id") or "")))
    return canonical_tasks


def _normalize_redesign_task(task: dict, analysis_result: dict, redesign_reason: list[str]) -> dict:
    raw_subdomain = str(task.get("subdomain") or "").strip() or "unknown_subdomain"
    raw_intent = str(task.get("intent") or "").strip() or "unknown_intent"
    description = str(task.get("description") or "").strip()
    title = str(task.get("title") or "").strip() or description or "Untitled redesign task"
    target_objects = _target_objects(task, analysis_result)
    variant_index = int(task.get("variation_index", 0) or 0)
    total_variations = int(task.get("total_variations", 0) or 0)
    priority = _priority_for_task(raw_subdomain, raw_intent)
    task_id = _canonical_task_id(raw_subdomain, raw_intent, target_objects, variant_index)

    return {
        "task_id": task_id,
        "title": title,
        "description": description,
        "domain": "game_design",
        "subdomain": raw_subdomain,
        "intent": raw_intent,
        "priority": priority,
        "reason": _task_reason(task, analysis_result, redesign_reason),
        "target_objects": target_objects,
        "proposed_actions": _proposed_actions(task, raw_subdomain, raw_intent, target_objects, description),
        "constraints": dict(task.get("constraints") or {}),
        "expected_outcome": _expected_outcome(raw_subdomain, raw_intent, analysis_result),
        "source": "playability_report.redesign",
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


def _target_objects(task: dict, analysis_result: dict) -> list[str]:
    targets: list[str] = []
    target_subject = str(task.get("target_subject") or "").strip()
    if target_subject:
        targets.append(target_subject)

    subdomain = str(task.get("subdomain") or "").strip().lower()
    intent = str(task.get("intent") or "").strip().lower()
    if subdomain in {"traversal_design", "level_layout"} or intent in {"design_traversal", "extend_map"}:
        for area in _dict_list(analysis_result.get("unreachable_areas")):
            area_id = str(area.get("area_id") or "").strip()
            if area_id:
                targets.append(area_id)

    return _deduplicate_preserve_order(targets) or ["level_layout"]


def _task_reason(task: dict, analysis_result: dict, redesign_reason: list[str]) -> list[str]:
    reasons = list(redesign_reason)
    raw_subdomain = str(task.get("subdomain") or "").strip().lower()
    raw_intent = str(task.get("intent") or "").strip().lower()

    if raw_subdomain == "traversal_design" or raw_intent == "design_traversal":
        reasons.extend(_string_list(analysis_result.get("progression_breaks")))
    if raw_subdomain == "level_layout" or raw_intent == "extend_map":
        unreachable_areas = _dict_list(analysis_result.get("unreachable_areas"))
        reasons.extend(str(area.get("reason") or "").strip() for area in unreachable_areas if str(area.get("reason") or "").strip())
    if raw_subdomain == "gameplay_flow" or raw_intent == "refine_flow":
        reasons.extend(_string_list(analysis_result.get("movement_mismatch")))

    return _deduplicate_preserve_order([reason for reason in reasons if str(reason).strip()])


def _proposed_actions(
    task: dict,
    raw_subdomain: str,
    raw_intent: str,
    target_objects: list[str],
    description: str,
) -> list[dict]:
    evaluation = dict(task.get("evaluation") or {})
    compare_group = str(evaluation.get("compare_group") or _default_compare_group(raw_subdomain, raw_intent)).strip()
    selection_required = bool(evaluation.get("selection_required", False))
    variant_index = int(task.get("variation_index", 0) or 0)
    total_variations = int(task.get("total_variations", 0) or 0)

    return [
        {
            "action_type": _action_type(raw_subdomain, raw_intent),
            "instruction": description,
            "target_objects": list(target_objects),
            "compare_group": compare_group,
            "selection_required": selection_required,
            "variant_index": variant_index,
            "total_variations": total_variations,
        }
    ]


def _expected_outcome(raw_subdomain: str, raw_intent: str, analysis_result: dict) -> list[str]:
    if raw_subdomain == "traversal_design" or raw_intent == "design_traversal":
        return [
            "Restore continuous traversal across currently blocked progression paths.",
            "Reduce or eliminate unreachable traversal targets in the analyzed layout.",
        ]
    if raw_subdomain == "level_layout" or raw_intent == "extend_map":
        return [
            "Bring required jump and layout demands closer to the current player movement envelope.",
            "Preserve structurally valid play space while resolving unreachable surfaces.",
        ]
    if raw_subdomain == "gameplay_flow" or raw_intent == "refine_flow":
        return [
            "Clarify player-facing flow after structural traversal blockers are resolved.",
            "Keep progression readable within the current analyzed space.",
        ]
    return [
        "Produce a deterministic redesign task that can be consumed by downstream builder layers.",
    ]


def _priority_for_task(raw_subdomain: str, raw_intent: str) -> int:
    if raw_subdomain == "traversal_design" or raw_intent == "design_traversal":
        return 1
    if raw_subdomain == "level_layout" or raw_intent == "extend_map":
        return 2
    if raw_subdomain == "gameplay_flow" or raw_intent == "refine_flow":
        return 3
    if raw_subdomain == "encounter_design" or raw_intent == "place_encounter":
        return 4
    if raw_subdomain == "theme_design" or raw_intent == "vary_theme":
        return 5
    return 6


def _action_type(raw_subdomain: str, raw_intent: str) -> str:
    if raw_subdomain == "traversal_design" or raw_intent == "design_traversal":
        return "design_traversal_path"
    if raw_subdomain == "level_layout" or raw_intent == "extend_map":
        return "adjust_level_layout"
    if raw_subdomain == "gameplay_flow" or raw_intent == "refine_flow":
        return "refine_gameplay_flow"
    return raw_intent or raw_subdomain or "formalized_redesign"


def _default_compare_group(raw_subdomain: str, raw_intent: str) -> str:
    if raw_subdomain == "traversal_design" or raw_intent == "design_traversal":
        return "game_design_traversal_pathing"
    if raw_subdomain == "level_layout" or raw_intent == "extend_map":
        return "game_design_map_variations"
    if raw_subdomain == "gameplay_flow" or raw_intent == "refine_flow":
        return "game_design_gameplay_flow"
    return f"game_design_{_slug_fragment(raw_subdomain or raw_intent or 'tasks')}"


def _canonical_task_id(raw_subdomain: str, raw_intent: str, target_objects: list[str], variant_index: int) -> str:
    base = "_".join(
        part
        for part in [
            _slug_fragment(raw_subdomain),
            _slug_fragment(raw_intent),
            _slug_fragment(target_objects[0] if target_objects else "level_layout"),
        ]
        if part
    )
    if variant_index > 0:
        return f"{base}_v{variant_index}"
    return base


def _slug_fragment(value: str) -> str:
    slug = []
    previous_was_separator = False
    for character in str(value or "").lower():
        if character.isalnum():
            slug.append(character)
            previous_was_separator = False
            continue
        if not previous_was_separator:
            slug.append("_")
            previous_was_separator = True
    return "".join(slug).strip("_")


def _deduplicate_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = str(item).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


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