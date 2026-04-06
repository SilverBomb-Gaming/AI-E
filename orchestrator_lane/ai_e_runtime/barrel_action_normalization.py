from __future__ import annotations

from dataclasses import dataclass
import re

from .intent_normalizer import normalize_prompt


_FILLER_TOKENS = {"the", "current", "a", "an"}


@dataclass(frozen=True)
class BarrelActionResolution:
    action_id: str
    canonical_prompt: str
    capability_id: str


@dataclass(frozen=True)
class _BarrelActionDefinition:
    action_id: str
    canonical_prompt: str
    capability_id: str
    aliases: tuple[str, ...]


_ACTION_DEFINITIONS = (
    _BarrelActionDefinition(
        action_id="enable_explosive_barrel_foundation",
        canonical_prompt="enable explosive barrel",
        capability_id="level_0001_enable_explosive_barrel_foundation",
        aliases=(
            "enable explosive barrel",
            "enable the explosive barrel",
            "place explosive barrel",
            "place an explosive barrel",
            "add explosive barrel",
            "add an explosive barrel",
        ),
    ),
)


def resolve_barrel_action(text: str) -> BarrelActionResolution | None:
    return _ALIAS_MAP.get(_cleanup_barrel_phrase(text))


def canonicalize_barrel_action_prompt(text: str) -> str | None:
    resolution = resolve_barrel_action(text)
    if resolution is None:
        return None
    return resolution.canonical_prompt


def supported_barrel_foundation_examples() -> str:
    return (
        "'place an explosive barrel', 'add an explosive barrel', "
        "or 'enable the explosive barrel'"
    )


def _cleanup_barrel_phrase(text: str) -> str:
    normalized = normalize_prompt(text)
    tokens = [token for token in normalized.split() if token not in _FILLER_TOKENS]
    cleaned = " ".join(tokens)
    cleaned = cleaned.replace("barrels", "barrel")
    cleaned = re.sub(r"\bplace barrel\b", "place explosive barrel", cleaned)
    cleaned = re.sub(r"\badd barrel\b", "add explosive barrel", cleaned)
    cleaned = " ".join(cleaned.split())
    return cleaned


_ALIAS_MAP = {
    _cleanup_barrel_phrase(alias): BarrelActionResolution(
        action_id=definition.action_id,
        canonical_prompt=definition.canonical_prompt,
        capability_id=definition.capability_id,
    )
    for definition in _ACTION_DEFINITIONS
    for alias in definition.aliases
}


__all__ = [
    "BarrelActionResolution",
    "canonicalize_barrel_action_prompt",
    "resolve_barrel_action",
    "supported_barrel_foundation_examples",
]
