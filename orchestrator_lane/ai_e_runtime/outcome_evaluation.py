from __future__ import annotations

from typing import Any, Dict, List

from .encounter_profiles import encounter_count_tier_values, spawn_pressure_tier_values
from .enemy_profiles import aggression_tier_values, speed_tier_values
from .experiment_tracking import find_experiment_by_id, find_variant_for_task
from .tuning_contexts import (
    detect_supported_tuning_context,
    is_supported_encounter_context,
    is_supported_enemy_context,
    tuning_context_display_name,
)


EVALUATION_SOURCE = "deterministic_rules"

_SPEED_ORDER = {
    "slow": 0,
    "standard": 1,
    "fast": 2,
}
_AGGRESSION_ORDER = {
    "standard": 0,
    "aggressive": 1,
}
_ENCOUNTER_COUNT_ORDER = {
    "low": 0,
    "standard": 1,
    "high": 2,
}
_SPAWN_PRESSURE_ORDER = {
    "low": 0,
    "standard": 1,
    "high": 2,
}


def apply_result_evaluation(
    state: Dict[str, Any],
    *,
    task: Dict[str, Any],
    timestamp: str,
) -> Dict[str, Any]:
    if not _is_result_boundary(task):
        return state

    result_state_history = list(state.get("result_state_history", []))
    snapshot = _build_result_snapshot(
        state,
        task=task,
        timestamp=timestamp,
        order=len(result_state_history) + 1,
    )
    previous_snapshot = result_state_history[-1] if result_state_history else None
    evaluation = _evaluate_snapshots(
        previous_snapshot=previous_snapshot,
        current_snapshot=snapshot,
        history=result_state_history,
    )
    if evaluation:
        evaluation_entry = {
            "order": snapshot["order"],
            "timestamp": timestamp,
            "task_id": snapshot["task_id"],
            "request_id": snapshot["request_id"],
            "plan_id": snapshot["plan_id"],
            "plan_title": snapshot["plan_title"],
            **evaluation,
        }
        snapshot["evaluation"] = dict(evaluation_entry)
        evaluation_history = list(state.get("result_evaluation_history", []))
        evaluation_history.append(evaluation_entry)
        state["result_evaluation_history"] = evaluation_history
        state["latest_result_evaluation"] = dict(evaluation_entry)
    else:
        snapshot["evaluation"] = {}
        state["latest_result_evaluation"] = {}

    result_state_history.append(snapshot)
    state["result_state_history"] = result_state_history
    return state


def _is_result_boundary(task: Dict[str, Any]) -> bool:
    total_steps = _int_or_default(task.get("plan_total_steps"), default=1)
    step_index = _int_or_default(task.get("plan_step_index"), default=1)
    if total_steps <= 1:
        return True
    return step_index == total_steps


