from __future__ import annotations

import json

from .decomposer import decompose_prompt


def group_tasks_for_selection(tasks: list[dict]) -> dict:
    grouped: dict[str, dict] = {}

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
            }
        )

    for group in grouped.values():
        group["tasks"].sort(key=lambda entry: (entry["variation_index"], entry["task_id"]))
        group["total_candidates"] = len(group["tasks"])

    return dict(sorted(grouped.items(), key=lambda item: item[0]))


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    print(json.dumps(group_tasks_for_selection(decompose_prompt(example_prompt)), indent=2))