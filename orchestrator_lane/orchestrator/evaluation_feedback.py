from __future__ import annotations

import json
import re

from .decomposer import decompose_prompt
from .evaluation_ranker import rank_grouped_tasks
from .evaluation_recommender import recommend_from_ranked
from .evaluation_selector import group_tasks_for_selection


def apply_user_selection(recommendation_output: dict, selected_task_id: str) -> dict:
    normalized_selected_task_id = str(selected_task_id or "").strip()
    if not normalized_selected_task_id:
        raise ValueError("selected_task_id must be a non-empty string.")

    selection_result: dict[str, dict] = {}
    matched = False

    for compare_group, group_payload in sorted(recommendation_output.items(), key=lambda item: item[0]):
        recommended_task = group_payload.get("recommended_task") or {}
        alternatives = group_payload.get("alternatives") or []
        if not isinstance(recommended_task, dict) or not isinstance(alternatives, list):
            continue

        candidates = [recommended_task, *[candidate for candidate in alternatives if isinstance(candidate, dict)]]
        candidate_ids = {str(candidate.get("task_id") or "").strip() for candidate in candidates}
        if normalized_selected_task_id not in candidate_ids:
            continue

        matched = True
        selected_candidate = next(
            candidate for candidate in candidates if str(candidate.get("task_id") or "").strip() == normalized_selected_task_id
        )
        selected_title = str(selected_candidate.get("title") or "").strip()
        if not selected_title:
            selected_title = _fallback_title_from_task_id(normalized_selected_task_id)
        selection_result[compare_group] = {
            "compare_group": compare_group,
            "selected_task": {
                "task_id": str(selected_candidate.get("task_id") or ""),
                "title": selected_title,
            },
            "recommended_task_id": str(recommended_task.get("task_id") or ""),
            "recommendation_reason": str(group_payload.get("recommendation_reason") or ""),
            "user_followed_recommendation": normalized_selected_task_id == str(recommended_task.get("task_id") or "").strip(),
            "rejected_alternatives": [
                str(candidate.get("task_id") or "")
                for candidate in candidates
                if str(candidate.get("task_id") or "").strip() != normalized_selected_task_id
            ],
        }

    if not matched:
        raise ValueError(f"selected_task_id not found in recommendation set: {normalized_selected_task_id}")

    return selection_result


def _fallback_title_from_task_id(task_id: str) -> str:
    match = re.fullmatch(r"variation_(\d+)(?:_\d+)?", task_id)
    if match is not None:
        return f"Generate map variation {int(match.group(1))}"
    return task_id


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    ranked = rank_grouped_tasks(grouped)
    recommendations = recommend_from_ranked(ranked)
    print(json.dumps(apply_user_selection(recommendations, "variation_3"), indent=2))