from __future__ import annotations

from typing import Any, Dict

from .intent_normalizer import normalize_prompt


SUPPORTED_PLATFORMER_CONTEXTS = ("platformer",)
DEFAULT_SUPPORTED_PLATFORMER_CONTEXT = "platformer"

_PLATFORMER_PROFILE: Dict[str, Any] = {
    "display_name": "platformer",
    "jump_height_tiers": {
        "low": 0.9,
        "standard": 1.2,
        "high": 1.6,
    },
    "gravity_tiers": {
        "low_gravity": 6.0,
        "standard_gravity": 9.81,
        "high_gravity": 13.0,
    },
    "speed_tiers": {
        "slow": 4.0,
        "standard": 5.5,
        "fast": 7.0,
    },
}


def supported_platformer_contexts() -> tuple[str, ...]:
    return SUPPORTED_PLATFORMER_CONTEXTS


def normalize_supported_platformer_context(context: str | None, *, default: str | None = None) -> str:
    normalized = normalize_prompt(str(context or "")).strip()
    if normalized in SUPPORTED_PLATFORMER_CONTEXTS:
        return normalized
    if normalized in {"super monkee", "super_monkee", "platformer"}:
        return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
    return str(default or "").strip()


def detect_supported_platformer_context(*values: Any, default: str | None = "") -> str:
    for value in values:
        if isinstance(value, dict):
            detected = detect_supported_platformer_context(*value.values(), default="")
            if detected:
                return detected
            continue
        normalized = normalize_prompt(str(value or "")).strip()
        if not normalized:
            continue
        tokens = set(normalized.split())
        if normalized in {"platformer", "super monkee", "super_monkee"}:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "jump" in tokens or "gravity" in tokens:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "air" in tokens and "control" in tokens:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "movement" in tokens and ({"faster", "slower", "standard"} & tokens):
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "platformer" in tokens or ({"super", "monkee"} <= tokens):
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
    return normalize_supported_platformer_context(default)


def platformer_display_name(context: str | None) -> str:
    resolved = normalize_supported_platformer_context(context, default=DEFAULT_SUPPORTED_PLATFORMER_CONTEXT)
    return str(_PLATFORMER_PROFILE.get("display_name") or resolved).strip() or DEFAULT_SUPPORTED_PLATFORMER_CONTEXT


def jump_height_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("jump_height_tiers") or {})


def gravity_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("gravity_tiers") or {})


def platformer_speed_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("speed_tiers") or {})


def jump_height_tiers() -> tuple[str, ...]:
    return tuple(jump_height_tier_values().keys())


def gravity_tiers() -> tuple[str, ...]:
    return tuple(gravity_tier_values().keys())


def platformer_speed_tiers() -> tuple[str, ...]:
    return tuple(platformer_speed_tier_values().keys())


def jump_height_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore jump to standard"
    if tier == "low":
        return "make jump lower"
    return "make jump higher"


def gravity_tier_prompt(tier: str) -> str:
    if tier == "standard_gravity":
        return "restore gravity to standard"
    if tier == "low_gravity":
        return "reduce gravity"
    return "increase gravity"


def platformer_speed_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore movement to standard"
    if tier == "slow":
        return "make movement slower"
    return "make movement faster"


def platformer_baseline_restore_prompts() -> tuple[str, ...]:
    return (
        jump_height_tier_prompt("standard"),
        gravity_tier_prompt("standard_gravity"),
        platformer_speed_tier_prompt("standard"),
    )


__all__ = [
    "DEFAULT_SUPPORTED_PLATFORMER_CONTEXT",
    "SUPPORTED_PLATFORMER_CONTEXTS",
    "detect_supported_platformer_context",
    "gravity_tier_prompt",
    "gravity_tier_values",
    "gravity_tiers",
    "jump_height_tier_prompt",
    "jump_height_tier_values",
    "jump_height_tiers",
    "normalize_supported_platformer_context",
    "platformer_baseline_restore_prompts",
    "platformer_display_name",
    "platformer_speed_tier_prompt",
    "platformer_speed_tier_values",
    "platformer_speed_tiers",
    "supported_platformer_contexts",
]