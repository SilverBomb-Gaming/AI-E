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
    "gap_size_tiers": {
        "small": 2.0,
        "standard": 3.0,
        "large": 4.5,
    },
    "obstacle_density_tiers": {
        "sparse": 0.5,
        "standard": 1.0,
        "dense": 1.5,
    },
    "enemy_density_tiers": {
        "low": 1.0,
        "standard": 2.0,
        "high": 3.0,
    },
    "segment_count_tiers": {
        "short": 5.0,
        "standard": 8.0,
        "long": 12.0,
    },
}

_PLATFORMER_LEVEL_PROFILES: Dict[str, Dict[str, Any]] = {
    "easy_traversal": {
        "display_name": "easy traversal",
        "plan_keys": ("platformer_easy_traversal_v1",),
        "plan_titles": ("Use easy traversal",),
        "trigger_prompts": (
            "use easy traversal",
            "make the level easier",
            "make level easier",
        ),
        "tiers": {
            "gap_size": "small",
            "obstacle_density": "sparse",
            "enemy_density": "low",
            "segment_count": "standard",
        },
    },
    "balanced_traversal": {
        "display_name": "balanced traversal",
        "plan_keys": (
            "platformer_balanced_traversal_v1",
            "platformer_restore_layout_standard_v1",
        ),
        "plan_titles": (
            "Use balanced traversal",
            "Restore platformer level structure to standard",
        ),
        "trigger_prompts": (
            "use balanced traversal",
            "restore level to standard",
        ),
        "tiers": {
            "gap_size": "standard",
            "obstacle_density": "standard",
            "enemy_density": "standard",
            "segment_count": "standard",
        },
    },
    "challenge_traversal": {
        "display_name": "challenge traversal",
        "plan_keys": ("platformer_challenge_traversal_v1",),
        "plan_titles": ("Use challenge traversal",),
        "trigger_prompts": (
            "use challenge traversal",
            "make the level more challenging",
            "make level more challenging",
        ),
        "tiers": {
            "gap_size": "large",
            "obstacle_density": "dense",
            "enemy_density": "high",
            "segment_count": "long",
        },
    },
    "long_sparse_run": {
        "display_name": "long sparse run",
        "plan_keys": ("platformer_long_sparse_run_v1",),
        "plan_titles": ("Use long sparse run",),
        "trigger_prompts": ("use long sparse run",),
        "tiers": {
            "gap_size": "standard",
            "obstacle_density": "sparse",
            "enemy_density": "low",
            "segment_count": "long",
        },
    },
    "short_dense_run": {
        "display_name": "short dense run",
        "plan_keys": ("platformer_short_dense_run_v1",),
        "plan_titles": ("Use short dense run",),
        "trigger_prompts": ("use short dense run",),
        "tiers": {
            "gap_size": "standard",
            "obstacle_density": "dense",
            "enemy_density": "high",
            "segment_count": "short",
        },
    },
}

_PLATFORMER_LEVEL_SETS: Dict[str, Dict[str, Any]] = {
    "level_set_a": {
        "display_name": "level set a",
        "plan_keys": ("platformer_level_set_a_v1",),
        "plan_titles": ("Use level set a",),
        "trigger_prompts": ("use level set a",),
        "profile_id": "easy_traversal",
        "tiers": {
            "jump_height": "high",
            "gravity": "low_gravity",
            "speed": "standard",
            "gap_size": "small",
            "obstacle_density": "sparse",
            "enemy_density": "low",
            "segment_count": "standard",
        },
    },
    "level_set_b": {
        "display_name": "level set b",
        "plan_keys": ("platformer_level_set_b_v1",),
        "plan_titles": ("Use level set b",),
        "trigger_prompts": ("use level set b",),
        "profile_id": "long_sparse_run",
        "tiers": {
            "jump_height": "standard",
            "gravity": "standard_gravity",
            "speed": "fast",
            "gap_size": "standard",
            "obstacle_density": "sparse",
            "enemy_density": "low",
            "segment_count": "long",
        },
    },
    "level_set_c": {
        "display_name": "level set c",
        "plan_keys": ("platformer_level_set_c_v1",),
        "plan_titles": ("Use level set c",),
        "trigger_prompts": ("use level set c",),
        "profile_id": "challenge_traversal",
        "tiers": {
            "jump_height": "low",
            "gravity": "high_gravity",
            "speed": "fast",
            "gap_size": "large",
            "obstacle_density": "dense",
            "enemy_density": "high",
            "segment_count": "long",
        },
    },
    "standard_level_set": {
        "display_name": "standard level set",
        "plan_keys": ("platformer_restore_level_set_standard_v1",),
        "plan_titles": ("Restore platformer level set to standard",),
        "trigger_prompts": ("restore level set to standard",),
        "profile_id": "balanced_traversal",
        "tiers": {
            "jump_height": "standard",
            "gravity": "standard_gravity",
            "speed": "standard",
            "gap_size": "standard",
            "obstacle_density": "standard",
            "enemy_density": "standard",
            "segment_count": "standard",
        },
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
        if "gap" in tokens or "gaps" in tokens:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "obstacle" in tokens and "density" in tokens:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "enemy" in tokens and "density" in tokens:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "segment" in tokens and ({"count", "longer", "shorter", "standard"} & tokens):
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "level" in tokens and "set" in tokens:
            return DEFAULT_SUPPORTED_PLATFORMER_CONTEXT
        if "level" in tokens and ({"longer", "shorter", "standard"} & tokens):
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


def gap_size_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("gap_size_tiers") or {})


def obstacle_density_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("obstacle_density_tiers") or {})


