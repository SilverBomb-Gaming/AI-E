from __future__ import annotations

from dataclasses import dataclass

from .encounter_profiles import (
    easier_encounter_prompt,
    intense_encounter_prompt,
    restore_standard_encounter_prompt,
)
from .enemy_profiles import (
    combat_variation_prompt,
    dangerous_prompt,
    easier_prompt,
    intense_prompt,
    less_dangerous_prompt,
    restore_standard_danger_prompt,
)
from .intent_normalizer import normalize_prompt


GOAL_INTENT_MAPPING_RESOLUTION = "goal_intent_mapping"


@dataclass(frozen=True)
class GoalIntentResolution:
    original_prompt: str
    canonical_prompt: str
    resolution_note: str
    resolution_source: str = GOAL_INTENT_MAPPING_RESOLUTION


@dataclass(frozen=True)
class GoalIntentDefinition:
    canonical_prompt: str
    resolution_note: str


_GOAL_INTENT_MAPPINGS = {
    dangerous_prompt("zombie"): GoalIntentDefinition(
        canonical_prompt=combat_variation_prompt("zombie"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie more dangerous" to the bounded plan '
            '"make zombie faster and more aggressive".'
        ),
    ),
    intense_prompt("zombie"): GoalIntentDefinition(
        canonical_prompt=combat_variation_prompt("zombie"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie more intense" to the bounded plan '
            '"make zombie faster and more aggressive".'
        ),
    ),
    less_dangerous_prompt("zombie"): GoalIntentDefinition(
        canonical_prompt=restore_standard_danger_prompt("zombie"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie less dangerous" to the bounded plan '
            '"restore zombie danger to standard".'
        ),
    ),
    easier_prompt("zombie"): GoalIntentDefinition(
        canonical_prompt=restore_standard_danger_prompt("zombie"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie easier" to the bounded plan '
            '"restore zombie danger to standard".'
        ),
    ),
    dangerous_prompt("runner"): GoalIntentDefinition(
        canonical_prompt=combat_variation_prompt("runner"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make runner more dangerous" to the bounded plan '
            '"make runner faster and more aggressive".'
        ),
    ),
    intense_prompt("runner"): GoalIntentDefinition(
        canonical_prompt=combat_variation_prompt("runner"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make runner more intense" to the bounded plan '
            '"make runner faster and more aggressive".'
        ),
    ),
    less_dangerous_prompt("runner"): GoalIntentDefinition(
        canonical_prompt=restore_standard_danger_prompt("runner"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make runner less dangerous" to the bounded plan '
            '"restore runner danger to standard".'
        ),
    ),
    easier_prompt("runner"): GoalIntentDefinition(
        canonical_prompt=restore_standard_danger_prompt("runner"),
        resolution_note=(
            'AI-E mapped the gameplay goal "make runner easier" to the bounded plan '
            '"restore runner danger to standard".'
        ),
    ),
    intense_encounter_prompt(): GoalIntentDefinition(
        canonical_prompt="increase encounter intensity",
        resolution_note=(
            'AI-E mapped the gameplay goal "make encounter more intense" to the bounded plan '
            '"increase encounter intensity".'
        ),
    ),
    easier_encounter_prompt(): GoalIntentDefinition(
        canonical_prompt="decrease encounter intensity",
        resolution_note=(
            'AI-E mapped the gameplay goal "make encounter easier" to the bounded plan '
            '"decrease encounter intensity".'
        ),
    ),
    restore_standard_encounter_prompt(): GoalIntentDefinition(
        canonical_prompt="restore encounter to standard",
        resolution_note=(
            'AI-E mapped the gameplay goal "restore encounter to standard" to the bounded plan '
            '"restore encounter to standard".'
        ),
    ),
    "reduce spawn pressure": GoalIntentDefinition(
        canonical_prompt="decrease spawn pressure",
        resolution_note=(
            'AI-E mapped the gameplay goal "reduce spawn pressure" to the bounded deterministic request '
            '"decrease spawn pressure".'
        ),
    ),
}


def resolve_goal_intent_prompt(prompt: str) -> GoalIntentResolution | None:
    normalized = normalize_prompt(prompt)
    definition = _GOAL_INTENT_MAPPINGS.get(normalized)
    if definition is None:
        return None
    return GoalIntentResolution(
        original_prompt=normalized,
        canonical_prompt=definition.canonical_prompt,
        resolution_note=definition.resolution_note,
    )


def unsupported_goal_intent_message(prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
    generalized_entity = _generalized_entity_label(tokens)

    if "smarter" in tokens:
        if "encounter" in tokens:
            return (
                "AI-E does not have a supported deterministic encounter intelligence goal yet. "
                "Try something like: 'make encounter more intense', 'make encounter easier', "
                "or 'restore encounter to standard'."
            )
        return (
            "AI-E does not have a supported deterministic enemy intelligence goal yet. "
            "Try something like: 'make zombie more dangerous', 'make runner more dangerous', "
            "or 'make runner easier'."
        )

    if "encounter" in tokens:
        if "intense" in tokens:
            return (
                "AI-E currently supports bounded encounter goals only through the predefined encounter intensity routes. "
                "Try something like: 'make encounter more intense'."
            )
        if "easier" in tokens:
            return (
                "AI-E currently supports bounded encounter easing only through the predefined encounter intensity routes. "
                "Try something like: 'make encounter easier'."
            )
        if "standard" in tokens:
            return (
                "AI-E currently supports bounded encounter restoration through the predefined standard restore route. "
                "Try something like: 'restore encounter to standard'."
            )

    if ("dangerous" in tokens and "less" not in tokens) or "intense" in tokens:
        if "zombie" not in tokens and "runner" not in tokens:
            if generalized_entity:
                return (
                    f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                    "Name the supported target explicitly. Try something like: "
                    "'make zombie more dangerous' or 'make runner more dangerous'."
                )
            return (
                "AI-E currently supports this combat variation plan only for the zombie or runner systems in BABYLON. "
                "Try something like: 'make zombie faster and more aggressive' or 'make runner faster and more aggressive'."
            )

    if ("dangerous" in tokens and "less" in tokens) or "easier" in tokens:
        if "zombie" not in tokens and "runner" not in tokens:
            if generalized_entity:
                return (
                    f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                    "Name the supported target explicitly. Try something like: "
                    "'make zombie easier' or 'make runner easier'."
                )
            return (
                "AI-E currently supports this lower-danger plan only for the zombie or runner systems in BABYLON. "
                "Try something like: 'make zombie less dangerous' or 'make runner easier'."
            )

    return None


def _generalized_entity_label(tokens: set[str]) -> str:
    for candidate in ("enemy", "character"):
        if candidate in tokens:
            return candidate
    return ""


__all__ = [
    "GOAL_INTENT_MAPPING_RESOLUTION",
    "GoalIntentResolution",
    "resolve_goal_intent_prompt",
    "unsupported_goal_intent_message",
]
