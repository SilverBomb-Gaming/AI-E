from __future__ import annotations

from typing import Any, Dict, List

from .experiment_tracking import find_experiment_by_id, find_variant_for_task


EVALUATION_SOURCE = "deterministic_rules"

_SPEED_ORDER = {
    "slow": 0,
    "standard": 1,
    "fast": 2,
}
_SPEED_BASELINE_VALUE = {
    "slow": 2.5,
    "standard": 3.5,
    "fast": 4.5,
}
_AGGRESSION_ORDER = {
    "standard": 0,
    "aggressive": 1,
}
_AGGRESSION_BASELINE_VALUE = {
    "standard": 1.0,
    "aggressive": 0.6,
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

    speed_record = _family_record(tuning_state, family="speed")
    aggression_record = _family_record(tuning_state, family="aggression")
    movement_record = _family_record(tuning_state, family="movement")

    speed_tier = str(speed_record.get("resulting_tier") or "standard").strip() or "standard"
    aggression_tier = str(aggression_record.get("resulting_tier") or "standard").strip() or "standard"
    movement_tier = str(movement_record.get("resulting_tier") or "").strip() or None
    movement_target_z = _movement_target_z(movement_record)
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
        "speed_tier": speed_tier,
        "speed_value": _float_or_default(speed_record.get("observed_value"), _SPEED_BASELINE_VALUE.get(speed_tier)),
        "aggression_tier": aggression_tier,
        "aggression_value": _float_or_default(
            aggression_record.get("observed_value"),
            _AGGRESSION_BASELINE_VALUE.get(aggression_tier),
        ),
        "movement_tier": movement_tier,
        "movement_target_z": movement_target_z,
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
    if not isinstance(previous_snapshot, dict):
        return None

    summary_terms: List[str] = []
    summary_signs: List[int] = []
    differences: List[str] = []

    speed_term = _compare_speed(previous_snapshot, current_snapshot)
    if speed_term is not None:
        summary_terms.append(speed_term["summary"])
        summary_signs.append(speed_term["sign"])
        differences.append(speed_term["detail"])

    aggression_term = _compare_aggression(previous_snapshot, current_snapshot)
    if aggression_term is not None:
        summary_terms.append(aggression_term["summary"])
        summary_signs.append(aggression_term["sign"])
        differences.append(aggression_term["detail"])

    movement_term = _compare_movement(previous_snapshot, current_snapshot)
    if movement_term is not None:
        summary_terms.append(movement_term["summary"])
        summary_signs.append(movement_term["sign"])
        differences.append(movement_term["detail"])

    if not summary_terms:
        summary = "Current zombie matches the previous version across the supported deterministic state checks."
    else:
        summary = _build_comparison_summary(summary_terms, summary_signs)

    suggestion = _deterministic_suggestion(summary_terms=summary_terms, differences=differences)
    experiment_fields = _experiment_comparison_fields(
        previous_snapshot=previous_snapshot,
        current_snapshot=current_snapshot,
        history=history,
    )

    return {
        "evaluation_source": EVALUATION_SOURCE,
        "comparison_description": summary,
        "detected_differences": differences,
        "suggestion": suggestion,
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
            comparison_snapshot = {
                **current_snapshot,
                "speed_tier": str(preferred_baseline_snapshot.get("speed_tier") or current_snapshot.get("speed_tier") or "").strip(),
                "aggression_tier": str(preferred_baseline_snapshot.get("aggression_tier") or current_snapshot.get("aggression_tier") or "").strip(),
                "movement_tier": str(preferred_baseline_snapshot.get("movement_tier") or current_snapshot.get("movement_tier") or "").strip(),
                "movement_target_z": _baseline_movement_target(preferred_baseline_snapshot, current_snapshot=current_snapshot),
            }
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
            comparison_snapshot = {
                **current_snapshot,
                "speed_tier": str(baseline_snapshot.get("speed_tier") or current_snapshot.get("speed_tier") or "").strip(),
                "aggression_tier": str(baseline_snapshot.get("aggression_tier") or current_snapshot.get("aggression_tier") or "").strip(),
                "movement_tier": str(baseline_snapshot.get("movement_tier") or current_snapshot.get("movement_tier") or "").strip(),
                "movement_target_z": _baseline_movement_target(baseline_snapshot, current_snapshot=current_snapshot),
            }
            compared_against_variant_id = baseline_variant_id
            compared_label = "the baseline"

    if comparison_snapshot is None:
        return fields

    summary_terms: List[str] = []
    summary_signs: List[int] = []
    speed_term = _compare_speed(comparison_snapshot, current_snapshot)
    if speed_term is not None:
        summary_terms.append(speed_term["summary"])
        summary_signs.append(speed_term["sign"])
    aggression_term = _compare_aggression(comparison_snapshot, current_snapshot)
    if aggression_term is not None:
        summary_terms.append(aggression_term["summary"])
        summary_signs.append(aggression_term["sign"])
    movement_term = _compare_movement(comparison_snapshot, current_snapshot)
    if movement_term is not None:
        summary_terms.append(movement_term["summary"])
        summary_signs.append(movement_term["sign"])

    current_label = f"Variant {current_variant_id.split('_')[-1].lstrip('0') or '0'}"
    if not summary_terms:
        description = f"{current_label} matches {compared_label} across the supported deterministic checks."
    else:
        description = _build_experiment_summary(
            current_label=current_label,
            compared_label=compared_label,
            summary_terms=summary_terms,
            summary_signs=summary_signs,
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
        return {
            "summary": "faster",
            "detail": f"Speed tier changed from {previous_tier} to {current_tier}.",
            "sign": 1,
        }
    return {
        "summary": "slower",
        "detail": f"Speed tier changed from {previous_tier} to {current_tier}.",
        "sign": -1,
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
        return {
            "summary": "more aggressive",
            "detail": f"Aggression tier changed from {previous_tier} to {current_tier}.",
            "sign": 1,
        }
    return {
        "summary": "less aggressive",
        "detail": f"Aggression tier changed from {previous_tier} to {current_tier}.",
        "sign": -1,
    }


def _compare_movement(previous_snapshot: Dict[str, Any], current_snapshot: Dict[str, Any]) -> Dict[str, Any] | None:
    previous_target = _float_or_none(previous_snapshot.get("movement_target_z"))
    current_target = _float_or_none(current_snapshot.get("movement_target_z"))
    previous_tier = str(previous_snapshot.get("movement_tier") or "").strip()
    current_tier = str(current_snapshot.get("movement_tier") or "").strip()

    if previous_target is not None and current_target is not None and abs(previous_target - current_target) > 0.0001:
        if current_target > previous_target:
            summary = "moves farther forward"
        else:
            summary = "moves less far forward"
        return {
            "summary": summary,
            "detail": f"Movement target changed from Z={previous_target:g} to Z={current_target:g}.",
            "sign": 0,
        }

    if previous_tier and current_tier and previous_tier != current_tier:
        if current_tier == "movement_variation":
            return {
                "summary": "uses the movement variation path",
                "detail": f"Movement path changed from {previous_tier} to {current_tier}.",
                "sign": 0,
            }
        return {
            "summary": "uses the standard forward path",
            "detail": f"Movement path changed from {previous_tier} to {current_tier}.",
            "sign": 0,
        }

    return None


def _build_comparison_summary(summary_terms: List[str], summary_signs: List[int]) -> str:
    if len(summary_terms) == 1:
        term = summary_terms[0]
        if term.startswith("moves ") or term.startswith("uses "):
            return f"Current zombie {term} than previous version."
        return f"Current zombie is {term} than previous version."

    connector = " and "
    non_zero_signs = {sign for sign in summary_signs if sign != 0}
    if len(non_zero_signs) > 1:
        connector = " but "

    if len(summary_terms) == 2:
        first, second = summary_terms
        if first.startswith("moves ") or first.startswith("uses "):
            first_text = first
        else:
            first_text = f"is {first}"
        if second.startswith("moves ") or second.startswith("uses "):
            second_text = second
        else:
            second_text = second
        return f"Current zombie {first_text}{connector}{second_text} than previous version."

    joined = ", ".join(summary_terms[:-1]) + f", and {summary_terms[-1]}"
    return f"Current zombie is {joined} than previous version."


def _deterministic_suggestion(*, summary_terms: List[str], differences: List[str]) -> str:
    terms = set(summary_terms)
    if "faster" in terms and "less aggressive" in terms:
        return "Try increasing aggression again for a more dangerous zombie."
    if any("Movement target changed" in difference or "Movement path changed" in difference for difference in differences):
        return "Choose between standard and variation path."
    return ""


def _build_experiment_summary(
    *,
    current_label: str,
    compared_label: str,
    summary_terms: List[str],
    summary_signs: List[int],
) -> str:
    if len(summary_terms) == 1:
        term = summary_terms[0]
        if term.startswith("moves ") or term.startswith("uses "):
            return f"{current_label} {term} than {compared_label}."
        return f"{current_label} is {term} than {compared_label}."

    connector = " and "
    non_zero_signs = {sign for sign in summary_signs if sign != 0}
    if len(non_zero_signs) > 1:
        connector = " but "

    if len(summary_terms) == 2:
        first, second = summary_terms
        first_text = first if first.startswith("moves ") or first.startswith("uses ") else f"is {first}"
        second_text = second if second.startswith("moves ") or second.startswith("uses ") else second
        return f"{current_label} {first_text}{connector}{second_text} than {compared_label}."

    joined = ", ".join(summary_terms[:-1]) + f", and {summary_terms[-1]}"
    return f"{current_label} is {joined} than {compared_label}."


def _family_record(tuning_state: Dict[str, Any], *, family: str) -> Dict[str, Any]:
    record = tuning_state.get(family)
    return dict(record) if isinstance(record, dict) else {}


def _movement_target_z(record: Dict[str, Any]) -> float | None:
    observed_value = record.get("observed_value")
    if isinstance(observed_value, list) and len(observed_value) >= 3:
        return _float_or_none(observed_value[2])
    return None


def _baseline_movement_target(baseline_variant: Dict[str, Any], *, current_snapshot: Dict[str, Any]) -> float | None:
    observed_value = baseline_variant.get("movement_value")
    if isinstance(observed_value, list) and len(observed_value) >= 3:
        return _float_or_none(observed_value[2])
    return _float_or_none(current_snapshot.get("movement_target_z"))


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
