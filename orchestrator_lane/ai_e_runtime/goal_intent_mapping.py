from __future__ import annotations

from dataclasses import dataclass

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
    "make zombie more dangerous": GoalIntentDefinition(
        canonical_prompt="make zombie faster and more aggressive",
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie more dangerous" to the bounded plan '
            '"make zombie faster and more aggressive".'
        ),
    ),
    "make zombie more intense": GoalIntentDefinition(
        canonical_prompt="make zombie faster and more aggressive",
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie more intense" to the bounded plan '
            '"make zombie faster and more aggressive".'
        ),
    ),
    "make zombie less dangerous": GoalIntentDefinition(
        canonical_prompt="restore zombie danger to standard",
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie less dangerous" to the bounded plan '
            '"restore zombie danger to standard".'
        ),
    ),
    "make zombie easier": GoalIntentDefinition(
        canonical_prompt="restore zombie danger to standard",
        resolution_note=(
            'AI-E mapped the gameplay goal "make zombie easier" to the bounded plan '
            '"restore zombie danger to standard".'
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

    if "smarter" in tokens:
        return (
            "AI-E does not have a supported deterministic zombie intelligence goal yet. "
            "Try something like: 'make zombie more dangerous' or 'make zombie less dangerous'."
        )

    if ("dangerous" in tokens and "less" not in tokens) or "intense" in tokens:
        if "zombie" not in tokens:
            return (
                "AI-E currently supports this combat variation plan only for the zombie system in BABYLON. "
                "Try something like: 'make zombie faster and more aggressive'."
            )

    if ("dangerous" in tokens and "less" in tokens) or "easier" in tokens:
        if "zombie" not in tokens:
            return (
                "AI-E currently supports this lower-danger plan only for the zombie system in BABYLON. "
                "Try something like: 'make zombie less dangerous'."
            )

    return None


__all__ = [
    "GOAL_INTENT_MAPPING_RESOLUTION",
    "GoalIntentResolution",
    "resolve_goal_intent_prompt",
    "unsupported_goal_intent_message",
]
