from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

from .enemy_profiles import (
    aggression_tier_prompt,
    aggression_tier_values,
    aggression_tiers,
    detect_supported_enemy_entity,
    easier_prompt,
    movement_variation_prompt,
    normalize_supported_enemy_entity,
    speed_tier_prompt,
    speed_tier_values,
    speed_tiers,
    supports_movement_variation,
)
from .intent_normalizer import normalize_prompt


DIRECT_PROMPT_RESOLUTION = "direct_prompt"
SESSION_FOLLOWUP_RESOLUTION = "session_followup_resolution"

_FOLLOW_UP_PROMPTS = {
    "make it faster",
    "make it slower",
    "make it more aggressive",
    "make it less aggressive",
    "try another version",
    "revert last change",
}


@dataclass(frozen=True)
class SessionFollowUpResolution:
    original_prompt: str
    canonical_prompt: str
    state_family: str
    previous_tier: str | None
    requested_tier: str | None
    resolution_note: str
    resolution_source: str = SESSION_FOLLOWUP_RESOLUTION
    revert_requested: bool = False
    revert_summary: str | None = None


def is_session_followup_prompt(prompt: str) -> bool:
    return normalize_prompt(prompt) in _FOLLOW_UP_PROMPTS


def resolve_session_followup_prompt(
    prompt: str,
    *,
    session_state: Dict[str, Any],
) -> tuple[SessionFollowUpResolution | None, str | None]:
    normalized = normalize_prompt(prompt)
    if normalized not in _FOLLOW_UP_PROMPTS:
        return None, None

    if normalized == "make it faster":
        return _resolve_speed_followup(normalized, session_state=session_state, direction="faster")
    if normalized == "make it slower":
        return _resolve_speed_followup(normalized, session_state=session_state, direction="slower")
    if normalized == "make it more aggressive":
        return _resolve_aggression_followup(normalized, session_state=session_state, direction="more_aggressive")
    if normalized == "make it less aggressive":
        return _resolve_aggression_followup(normalized, session_state=session_state, direction="less_aggressive")
    if normalized == "try another version":
        return _resolve_variation_followup(normalized, session_state=session_state)
    if normalized == "revert last change":
        return _resolve_revert_followup(normalized, session_state=session_state)
    return None, None


def build_result_session_metadata(
    *,
    task: Dict[str, Any],
    details: Dict[str, Any],
    result_kind: str,
) -> Dict[str, Any]:
    family = _state_family_for_result_kind(result_kind)
    target_entity = _target_entity_for_task(task, details=details)
    resulting_tier = _resulting_tier_for_details(details, family=family, target_entity=target_entity)
    previous_tier = _value_or_none(task.get("previous_tier")) or _previous_tier_for_details(
        details,
        family=family,
        target_entity=target_entity,
    )
    requested_tier = _value_or_none(task.get("requested_tier")) or _requested_tier_for_details(
        details,
        family=family,
        target_entity=target_entity,
    )

    metadata: Dict[str, Any] = {
        "resolution_source": str(task.get("resolution_source") or DIRECT_PROMPT_RESOLUTION),
        "resolved_from_prompt": str(task.get("resolved_from_prompt") or "").strip(),
        "goal_components": [str(item).strip() for item in (task.get("goal_components") or []) if str(item).strip()],
        "target_entity": target_entity,
        "state_family": family,
        "previous_tier": previous_tier,
        "requested_tier": requested_tier,
        "resulting_tier": resulting_tier,
        "revert_requested": bool(task.get("revert_requested", False)),
        "revert_summary": str(task.get("revert_summary") or "").strip(),
    }
    if metadata["resolved_from_prompt"] or str(task.get("session_resolution_note") or "").strip():
        metadata["resolution_note"] = str(task.get("session_resolution_note") or "").strip()
    return metadata


