from __future__ import annotations

from typing import Any, Dict, List

from .encounter_profiles import (
    easier_encounter_prompt,
    intense_encounter_prompt,
    spawn_pressure_tier_prompt,
)
from .enemy_profiles import (
    aggression_tier_prompt,
    dangerous_prompt,
    easier_prompt,
    movement_variation_prompt,
    speed_tier_prompt,
    supported_enemy_entities,
)
from .intent_normalizer import normalize_prompt
from .tuning_contexts import (
    is_supported_encounter_context,
    is_supported_enemy_context,
    normalize_supported_tuning_context,
    supported_tuning_contexts,
)


def clarification_options_for_prompt(prompt: str) -> List[str]:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
    generalized_entity = "enemy" in tokens or "character" in tokens
    if not generalized_entity:
        return []
    if ("and" in tokens or "but" in tokens) and ("aggressive" in tokens or "dangerous" in tokens):
        return []

    if {"make", "faster"}.issubset(tokens):
        return [speed_tier_prompt(entity, "fast") for entity in supported_enemy_entities()]
    if {"make", "slower"}.issubset(tokens):
        return [speed_tier_prompt(entity, "slow") for entity in supported_enemy_entities()]
    if "aggressive" in tokens and "less" not in tokens:
        return [aggression_tier_prompt(entity, "aggressive") for entity in supported_enemy_entities()]
    if "aggressive" in tokens and "less" in tokens:
        return [aggression_tier_prompt(entity, "standard") for entity in supported_enemy_entities()]
    if ("dangerous" in tokens and "less" not in tokens) or "intense" in tokens:
        return [dangerous_prompt(entity) for entity in supported_enemy_entities()]
    if "easier" in tokens or ("dangerous" in tokens and "less" in tokens):
        return [easier_prompt(entity) for entity in supported_enemy_entities()]
    return []


def clarification_options_for_session_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
) -> List[str]:
    normalized = normalize_prompt(prompt)
    active_contexts = _active_contexts(session_state)
    if len(active_contexts) <= 1:
        return []

    options: List[str] = []
    if normalized == "make it easier":
        options.extend(
            _map_contexts(
                active_contexts,
                enemy_prompt=easier_prompt,
                encounter_prompt=easier_encounter_prompt,
                expand_enemy_choices_for_cross_context=True,
            )
        )
    elif normalized == "make it faster":
        options.extend(
            _map_contexts(
                active_contexts,
                enemy_prompt=lambda entity: speed_tier_prompt(entity, "fast"),
                encounter_prompt=lambda: spawn_pressure_tier_prompt("high"),
                expand_enemy_choices_for_cross_context=True,
            )
        )
    elif normalized == "make it slower":
        options.extend(
            _map_contexts(
                active_contexts,
                enemy_prompt=lambda entity: speed_tier_prompt(entity, "slow"),
                encounter_prompt=lambda: spawn_pressure_tier_prompt("low"),
                expand_enemy_choices_for_cross_context=True,
            )
        )
    elif normalized == "make it more aggressive":
        options.extend(
            _map_contexts(
                active_contexts,
                enemy_prompt=lambda entity: aggression_tier_prompt(entity, "aggressive"),
                encounter_prompt=intense_encounter_prompt,
                expand_enemy_choices_for_cross_context=True,
            )
        )
    elif normalized == "make it less aggressive":
        options.extend(
            _map_contexts(
                active_contexts,
                enemy_prompt=lambda entity: aggression_tier_prompt(entity, "standard"),
                encounter_prompt=easier_encounter_prompt,
                expand_enemy_choices_for_cross_context=True,
            )
        )
    elif normalized == "try another version":
        for context in active_contexts:
            if is_supported_enemy_context(context):
                variation_prompt = str(movement_variation_prompt(context) or "").strip()
                if variation_prompt:
                    options.append(variation_prompt)
    return _dedupe(options)


def _active_contexts(session_state: Dict[str, Any]) -> List[str]:
    found: List[str] = []
    history = session_state.get("session_tuning_history")
    if isinstance(history, list):
        for item in history:
            if not isinstance(item, dict):
                continue
            context = normalize_supported_tuning_context(
                item.get("target_context") or item.get("target_entity"),
                default="",
            )
            if context and context not in found:
                found.append(context)

    tuning_state = session_state.get("session_tuning_state")
    if isinstance(tuning_state, dict):
        contexts = tuning_state.get("contexts")
        if isinstance(contexts, dict):
            for raw_context in contexts.keys():
                context = normalize_supported_tuning_context(raw_context, default="")
                if context and context not in found:
                    found.append(context)
        direct_context = normalize_supported_tuning_context(
            tuning_state.get("target_context") or tuning_state.get("target_entity"),
            default="",
        )
        if direct_context and direct_context not in found:
            found.append(direct_context)

    ordered = [context for context in supported_tuning_contexts() if context in found]
    return ordered or found


def _map_contexts(
    contexts: List[str],
    *,
    enemy_prompt,
    encounter_prompt,
    expand_enemy_choices_for_cross_context: bool = False,
) -> List[str]:
    options: List[str] = []
    has_enemy = any(is_supported_enemy_context(context) for context in contexts)
    has_encounter = any(is_supported_encounter_context(context) for context in contexts)
    if expand_enemy_choices_for_cross_context and has_enemy and has_encounter:
        for entity in supported_enemy_entities():
            options.append(str(enemy_prompt(entity)).strip())
        options.append(str(encounter_prompt()).strip())
        return _dedupe(options)

    for context in contexts:
        if is_supported_enemy_context(context):
            options.append(str(enemy_prompt(context)).strip())
        elif is_supported_encounter_context(context):
            options.append(str(encounter_prompt()).strip())
    return _dedupe(options)


def _dedupe(options: List[str]) -> List[str]:
    deduped: List[str] = []
    for option in options:
        text = str(option).strip()
        if text and text not in deduped:
            deduped.append(text)
    return deduped


__all__ = [
    "clarification_options_for_prompt",
    "clarification_options_for_session_followup",
]
