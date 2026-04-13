from __future__ import annotations

from typing import Any, Dict

from .intent_normalizer import normalize_prompt


SUPPORTED_ENEMY_ENTITIES = ("zombie", "runner")
DEFAULT_SUPPORTED_ENTITY = "zombie"

_ENEMY_PROFILES: Dict[str, Dict[str, Any]] = {
    "zombie": {
        "display_name": "zombie",
        "speed_tiers": {
            "slow": 2.5,
            "standard": 3.5,
            "fast": 4.5,
        },
        "aggression_tiers": {
            "standard": 1.0,
            "aggressive": 0.6,
        },
        "movement_variation_prompt": "make zombie move differently",
    },
    "runner": {
        "display_name": "runner",
        "speed_tiers": {
            "slow": 3.5,
            "standard": 4.5,
            "fast": 5.0,
        },
        "aggression_tiers": {
            "standard": 0.8,
            "aggressive": 0.5,
        },
        "movement_variation_prompt": None,
    },
}


def supported_enemy_entities() -> tuple[str, ...]:
    return SUPPORTED_ENEMY_ENTITIES


def is_supported_enemy_entity(entity: str | None) -> bool:
    return normalize_supported_enemy_entity(entity) in _ENEMY_PROFILES


def normalize_supported_enemy_entity(entity: str | None, *, default: str | None = None) -> str:
    normalized = normalize_prompt(str(entity or "")).strip()
    if normalized in _ENEMY_PROFILES:
        return normalized
    return str(default or "").strip()


def detect_supported_enemy_entity(*values: Any, default: str | None = DEFAULT_SUPPORTED_ENTITY) -> str:
    for value in values:
        if isinstance(value, dict):
            detected = detect_supported_enemy_entity(*value.values(), default="")
            if detected:
                return detected
            continue
        if value is None:
            continue
        normalized = normalize_prompt(str(value or ""))
        if not normalized:
            continue
        for entity in SUPPORTED_ENEMY_ENTITIES:
            if entity in normalized:
                return entity
    return normalize_supported_enemy_entity(default)


def enemy_display_name(entity: str | None) -> str:
    normalized = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    profile = _ENEMY_PROFILES.get(normalized, _ENEMY_PROFILES[DEFAULT_SUPPORTED_ENTITY])
    return str(profile.get("display_name") or normalized).strip() or DEFAULT_SUPPORTED_ENTITY


def speed_tier_values(entity: str | None) -> Dict[str, float]:
    normalized = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    profile = _ENEMY_PROFILES.get(normalized, _ENEMY_PROFILES[DEFAULT_SUPPORTED_ENTITY])
    return dict(profile.get("speed_tiers") or {})


def aggression_tier_values(entity: str | None) -> Dict[str, float]:
    normalized = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    profile = _ENEMY_PROFILES.get(normalized, _ENEMY_PROFILES[DEFAULT_SUPPORTED_ENTITY])
    return dict(profile.get("aggression_tiers") or {})


def speed_tiers(entity: str | None) -> tuple[str, ...]:
    return tuple(speed_tier_values(entity).keys())


def aggression_tiers(entity: str | None) -> tuple[str, ...]:
    return tuple(aggression_tier_values(entity).keys())


def speed_tier_prompt(entity: str | None, tier: str) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    if tier == "standard":
        return f"restore {resolved} speed to standard"
    if tier == "slow":
        return f"make {resolved} slower"
    return f"make {resolved} faster"


def aggression_tier_prompt(entity: str | None, tier: str) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    if tier == "standard":
        return f"restore {resolved} aggression to standard"
    return f"make {resolved} more aggressive"


def combat_variation_prompt(entity: str | None) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    return f"make {resolved} faster and more aggressive"


def restore_standard_danger_prompt(entity: str | None) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    return f"restore {resolved} danger to standard"


def easier_prompt(entity: str | None) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    return f"make {resolved} easier"


def less_dangerous_prompt(entity: str | None) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    return f"make {resolved} less dangerous"


def dangerous_prompt(entity: str | None) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    return f"make {resolved} more dangerous"


def intense_prompt(entity: str | None) -> str:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    return f"make {resolved} more intense"


def supports_movement_variation(entity: str | None) -> bool:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    profile = _ENEMY_PROFILES.get(resolved, _ENEMY_PROFILES[DEFAULT_SUPPORTED_ENTITY])
    return bool(profile.get("movement_variation_prompt"))


def movement_variation_prompt(entity: str | None) -> str | None:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    profile = _ENEMY_PROFILES.get(resolved, _ENEMY_PROFILES[DEFAULT_SUPPORTED_ENTITY])
    prompt = str(profile.get("movement_variation_prompt") or "").strip()
    return prompt or None


def baseline_restore_prompts(entity: str | None) -> tuple[str, ...]:
    resolved = normalize_supported_enemy_entity(entity, default=DEFAULT_SUPPORTED_ENTITY)
    prompts = [
        speed_tier_prompt(resolved, "standard"),
        aggression_tier_prompt(resolved, "standard"),
        restore_standard_danger_prompt(resolved),
        easier_prompt(resolved),
        less_dangerous_prompt(resolved),
    ]
    return tuple(dict.fromkeys(prompts))


def supported_entity_examples_for_family(family: str) -> str:
    examples = []
    for entity in SUPPORTED_ENEMY_ENTITIES:
        if family == "speed_fast":
            examples.append(f"'make {entity} faster'")
        elif family == "speed_slow":
            examples.append(f"'make {entity} slower'")
        elif family == "aggression":
            examples.append(f"'make {entity} more aggressive'")
        elif family == "combat_plan":
            examples.append(f"'{combat_variation_prompt(entity)}'")
        else:
            examples.append(f"'make {entity} faster'")
    return " or ".join(examples)


__all__ = [
    "DEFAULT_SUPPORTED_ENTITY",
    "SUPPORTED_ENEMY_ENTITIES",
    "aggression_tier_prompt",
    "aggression_tier_values",
    "aggression_tiers",
    "baseline_restore_prompts",
    "combat_variation_prompt",
    "dangerous_prompt",
    "detect_supported_enemy_entity",
    "easier_prompt",
    "enemy_display_name",
    "intense_prompt",
    "is_supported_enemy_entity",
    "less_dangerous_prompt",
    "movement_variation_prompt",
    "normalize_supported_enemy_entity",
    "restore_standard_danger_prompt",
    "speed_tier_prompt",
    "speed_tier_values",
    "speed_tiers",
    "supported_enemy_entities",
    "supported_entity_examples_for_family",
    "supports_movement_variation",
]
