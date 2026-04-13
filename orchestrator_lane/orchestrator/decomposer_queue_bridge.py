from __future__ import annotations

import json

from .decomposer import decompose_prompt


def build_queue_entries(prompt: str) -> list[dict]:
    normalized_prompt = " ".join(prompt.strip().split())
    decomposed_tasks = decompose_prompt(normalized_prompt)
    return [
        {
            "task_id": task["task_id"],
            "title": _build_title(task["description"]),
            "status": "pending",
            "source": "decomposer_v1",
            "description": task["description"],
            "created_from_prompt": normalized_prompt,
            "retry_count": 0,
        }
        for task in decomposed_tasks
    ]


def _build_title(description: str) -> str:
    text = description.strip()
    if not text:
        return "Generated task"
    return text[0].upper() + text[1:]


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    print(json.dumps(build_queue_entries(example_prompt), indent=2))