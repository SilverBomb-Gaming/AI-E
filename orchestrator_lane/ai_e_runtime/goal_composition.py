from __future__ import annotations

from dataclasses import dataclass

from .enemy_profiles import combat_variation_prompt
from .intent_normalizer import normalize_prompt


GOAL_COMPOSITION_RESOLUTION = "goal_composition"


@dataclass(frozen=True)
class GoalCompositionResolution:
    original_prompt: str
    canonical_prompt: str
    goal_components: tuple[str, ...]
    resolution_note: str
    resolution_source: str = GOAL_COMPOSITION_RESOLUTION


@dataclass(frozen=True)
class GoalCompositionDefinition:
    canonical_prompt: str
    goal_components: tuple[str, ...]
    resolution_note: str


_GOAL_COMPOSITION_MAPPINGS = {
    "make zombie faster and more aggressive": GoalCompositionDefinition(
        canonical_prompt="make zombie faster and more aggressive",
        goal_components=("increase zombie speed", "increase zombie aggression"),
        resolution_note=(
            'AI-E combined the gameplay goals "faster" and "more aggressive" into the bounded '
            'plan "make zombie faster and more aggressive".'
        ),
    ),
    "make runner faster and more aggressive": GoalCompositionDefinition(
        canonical_prompt="make runner faster and more aggressive",
        goal_components=("increase runner speed", "increase runner aggression"),
        resolution_note=(
            'AI-E combined the gameplay goals "faster" and "more aggressive" into the bounded '
            'plan "make runner faster and more aggressive".'
        ),
    ),
    "make zombie faster but less aggressive": GoalCompositionDefinition(
        canonical_prompt="make zombie faster but less aggressive",
        goal_components=("increase zombie speed", "decrease zombie aggression"),
        resolution_note=(
            'AI-E combined the gameplay goals "faster" and "less aggressive" into the bounded '
            'plan "make zombie faster but less aggressive".'
        ),
    ),
    "make zombie faster and less aggressive": GoalCompositionDefinition(
        canonical_prompt="make zombie faster but less aggressive",
        goal_components=("increase zombie speed", "decrease zombie aggression"),
        resolution_note=(
            'AI-E combined the gameplay goals "faster" and "less aggressive" into the bounded '
            'plan "make zombie faster but less aggressive".'
        ),
    ),
    "make zombie less dangerous and slower": GoalCompositionDefinition(
        canonical_prompt="make zombie less dangerous and slower",
        goal_components=("restore zombie aggression to standard", "decrease zombie speed"),
        resolution_note=(
            'AI-E combined the gameplay goals "less dangerous" and "slower" into the bounded '
            'plan "make zombie less dangerous and slower".'
        ),
    ),
    "make zombie easier and slower": GoalCompositionDefinition(
        canonical_prompt="make zombie less dangerous and slower",
        goal_components=("restore zombie aggression to standard", "decrease zombie speed"),
        resolution_note=(
            'AI-E combined the gameplay goals "easier" and "slower" into the bounded '
            'plan "make zombie less dangerous and slower".'
        ),
    ),
}


def resolve_goal_composition_prompt(prompt: str) -> GoalCompositionResolution | None:
    normalized = normalize_prompt(prompt)
    definition = _GOAL_COMPOSITION_MAPPINGS.get(normalized)
    if definition is None:
        return None
    return GoalCompositionResolution(
        original_prompt=normalized,
        canonical_prompt=definition.canonical_prompt,
        goal_components=definition.goal_components,
        resolution_note=definition.resolution_note,
    )


def unsupported_goal_composition_message(prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
    generalized_entity = _generalized_entity_label(tokens)

    if " and " not in normalized and " but " not in normalized:
        return None

    if "zombie" not in tokens and "runner" not in tokens and _mentions_supported_goal_terms(normalized):
        if generalized_entity:
            return (
                f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                "Name the supported target explicitly. Try something like: "
                "'make zombie faster but less aggressive', 'make zombie faster and more aggressive', "
                "or 'make runner faster and more aggressive'."
            )
        return (
            "AI-E currently supports this composed gameplay goal only for the zombie or runner systems in BABYLON. "
            f"Try something like: '{combat_variation_prompt('zombie')}' or '{combat_variation_prompt('runner')}'."
        )

    if "faster" in tokens and "slower" in tokens:
        entity_label = "runner" if "runner" in tokens else "zombie"
        return (
            f"AI-E cannot combine conflicting {entity_label} speed goals in one bounded request. "
            f"Try either 'make {entity_label} faster' or 'make {entity_label} slower'."
        )

    if _mentions_higher_aggression(normalized) and _mentions_lower_aggression(normalized):
        entity_label = "runner" if "runner" in tokens else "zombie"
        return (
            f"AI-E cannot combine conflicting {entity_label} aggression goals in one bounded request. "
            f"Try either 'make {entity_label} more aggressive' or 'make {entity_label} less aggressive'."
        )

    if "smarter" in tokens and _mentions_supported_goal_terms(normalized):
        entity_label = "runner" if "runner" in tokens else "zombie"
        return (
            f"AI-E does not support combining {entity_label} intelligence goals with bounded combat tuning yet. "
            f"Try something like: '{combat_variation_prompt(entity_label)}'."
        )

    if ("zombie" in tokens or "runner" in tokens) and _mentions_supported_goal_terms(normalized):
        entity_label = "runner" if "runner" in tokens else "zombie"
        return (
            f"AI-E does not support this {entity_label} goal combination yet. "
            f"Try something like: '{combat_variation_prompt(entity_label)}'"
            + (" or 'make zombie faster but less aggressive'." if entity_label == "zombie" else ".")
        )

    return None


def _mentions_higher_aggression(prompt: str) -> bool:
    return any(phrase in prompt for phrase in ("more aggressive", "more dangerous", "more intense"))


def _mentions_lower_aggression(prompt: str) -> bool:
    return any(phrase in prompt for phrase in ("less aggressive", "less dangerous", "easier"))


def _mentions_supported_goal_terms(prompt: str) -> bool:
    return (
        "faster" in prompt
        or "slower" in prompt
        or _mentions_higher_aggression(prompt)
        or _mentions_lower_aggression(prompt)
    )


def _generalized_entity_label(tokens: set[str]) -> str:
    for candidate in ("enemy", "character"):
        if candidate in tokens:
            return candidate
    return ""


__all__ = [
    "GOAL_COMPOSITION_RESOLUTION",
    "GoalCompositionResolution",
    "resolve_goal_composition_prompt",
    "unsupported_goal_composition_message",
]
