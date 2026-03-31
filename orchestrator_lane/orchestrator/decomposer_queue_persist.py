from __future__ import annotations

import json
from pathlib import Path

from .decomposer_contract_generator import generate_task_contracts
from .decomposer_queue_bridge import build_queue_entries
from .utils import read_json, write_json


def enqueue_prompt_tasks(prompt: str) -> list[dict]:
    queue_path = _queue_path()
    payload = read_json(queue_path, default={"tasks": []})
    existing_tasks = payload.get("tasks")
    if not isinstance(existing_tasks, list):
        existing_tasks = []
        payload["tasks"] = existing_tasks

    new_entries = build_queue_entries(prompt)
    existing_ids = {
        str(task.get("task_id") or "").strip()
        for task in existing_tasks
        if str(task.get("task_id") or "").strip()
    }
    added_entries: list[dict] = []
    resolved_entries: list[dict] = []

    for entry in new_entries:
        normalized_entry = dict(entry)
        normalized_entry["task_id"] = _resolve_task_id(
            str(normalized_entry.get("task_id") or "task").strip() or "task",
            existing_ids,
        )
        existing_ids.add(normalized_entry["task_id"])
        resolved_entries.append(normalized_entry)

    generated_entries = generate_task_contracts(resolved_entries)
    for entry in generated_entries:
        existing_tasks.append(entry)
        added_entries.append(entry)

    write_json(queue_path, payload)
    return added_entries


def _queue_path() -> Path:
    return Path(__file__).resolve().parents[1] / "backlog" / "queue.json"


def _resolve_task_id(base_task_id: str, existing_ids: set[str]) -> str:
    if base_task_id not in existing_ids:
        return base_task_id
    suffix = 2
    while True:
        candidate = f"{base_task_id}_{suffix}"
        if candidate not in existing_ids:
            return candidate
        suffix += 1


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    added_entries = enqueue_prompt_tasks(example_prompt)
    queue_payload = read_json(_queue_path(), default={"tasks": []})
    final_queue_size = len(queue_payload.get("tasks", [])) if isinstance(queue_payload.get("tasks"), list) else 0
    print(json.dumps(added_entries, indent=2))
    print(f"final_queue_size={final_queue_size}")