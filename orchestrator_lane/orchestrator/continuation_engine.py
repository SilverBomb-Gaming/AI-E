from __future__ import annotations

import json

from .decomposer import decompose_prompt
from .evaluation_feedback import apply_user_selection
from .evaluation_ranker import rank_grouped_tasks
from .evaluation_recommender import recommend_from_ranked
from .evaluation_selector import group_tasks_for_selection


def build_continuation_tasks(selection_output: dict) -> list[dict]:
    continuation_tasks: list[dict] = []

    for _, group_payload in sorted(selection_output.items(), key=lambda item: item[0]):
        selected_task = group_payload.get("selected_task")
        compare_group = str(group_payload.get("compare_group") or "").strip()
        if not isinstance(selected_task, dict):
            continue

        selected_task_id = str(selected_task.get("task_id") or "").strip()
        if not selected_task_id:
            continue

        selected_label = _selected_label(selected_task_id, compare_group=compare_group)
        continuation_tasks.extend(
            [
                {
                    "task_id": f"{selected_task_id}_expand_1",
                    "description": f"expand {selected_label} layout",
                },
                {
                    "task_id": f"{selected_task_id}_expand_2",
                    "description": f"refine gameplay flow for {selected_label}",
                },
            ]
        )

    return continuation_tasks


def _selected_label(selected_task_id: str, *, compare_group: str) -> str:
    if compare_group == "map_variations":
        return selected_task_id.replace("variation_", "map variation ").replace("_", " ")
    return selected_task_id


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    ranked = rank_grouped_tasks(grouped)
    recommendations = recommend_from_ranked(ranked)
    selection = apply_user_selection(recommendations, "variation_3")
    print(json.dumps(build_continuation_tasks(selection), indent=2))