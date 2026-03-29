from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()

import json

from .decomposer import decompose_prompt


def group_tasks_for_selection(tasks: list[dict], playability_report: dict | None = None) -> dict:
    grouped: dict[str, dict] = {}
    report_context = _report_context(playability_report)

    for task in tasks:
        evaluation = task.get("evaluation")
        if not isinstance(evaluation, dict):
            continue
        if evaluation.get("selection_required") is not True:
            continue

        compare_group = str(evaluation.get("compare_group") or "").strip()
        if not compare_group:
            continue

        group = grouped.setdefault(
            compare_group,
            {
                "selection_required": True,
                "total_candidates": 0,
                "playability_report": dict(playability_report or {}),
                "readiness": dict(report_context["readiness"]),
                "metrics": dict(report_context["metrics"]),
                "analysis": dict(report_context["analysis"]),
                "tasks": [],
            },
        )
        group["tasks"].append(
            {
                "task_id": str(task.get("task_id") or ""),
                "title": str(task.get("title") or ""),
                "variation_index": int(task.get("variation_index", 0) or 0),
                "total_variations": int(task.get("total_variations", 0) or 0),
                "description": str(task.get("description") or ""),
                "subdomain": str(task.get("subdomain") or ""),
                "intent": str(task.get("intent") or ""),
                "report_task": _task_is_in_report(task, report_context["redesign_tasks"]),
            }
        )

    for group in grouped.values():
        group["tasks"].sort(key=lambda entry: (entry["variation_index"], entry["task_id"]))
        group["total_candidates"] = len(group["tasks"])

    return dict(sorted(grouped.items(), key=lambda item: item[0]))


def _report_context(playability_report: dict | None) -> dict:
    report = dict(playability_report or {})
    analysis = report.get("analysis")
    metrics = report.get("metrics")
    readiness = report.get("readiness")
    redesign = report.get("redesign")
    return {
        "analysis": dict(analysis) if isinstance(analysis, dict) else {},
        "metrics": dict(metrics) if isinstance(metrics, dict) else {},
        "readiness": dict(readiness) if isinstance(readiness, dict) else {},
        "redesign_tasks": [dict(task) for task in (redesign or {}).get("tasks", []) if isinstance(task, dict)]
        if isinstance(redesign, dict)
        else [],
    }


def _task_is_in_report(task: dict, redesign_tasks: list[dict]) -> bool:
    task_id = str(task.get("task_id") or "").strip()
    if not task_id:
        return False
    return any(str(redesign_task.get("task_id") or "").strip() == task_id for redesign_task in redesign_tasks)


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    print(json.dumps(group_tasks_for_selection(decompose_prompt(example_prompt)), indent=2))