def build_session_tuning_record(
    *,
    task: Dict[str, Any],
    details: Dict[str, Any],
    timestamp: str,
    order: int,
) -> Dict[str, Any] | None:
    family = _value_or_none(details.get("state_family")) or _state_family_for_task(task, details=details)
    if family not in {"speed", "aggression", "movement"}:
        return None
    target_entity = _target_entity_for_task(task, details=details)

    requested_value, observed_value = _state_values_for_details(details, family=family)
    previous_value = _previous_value_for_details(details, family=family)
    previous_tier = _value_or_none(details.get("previous_tier")) or _tier_for_value(
        previous_value,
        family=family,
        target_entity=target_entity,
    )
    requested_tier = _value_or_none(details.get("requested_tier")) or _tier_for_value(
        requested_value,
        family=family,
        target_entity=target_entity,
    )
    resulting_tier = _value_or_none(details.get("resulting_tier")) or _tier_for_value(
        observed_value,
        family=family,
        target_entity=target_entity,
    )
    if family == "movement" and resulting_tier is None:
        resulting_tier = _movement_variant_for_task(task, details=details)
        requested_tier = requested_tier or resulting_tier

    executed = _bool_or_default(details.get("executed"), default=True)
    result_reason = str(details.get("result_reason") or "applied").strip().lower() or "applied"
    canonical_prompt = str(details.get("translated_command") or task.get("operator_prompt") or "").strip()
    source_prompt = str(task.get("source_prompt") or task.get("operator_prompt") or canonical_prompt).strip()

    record = {
        "order": int(order),
        "timestamp": timestamp,
        "task_id": str(task.get("task_id") or "").strip(),
        "request_id": str(task.get("request_id") or "").strip(),
        "plan_id": str(task.get("plan_id") or "").strip(),
        "plan_title": str(task.get("plan_title") or "").strip(),
        "plan_step_title": str(task.get("plan_step_title") or task.get("title") or "").strip(),
        "capability_id": str(task.get("capability_id") or "").strip(),
        "family": family,
        "target_entity": target_entity,
        "source_prompt": source_prompt,
        "canonical_prompt": canonical_prompt,
        "requested_target_value": requested_value,
        "observed_value": observed_value,
        "executed": executed,
        "result_reason": result_reason,
        "previous_tier": previous_tier,
        "requested_tier": requested_tier,
        "resulting_tier": resulting_tier,
        "resolution_source": str(details.get("resolution_source") or DIRECT_PROMPT_RESOLUTION),
        "resolved_from_prompt": str(details.get("resolved_from_prompt") or "").strip(),
        "revert_requested": bool(details.get("revert_requested", False)),
        "revert_summary": str(details.get("revert_summary") or "").strip(),
    }
    return record


def apply_session_tuning_record(
    state: Dict[str, Any],
    *,
    task: Dict[str, Any],
    details: Dict[str, Any],
    timestamp: str,
) -> Dict[str, Any]:
    history = list(state.get("session_tuning_history", []))
    order = len(history) + 1
    record = build_session_tuning_record(task=task, details=details, timestamp=timestamp, order=order)
    if record is None:
        return state

    history.append(record)
    state["session_tuning_history"] = history

    tuning_state = dict(state.get("session_tuning_state") or {})
    target_entity = str(record.get("target_entity") or "").strip() or detect_supported_enemy_entity(record)
    entity_states = dict(tuning_state.get("entities") or {})
    current_entity_state = dict(entity_states.get(target_entity) or {})
    current_entity_state["last_mutation"] = dict(record)
    tuning_state["last_mutation"] = dict(record)
    family = str(record.get("family") or "").strip()
    if family:
        current_entity_state[family] = dict(record)
        tuning_state[family] = dict(record)
    entity_states[target_entity] = current_entity_state
    tuning_state["entities"] = entity_states
    tuning_state["target_entity"] = target_entity
    state["session_tuning_state"] = tuning_state
    return state