def enemy_density_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("enemy_density_tiers") or {})


def segment_count_tier_values(_: str | None = None) -> Dict[str, float]:
    return dict(_PLATFORMER_PROFILE.get("segment_count_tiers") or {})


def jump_height_tiers() -> tuple[str, ...]:
    return tuple(jump_height_tier_values().keys())


def gravity_tiers() -> tuple[str, ...]:
    return tuple(gravity_tier_values().keys())


def platformer_speed_tiers() -> tuple[str, ...]:
    return tuple(platformer_speed_tier_values().keys())


def gap_size_tiers() -> tuple[str, ...]:
    return tuple(gap_size_tier_values().keys())


def obstacle_density_tiers() -> tuple[str, ...]:
    return tuple(obstacle_density_tier_values().keys())


def enemy_density_tiers() -> tuple[str, ...]:
    return tuple(enemy_density_tier_values().keys())


def segment_count_tiers() -> tuple[str, ...]:
    return tuple(segment_count_tier_values().keys())


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


def gap_size_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore gap size to standard"
    if tier == "small":
        return "make gaps smaller"
    return "make gaps larger"


def obstacle_density_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore obstacle density to standard"
    if tier == "sparse":
        return "reduce obstacle density"
    return "increase obstacle density"


def enemy_density_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore enemy density to standard"
    if tier == "low":
        return "reduce enemy density"
    return "increase enemy density"


def segment_count_tier_prompt(tier: str) -> str:
    if tier == "standard":
        return "restore segment count to standard"
    if tier == "short":
        return "make level shorter"
    return "make level longer"


def platformer_layout_restore_prompt() -> str:
    return "restore level to standard"


def platformer_level_set_restore_prompt() -> str:
    return "restore level set to standard"


def _platformer_level_profile_payload(profile_id: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "profile_id": profile_id,
        "display_name": str(profile.get("display_name") or profile_id).strip(),
        "tiers": dict(profile.get("tiers") or {}),
    }


def resolve_platformer_level_profile(
    *,
    plan_key: str | None = None,
    plan_title: str | None = None,
    prompt: str | None = None,
) -> Dict[str, Any]:
    normalized_key = str(plan_key or "").strip().lower()
    normalized_title = normalize_prompt(str(plan_title or ""))
    normalized_prompt = normalize_prompt(str(prompt or ""))
    for profile_id, profile in _PLATFORMER_LEVEL_PROFILES.items():
        plan_keys = tuple(str(value).strip().lower() for value in profile.get("plan_keys") or ())
        plan_titles = tuple(normalize_prompt(str(value)) for value in profile.get("plan_titles") or ())
        trigger_prompts = tuple(normalize_prompt(str(value)) for value in profile.get("trigger_prompts") or ())
        if normalized_key and normalized_key in plan_keys:
            return _platformer_level_profile_payload(profile_id, profile)
        if normalized_title and normalized_title in plan_titles:
            return _platformer_level_profile_payload(profile_id, profile)
        if normalized_prompt and normalized_prompt in trigger_prompts:
            return _platformer_level_profile_payload(profile_id, profile)
    return {}


