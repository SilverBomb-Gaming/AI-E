from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from .encounter_profiles import (
    encounter_count_tier_prompt,
    encounter_count_tier_values,
    spawn_pressure_tier_prompt,
    spawn_pressure_tier_values,
)
from .enemy_profiles import (
    aggression_tier_prompt,
    aggression_tier_values,
    speed_tier_prompt,
    speed_tier_values,
)
from .intent_normalizer import normalize_prompt
from .racing_profiles import (
    acceleration_tier_prompt,
    acceleration_tier_values,
    max_speed_tier_prompt,
    max_speed_tier_values,
)
from .platformer_profiles import (
    enemy_density_tier_prompt,
    enemy_density_tier_values,
    gap_size_tier_prompt,
    gap_size_tier_values,
    gravity_tier_prompt,
    gravity_tier_values,
    jump_height_tier_prompt,
    jump_height_tier_values,
    obstacle_density_tier_prompt,
    obstacle_density_tier_values,
    platformer_speed_tier_prompt,
    platformer_speed_tier_values,
    segment_count_tier_prompt,
    segment_count_tier_values,
)
from .tuning_contexts import detect_supported_tuning_context


@dataclass(frozen=True)
class GenericCapabilityDefinition:
    target_context: str
    target_system: str
    parameter_family: str
    parameter_name: str
    bounded_tiers: tuple[str, ...]
    deterministic_values: Dict[str, float | int]
    restore_standard_behavior: str
    evaluation_dimension: str
    source_family: str

    def to_payload(self) -> Dict[str, Any]:
        return {
            "target_context": self.target_context,
            "target_system": self.target_system,
            "parameter_family": self.parameter_family,
            "parameter_name": self.parameter_name,
            "bounded_tiers": list(self.bounded_tiers),
            "deterministic_values": dict(self.deterministic_values),
            "restore_standard_behavior": self.restore_standard_behavior,
            "evaluation_dimension": self.evaluation_dimension,
            "source_family": self.source_family,
        }


def generic_capability_definition(target_context: str | None, family: str | None) -> Dict[str, Any]:
    resolved_context = detect_supported_tuning_context(target_context, default="")
    resolved_family = normalize_prompt(str(family or "")).replace(" ", "_")
    definition = _GENERIC_CAPABILITY_DEFINITIONS.get((resolved_context, resolved_family))
    if definition is None:
        return {}
    return definition.to_payload()


def generic_capability_definition_for_capability_id(capability_id: str | None) -> Dict[str, Any]:
    normalized = normalize_prompt(str(capability_id or "")).replace(" ", "_")
    if not normalized:
        return {}

    family = ""
    if "spawn_pressure" in normalized:
        family = "spawn_pressure"
        target_context = "encounter"
    elif "encounter_count" in normalized:
        family = "encounter_count"
        target_context = "encounter"
    elif "acceleration" in normalized:
        family = "acceleration"
        target_context = "racer"
    elif "max_speed" in normalized or ("max" in normalized and "speed" in normalized and "racer" in normalized):
        family = "max_speed"
        target_context = "racer"
    elif "jump_height" in normalized or ("jump" in normalized and any(token in normalized for token in ("higher", "lower", "standard"))):
        family = "jump_height"
        target_context = "platformer"
    elif "gravity" in normalized:
        family = "gravity"
        target_context = "platformer"
    elif "gap_size" in normalized or ("gap" in normalized and any(token in normalized for token in ("larger", "smaller", "standard"))):
        family = "gap_size"
        target_context = "platformer"
    elif "obstacle_density" in normalized or ("obstacle" in normalized and "density" in normalized):
        family = "obstacle_density"
        target_context = "platformer"
    elif "enemy_density" in normalized or ("enemy" in normalized and "density" in normalized):
        family = "enemy_density"
        target_context = "platformer"
    elif "segment_count" in normalized or ("level" in normalized and any(token in normalized for token in ("longer", "shorter", "standard"))):
        family = "segment_count"
        target_context = "platformer"
    elif "platformer" in normalized and "speed" in normalized:
        family = "speed"
        target_context = "platformer"
    elif "aggression" in normalized:
        family = "aggression"
        target_context = detect_supported_tuning_context(normalized, default="")
    elif "speed" in normalized:
        family = "speed"
        target_context = detect_supported_tuning_context(normalized, default="")
    else:
        target_context = detect_supported_tuning_context(normalized, default="")
    if not target_context:
        return {}
    return generic_capability_definition(target_context, family)


