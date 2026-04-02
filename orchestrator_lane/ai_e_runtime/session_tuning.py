from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

from .intent_normalizer import normalize_prompt


DIRECT_PROMPT_RESOLUTION = "direct_prompt"
SESSION_FOLLOWUP_RESOLUTION = "session_followup_resolution"

_SPEED_TIERS = ("slow", "standard", "fast")
_SPEED_TIER_VALUES = {
    "slow": 2.5,
    "standard": 3.5,
    "fast": 4.5,
}
_SPEED_TIER_PROMPTS = {
    "slow": "make zombie slower",
    "standard": "restore zombie speed to standard",
    "fast": "make zombie faster",
}

_AGGRESSION_TIERS = ("standard", "aggressive")
_AGGRESSION_TIER_VALUES = {
    "standard": 1.0,
    "aggressive": 0.6,
}
_AGGRESSION_TIER_PROMPTS = {
    "standard": "restore zombie aggression to standard",
    "aggressive": "make zombie more aggressive",
}

_MOVEMENT_VARIATION_PROMPT = "make zombie move differently"

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
    resulting_tier = _resulting_tier_for_details(details, family=family)
    previous_tier = _value_or_none(task.get("previous_tier")) or _previous_tier_for_details(details, family=family)
    requested_tier = _value_or_none(task.get("requested_tier")) or _requested_tier_for_details(details, family=family)

    metadata: Dict[str, Any] = {
        "resolution_source": str(task.get("resolution_source") or DIRECT_PROMPT_RESOLUTION),
        "resolved_from_prompt": str(task.get("resolved_from_prompt") or "").strip(),
        "goal_components": [str(item).strip() for item in (task.get("goal_components") or []) if str(item).strip()],
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

    requested_value, observed_value = _state_values_for_details(details, family=family)
    previous_value = _previous_value_for_details(details, family=family)
    previous_tier = _value_or_none(details.get("previous_tier")) or _tier_for_value(previous_value, family=family)
    requested_tier = _value_or_none(details.get("requested_tier")) or _tier_for_value(requested_value, family=family)
    resulting_tier = _value_or_none(details.get("resulting_tier")) or _tier_for_value(observed_value, family=family)
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
        "target_entity": "zombie",
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
    tuning_state["target_entity"] = "zombie"
    tuning_state["last_mutation"] = dict(record)
    family = str(record.get("family") or "").strip()
    if family:
        tuning_state[family] = dict(record)
    state["session_tuning_state"] = tuning_state
    return state


def _resolve_speed_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
    direction: str,
) -> tuple[SessionFollowUpResolution | None, str | None]:
    current = _latest_family_state(session_state, family="speed")
    if current is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported zombie speed change in the current session. '
            "Start with something like: 'make zombie faster'."
        )

    current_tier = str(current.get("resulting_tier") or "").strip()
    if current_tier not in _SPEED_TIERS:
        return None, (
            f'AI-E could not resolve "{prompt}" because the current zombie speed tier is not available in this session. '
            "Start with a supported speed change such as 'make zombie faster'."
        )

    if direction == "faster":
        requested_tier = _next_tier(current_tier, tiers=_SPEED_TIERS, step=1) or current_tier
    else:
        requested_tier = _next_tier(current_tier, tiers=_SPEED_TIERS, step=-1) or current_tier

    note = (
        f'AI-E resolved "{prompt}" from the current zombie speed tier '
        f"{current_tier} to {requested_tier}."
    )
    return SessionFollowUpResolution(
        original_prompt=prompt,
        canonical_prompt=_SPEED_TIER_PROMPTS[requested_tier],
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
    current = _latest_family_state(session_state, family="aggression")
    if current is None:
        return None, (
            f'AI-E can use "{prompt}" only after a supported zombie aggression change in the current session. '
            "Start with something like: 'make zombie more aggressive'."
        )

    current_tier = str(current.get("resulting_tier") or "").strip()
    if current_tier not in _AGGRESSION_TIERS:
        return None, (
            f'AI-E could not resolve "{prompt}" because the current zombie aggression tier is not available in this session. '
            "Start with a supported aggression change such as 'make zombie more aggressive'."
        )

    if direction == "more_aggressive":
        requested_tier = _next_tier(current_tier, tiers=_AGGRESSION_TIERS, step=1) or current_tier
        note = (
            f'AI-E resolved "{prompt}" from the current zombie aggression tier '
            f"{current_tier} to {requested_tier}."
        )
        return SessionFollowUpResolution(
            original_prompt=prompt,
            canonical_prompt=_AGGRESSION_TIER_PROMPTS[requested_tier],
            state_family="aggression",
            previous_tier=current_tier,
            requested_tier=requested_tier,
            resolution_note=note,
        ), None

    if current_tier == "aggressive":
        requested_tier = "standard"
        note = (
            f'AI-E resolved "{prompt}" from the current zombie aggression tier '
            f"{current_tier} to {requested_tier}."
        )
        return SessionFollowUpResolution(
            original_prompt=prompt,
            canonical_prompt=_AGGRESSION_TIER_PROMPTS[requested_tier],
            state_family="aggression",
            previous_tier=current_tier,
            requested_tier=requested_tier,
            resolution_note=note,
        ), None

    return None, (
        f'AI-E cannot use "{prompt}" right now because there is no safer deterministic zombie aggression tier below '
        f"{current_tier}. Try 'make zombie safer' if you want the broader safety plan."
    )


def _resolve_variation_followup(
    prompt: str,
    *,
    session_state: Dict[str, Any],
) -> tuple[SessionFollowUpResolution | None, str | None]:
    history = _normalized_history(session_state)
    if not history:
        return None, (
            f'AI-E can use "{prompt}" only after a supported zombie session is active. '
            "Start with something like: 'make zombie move differently'."
        )

    note = (
        f'AI-E resolved "{prompt}" from the current zombie session into the bounded movement variation route.'
    )
    movement_state = _latest_family_state(session_state, family="movement")
    previous_tier = None
    if movement_state is not None:
        previous_tier = str(movement_state.get("resulting_tier") or "").strip() or None
    return SessionFollowUpResolution(
        original_prompt=prompt,
        canonical_prompt=_MOVEMENT_VARIATION_PROMPT,
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
            "AI-E can revert only the most recent supported zombie mutation in the current session. "
            "Start with a supported zombie change first."
        )

    last_mutation = dict(history[-1])
    if not _bool_or_default(last_mutation.get("executed"), default=True):
        return None, (
            "The last supported zombie mutation was already satisfied, so there is nothing to revert."
        )

    family = str(last_mutation.get("family") or "").strip()
    current_tier = str(last_mutation.get("resulting_tier") or "").strip() or None
    previous_tier = str(last_mutation.get("previous_tier") or "").strip() or None
    if family == "speed" and previous_tier in _SPEED_TIER_PROMPTS:
        canonical_prompt = _SPEED_TIER_PROMPTS[previous_tier]
    elif family == "aggression" and previous_tier in _AGGRESSION_TIER_PROMPTS:
        canonical_prompt = _AGGRESSION_TIER_PROMPTS[previous_tier]
    else:
        return None, (
            "AI-E can only revert the latest supported zombie speed or aggression tier in the current session."
        )

    revert_summary = (
        f"Revert the last zombie {family} change from {current_tier or 'current'} back to {previous_tier}."
    )
    return SessionFollowUpResolution(
        original_prompt=prompt,
        canonical_prompt=canonical_prompt,
        state_family=family,
        previous_tier=current_tier,
        requested_tier=previous_tier,
        resolution_note=f'AI-E resolved "{prompt}" by restoring the previous supported zombie {family} tier.',
        revert_requested=True,
        revert_summary=revert_summary,
    ), None


def _normalized_history(session_state: Dict[str, Any]) -> List[Dict[str, Any]]:
    history = session_state.get("session_tuning_history")
    if not isinstance(history, list):
        return []
    return [dict(item) for item in history if isinstance(item, dict)]


def _latest_family_state(session_state: Dict[str, Any], *, family: str) -> Dict[str, Any] | None:
    tuning_state = session_state.get("session_tuning_state")
    if isinstance(tuning_state, dict):
        current = tuning_state.get(family)
        if isinstance(current, dict):
            return dict(current)
    history = _normalized_history(session_state)
    for item in reversed(history):
        if str(item.get("family") or "").strip() == family:
            return item
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
    if "move_zombie" in capability_id or "transform" in str(details.get("action_type") or "").strip().lower():
        return "movement"
    return ""


def _requested_tier_for_details(details: Dict[str, Any], *, family: str) -> str | None:
    requested_value, _ = _state_values_for_details(details, family=family)
    if family == "movement":
        return _movement_variant_for_task({}, details=details)
    return _tier_for_value(requested_value, family=family)


def _previous_tier_for_details(details: Dict[str, Any], *, family: str) -> str | None:
    previous_value = _previous_value_for_details(details, family=family)
    if family == "movement":
        return None
    return _tier_for_value(previous_value, family=family)


def _resulting_tier_for_details(details: Dict[str, Any], *, family: str) -> str | None:
    _, observed_value = _state_values_for_details(details, family=family)
    if family == "movement":
        return _movement_variant_for_task({}, details=details)
    return _tier_for_value(observed_value, family=family)


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


def _tier_for_value(value: Any, *, family: str) -> str | None:
    numeric = _float_or_none(value)
    if numeric is None:
        return None
    tier_values = _SPEED_TIER_VALUES if family == "speed" else _AGGRESSION_TIER_VALUES
    for tier, expected in tier_values.items():
        if abs(numeric - expected) <= 0.0001:
            return tier
    return None


def _movement_variant_for_task(task: Dict[str, Any], *, details: Dict[str, Any]) -> str | None:
    capability_id = str(task.get("capability_id") or "").strip().lower()
    translated_command = str(details.get("translated_command") or task.get("operator_prompt") or "").strip().lower()
    if "farther_forward" in capability_id or "farther" in translated_command:
        return "movement_variation"
    if "move_zombie_forward" in capability_id or translated_command == "move zombie forward":
        return "standard_forward"
    return None


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