def resolve_platformer_level_set(
    *,
    plan_key: str | None = None,
    plan_title: str | None = None,
    prompt: str | None = None,
) -> Dict[str, Any]:
    normalized_key = str(plan_key or "").strip().lower()
    normalized_title = normalize_prompt(str(plan_title or ""))
    normalized_prompt = normalize_prompt(str(prompt or ""))
    for level_set_id, level_set in _PLATFORMER_LEVEL_SETS.items():
        plan_keys = tuple(str(value).strip().lower() for value in level_set.get("plan_keys") or ())
        plan_titles = tuple(normalize_prompt(str(value)) for value in level_set.get("plan_titles") or ())
        trigger_prompts = tuple(normalize_prompt(str(value)) for value in level_set.get("trigger_prompts") or ())
        if normalized_key and normalized_key in plan_keys:
            return _platformer_level_set_payload(level_set_id, level_set)
        if normalized_title and normalized_title in plan_titles:
            return _platformer_level_set_payload(level_set_id, level_set)
        if normalized_prompt and normalized_prompt in trigger_prompts:
            return _platformer_level_set_payload(level_set_id, level_set)
    return {}


def resolve_platformer_level_set_by_name(name: str | None) -> Dict[str, Any]:
    normalized_name = normalize_prompt(str(name or ""))
    if not normalized_name:
        return {}
    for level_set_id, level_set in _PLATFORMER_LEVEL_SETS.items():
        display_name = normalize_prompt(str(level_set.get("display_name") or level_set_id))
        if normalized_name == display_name:
            return _platformer_level_set_payload(level_set_id, level_set)
    return {}


def _platformer_level_set_payload(level_set_id: str, level_set: Dict[str, Any]) -> Dict[str, Any]:
    profile_id = str(level_set.get("profile_id") or "").strip()
    profile = dict(_PLATFORMER_LEVEL_PROFILES.get(profile_id) or {})
    return {
        "level_set_id": level_set_id,
        "display_name": str(level_set.get("display_name") or level_set_id).strip(),
        "profile_id": profile_id,
        "profile_display_name": str(profile.get("display_name") or profile_id).strip(),
        "tiers": dict(level_set.get("tiers") or {}),
        "profile_tiers": dict(profile.get("tiers") or {}),
    }


def platformer_baseline_restore_prompts() -> tuple[str, ...]:
    return (
        jump_height_tier_prompt("standard"),
        gravity_tier_prompt("standard_gravity"),
        platformer_speed_tier_prompt("standard"),
        gap_size_tier_prompt("standard"),
        obstacle_density_tier_prompt("standard"),
        enemy_density_tier_prompt("standard"),
        segment_count_tier_prompt("standard"),
        platformer_layout_restore_prompt(),
        platformer_level_set_restore_prompt(),
    )


__all__ = [
    "DEFAULT_SUPPORTED_PLATFORMER_CONTEXT",
    "SUPPORTED_PLATFORMER_CONTEXTS",
    "detect_supported_platformer_context",
    "enemy_density_tier_prompt",
    "enemy_density_tier_values",
    "enemy_density_tiers",
    "gap_size_tier_prompt",
    "gap_size_tier_values",
    "gap_size_tiers",
    "gravity_tier_prompt",
    "gravity_tier_values",
    "gravity_tiers",
    "jump_height_tier_prompt",
    "jump_height_tier_values",
    "jump_height_tiers",
    "normalize_supported_platformer_context",
    "obstacle_density_tier_prompt",
    "obstacle_density_tier_values",
    "obstacle_density_tiers",
    "platformer_baseline_restore_prompts",
    "platformer_display_name",
    "platformer_layout_restore_prompt",
    "platformer_level_set_restore_prompt",
    "platformer_speed_tier_prompt",
    "platformer_speed_tier_values",
    "platformer_speed_tiers",
    "resolve_platformer_level_set",
    "resolve_platformer_level_set_by_name",
    "resolve_platformer_level_profile",
    "segment_count_tier_prompt",
    "segment_count_tier_values",
    "segment_count_tiers",
    "supported_platformer_contexts",
]