def _resolve_speed_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
    direction: str,
) -> tuple[SessionFollowUpResolution | None, str | None]:
    target_entity = _active_target_entity(session_state)
    if target_entity is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported enemy speed change in the current session. '
            "Start with something like: 'make zombie faster' or 'make runner faster'."
        )

    current = _latest_family_state(session_state, family="speed", target_entity=target_entity)
    if current is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported {target_entity} speed change in the current session. '
            f"Start with something like: '{speed_tier_prompt(target_entity, 'fast')}'."
        )

    current_tier = str(current.get("resulting_tier") or "").strip()
    entity_speed_tiers = speed_tiers(target_entity)
    if current_tier not in entity_speed_tiers:
        return None, (
            f'AI-E could not resolve "{prompt}" because the current {target_entity} speed tier is not available in this session. '
            f"Start with a supported speed change such as '{speed_tier_prompt(target_entity, 'fast')}'."
        )

    if direction == "faster":
        requested_tier = _next_tier(current_tier, tiers=entity_speed_tiers, step=1) or current_tier
    else:
        requested_tier = _next_tier(current_tier, tiers=entity_speed_tiers, step=-1) or current_tier

    note = (
        f'AI-E resolved "{prompt}" from the current {target_entity} speed tier '
        f"{current_tier} to {requested_tier}."
    )
    return SessionFollowUpResolution(
        original_prompt=prompt,
        canonical_prompt=speed_tier_prompt(target_entity, requested_tier),
        state_family="speed",
        previous_tier=current_tier,
        requested_tier=requested_tier,
        resolution_note=note,
    ), None


def _resolve_aggression_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
    direction: str,
) -> tuple[SessionFollowUpResolution | None, str | None]:
    target_entity = _active_target_entity(session_state)
    if target_entity is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported enemy aggression change in the current session. '
            "Start with something like: 'make zombie more aggressive' or 'make runner more aggressive'."
        )

    current = _latest_family_state(session_state, family="aggression", target_entity=target_entity)
    if current is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported {target_entity} aggression change in the current session. '
            f"Start with something like: '{aggression_tier_prompt(target_entity, 'aggressive')}'."
        )

    current_tier = str(current.get("resulting_tier") or "").strip()
    entity_aggression_tiers = aggression_tiers(target_entity)
    if current_tier not in entity_aggression_tiers:
        return None, (
            f'AI-E could not resolve "{prompt}" because the current {target_entity} aggression tier is not available in this session. '
            f"Start with a supported aggression change such as '{aggression_tier_prompt(target_entity, 'aggressive')}'."
        )

    if direction == "more_aggressive":
        requested_tier = _next_tier(current_tier, tiers=entity_aggression_tiers, step=1) or current_tier
        note = (
            f'AI-E resolved "{prompt}" from the current {target_entity} aggression tier '
            f"{current_tier} to {requested_tier}."
        )
        return SessionFollowUpResolution(
            original_prompt=prompt,
            canonical_prompt=aggression_tier_prompt(target_entity, requested_tier),
            state_family="aggression",
            previous_tier=current_tier,
            requested_tier=requested_tier,
            resolution_note=note,
        ), None

    if current_tier == "aggressive":
        requested_tier = "standard"
        note = (
            f'AI-E resolved "{prompt}" from the current {target_entity} aggression tier '
            f"{current_tier} to {requested_tier}."
        )
        return SessionFollowUpResolution(
            original_prompt=prompt,
            canonical_prompt=aggression_tier_prompt(target_entity, requested_tier),
            state_family="aggression",
            previous_tier=current_tier,
            requested_tier=requested_tier,
            resolution_note=note,
        ), None

    return None, (
        f'AI-E cannot use "{prompt}" right now because there is no safer deterministic {target_entity} aggression tier below '
        f"{current_tier}. Try '{easier_prompt(target_entity)}' if you want the broader lower-danger path."
    )


def _resolve_variation_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
) -> tuple[SessionFollowUpResolution | None, str | None]:
    history = _normalized_history(session_state)
    if not history:
        return None, (
            f'AI-E can use "{prompt}" only after a supported enemy session is active. '
            "Start with something like: 'make zombie move differently'."
        )
    target_entity = _active_target_entity(session_state)
    if target_entity is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported enemy session is active. '
            "Start with something like: 'make zombie move differently'."
        )
    if not supports_movement_variation(target_entity):
        return None, (
            f'AI-E cannot use "{prompt}" right now because there is no bounded movement-variation route for the current {target_entity} session. '
            f"Start with a direct {target_entity} tuning change such as '{speed_tier_prompt(target_entity, 'fast')}'."
        )

    note = (
        f'AI-E resolved "{prompt}" from the current {target_entity} session into the bounded movement variation route.'
    )
    movement_state = _latest_family_state(session_state, family="movement", target_entity=target_entity)
    previous_tier = None
    if movement_state is not None:
        previous_tier = str(movement_state.get("resulting_tier") or "").strip() or None
    return SessionFollowUpResolution(
        original_prompt=prompt,
        canonical_prompt=str(movement_variation_prompt(target_entity) or ""),
        state_family="movement",
        previous_tier=previous_tier,
        requested_tier="movement_variation",
        resolution_note=note,
    ), None


