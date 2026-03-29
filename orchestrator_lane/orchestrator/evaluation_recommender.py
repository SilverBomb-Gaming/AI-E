from __future__ import annotations

import json

from .decomposer import decompose_prompt
from .evaluation_ranker import rank_grouped_tasks
from .evaluation_selector import group_tasks_for_selection


def recommend_from_ranked(ranked: dict) -> dict:
    recommendations: dict[str, dict] = {}

    for group_name, group_payload in sorted(ranked.items(), key=lambda item: item[0]):
        ranked_tasks = group_payload.get("ranked_tasks")
        if not isinstance(ranked_tasks, list) or not ranked_tasks:
            continue

        ordered_tasks = sorted(
            ranked_tasks,
            key=lambda task: (
                -int(task.get("score", 0) or 0),
                int(task.get("rank", 0) or 0),
                int(task.get("variation_index", 0) or 0),
                str(task.get("task_id") or ""),
            ),
        )

        top_task = ordered_tasks[0]
        recommendations[group_name] = {
            "selection_required": bool(group_payload.get("selection_required", False)),
            "total_candidates": int(group_payload.get("total_candidates", len(ordered_tasks)) or 0),
            "recommended_task": {
                "task_id": str(top_task.get("task_id") or ""),
                "title": str(top_task.get("title") or ""),
                "score": int(top_task.get("score", 0) or 0),
                "rank": int(top_task.get("rank", 0) or 0),
            },
            "recommendation_reason": "Selected highest-ranked candidate by deterministic variation ordering.",
            "alternatives": [
                {
                    "task_id": str(task.get("task_id") or ""),
                    "score": int(task.get("score", 0) or 0),
                    "rank": int(task.get("rank", 0) or 0),
                }
                for task in ordered_tasks[1:]
            ],
        }

    return recommendations


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    ranked = rank_grouped_tasks(grouped)
    print(json.dumps(recommend_from_ranked(ranked), indent=2))