def _build_result_snapshot(
    state: Dict[str, Any],
    *,
    task: Dict[str, Any],
    timestamp: str,
    order: int,
) -> Dict[str, Any]:
    tuning_state = state.get("session_tuning_state")
    if not isinstance(tuning_state, dict):
        tuning_state = {}

    experiment_variant = find_variant_for_task(
        state,
        task_id=str(task.get("task_id") or "").strip(),
        request_id=str(task.get("request_id") or "").strip(),
        plan_id=str(task.get("plan_id") or "").strip(),
    )
    experiment = find_experiment_by_id(
        state,
        experiment_id=str(experiment_variant.get("experiment_id") or "").strip(),
    )
    target_context = detect_supported_tuning_context(
        experiment_variant.get("target_context"),
        experiment_variant.get("target_entity"),
        task.get("operator_prompt"),
        task.get("source_prompt"),
    )
    speed_record = _family_record(tuning_state, family="speed", target_context=target_context)
    aggression_record = _family_record(tuning_state, family="aggression", target_context=target_context)
    movement_record = _family_record(tuning_state, family="movement", target_context=target_context)
    count_record = _family_record(tuning_state, family="encounter_count", target_context=target_context)
    pressure_record = _family_record(tuning_state, family="spawn_pressure", target_context=target_context)

    speed_tier = str(speed_record.get("resulting_tier") or "").strip()
    aggression_tier = str(aggression_record.get("resulting_tier") or "").strip()
    movement_tier = str(movement_record.get("resulting_tier") or "").strip() or None
    movement_target_z = _movement_target_z(movement_record)
    encounter_count_tier = str(count_record.get("resulting_tier") or "").strip()
    spawn_pressure_tier = str(pressure_record.get("resulting_tier") or "").strip()

    speed_defaults = speed_tier_values(target_context) if is_supported_enemy_context(target_context) else {}
    aggression_defaults = aggression_tier_values(target_context) if is_supported_enemy_context(target_context) else {}
    encounter_count_defaults = encounter_count_tier_values() if is_supported_encounter_context(target_context) else {}
    spawn_pressure_defaults = spawn_pressure_tier_values() if is_supported_encounter_context(target_context) else {}

    return {
        "order": int(order),
        "timestamp": str(timestamp or "").strip(),
        "task_id": str(task.get("task_id") or "").strip(),
        "request_id": str(task.get("request_id") or "").strip(),
        "plan_id": str(task.get("plan_id") or "").strip(),
        "plan_title": str(task.get("plan_title") or "").strip(),
        "source_prompt": str(task.get("source_prompt") or task.get("operator_prompt") or "").strip(),
        "canonical_prompt": str(task.get("operator_prompt") or "").strip(),
        "resolution_source": str(task.get("resolution_source") or "").strip(),
        "resolved_from_prompt": str(task.get("resolved_from_prompt") or "").strip(),
        "target_entity": target_context,
        "target_context": target_context,
        "speed_tier": speed_tier,
        "speed_value": _float_or_default(speed_record.get("observed_value"), speed_defaults.get(speed_tier)),
        "aggression_tier": aggression_tier,
        "aggression_value": _float_or_default(
            aggression_record.get("observed_value"),
            aggression_defaults.get(aggression_tier),
        ),
        "movement_tier": movement_tier,
        "movement_target_z": movement_target_z,
        "encounter_count_tier": encounter_count_tier,
        "encounter_count_value": _float_or_default(
            count_record.get("observed_value"),
            encounter_count_defaults.get(encounter_count_tier),
        ),
        "spawn_pressure_tier": spawn_pressure_tier,
        "spawn_pressure_value": _float_or_default(
            pressure_record.get("observed_value"),
            spawn_pressure_defaults.get(spawn_pressure_tier),
        ),
        "experiment_id": str(experiment_variant.get("experiment_id") or "").strip(),
        "variant_id": str(experiment_variant.get("variant_id") or "").strip(),
        "parent_variant_id": str(experiment_variant.get("parent_variant_id") or "").strip(),
        "baseline_variant_id": str(experiment_variant.get("baseline_variant_id") or "").strip(),
        "preferred_baseline_variant_id": str(
            experiment.get("preferred_baseline_variant_id")
            or experiment_variant.get("preferred_baseline_variant_id")
            or ""
        ).strip(),
        "baseline_marker": bool(experiment_variant.get("baseline_marker")),
        "variant_kind": str(experiment_variant.get("variant_kind") or "").strip(),
    }


def _evaluate_snapshots(
    *,
    previous_snapshot: Dict[str, Any] | None,
    current_snapshot: Dict[str, Any],
    history: List[Dict[str, Any]],
) -> Dict[str, Any] | None:
    comparison_snapshot = previous_snapshot if isinstance(previous_snapshot, dict) else None
    current_experiment_id = str(current_snapshot.get("experiment_id") or "").strip()
    if comparison_snapshot is not None and current_experiment_id:
        if str(comparison_snapshot.get("experiment_id") or "").strip() != current_experiment_id:
            comparison_snapshot = _previous_snapshot_for_experiment(
                history,
                experiment_id=current_experiment_id,
                current_order=_int_or_default(current_snapshot.get("order"), 0),
            )

    if not isinstance(comparison_snapshot, dict):
        return None

    comparison_entries = _comparison_entries(comparison_snapshot, current_snapshot)
    summary = _build_structured_comparison_summary(
        comparison_entries,
        reference_label="previous version",
        state_section_label="Current state vs previous version",
        inline_key_differences=False,
    )
    experiment_fields = _experiment_comparison_fields(
        previous_snapshot=comparison_snapshot,
        current_snapshot=current_snapshot,
        history=history,
    )

    return {
        "evaluation_source": EVALUATION_SOURCE,
        "comparison_description": summary,
        "detected_differences": [entry["delta"] for entry in comparison_entries],
        "suggestion": "",
        **experiment_fields,
    }