def _resolve_revert_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
) -> tuple[SessionFollowUpResolution | None, str | None]:
    history = _normalized_history(session_state)
    if not history:
        return None, (
            "AI-E can revert only the most recent supported enemy mutation in the current session. "
            "Start with a supported zombie or runner change first."
        )

    last_mutation = dict(history[-1])
    target_entity = str(last_mutation.get("target_entity") or _active_target_entity(session_state) or "").strip()
    if not _bool_or_default(last_mutation.get("executed"), default=True):
        return None, (
            f"The last supported {target_entity or 'enemy'} mutation was already satisfied, so there is nothing to revert."
        )

    family = str(last_mutation.get("family") or "").strip()
    current_tier = str(last_mutation.get("resulting_tier") or "").strip() or None
    previous_tier = str(last_mutation.get("previous_tier") or "").strip() or None
    if family == "speed" and previous_tier in speed_tiers(target_entity):
        canonical_prompt = speed_tier_prompt(target_entity, previous_tier)
    elif family == "aggression" and previous_tier in aggression_tiers(target_entity):
        canonical_prompt = aggression_tier_prompt(target_entity, previous_tier)
    else:
        return None, (
            f"AI-E can only revert the latest supported {target_entity or 'enemy'} speed or aggression tier in the current session."
        )

    revert_summary = (
        f"Revert the last {target_entity or 'enemy'} {family} change from {current_tier or 'current'} back to {previous_tier}."
    )
    return SessionFollowUpResolution(
        original_prompt=prompt,
        canonical_prompt=canonical_prompt,
        state_family=family,
        previous_tier=current_tier,
        requested_tier=previous_tier,
        resolution_note=f'AI-E resolved "{prompt}" by restoring the previous supported {target_entity or "enemy"} {family} tier.',
        revert_requested=True,
        revert_summary=revert_summary,
    ), None


def _normalized_history(session_state: Dict[str, Any]) -> List[Dict[str, Any]]:
    history = session_state.get("session_tuning_history")
    if not isinstance(history, list):
        return []
    return [dict(item) for item in history if isinstance(item, dict)]


def _latest_family_state(
    session_state: Dict[str, Any],
    *,
    family: str,
    target_entity: str | None = None,
) -> Dict[str, Any] | None:
    tuning_state = session_state.get("session_tuning_state")
    if isinstance(tuning_state, dict):
        if target_entity:
            entities = tuning_state.get("entities")
            if isinstance(entities, dict):
                entity_state = entities.get(target_entity)
                if isinstance(entity_state, dict):
                    current = entity_state.get(family)
                    if isinstance(current, dict):
                        return dict(current)
        current = tuning_state.get(family)
        if isinstance(current, dict):
            current_entity = str(current.get("target_entity") or "").strip()
            if not target_entity or current_entity == target_entity:
                return dict(current)
    history = _normalized_history(session_state)
    for item in reversed(history):
        if str(item.get("family") or "").strip() != family:
            continue
        if target_entity and str(item.get("target_entity") or "").strip() != target_entity:
            continue
        return item
    return None


def _active_target_entity(session_state: Dict[str, Any]) -> str | None:
    tuning_state = session_state.get("session_tuning_state")
    if isinstance(tuning_state, dict):
        target_entity = normalize_supported_enemy_entity(
            tuning_state.get("target_entity"),
            default="",
        )
        if target_entity:
            return target_entity
        last_mutation = tuning_state.get("last_mutation")
        if isinstance(last_mutation, dict):
            detected = normalize_supported_enemy_entity(last_mutation.get("target_entity"), default="")
            if detected:
                return detected
    history = _normalized_history(session_state)
    if history:
        detected = normalize_supported_enemy_entity(history[-1].get("target_entity"), default="")
        if detected:
            return detected
    return None


def _state_family_for_result_kind(result_kind: str) -> str:
    if result_kind == "speed":
        return "speed"
    if result_kind == "aggression":
        return "aggression"
    return "movement"


