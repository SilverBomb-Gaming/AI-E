from __future__ import annotations

import json

from .decomposer import decompose_prompt
from .evaluation_ranker import rank_grouped_tasks
from .evaluation_selector import group_tasks_for_selection


def recommend_from_ranked(ranked: dict, playability_report: dict | None = None) -> dict:
    recommendations: dict[str, dict] = {}
    report = dict(playability_report or {})
    readiness = _report_readiness(report)
    redesign_tasks = _report_redesign_tasks(report)
    redesign_task_ids = {str(task.get("task_id") or "").strip() for task in redesign_tasks}
    blocking_issues = _string_list(readiness.get("blocking_issues"))

    for group_name, group_payload in sorted(ranked.items(), key=lambda item: item[0]):
        ranked_tasks = group_payload.get("ranked_tasks")
        if not isinstance(ranked_tasks, list) or not ranked_tasks:
            continue

        group_report = group_payload.get("playability_report")
        if not isinstance(group_report, dict):
            group_report = report

        ordered_tasks = sorted(
            ranked_tasks,
            key=lambda task: (
                -int(task.get("score", 0) or 0),
                -int(task.get("severity", 0) or 0),
                -int(task.get("progression_impact", 0) or 0),
                -int(task.get("reachability_impact", 0) or 0),
                int(task.get("rank", 0) or 0),
                int(task.get("variation_index", 0) or 0),
                str(task.get("task_id") or ""),
            ),
        )

        top_task = ordered_tasks[0]
        prioritized_task_ids = [
            task_id for task_id in [str(task.get("task_id") or "").strip() for task in redesign_tasks] if task_id
        ]
        recommendations[group_name] = {
            "selection_required": bool(group_payload.get("selection_required", False)),
            "total_candidates": int(group_payload.get("total_candidates", len(ordered_tasks)) or 0),
            "blocking_issues": blocking_issues,
            "playability_status": str(group_report.get("playability_status") or ""),
            "recommended_task": {
                "task_id": str(top_task.get("task_id") or ""),
                "title": str(top_task.get("title") or ""),
                "score": int(top_task.get("score", 0) or 0),
                "rank": int(top_task.get("rank", 0) or 0),
                "severity": int(top_task.get("severity", 0) or 0),
                "reachability_impact": int(top_task.get("reachability_impact", 0) or 0),
                "progression_impact": int(top_task.get("progression_impact", 0) or 0),
            },
            "recommendation_reason": _recommendation_reason(top_task, blocking_issues, redesign_task_ids),
            "redesign_tasks_considered": prioritized_task_ids,
            "alternatives": [
                {
                    "task_id": str(task.get("task_id") or ""),
                    "title": str(task.get("title") or ""),
                    "score": int(task.get("score", 0) or 0),
                    "rank": int(task.get("rank", 0) or 0),
                    "severity": int(task.get("severity", 0) or 0),
                    "reachability_impact": int(task.get("reachability_impact", 0) or 0),
                    "progression_impact": int(task.get("progression_impact", 0) or 0),
                }
                for task in ordered_tasks[1:]
            ],
        }

    return recommendations


def _recommendation_reason(top_task: dict, blocking_issues: list[str], redesign_task_ids: set[str]) -> str:
    task_id = str(top_task.get("task_id") or "").strip()
    blocking_issue = blocking_issues[0] if blocking_issues else "current playability blockers"
    if task_id in redesign_task_ids:
        return (
            f"Prioritized to address {blocking_issue} with severity={int(top_task.get('severity', 0) or 0)}, "
            f"reachability_impact={int(top_task.get('reachability_impact', 0) or 0)}, "
            f"progression_impact={int(top_task.get('progression_impact', 0) or 0)}."
        )
    return "Selected highest-ranked candidate by deterministic report-aware ordering."


def _report_readiness(playability_report: dict) -> dict:
    readiness = playability_report.get("readiness")
    return dict(readiness) if isinstance(readiness, dict) else {}


def _report_redesign_tasks(playability_report: dict) -> list[dict]:
    redesign = playability_report.get("redesign")
    if not isinstance(redesign, dict):
        return []
    tasks = redesign.get("tasks")
    if not isinstance(tasks, list):
        return []
    return [dict(task) for task in tasks if isinstance(task, dict)]


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    ranked = rank_grouped_tasks(grouped)
    print(json.dumps(recommend_from_ranked(ranked), indent=2))