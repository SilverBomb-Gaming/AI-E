from __future__ import annotations

from typing import Any, Dict

from .intent_normalizer import normalize_prompt


SUPPORTED_RACING_CONTEXTS = ("racer",)
DEFAULT_SUPPORTED_RACING_CONTEXT = "racer"

_RACING_PROFILE: Dict[str, Any] = {
    "display_name": "racer",
    "acceleration_tiers": {
        "slow": 3.5,
        "standard": 5.0,
        "fast": 6.5,
    },
    "max_speed_tiers": {
        "slow": 10.0,
        "standard": 12.5,
        "fast": 15.0,
    },
}


def supported_racing_contexts() -> tuple[str, ...]:
    return SUPPORTED_RACING_CONTEXTS


def normalize_supported_racing_context(context: str | None, *, default: str | None = None) -> str:
    normalized = normalize_prompt(str(context or "")).strip()
    if normalized in SUPPORTED_RACING_CONTEXTS:
        return normalized
    if normalized == "racing":
        return DEFAULT_SUPPORTED_RACING_CONTEXT
    return str(default or "").strip()


def detect_supported_racing_context(*values: Any, default: str | None = "") -> str:
    for value in values:
        if isinstance(value, dict):
            detected = detect_supported_racing_context(*value.values(), default="")
            if detected:
                return detected
            continue
        normalized = normalize_prompt(str(value or "")).strip()
        if not normalized:
            continue
        tokens = set(normalized.split())
        if "racer" in tokens or "racing" in tokens:
            return DEFAULT_SUPPORTED_RACING_CONTEXT
        if {"max", "speed", "racer"} <= tokens:
            return DEFAULT_SUPPORTED_RACING_CONTEXT
        if {"acceleration", "racer"} <= tokens:
            return DEFAULT_SUPPORTED_RACING_CONTEXT
    return normalize_supported_racing_context(default)


def racing_display_name(context: str | None) -> str:
    resolved = normalize_supported_racing_context(context, default=DEFAULT_SUPPORTED_RACING_CONTEXT)
    return str(_RACING_PROFILE.get("display_name") or resolved).strip() or DEFAULT_SUPPORTED_RACING_CONTEXT


def acceleration_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_RACING_PROFILE.get("acceleration_tiers") or {})


def max_speed_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_RACING_PROFILE.get("max_speed_tiers") or {})


def acceleration_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore racer acceleration to standard"
    if tier == "slow":
        return "decrease racer acceleration"
    return "increase racer acceleration"


def max_speed_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore racer max speed to standard"
    if tier == "slow":
        return "decrease racer max speed"
    return "increase racer max speed"


def racing_baseline_restore_prompts() -> tuple[str, ...]:
    return (
        acceleration_tier_prompt("standard"),
        max_speed_tier_prompt("standard"),
    )


__all__ = [
    "DEFAULT_SUPPORTED_RACING_CONTEXT",
    "SUPPORTED_RACING_CONTEXTS",
    "acceleration_tier_prompt",
    "acceleration_tier_values",
    "detect_supported_racing_context",
    "max_speed_tier_prompt",
    "max_speed_tier_values",
    "normalize_supported_racing_context",
    "racing_baseline_restore_prompts",
    "racing_display_name",
    "supported_racing_contexts",
]