def _state_family_for_task(task: Dict[str, Any], *, details: Dict[str, Any]) -> str:
    family = _value_or_none(details.get("state_family"))
    if family:
        return family
    capability_id = str(task.get("capability_id") or "").strip().lower()
    if "speed" in capability_id:
        return "speed"
    if "aggression" in capability_id:
        return "aggression"
    if ("move_zombie" in capability_id or "move_runner" in capability_id) or "transform" in str(
        details.get("action_type") or ""
    ).strip().lower():
        return "movement"
    return ""


def _requested_tier_for_details(details: Dict[str, Any], *, family: str, target_entity: str | None) -> str | None:
    requested_value, _ = _state_values_for_details(details, family=family)
    if family == "movement":
        return _movement_variant_for_task({}, details=details)
    return _tier_for_value(requested_value, family=family, target_entity=target_entity)


def _previous_tier_for_details(details: Dict[str, Any], *, family: str, target_entity: str | None) -> str | None:
    previous_value = _previous_value_for_details(details, family=family)
    if family == "movement":
        return None
    return _tier_for_value(previous_value, family=family, target_entity=target_entity)


def _resulting_tier_for_details(details: Dict[str, Any], *, family: str, target_entity: str | None) -> str | None:
    _, observed_value = _state_values_for_details(details, family=family)
    if family == "movement":
        return _movement_variant_for_task({}, details=details)
    return _tier_for_value(observed_value, family=family, target_entity=target_entity)


def _state_values_for_details(details: Dict[str, Any], *, family: str) -> tuple[Any, Any]:
    if family == "speed":
        return details.get("requested_speed"), details.get("new_speed")
    if family == "aggression":
        return details.get("requested_attack_cooldown"), details.get("new_attack_cooldown")
    return details.get("new_position"), details.get("new_position")


def _previous_value_for_details(details: Dict[str, Any], *, family: str) -> Any:
    if family == "speed":
        return details.get("previous_speed")
    if family == "aggression":
        return details.get("previous_attack_cooldown")
    return details.get("previous_position")


def _tier_for_value(value: Any, *, family: str, target_entity: str | None) -> str | None:
    numeric = _float_or_none(value)
    if numeric is None:
        return None
    tier_values = speed_tier_values(target_entity) if family == "speed" else aggression_tier_values(target_entity)
    for tier, expected in tier_values.items():
        if abs(numeric - expected) <= 0.0001:
            return tier
    return None


def _movement_variant_for_task(task: Dict[str, Any], *, details: Dict[str, Any]) -> str | None:
    capability_id = str(task.get("capability_id") or "").strip().lower()
    translated_command = str(details.get("translated_command") or task.get("operator_prompt") or "").strip().lower()
    if "farther_forward" in capability_id or "farther" in translated_command:
        return "movement_variation"
    if "move_zombie_forward" in capability_id or "move_runner_forward" in capability_id or translated_command in {
        "move zombie forward",
        "move runner forward",
    }:
        return "standard_forward"
    return None


def _target_entity_for_task(task: Dict[str, Any], *, details: Dict[str, Any]) -> str:
    return detect_supported_enemy_entity(
        details.get("target_entity"),
        details.get("entity_type"),
        details.get("translated_command"),
        details.get("matched_prompt_pattern"),
        details.get("object_name"),
        task.get("target_entity"),
        task.get("source_prompt"),
        task.get("operator_prompt"),
        task.get("capability_id"),
    )


def _next_tier(current_tier: str, *, tiers: Iterable[str], step: int) -> str | None:
    ordered = list(tiers)
    try:
        index = ordered.index(current_tier)
    except ValueError:
        return None
    next_index = index + int(step)
    if next_index < 0 or next_index >= len(ordered):
        return current_tier
    return ordered[next_index]


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _bool_or_default(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _value_or_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


__all__ = [
    "DIRECT_PROMPT_RESOLUTION",
    "SESSION_FOLLOWUP_RESOLUTION",
    "SessionFollowUpResolution",
    "apply_session_tuning_record",
    "build_result_session_metadata",
    "is_session_followup_prompt",
    "resolve_session_followup_prompt",
]
