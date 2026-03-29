from __future__ import annotations

import json

from .decomposer import decompose_prompt
from .evaluation_selector import group_tasks_for_selection


def rank_grouped_tasks(grouped: dict, playability_report: dict | None = None) -> dict:
    ranked_groups: dict[str, dict] = {}
    report = dict(playability_report or {})

    for group_name, group_payload in sorted(grouped.items(), key=lambda item: item[0]):
        tasks = group_payload.get("tasks")
        if not isinstance(tasks, list):
            continue

        group_report = group_payload.get("playability_report")
        if not isinstance(group_report, dict):
            group_report = report

        sorted_tasks = sorted(
            tasks,
            key=lambda task: (
                -_priority_score(task, group_report),
                -_severity(task, group_report),
                -_progression_impact(task, group_report),
                -_reachability_impact(task, group_report),
                int(task.get("variation_index", 0) or 0),
                str(task.get("task_id") or ""),
            ),
        )

        ranked_tasks = []
        for index, task in enumerate(sorted_tasks, start=1):
            variation_index = int(task.get("variation_index", 0) or 0)
            severity = _severity(task, group_report)
            reachability_impact = _reachability_impact(task, group_report)
            progression_impact = _progression_impact(task, group_report)
            ranked_tasks.append(
                {
                    "task_id": str(task.get("task_id") or ""),
                    "title": str(task.get("title") or ""),
                    "variation_index": variation_index,
                    "total_variations": int(task.get("total_variations", 0) or 0),
                    "description": str(task.get("description") or ""),
                    "subdomain": str(task.get("subdomain") or ""),
                    "intent": str(task.get("intent") or ""),
                    "severity": severity,
                    "reachability_impact": reachability_impact,
                    "progression_impact": progression_impact,
                    "score": _priority_score(task, group_report),
                    "rank": index,
                }
            )

        ranked_groups[group_name] = {
            "selection_required": bool(group_payload.get("selection_required", False)),
            "total_candidates": int(group_payload.get("total_candidates", len(ranked_tasks)) or 0),
            "playability_report": dict(group_report),
            "ranked_tasks": ranked_tasks,
        }

    return ranked_groups


def _priority_score(task: dict, playability_report: dict) -> int:
    severity = _severity(task, playability_report)
    progression_impact = _progression_impact(task, playability_report)
    reachability_impact = _reachability_impact(task, playability_report)
    normalized_index = max(1, int(task.get("variation_index", 0) or 1))
    return (severity * 1000) + (progression_impact * 100) + (reachability_impact * 10) + (101 - normalized_index)


def _severity(task: dict, playability_report: dict) -> int:
    blocking_issues = _string_list(_report_readiness(playability_report).get("blocking_issues"))
    unreachable_count = int(_report_metrics(playability_report).get("unreachable_count", 0) or 0)
    max_jump_required = _float_value(_report_metrics(playability_report).get("max_jump_required"))
    jump_capacity = _float_value(_report_metrics(playability_report).get("player_jump_capacity"))
    if _is_traversal_task(task):
        if blocking_issues or unreachable_count > 0:
            return 3
        return 2
    if _is_layout_task(task):
        if max_jump_required > jump_capacity or unreachable_count > 0:
            return 3
        return 2
    if _is_flow_task(task):
        return 2 if blocking_issues else 1
    return 1


def _reachability_impact(task: dict, playability_report: dict) -> int:
    metrics = _report_metrics(playability_report)
    unreachable_count = int(metrics.get("unreachable_count", 0) or 0)
    gap_violations = int(metrics.get("gap_violations", 0) or 0)
    if _is_traversal_task(task):
        return min(3, max(1, unreachable_count + gap_violations))
    if _is_layout_task(task):
        return 2 if unreachable_count > 0 else 1
    if _is_flow_task(task):
        return 1 if unreachable_count > 0 else 0
    return 0


def _progression_impact(task: dict, playability_report: dict) -> int:
    progression_breaks = _string_list(_report_analysis(playability_report).get("progression_breaks"))
    if _is_traversal_task(task):
        return 3 if progression_breaks else 2
    if _is_layout_task(task):
        return 2 if progression_breaks else 1
    if _is_flow_task(task):
        return 2 if progression_breaks else 1
    return 0


def _is_traversal_task(task: dict) -> bool:
    subdomain = str(task.get("subdomain") or "").strip().lower()
    intent = str(task.get("intent") or "").strip().lower()
    title = str(task.get("title") or "").strip().lower()
    return subdomain == "traversal_design" or intent == "design_traversal" or "traversal" in title


def _is_layout_task(task: dict) -> bool:
    subdomain = str(task.get("subdomain") or "").strip().lower()
    intent = str(task.get("intent") or "").strip().lower()
    return subdomain == "level_layout" or intent == "extend_map"


def _is_flow_task(task: dict) -> bool:
    subdomain = str(task.get("subdomain") or "").strip().lower()
    intent = str(task.get("intent") or "").strip().lower()
    return subdomain == "gameplay_flow" or intent == "refine_flow"


def _report_analysis(playability_report: dict) -> dict:
    analysis = playability_report.get("analysis")
    return dict(analysis) if isinstance(analysis, dict) else {}


def _report_metrics(playability_report: dict) -> dict:
    metrics = playability_report.get("metrics")
    return dict(metrics) if isinstance(metrics, dict) else {}


def _report_readiness(playability_report: dict) -> dict:
    readiness = playability_report.get("readiness")
    return dict(readiness) if isinstance(readiness, dict) else {}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _float_value(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    print(json.dumps(rank_grouped_tasks(grouped), indent=2))