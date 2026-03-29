from __future__ import annotations

import json
import re


_VARIATION_PATTERN = re.compile(r"\bvariation(?:s)?\b", re.IGNORECASE)
_VARIATION_COUNT_PATTERN = re.compile(r"\b(\d+)\s+variation(?:s)?\b", re.IGNORECASE)
_LEADING_ACTION_WORDS = {
    "add",
    "analyze",
    "build",
    "create",
    "design",
    "extend",
    "fix",
    "generate",
    "improve",
    "make",
    "produce",
    "repair",
    "refine",
    "rework",
}
_FAMILY_DEFINITIONS = {
    "map_extension_variation": {
        "subdomain": "level_layout",
        "intent": "extend_map",
        "compare_group": "game_design_map_variations",
        "title": "Map extension variation",
        "description": "generate map extension variation",
        "keywords": ("map", "layout", "level", "space", "extension", "geometry"),
        "playability_review_required": True,
    },
    "gameplay_flow_refinement": {
        "subdomain": "gameplay_flow",
        "intent": "refine_flow",
        "compare_group": "game_design_gameplay_flow",
        "title": "Gameplay flow refinement",
        "description": "refine gameplay flow",
        "keywords": ("flow", "loop", "pace", "combat flow", "gameplay"),
        "playability_review_required": True,
    },
    "encounter_placement_concept": {
        "subdomain": "encounter_design",
        "intent": "place_encounter",
        "compare_group": "game_design_encounter_placement",
        "title": "Encounter placement concept",
        "description": "design encounter placement concept",
        "keywords": ("encounter", "enemy", "spawn", "wave"),
        "playability_review_required": False,
    },
    "traversal_pathing_concept": {
        "subdomain": "traversal_design",
        "intent": "design_traversal",
        "compare_group": "game_design_traversal_pathing",
        "title": "Traversal pathing concept",
        "description": "design traversal and pathing concept",
        "keywords": ("traversal", "path", "pathing", "route", "jump", "platform", "reachability"),
        "playability_review_required": True,
    },
    "theme_variation_concept": {
        "subdomain": "theme_direction",
        "intent": "vary_theme",
        "compare_group": "game_design_theme_variations",
        "title": "Theme variation concept",
        "description": "generate theme variation concept",
        "keywords": ("theme", "style", "mood", "visual", "biome"),
        "playability_review_required": False,
    },
}


def build_game_design_tasks(prompt: str) -> list[dict]:
    normalized_prompt = " ".join(str(prompt or "").strip().split())
    if not normalized_prompt:
        return []

    variation_count = _extract_variation_count(normalized_prompt)
    families = _detect_families(normalized_prompt)
    subject = _extract_subject(normalized_prompt)
    tasks: list[dict] = []

    for family_key in families:
        family = _FAMILY_DEFINITIONS[family_key]
        family_task_count = variation_count if _VARIATION_PATTERN.search(normalized_prompt) else 1
        for index in range(1, family_task_count + 1):
            tasks.append(
                {
                    "task_id": _task_id_for_family(family_key, index=index),
                    "title": _build_title(family_key, subject=subject, index=index, total=family_task_count),
                    "description": _build_description(family_key, subject=subject, index=index, total=family_task_count),
                    "domain": "game_design",
                    "subdomain": family["subdomain"],
                    "intent": family["intent"],
                    "constraints": {
                        "safety": "read_only",
                        "execution_mode": "local_only",
                        "runtime_changes": False,
                        "external_apis": False,
                        "engine_dependency": "none_in_task_pack_layer",
                    },
                    "evaluation": {
                        "compare_group": family["compare_group"],
                        "selection_required": family_task_count > 1,
                        "playability_review_required": family["playability_review_required"],
                        "redesign_authorized_for_playability": family["playability_review_required"],
                    },
                    "target_subject": subject,
                    "variation_index": index if family_task_count > 1 else 0,
                    "total_variations": family_task_count,
                }
            )

    return tasks


def _extract_variation_count(prompt: str) -> int:
    match = _VARIATION_COUNT_PATTERN.search(prompt)
    if match is None:
        return 3
    return max(1, int(match.group(1)))


def _detect_families(prompt: str) -> list[str]:
    lowered = prompt.lower()
    matched: list[str] = []

    for family_key, family in _FAMILY_DEFINITIONS.items():
        if any(keyword in lowered for keyword in family["keywords"]):
            matched.append(family_key)

    if matched:
        return matched

    if _VARIATION_PATTERN.search(prompt):
        return ["map_extension_variation"]

    return ["gameplay_flow_refinement"]


def _extract_subject(prompt: str) -> str:
    lowered_prompt = prompt.lower()
    subject_match = re.search(r"\bfor\b\s+(.+)$", lowered_prompt)
    if subject_match is not None:
        stem = subject_match.group(1).strip()
    else:
        stem = _VARIATION_COUNT_PATTERN.sub(" ", lowered_prompt)
        stem = _VARIATION_PATTERN.sub(" ", stem)
    stem = re.sub(r"\b(map|layout|level|extension|gameplay|flow|encounter|traversal|pathing|theme|concept|design)\b", " ", stem, flags=re.IGNORECASE)
    stem = re.sub(r"\b(and|with|for|of|to)\b", " ", stem, flags=re.IGNORECASE)
    stem = re.sub(r"\b\d+\b", " ", stem)
    words = [word for word in stem.split() if word]
    if len(words) > 1 and words[0] in _LEADING_ACTION_WORDS:
        words = words[1:]
    if words and words[0] in {"a", "an", "the"}:
        words = words[1:]
    subject = " ".join(words).strip()
    return subject or "level layout"


def _task_id_for_family(family_key: str, *, index: int) -> str:
    prefix = {
        "map_extension_variation": "map_design",
        "gameplay_flow_refinement": "gameplay_flow",
        "encounter_placement_concept": "encounter",
        "traversal_pathing_concept": "traversal",
        "theme_variation_concept": "theme",
    }[family_key]
    return f"{prefix}_{index}"


def _build_title(family_key: str, *, subject: str, index: int, total: int) -> str:
    label = _FAMILY_DEFINITIONS[family_key]["title"]
    if total > 1:
        return f"{label} {index} for {subject}"
    return f"{label} for {subject}"


def _build_description(family_key: str, *, subject: str, index: int, total: int) -> str:
    base = _FAMILY_DEFINITIONS[family_key]["description"]
    if total > 1:
        return f"{base} {index} for {subject}"
    return f"{base} for {subject}"


if __name__ == "__main__":
    example_prompt = "generate 3 traversal variations for a combat arena"
    print(json.dumps(build_game_design_tasks(example_prompt), indent=2))