def _experiment_comparison_fields(
    *,
    previous_snapshot: Dict[str, Any] | None,
    current_snapshot: Dict[str, Any],
    history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    experiment_id = str(current_snapshot.get("experiment_id") or "").strip()
    current_variant_id = str(current_snapshot.get("variant_id") or "").strip()
    previous_variant_id = str(previous_snapshot.get("variant_id") or "").strip() if isinstance(previous_snapshot, dict) else ""
    baseline_variant_id = str(current_snapshot.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(current_snapshot.get("preferred_baseline_variant_id") or "").strip()
    baseline_marker = bool(current_snapshot.get("baseline_marker"))
    variant_kind = str(current_snapshot.get("variant_kind") or "").strip()

    fields: Dict[str, Any] = {
        "experiment_id": experiment_id,
        "variant_id": current_variant_id,
        "previous_variant_id": previous_variant_id,
        "baseline_variant_id": baseline_variant_id,
        "preferred_baseline_variant_id": preferred_baseline_variant_id,
        "baseline_marker": baseline_marker,
        "variant_kind": variant_kind,
        "compared_against_variant_id": "",
        "experiment_comparison_description": "",
    }
    if not experiment_id or not current_variant_id:
        return fields

    if previous_variant_id and str(previous_snapshot.get("experiment_id") or "").strip() != experiment_id:
        previous_snapshot = None
        previous_variant_id = ""

    comparison_snapshot = previous_snapshot if isinstance(previous_snapshot, dict) else None
    compared_against_variant_id = previous_variant_id
    compared_label = (
        f"Variant {previous_variant_id.split('_')[-1].lstrip('0') or '0'}"
        if previous_variant_id
        else "the previous related variant"
    )

    if (
        preferred_baseline_variant_id
        and preferred_baseline_variant_id != current_variant_id
        and preferred_baseline_variant_id != previous_variant_id
    ):
        preferred_baseline_snapshot = _snapshot_by_variant_id(
            history,
            experiment_id=experiment_id,
            variant_id=preferred_baseline_variant_id,
        )
        if isinstance(preferred_baseline_snapshot, dict) and preferred_baseline_snapshot:
            comparison_snapshot = {**current_snapshot, **preferred_baseline_snapshot}
            comparison_snapshot["movement_target_z"] = _baseline_movement_target(
                preferred_baseline_snapshot,
                current_snapshot=current_snapshot,
            )
            compared_against_variant_id = preferred_baseline_variant_id
            compared_label = "the preferred baseline"
    if (
        compared_against_variant_id == previous_variant_id
        and baseline_variant_id
        and baseline_variant_id != current_variant_id
        and baseline_variant_id != previous_variant_id
    ):
        baseline_snapshot = _snapshot_by_variant_id(
            history,
            experiment_id=experiment_id,
            variant_id=baseline_variant_id,
        )
        if isinstance(baseline_snapshot, dict) and baseline_snapshot:
            comparison_snapshot = {**current_snapshot, **baseline_snapshot}
            comparison_snapshot["movement_target_z"] = _baseline_movement_target(
                baseline_snapshot,
                current_snapshot=current_snapshot,
            )
            compared_against_variant_id = baseline_variant_id
            compared_label = "the baseline"

    if comparison_snapshot is None:
        return fields

    comparison_entries = _comparison_entries(comparison_snapshot, current_snapshot)
    if compared_label in {"the baseline", "the preferred baseline"}:
        state_section_label = "Current variant vs baseline"
    else:
        state_section_label = f"Current variant vs {_normalize_reference_label(compared_label)}"

    description = _build_structured_comparison_summary(
        comparison_entries,
        reference_label=compared_label,
        state_section_label=state_section_label,
        inline_key_differences=True,
    )
    fields["compared_against_variant_id"] = compared_against_variant_id
    fields["experiment_comparison_description"] = description
    return fields


def _compare_speed(previous_snapshot: Dict[str, Any], current_snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
    previous_tier = str(previous_snapshot.get("speed_tier") or "").strip()
    current_tier = str(current_snapshot.get("speed_tier") or "").strip()
    if previous_tier not in _SPEED_ORDER or current_tier not in _SPEED_ORDER or previous_tier == current_tier:
        return None
    if _SPEED_ORDER[current_tier] > _SPEED_ORDER[previous_tier]:
        impact = "Higher movement speed."
        sign = 1
    else:
        impact = "Lower movement speed."
        sign = -1
    return {
        "attribute": "Speed",
        "current_display": current_tier,
        "previous_display": previous_tier,
        "delta": f"Speed: {previous_tier} -> {current_tier}",
        "impact": impact,
        "sign": sign,
    }


def _compare_aggression(previous_snapshot: Dict[str, Any], current_snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
    previous_tier = str(previous_snapshot.get("aggression_tier") or "").strip()
    current_tier = str(current_snapshot.get("aggression_tier") or "").strip()
    if (
        previous_tier not in _AGGRESSION_ORDER
        or current_tier not in _AGGRESSION_ORDER
        or previous_tier == current_tier
    ):
        return None
    if _AGGRESSION_ORDER[current_tier] > _AGGRESSION_ORDER[previous_tier]:
        impact = "Shorter attack cooldown."
        sign = 1
    else:
        impact = "Longer attack cooldown."
        sign = -1
    return {
        "attribute": "Aggression",
        "current_display": current_tier,
        "previous_display": previous_tier,
        "delta": f"Aggression: {previous_tier} -> {current_tier}",
        "impact": impact,
        "sign": sign,
    }


def _compare_movement(previous_snapshot: Dict[str, Any], current_snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
    previous_target = _float_or_none(previous_snapshot.get("movement_target_z"))
    current_target = _float_or_none(current_snapshot.get("movement_target_z"))
    previous_tier = str(previous_snapshot.get("movement_tier") or "").strip()
    current_tier = str(current_snapshot.get("movement_tier") or "").strip()

    if previous_target is not None and current_target is not None and abs(previous_target - current_target) > 0.0001:
        if current_target > previous_target:
            impact = "Moves farther forward along the same path."
        else:
            impact = "Moves a shorter forward distance."
        return {
            "attribute": "Movement target",
            "current_display": f"Z={current_target:g}",
            "previous_display": f"Z={previous_target:g}",
            "delta": f"Movement target: Z={previous_target:g} -> Z={current_target:g}",
            "impact": impact,
            "sign": 0,
        }

    if previous_tier and current_tier and previous_tier != current_tier:
        if current_tier == "movement_variation":
            return {
                "attribute": "Movement path",
                "current_display": _movement_path_label(current_tier),
                "previous_display": _movement_path_label(previous_tier),
                "delta": f"Movement path: {_movement_path_label(previous_tier)} -> {_movement_path_label(current_tier)}",
                "impact": "Uses the movement variation path.",
                "sign": 0,
            }
        return {
            "attribute": "Movement path",
            "current_display": _movement_path_label(current_tier),
            "previous_display": _movement_path_label(previous_tier),
            "delta": f"Movement path: {_movement_path_label(previous_tier)} -> {_movement_path_label(current_tier)}",
            "impact": "Uses the standard forward path.",
            "sign": 0,
        }

    return None


def _compare_encounter_count(previous_snapshot: Dict[str, Any], current_snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
    previous_tier = str(previous_snapshot.get("encounter_count_tier") or "").strip()
    current_tier = str(current_snapshot.get("encounter_count_tier") or "").strip()
    if (
        previous_tier not in _ENCOUNTER_COUNT_ORDER
        or current_tier not in _ENCOUNTER_COUNT_ORDER
        or previous_tier == current_tier
    ):
        return None
    previous_count = _float_or_none(previous_snapshot.get("encounter_count_value"))
    current_count = _float_or_none(current_snapshot.get("encounter_count_value"))
    previous_display = _format_count_display(previous_count, fallback=previous_tier)
    current_display = _format_count_display(current_count, fallback=current_tier)
    if _ENCOUNTER_COUNT_ORDER[current_tier] > _ENCOUNTER_COUNT_ORDER[previous_tier]:
        impact = "More enemies per encounter."
        sign = 1
    else:
        impact = "Fewer enemies per encounter."
        sign = -1
    return {
        "attribute": "Spawn count",
        "current_display": current_display,
        "previous_display": previous_display,
        "delta": f"Spawn count: {previous_display} -> {current_display}",
        "impact": impact,
        "sign": sign,
    }


def _compare_spawn_pressure(previous_snapshot: Dict[str, Any], current_snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
    previous_tier = str(previous_snapshot.get("spawn_pressure_tier") or "").strip()
    current_tier = str(current_snapshot.get("spawn_pressure_tier") or "").strip()
    if (
        previous_tier not in _SPAWN_PRESSURE_ORDER
        or current_tier not in _SPAWN_PRESSURE_ORDER
        or previous_tier == current_tier
    ):
        return None
    previous_interval = _float_or_none(previous_snapshot.get("spawn_pressure_value"))
    current_interval = _float_or_none(current_snapshot.get("spawn_pressure_value"))
    previous_display = _format_seconds_display(previous_interval, fallback=previous_tier)
    current_display = _format_seconds_display(current_interval, fallback=current_tier)
    if _SPAWN_PRESSURE_ORDER[current_tier] > _SPAWN_PRESSURE_ORDER[previous_tier]:
        delta = f"Spawn interval: {previous_display} -> {current_display} (higher pressure)"
        impact = "Spawn interval is shorter, which increases pressure."
        sign = 1
    else:
        delta = f"Spawn interval: {previous_display} -> {current_display} (lower pressure)"
        impact = "Spawn interval is longer, which reduces pressure."
        sign = -1
    return {
        "attribute": "Spawn interval",
        "current_display": current_display,
        "previous_display": previous_display,
        "delta": delta,
        "impact": impact,
        "sign": sign,
    }


def _comparison_entries(
    previous_snapshot: Dict[str, Any],
    current_snapshot: Dict[str, Any],
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for comparator in (
        _compare_speed,
        _compare_aggression,
        _compare_movement,
        _compare_encounter_count,
        _compare_spawn_pressure,
    ):
        entry = comparator(previous_snapshot, current_snapshot)
        if isinstance(entry, dict):
            entries.append(entry)
    return entries


def _build_structured_comparison_summary(
    comparison_entries: List[Dict[str, Any]],
    *,
    reference_label: str,
    state_section_label: str,
    inline_key_differences: bool,
) -> str:
    if comparison_entries:
        what_changed = f"{_join_attribute_labels(entry['attribute'] for entry in comparison_entries)} changed."
        state_lines = [
            f"{entry['attribute']}: {entry['current_display']} vs {entry['previous_display']}"
            for entry in comparison_entries
        ]
        difference_lines = [entry["delta"] for entry in comparison_entries]
        impact_lines = _dedupe_lines(entry["impact"] for entry in comparison_entries)
    else:
        normalized_reference = _normalize_reference_label(reference_label)
        what_changed = "No supported deterministic differences were detected."
        state_lines = [f"Supported deterministic checks match {normalized_reference}."]
        difference_lines = ["No explicit deltas were recorded."]
        impact_lines = ["No deterministic gameplay-impact change detected."]

    if inline_key_differences:
        key_difference_text = "\n".join(difference_lines)
    else:
        key_difference_text = "See explicit deltas below." if comparison_entries else difference_lines[0]

    return "\n\n".join(
        [
            f"What changed\n{what_changed}",
            f"{state_section_label}\n" + "\n".join(state_lines),
            f"Key differences\n{key_difference_text}",
            "Expected gameplay impact\n" + "\n".join(impact_lines),
        ]
    )


def _join_attribute_labels(labels: Any) -> str:
    values = [str(label).strip() for label in labels if str(label).strip()]
    if not values:
        return "Supported deterministic state"
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} and {values[1].lower()}"
    return f"{', '.join(values[:-1])}, and {values[-1].lower()}"


def _dedupe_lines(lines: Any) -> List[str]:
    ordered: List[str] = []
    seen: set[str] = set()
    for line in lines:
        text = str(line).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered


def _normalize_reference_label(reference_label: str) -> str:
    text = str(reference_label or "").strip()
    if not text:
        return "the compared state"
    if text.startswith("the "):
        return text
    return text


def _movement_path_label(tier: str) -> str:
    text = str(tier or "").strip()
    if text == "movement_variation":
        return "movement variation"
    if text == "standard_forward":
        return "standard forward"
    return text.replace("_", " ")


def _format_count_display(value: float | None, *, fallback: str) -> str:
    if value is None:
        return str(fallback or "").strip()
    rounded = round(value)
    if abs(value - rounded) < 0.0001:
        return str(int(rounded))
    return f"{value:g}"


def _format_seconds_display(value: float | None, *, fallback: str) -> str:
    if value is None:
        return str(fallback or "").strip()
    return f"{value:.1f}s"


def _family_record(tuning_state: Dict[str, Any], *, family: str, target_context: str) -> Dict[str, Any]:
    contexts = tuning_state.get("contexts")
    if isinstance(contexts, dict):
        context_state = contexts.get(target_context)
        if isinstance(context_state, dict):
            record = context_state.get(family)
            if isinstance(record, dict):
                return dict(record)
    entities = tuning_state.get("entities")
    if isinstance(entities, dict):
        entity_state = entities.get(target_context)
        if isinstance(entity_state, dict):
            record = entity_state.get(family)
            if isinstance(record, dict):
                return dict(record)
    record = tuning_state.get(family)
    if isinstance(record, dict) and str(record.get("target_context") or record.get("target_entity") or "").strip() == target_context:
        return dict(record)
    return {}


def _movement_target_z(record: Dict[str, Any]) -> float | None:
    observed_value = record.get("observed_value")
    if isinstance(observed_value, list) and len(observed_value) >= 3:
        return _float_or_none(observed_value[2])
    return None


def _baseline_movement_target(baseline_variant: Dict[str, Any], *, current_snapshot: Dict[str, Any]) -> float | None:
    observed_value = baseline_variant.get("movement_value")
    if isinstance(observed_value, list) and len(observed_value) >= 3:
        return _float_or_none(observed_value[2])
    target = _float_or_none(baseline_variant.get("movement_target_z"))
    if target is not None:
        return target
    return _float_or_none(current_snapshot.get("movement_target_z"))


def _previous_snapshot_for_experiment(
    history: List[Dict[str, Any]],
    *,
    experiment_id: str,
    current_order: int,
) -> Dict[str, Any]:
    for snapshot in reversed(history):
        if not isinstance(snapshot, dict):
            continue
        if str(snapshot.get("experiment_id") or "").strip() != experiment_id:
            continue
        if _int_or_default(snapshot.get("order"), 0) >= current_order:
            continue
        return snapshot
    return {}


def _snapshot_by_variant_id(
    history: List[Dict[str, Any]],
    *,
    experiment_id: str,
    variant_id: str,
) -> Dict[str, Any]:
    for snapshot in history:
        if not isinstance(snapshot, dict):
            continue
        if str(snapshot.get("experiment_id") or "").strip() != experiment_id:
            continue
        if str(snapshot.get("variant_id") or "").strip() == variant_id:
            return snapshot
    return {}


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _float_or_default(value: Any, default: float | None) -> float | None:
    numeric = _float_or_none(value)
    if numeric is not None:
        return numeric
    return default


__all__ = [
    "EVALUATION_SOURCE",
    "apply_result_evaluation",
]