def build_generic_capability_state(
    *,
    target_context: str | None,
    speed_tier: str = "",
    speed_value: Any = None,
    aggression_tier: str = "",
    aggression_value: Any = None,
    encounter_count_tier: str = "",
    encounter_count_value: Any = None,
    spawn_pressure_tier: str = "",
    spawn_pressure_value: Any = None,
    jump_height_tier: str = "",
    jump_height_value: Any = None,
    gravity_tier: str = "",
    gravity_value: Any = None,
    gap_size_tier: str = "",
    gap_size_value: Any = None,
    obstacle_density_tier: str = "",
    obstacle_density_value: Any = None,
    enemy_density_tier: str = "",
    enemy_density_value: Any = None,
    segment_count_tier: str = "",
    segment_count_value: Any = None,
    acceleration_tier: str = "",
    acceleration_value: Any = None,
    max_speed_tier: str = "",
    max_speed_value: Any = None,
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for family, tier, value in (
        ("speed", speed_tier, speed_value),
        ("aggression", aggression_tier, aggression_value),
        ("encounter_count", encounter_count_tier, encounter_count_value),
        ("spawn_pressure", spawn_pressure_tier, spawn_pressure_value),
        ("jump_height", jump_height_tier, jump_height_value),
        ("gravity", gravity_tier, gravity_value),
        ("gap_size", gap_size_tier, gap_size_value),
        ("obstacle_density", obstacle_density_tier, obstacle_density_value),
        ("enemy_density", enemy_density_tier, enemy_density_value),
        ("segment_count", segment_count_tier, segment_count_value),
        ("acceleration", acceleration_tier, acceleration_value),
        ("max_speed", max_speed_tier, max_speed_value),
    ):
        definition = generic_capability_definition(target_context, family)
        if not definition:
            continue
        current_tier = str(tier or "").strip()
        current_value = _float_or_int_or_none(value)
        if not current_tier and current_value is None:
            continue
        entries.append({**definition, "current_tier": current_tier, "current_value": current_value})
    return entries


def supported_generic_capability_mappings() -> List[Dict[str, Any]]:
    return [definition.to_payload() for definition in _GENERIC_CAPABILITY_DEFINITIONS.values()]


def _float_or_int_or_none(value: Any) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric.is_integer():
        return int(numeric)
    return numeric


_GENERIC_CAPABILITY_DEFINITIONS: Dict[tuple[str, str], GenericCapabilityDefinition] = {
    ("zombie", "speed"): GenericCapabilityDefinition(
        target_context="zombie",
        target_system="movement",
        parameter_family="speed",
        parameter_name="speed",
        bounded_tiers=tuple(speed_tier_values("zombie").keys()),
        deterministic_values=speed_tier_values("zombie"),
        restore_standard_behavior=speed_tier_prompt("zombie", "standard"),
        evaluation_dimension="movement_speed",
        source_family="speed",
    ),
    ("zombie", "aggression"): GenericCapabilityDefinition(
        target_context="zombie",
        target_system="combat",
        parameter_family="aggression",
        parameter_name="aggression",
        bounded_tiers=tuple(aggression_tier_values("zombie").keys()),
        deterministic_values=aggression_tier_values("zombie"),
        restore_standard_behavior=aggression_tier_prompt("zombie", "standard"),
        evaluation_dimension="combat_aggression",
        source_family="aggression",
    ),
    ("runner", "speed"): GenericCapabilityDefinition(
        target_context="runner",
        target_system="movement",
        parameter_family="speed",
        parameter_name="speed",
        bounded_tiers=tuple(speed_tier_values("runner").keys()),
        deterministic_values=speed_tier_values("runner"),
        restore_standard_behavior=speed_tier_prompt("runner", "standard"),
        evaluation_dimension="movement_speed",
        source_family="speed",
    ),
    ("runner", "aggression"): GenericCapabilityDefinition(
        target_context="runner",
        target_system="combat",
        parameter_family="aggression",
        parameter_name="aggression",
        bounded_tiers=tuple(aggression_tier_values("runner").keys()),
        deterministic_values=aggression_tier_values("runner"),
        restore_standard_behavior=aggression_tier_prompt("runner", "standard"),
        evaluation_dimension="combat_aggression",
        source_family="aggression",
    ),
    ("encounter", "encounter_count"): GenericCapabilityDefinition(
        target_context="encounter",
        target_system="encounter",
        parameter_family="spawn_count",
        parameter_name="spawn_count",
        bounded_tiers=tuple(encounter_count_tier_values().keys()),
        deterministic_values=encounter_count_tier_values(),
        restore_standard_behavior=encounter_count_tier_prompt("standard"),
        evaluation_dimension="spawn_count",
        source_family="encounter_count",
    ),
    ("encounter", "spawn_pressure"): GenericCapabilityDefinition(
        target_context="encounter",
        target_system="encounter",
        parameter_family="spawn_interval",
        parameter_name="spawn_interval",
        bounded_tiers=tuple(spawn_pressure_tier_values().keys()),
        deterministic_values=spawn_pressure_tier_values(),
        restore_standard_behavior=spawn_pressure_tier_prompt("standard"),
        evaluation_dimension="spawn_interval",
        source_family="spawn_pressure",
    ),
    ("platformer", "jump_height"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="movement",
        parameter_family="jump_height",
        parameter_name="jump_height",
        bounded_tiers=tuple(jump_height_tier_values().keys()),
        deterministic_values=jump_height_tier_values(),
        restore_standard_behavior=jump_height_tier_prompt("standard"),
        evaluation_dimension="movement_jump_height",
        source_family="jump_height",
    ),
    ("platformer", "gravity"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="physics",
        parameter_family="gravity",
        parameter_name="gravity",
        bounded_tiers=tuple(gravity_tier_values().keys()),
        deterministic_values=gravity_tier_values(),
        restore_standard_behavior=gravity_tier_prompt("standard_gravity"),
        evaluation_dimension="physics_gravity",
        source_family="gravity",
    ),
    ("platformer", "speed"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="movement",
        parameter_family="speed",
        parameter_name="speed",
        bounded_tiers=tuple(platformer_speed_tier_values().keys()),
        deterministic_values=platformer_speed_tier_values(),
        restore_standard_behavior=platformer_speed_tier_prompt("standard"),
        evaluation_dimension="movement_speed",
        source_family="speed",
    ),
    ("platformer", "gap_size"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="layout",
        parameter_family="gap_size",
        parameter_name="gap_size",
        bounded_tiers=tuple(gap_size_tier_values().keys()),
        deterministic_values=gap_size_tier_values(),
        restore_standard_behavior=gap_size_tier_prompt("standard"),
        evaluation_dimension="layout_gap_size",
        source_family="gap_size",
    ),
    ("platformer", "obstacle_density"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="layout",
        parameter_family="obstacle_density",
        parameter_name="obstacle_density",
        bounded_tiers=tuple(obstacle_density_tier_values().keys()),
        deterministic_values=obstacle_density_tier_values(),
        restore_standard_behavior=obstacle_density_tier_prompt("standard"),
        evaluation_dimension="layout_obstacle_density",
        source_family="obstacle_density",
    ),
    ("platformer", "enemy_density"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="encounter",
        parameter_family="enemy_density",
        parameter_name="enemy_density",
        bounded_tiers=tuple(enemy_density_tier_values().keys()),
        deterministic_values=enemy_density_tier_values(),
        restore_standard_behavior=enemy_density_tier_prompt("standard"),
        evaluation_dimension="encounter_enemy_density",
        source_family="enemy_density",
    ),
    ("platformer", "segment_count"): GenericCapabilityDefinition(
        target_context="platformer",
        target_system="layout",
        parameter_family="segment_count",
        parameter_name="segment_count",
        bounded_tiers=tuple(segment_count_tier_values().keys()),
        deterministic_values=segment_count_tier_values(),
        restore_standard_behavior=segment_count_tier_prompt("standard"),
        evaluation_dimension="layout_segment_count",
        source_family="segment_count",
    ),
    ("racer", "acceleration"): GenericCapabilityDefinition(
        target_context="racer",
        target_system="movement",
        parameter_family="acceleration",
        parameter_name="acceleration",
        bounded_tiers=tuple(acceleration_tier_values().keys()),
        deterministic_values=acceleration_tier_values(),
        restore_standard_behavior=acceleration_tier_prompt("standard"),
        evaluation_dimension="movement_acceleration",
        source_family="acceleration",
    ),
    ("racer", "max_speed"): GenericCapabilityDefinition(
        target_context="racer",
        target_system="movement",
        parameter_family="max_speed",
        parameter_name="max_speed",
        bounded_tiers=tuple(max_speed_tier_values().keys()),
        deterministic_values=max_speed_tier_values(),
        restore_standard_behavior=max_speed_tier_prompt("standard"),
        evaluation_dimension="movement_max_speed",
        source_family="max_speed",
    ),
}


__all__ = [
    "GenericCapabilityDefinition",
    "build_generic_capability_state",
    "generic_capability_definition",
    "generic_capability_definition_for_capability_id",
    "supported_generic_capability_mappings",
]