from __future__ import annotations

from dataclasses import dataclass

from .intent_normalizer import normalize_prompt
from .predefined_plans import PredefinedPlan, match_predefined_plan


ENVIRONMENT_THEME_MULTI_INTENT_RESOLUTION = "environment_theme_multi_intent_composition"

_UNSUPPORTED_SCOPE_TOKENS = {
    "realistic",
    "realism",
    "terrain",
    "blend",
    "flowers",
    "fog",
    "smoke",
    "debris",
    "battle",
    "battlefield",
    "crater",
    "craters",
    "paths",
}

_SUPPORTED_PROMPTS: dict[str, tuple[str, str, str, str, tuple[str, ...]]] = {
    "make the ground gravel and damaged": (
        "environment_theme_gravel_damaged_v1",
        "Apply gravel then damaged ground theme",
        "apply gravel then damaged ground theme",
        "gravel",
        ("increase gravel texture presence", "apply damaged-ground finish"),
    ),
    "apply a dirt and damaged ground theme": (
        "environment_theme_dirt_damaged_v1",
        "Apply dirt then damaged ground theme",
        "apply dirt then damaged ground theme",
        "dirt",
        ("increase dirt texture presence", "apply damaged-ground finish"),
    ),
    "apply dirt and damaged ground theme": (
        "environment_theme_dirt_damaged_v1",
        "Apply dirt then damaged ground theme",
        "apply dirt then damaged ground theme",
        "dirt",
        ("increase dirt texture presence", "apply damaged-ground finish"),
    ),
    "make the ground grassy and damaged": (
        "environment_theme_grass_damaged_v1",
        "Apply grass then damaged ground theme",
        "apply grass then damaged ground theme",
        "grass",
        ("increase grass texture presence", "apply damaged-ground finish"),
    ),
    "apply a damaged gravel ground theme": (
        "environment_theme_gravel_damaged_v1",
        "Apply gravel then damaged ground theme",
        "apply gravel then damaged ground theme",
        "gravel",
        ("increase gravel texture presence", "apply damaged-ground finish"),
    ),
    "apply damaged gravel ground theme": (
        "environment_theme_gravel_damaged_v1",
        "Apply gravel then damaged ground theme",
        "apply gravel then damaged ground theme",
        "gravel",
        ("increase gravel texture presence", "apply damaged-ground finish"),
    ),
}


@dataclass(frozen=True)
class EnvironmentThemeMultiIntentPlanResolution:
    original_prompt: str
    canonical_prompt: str
    goal_components: tuple[str, ...]
    resolution_note: str
    plan: PredefinedPlan
    resolution_source: str = ENVIRONMENT_THEME_MULTI_INTENT_RESOLUTION


def resolve_environment_theme_multi_intent_plan(prompt: str) -> EnvironmentThemeMultiIntentPlanResolution | None:
    normalized = normalize_prompt(prompt)
    definition = _SUPPORTED_PROMPTS.get(normalized)
    if definition is None:
        return None

    _, title, canonical_prompt, base_theme, goal_components = definition
    plan = match_predefined_plan(canonical_prompt)
    if plan is None:
        return None
    return EnvironmentThemeMultiIntentPlanResolution(
        original_prompt=normalized,
        canonical_prompt=canonical_prompt,
        goal_components=goal_components,
        resolution_note=(
            f'AI-E mapped the bounded compound ground-theme request "{normalized}" to the reviewed multi-intent plan '
            f'"{title}" using only the already-proven {base_theme} ground theme action and the '
            "already-proven damaged-ground theme action on Ground."
        ),
        plan=plan,
    )


def unsupported_environment_theme_multi_intent_message(prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
    if "ground" not in tokens and "terrain" not in tokens:
        return None

    has_marker = " and " in normalized
    if not has_marker:
        return None

    if tokens & _UNSUPPORTED_SCOPE_TOKENS:
        return None

    theme_tokens = {token for token in ("grass", "grassy", "dirt", "gravel", "damaged") if token in tokens}
    if len(theme_tokens) < 2:
        return None

    if resolve_environment_theme_multi_intent_plan(normalized) is not None:
        return None

    return (
        "AI-E only supports a small allowlisted set of compound ground-theme requests in this pass. "
        "Supported reviewed combinations are: 'make the ground gravel and damaged', "
        "'apply a dirt and damaged ground theme', and 'make the ground grassy and damaged'."
    )
__all__ = [
    "ENVIRONMENT_THEME_MULTI_INTENT_RESOLUTION",
    "EnvironmentThemeMultiIntentPlanResolution",
    "resolve_environment_theme_multi_intent_plan",
    "unsupported_environment_theme_multi_intent_message",
]
