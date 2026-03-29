from __future__ import annotations

import json
from pathlib import Path

from .continuation_engine import build_continuation_tasks
from .decomposer_queue_bridge import _build_title
from .decomposer import decompose_prompt
from .evaluation_feedback import apply_user_selection
from .evaluation_ranker import rank_grouped_tasks
from .evaluation_recommender import recommend_from_ranked
from .evaluation_selector import group_tasks_for_selection
from .utils import write_json


def build_continuation_queue_entries(selection_output: dict) -> list[dict]:
    continuation_tasks = build_continuation_tasks(selection_output)
    queue_entries: list[dict] = []

    for task in continuation_tasks:
        task_id = str(task.get("task_id") or "task").strip() or "task"
        description = str(task.get("description") or "").strip()
        queue_entries.append(
            {
                "task_id": task_id,
                "title": _build_title(description),
                "status": "pending",
                "source": "continuation_engine_v1",
                "description": description,
                "retry_count": 0,
            }
        )

    return _generate_continuation_contracts(queue_entries, selection_output)


def _generate_continuation_contracts(tasks: list[dict], selection_output: dict) -> list[dict]:
    generated_tasks: list[dict] = []
    contracts_dir = _contracts_dir()
    selected_context = _selected_context(selection_output)

    for task in tasks:
        normalized_task = dict(task)
        task_id = str(normalized_task.get("task_id") or "task").strip() or "task"
        title = str(normalized_task.get("title") or "Generated task").strip() or "Generated task"
        description = str(normalized_task.get("description") or "").strip()

        payload = {
            "runtime_task": {
                "task_id": task_id,
                "title": title,
                "agent_type": "read_only_inspector_agent",
                "result_payload": {
                    "source": "continuation_engine_v1",
                    "description": description,
                    "selected_task_id": selected_context["selected_task_id"],
                    "compare_group": selected_context["compare_group"],
                },
            }
        }

        destination = contracts_dir / f"{task_id}.json"
        write_json(destination, payload)
        normalized_task["contract_path"] = _relative_contract_path(task_id)
        generated_tasks.append(normalized_task)

    return generated_tasks


def _selected_context(selection_output: dict) -> dict[str, str]:
    for compare_group, group_payload in sorted(selection_output.items(), key=lambda item: item[0]):
        if not isinstance(group_payload, dict):
            continue
        selected_task = group_payload.get("selected_task")
        if not isinstance(selected_task, dict):
            continue
        selected_task_id = str(selected_task.get("task_id") or "").strip()
        if not selected_task_id:
            continue
        return {
            "selected_task_id": selected_task_id,
            "compare_group": str(group_payload.get("compare_group") or compare_group).strip(),
        }

    return {"selected_task_id": "", "compare_group": ""}


def _contracts_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "contracts" / "generated_runtime"


def _relative_contract_path(task_id: str) -> str:
    return f"contracts/generated_runtime/{task_id}.json"


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    grouped = group_tasks_for_selection(decompose_prompt(example_prompt))
    ranked = rank_grouped_tasks(grouped)
    recommendations = recommend_from_ranked(ranked)
    selection = apply_user_selection(recommendations, "variation_3")
    print(json.dumps(build_continuation_queue_entries(selection), indent=2))