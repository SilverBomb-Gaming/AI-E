from __future__ import annotations

from typing import Any

from .encounter_profiles import (
    detect_supported_encounter_context,
    easier_encounter_prompt,
    encounter_count_tier_prompt,
    encounter_display_name,
    normalize_supported_encounter_context,
    restore_standard_encounter_prompt,
    spawn_pressure_tier_prompt,
    supported_encounter_contexts,
)
from .enemy_profiles import (
    baseline_restore_prompts,
    detect_supported_enemy_entity,
    enemy_display_name,
    normalize_supported_enemy_entity,
    supported_enemy_entities,
)
from .racing_profiles import (
    detect_supported_racing_context,
    normalize_supported_racing_context,
    racing_baseline_restore_prompts,
    racing_display_name,
    supported_racing_contexts,
)
from .platformer_profiles import (
    detect_supported_platformer_context,
    normalize_supported_platformer_context,
    platformer_baseline_restore_prompts,
    platformer_display_name,
    supported_platformer_contexts,
)


def supported_tuning_contexts() -> tuple[str, ...]:
    return (*supported_enemy_entities(), *supported_encounter_contexts(), *supported_racing_contexts(), *supported_platformer_contexts())


def is_supported_tuning_context(context: str | None) -> bool:
    return bool(normalize_supported_tuning_context(context))


def is_supported_enemy_context(context: str | None) -> bool:
    return bool(normalize_supported_enemy_entity(context, default=""))


def is_supported_encounter_context(context: str | None) -> bool:
    return bool(normalize_supported_encounter_context(context, default=""))


def normalize_supported_tuning_context(context: str | None, *, default: str | None = None) -> str:
    platformer = normalize_supported_platformer_context(context, default="")
    if platformer:
        return platformer
    racing = normalize_supported_racing_context(context, default="")
    if racing:
        return racing
    encounter = normalize_supported_encounter_context(context, default="")
    if encounter:
        return encounter
    enemy = normalize_supported_enemy_entity(context, default="")
    if enemy:
        return enemy
    return str(default or "").strip()


def detect_supported_tuning_context(*values: Any, default: str | None = "") -> str:
    platformer = detect_supported_platformer_context(*values, default="")
    if platformer:
        return platformer
    racing = detect_supported_racing_context(*values, default="")
    if racing:
        return racing
    encounter = detect_supported_encounter_context(*values, default="")
    if encounter:
        return encounter
    enemy = detect_supported_enemy_entity(*values, default="")
    if enemy:
        return enemy
    return normalize_supported_tuning_context(default)


def tuning_context_display_name(context: str | None) -> str:
    resolved = normalize_supported_tuning_context(context)
    if normalize_supported_platformer_context(resolved, default=""):
        return platformer_display_name(resolved)
    if normalize_supported_racing_context(resolved, default=""):
        return racing_display_name(resolved)
    if is_supported_encounter_context(resolved):
        return encounter_display_name(resolved)
    return enemy_display_name(resolved)


def baseline_restore_prompts_for_context(context: str | None) -> tuple[str, ...]:
    resolved = normalize_supported_tuning_context(context)
    if normalize_supported_platformer_context(resolved, default=""):
        return platformer_baseline_restore_prompts()
    if normalize_supported_racing_context(resolved, default=""):
        return racing_baseline_restore_prompts()
    if is_supported_encounter_context(resolved):
        prompts = (
            encounter_count_tier_prompt("standard"),
            spawn_pressure_tier_prompt("standard"),
            easier_encounter_prompt(),
            restore_standard_encounter_prompt(),
        )
        return tuple(dict.fromkeys(prompts))
    return baseline_restore_prompts(resolved)


__all__ = [
    "baseline_restore_prompts_for_context",
    "detect_supported_tuning_context",
    "is_supported_encounter_context",
    "is_supported_enemy_context",
    "is_supported_tuning_context",
    "normalize_supported_tuning_context",
    "supported_tuning_contexts",
    "tuning_context_display_name",
]
