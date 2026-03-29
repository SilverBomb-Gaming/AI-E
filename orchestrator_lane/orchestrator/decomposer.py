from __future__ import annotations

import json
import re


_VARIATION_PATTERN = re.compile(r"\bvariation(?:s)?\b", re.IGNORECASE)
_VARIATION_COUNT_PATTERN = re.compile(r"\b(\d+)\s+variation(?:s)?\b", re.IGNORECASE)
_LEADING_ACTION_WORDS = {
    "add",
    "build",
    "create",
    "extend",
    "generate",
    "make",
    "produce",
}


def decompose_prompt(prompt: str) -> list[dict]:
    normalized_prompt = " ".join(prompt.strip().split())
    if not normalized_prompt or not _VARIATION_PATTERN.search(normalized_prompt):
        return []

    variation_count = _extract_variation_count(normalized_prompt)
    base_intent = _extract_subject(normalized_prompt)
    return [
        {
            "task_id": f"variation_{index}",
            "title": _build_title(base_intent, index=index),
            "description": f"generate {base_intent} variation {index}",
            "base_intent": base_intent,
            "domain": "map_design",
            "intent": "generate_variation",
            "variation_index": index,
            "total_variations": variation_count,
            "constraints": {
                "safety": "read_only",
            },
            "evaluation": {
                "compare_group": "map_variations",
                "selection_required": True,
            },
        }
        for index in range(1, variation_count + 1)
    ]


def _extract_variation_count(prompt: str) -> int:
    match = _VARIATION_COUNT_PATTERN.search(prompt)
    if match is None:
        return 3
    return max(1, int(match.group(1)))


def _extract_subject(prompt: str) -> str:
    lowered_prompt = prompt.lower()
    stem = re.split(r"\bwith\b.*\bvariation(?:s)?\b", lowered_prompt, maxsplit=1)[0].strip()
    if not stem:
        stem = _VARIATION_COUNT_PATTERN.sub("", lowered_prompt).strip()
    words = stem.split()
    if len(words) > 1 and words[0] in _LEADING_ACTION_WORDS:
        words = words[1:]
    subject = " ".join(words).strip()
    return subject or "task"


def _build_title(base_intent: str, *, index: int) -> str:
    return f"Generate {base_intent} variation {index}"


if __name__ == "__main__":
    example_prompt = "extend map with 4 variations"
    print(json.dumps(decompose_prompt(example_prompt), indent=2))