from __future__ import annotations

import json

from .decomposer import decompose_prompt
from .evaluation_selector import group_tasks_for_selection


def rank_grouped_tasks(grouped: dict) -> dict:
    ranked_groups: dict[str, dict] = {}

    for group_name, group_payload in sorted(grouped.items(), key=lambda item: item[0]):
        tasks = group_payload.get("tasks")
        if not isinstance(tasks, list):
            continue

        sorted_tasks = sorted(
            tasks,
            key=lambda task: (
                int(task.get("variation_index", 0) or 0),
                str(task.get("task_id") or ""),
            ),
        )

        ranked_tasks = []
        for index, task in enumerate(sorted_tasks, start=1):
            variation_index = int(task.get("variation_index", 0) or 0)
            ranked_tasks.append(
                {
                    "task_id": str(task.get("task_id") or ""),
                    "title": str(task.get("title") or ""),
                    "variation_index": variation_index,
                    "total_variations": int(task.get("total_variations", 0) or 0),
                    "description": str(task.get("description") or ""),
                    "score": _score_for_variation_index(variation_index),
                    "rank": index,
                }
            )

        ranked_groups[group_name] = {
            "selection_required": bool(group_payload.get("selection_required", False)),
            "total_candidates": int(group_payload.get("total_candidates", len(ranked_tasks)) or 0),
            "ranked_tasks": ranked_tasks,
        }

    return ranked_groups


def _score_for_variation_index(variation_index: int) -> int:
    normalized_index = max(1, int(variation_index or 1))
    return 101 - normalized_index


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    print(json.dumps(rank_grouped_tasks(grouped), indent=2))