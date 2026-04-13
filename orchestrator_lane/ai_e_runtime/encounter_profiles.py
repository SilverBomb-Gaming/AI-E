from __future__ import annotations

from typing import Any, Dict

from .intent_normalizer import normalize_prompt


SUPPORTED_ENCOUNTER_CONTEXTS = ("encounter",)
DEFAULT_SUPPORTED_ENCOUNTER = "encounter"

_ENCOUNTER_PROFILE: Dict[str, Any] = {
    "display_name": "encounter",
    "count_tiers": {
        "low": 3,
        "standard": 5,
        "high": 7,
    },
    "pressure_tiers": {
        "low": 8.0,
        "standard": 6.0,
        "high": 4.0,
    },
}


def supported_encounter_contexts() -> tuple[str, ...]:
    return SUPPORTED_ENCOUNTER_CONTEXTS


def normalize_supported_encounter_context(context: str | None, *, default: str | None = None) -> str:
    normalized = normalize_prompt(str(context or "")).strip()
    if normalized in SUPPORTED_ENCOUNTER_CONTEXTS:
        return normalized
    return str(default or "").strip()


def detect_supported_encounter_context(*values: Any, default: str | None = "") -> str:
    for value in values:
        if isinstance(value, dict):
            detected = detect_supported_encounter_context(*value.values(), default="")
            if detected:
                return detected
            continue
        normalized = normalize_prompt(str(value or "")).strip()
        if not normalized:
            continue
        tokens = set(normalized.split())
        if "encounter" in tokens:
            return DEFAULT_SUPPORTED_ENCOUNTER
        if {"spawn", "pressure"} <= tokens:
            return DEFAULT_SUPPORTED_ENCOUNTER
        if {"encounter", "count"} <= tokens:
            return DEFAULT_SUPPORTED_ENCOUNTER
        if {"spawn", "count"} <= tokens:
            return DEFAULT_SUPPORTED_ENCOUNTER
    return normalize_supported_encounter_context(default)


def encounter_display_name(context: str | None) -> str:
    resolved = normalize_supported_encounter_context(context, default=DEFAULT_SUPPORTED_ENCOUNTER)
    return str(_ENCOUNTER_PROFILE.get("display_name") or resolved).strip() or DEFAULT_SUPPORTED_ENCOUNTER


def encounter_count_tier_values(_: str | None = None) -> Dict[str, int]:
    return dict(_ENCOUNTER_PROFILE.get("count_tiers") or {})


def spawn_pressure_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_ENCOUNTER_PROFILE.get("pressure_tiers") or {})


def encounter_count_tiers(_: str | None = None) -> tuple[str, ...]:
    return tuple(encounter_count_tier_values().keys())


def spawn_pressure_tiers(_: str | None = None) -> tuple[str, ...]:
    return tuple(spawn_pressure_tier_values().keys())


def encounter_count_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore encounter count to standard"
    if tier == "low":
        return "decrease encounter count"
    return "increase encounter count"


def spawn_pressure_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore spawn pressure to standard"
    if tier == "low":
        return "decrease spawn pressure"
    return "increase spawn pressure"


def intense_encounter_prompt() -> str:
    return "make encounter more intense"


def easier_encounter_prompt() -> str:
    return "make encounter easier"


def restore_standard_encounter_prompt() -> str:
    return "restore encounter to standard"


def supported_encounter_examples_for_family(family: str) -> str:
    if family == "count_high":
        return "'increase encounter count'"
    if family == "count_low":
        return "'decrease encounter count'"
    if family == "pressure_high":
        return "'increase spawn pressure'"
    if family == "pressure_low":
        return "'decrease spawn pressure'"
    if family == "intensity_plan":
        return "'make encounter more intense'"
    if family == "easier_plan":
        return "'make encounter easier'"
    if family == "restore_plan":
        return "'restore encounter to standard'"
    return "'increase encounter count'"


__all__ = [
    "DEFAULT_SUPPORTED_ENCOUNTER",
    "SUPPORTED_ENCOUNTER_CONTEXTS",
    "detect_supported_encounter_context",
    "easier_encounter_prompt",
    "encounter_count_tier_prompt",
    "encounter_count_tier_values",
    "encounter_count_tiers",
    "encounter_display_name",
    "intense_encounter_prompt",
    "normalize_supported_encounter_context",
    "restore_standard_encounter_prompt",
    "spawn_pressure_tier_prompt",
    "spawn_pressure_tier_values",
    "spawn_pressure_tiers",
    "supported_encounter_contexts",
    "supported_encounter_examples_for_family",
]
