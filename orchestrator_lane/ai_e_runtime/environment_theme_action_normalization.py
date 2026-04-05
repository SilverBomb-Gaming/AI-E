from __future__ import annotations

from dataclasses import dataclass
import re

from .intent_normalizer import normalize_prompt


_FILLER_TOKENS = {"the", "current", "a", "an"}


@dataclass(frozen=True)
class EnvironmentThemeActionResolution:
    action_id: str
    canonical_prompt: str
    capability_id: str


@dataclass(frozen=True)
class _EnvironmentThemeActionDefinition:
    action_id: str
    canonical_prompt: str
    capability_id: str
    aliases: tuple[str, ...]


_ACTION_DEFINITIONS = (
    _EnvironmentThemeActionDefinition(
        action_id="apply_grass_ground_theme",
        canonical_prompt="apply grass ground theme",
        capability_id="level_0001_apply_grass_ground_theme",
        aliases=(
            "apply grass ground theme",
            "apply grassy ground theme",
            "make ground grassy",
            "make the ground grassy",
        ),
    ),
    _EnvironmentThemeActionDefinition(
        action_id="apply_dirt_ground_theme",
        canonical_prompt="apply dirt ground theme",
        capability_id="level_0001_apply_dirt_ground_theme",
        aliases=(
            "apply dirt ground theme",
            "apply a dirt ground theme",
            "make ground dirt",
            "make the ground dirt",
            "change ground to dirt",
            "change the ground to dirt",
        ),
    ),
)


def resolve_environment_theme_action(text: str) -> EnvironmentThemeActionResolution | None:
    return _ALIAS_MAP.get(_cleanup_environment_theme_phrase(text))


def canonicalize_environment_theme_action_prompt(text: str) -> str | None:
    resolution = resolve_environment_theme_action(text)
    if resolution is None:
        return None
    return resolution.canonical_prompt


def _cleanup_environment_theme_phrase(text: str) -> str:
    normalized = normalize_prompt(text)
    tokens = [token for token in normalized.split() if token not in _FILLER_TOKENS]
    cleaned = " ".join(tokens)
    cleaned = cleaned.replace(" for level", "")
    cleaned = re.sub(r"\bgrassy ground\b", "grass ground", cleaned)
    cleaned = re.sub(r"\bground to dirt\b", "ground dirt", cleaned)
    cleaned = " ".join(cleaned.split())
    return cleaned


_ALIAS_MAP = {
    _cleanup_environment_theme_phrase(alias): EnvironmentThemeActionResolution(
        action_id=definition.action_id,
        canonical_prompt=definition.canonical_prompt,
        capability_id=definition.capability_id,
    )
    for definition in _ACTION_DEFINITIONS
    for alias in definition.aliases
}


__all__ = [
    "EnvironmentThemeActionResolution",
    "canonicalize_environment_theme_action_prompt",
    "resolve_environment_theme_action",
]