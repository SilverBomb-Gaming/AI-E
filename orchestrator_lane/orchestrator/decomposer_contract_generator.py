from __future__ import annotations

import json
from pathlib import Path

from .decomposer_queue_bridge import build_queue_entries
from .utils import write_json


def generate_task_contracts(tasks: list[dict]) -> list[dict]:
    generated_tasks: list[dict] = []
    contracts_dir = _contracts_dir()

    for task in tasks:
        normalized_task = dict(task)
        task_id = str(normalized_task.get("task_id") or "task").strip() or "task"
        title = str(normalized_task.get("title") or "Generated task").strip() or "Generated task"
        description = str(normalized_task.get("description") or "").strip()
        created_from_prompt = str(normalized_task.get("created_from_prompt") or "").strip()

        payload = {
            "runtime_task": {
                "task_id": task_id,
                "title": title,
                "agent_type": "read_only_inspector_agent",
                "result_payload": {
                    "source": "decomposer_v1",
                    "description": description,
                    "created_from_prompt": created_from_prompt,
                },
            }
        }

        destination = contracts_dir / f"{task_id}.json"
        write_json(destination, payload)
        normalized_task["contract_path"] = _relative_contract_path(task_id)
        generated_tasks.append(normalized_task)

    return generated_tasks


def _contracts_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "contracts" / "generated_runtime"


def _relative_contract_path(task_id: str) -> str:
    return f"contracts/generated_runtime/{task_id}.json"


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    generated_tasks = generate_task_contracts(build_queue_entries(example_prompt))
    print(json.dumps(generated_tasks, indent=2))
    print("created_files=")
    for task in generated_tasks:
        print(task["contract_path"])