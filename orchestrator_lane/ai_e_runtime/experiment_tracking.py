from __future__ import annotations

from typing import Any, Dict, List

from .intent_normalizer import normalize_prompt
from .session_tuning import SESSION_FOLLOWUP_RESOLUTION


EXPERIMENT_REVIEW_RESOLUTION = "experiment_review"
EXPERIMENT_DECISION_RESOLUTION = "experiment_decision_review"
EXPERIMENT_DECISION_SOURCE = "explicit_user_review"

_EXPERIMENT_REVIEW_PROMPT = "show current experiment variants"
_EXPERIMENT_DECISIONS_PROMPT = "show current experiment decisions"
_EXPERIMENT_DECISION_PROMPTS = {
    "keep current variant": "keep_current_variant",
    "reject current variant": "reject_current_variant",
    "set current variant as baseline": "set_current_variant_as_baseline",
}
_BASELINE_RESTORE_PROMPTS = {
    "restore zombie speed to standard",
    "restore zombie aggression to standard",
    "restore zombie danger to standard",
    "make zombie safer",
    "make zombie less dangerous",
}


def is_experiment_review_prompt(prompt: str) -> bool:
    return normalize_prompt(prompt) == _EXPERIMENT_REVIEW_PROMPT


def is_experiment_decision_prompt(prompt: str) -> bool:
    return normalize_prompt(prompt) in _EXPERIMENT_DECISION_PROMPTS


def is_experiment_decisions_prompt(prompt: str) -> bool:
    return normalize_prompt(prompt) == _EXPERIMENT_DECISIONS_PROMPT


def build_current_experiment_review(session_state: Dict[str, Any]) -> tuple[Dict[str, Any] | None, str | None]:
    experiment = _active_experiment(session_state)
    if experiment is None:
        return None, _no_active_experiment_message(
            "show current experiment variants",
            detail="show current experiment variants only after a supported zombie result exists in the current session",
        )

    variants = _normalized_variants(experiment)
    if not variants:
        return None, _no_active_experiment_message(
            "show current experiment variants",
            detail="show current experiment variants only after a supported zombie result exists in the current session",
        )

    experiment_id = str(experiment.get("experiment_id") or "").strip()
    current_variant_id = str(experiment.get("active_variant_id") or variants[-1].get("variant_id") or "").strip()
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    variant_lines: List[str] = []
    for variant in variants:
        variant_id = str(variant.get("variant_id") or "").strip()
        prompt = str(variant.get("source_prompt") or variant.get("canonical_prompt") or "Supported zombie change").strip()
        outcome = str(variant.get("outcome_summary") or "Outcome summary not available").strip()
        suffixes: List[str] = []
        if bool(variant.get("baseline_marker")):
            suffixes.append("baseline")
        variant_kind = str(variant.get("variant_kind") or "").strip()
        if variant_kind and variant_kind not in suffixes:
            suffixes.append(variant_kind.replace("_", " "))
        suffix_text = f" ({', '.join(suffixes)})" if suffixes else ""
        variant_lines.append(f"{variant_id}: {prompt} -> {outcome}{suffix_text}.")

    overview = (
        f"AI-E is tracking {len(variants)} recorded variant(s) in {experiment_id}. "
        f"Current variant: {current_variant_id or 'not available'}."
    )
    if baseline_variant_id:
        overview += f" Baseline: {baseline_variant_id}."
    return {
        "experiment_id": experiment_id,
        "current_variant_id": current_variant_id,
        "baseline_variant_id": baseline_variant_id,
        "variant_lines": variant_lines,
        "overview": overview,
    }, None


def build_current_experiment_decisions(session_state: Dict[str, Any]) -> tuple[Dict[str, Any] | None, str | None]:
    experiment = _active_experiment(session_state)
    if experiment is None:
        return None, _no_active_experiment_message(
            "show current experiment decisions",
            detail="show current experiment decisions only after a supported zombie result exists in the current session",
        )

    variants = _normalized_variants(experiment)
    if not variants:
        return None, _no_active_experiment_message(
            "show current experiment decisions",
            detail="show current experiment decisions only after a supported zombie result exists in the current session",
        )

    current_variant = _active_variant(experiment, variants=variants)
    if not current_variant:
        return None, _no_active_experiment_message(
            "show current experiment decisions",
            detail="show current experiment decisions only when the active experiment has a current variant",
        )

    experiment_id = str(experiment.get("experiment_id") or "").strip()
    current_variant_id = str(current_variant.get("variant_id") or "").strip()
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
    variant_lines = [
        _decision_variant_line(
            variant,
            preferred_baseline_variant_id=preferred_baseline_variant_id,
        )
        for variant in variants
    ]
    overview = (
        f"AI-E is tracking explicit decisions for {len(variants)} recorded variant(s) in {experiment_id}. "
        f"Current variant: {current_variant_id or 'not available'}."
    )
    if baseline_variant_id:
        overview += f" Original baseline: {baseline_variant_id}."
    if preferred_baseline_variant_id:
        overview += f" Preferred baseline: {preferred_baseline_variant_id}."
    latest_decision = _latest_decision_summary(experiment)
    if latest_decision:
        overview += f" {latest_decision}"
    return {
        "experiment_id": experiment_id,
        "current_variant_id": current_variant_id,
        "baseline_variant_id": baseline_variant_id,
        "preferred_baseline_variant_id": preferred_baseline_variant_id,
        "variant_lines": variant_lines,
        "overview": overview,
        "latest_decision_summary": latest_decision,
    }, None


def build_experiment_decision_preview(
    prompt: str,
    session_state: Dict[str, Any],
) -> tuple[Dict[str, Any] | None, str | None]:
    decision_action = _decision_action(prompt)
    if not decision_action:
        return None, None

    experiment = _active_experiment(session_state)
    if experiment is None:
        return None, _no_active_experiment_message(
            prompt,
            detail="record an experiment decision only after a supported zombie result exists in the current session",
        )

    variants = _normalized_variants(experiment)
    current_variant = _active_variant(experiment, variants=variants)
    if not current_variant:
        return None, _no_active_experiment_message(
            prompt,
            detail="record an experiment decision only when the active experiment has a current variant",
        )

    experiment_id = str(experiment.get("experiment_id") or "").strip()
    current_variant_id = str(current_variant.get("variant_id") or "").strip()
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
    current_status = _decision_status(current_variant)
    lines = [
        f"Current variant: {current_variant_id}.",
        f"Current decision status: {current_status}.",
    ]
    if baseline_variant_id:
        lines.append(f"Original baseline: {baseline_variant_id}.")
    if preferred_baseline_variant_id:
        lines.append(f"Preferred baseline: {preferred_baseline_variant_id}.")
    if decision_action == "keep_current_variant":
        overview = f"AI-E will mark {current_variant_id} as kept in {experiment_id}. No execution will start."
        lines.append("Decision to record: kept.")
        title = "Keep current variant"
    elif decision_action == "reject_current_variant":
        overview = f"AI-E will mark {current_variant_id} as rejected in {experiment_id}. No execution will start."
        lines.append("Decision to record: rejected.")
        title = "Reject current variant"
    else:
        overview = (
            f"AI-E will set {current_variant_id} as the preferred baseline in {experiment_id}. "
            "No execution will start."
        )
        lines.append("Decision to record: preferred baseline.")
        title = "Set current variant as baseline"
    return {
        "experiment_id": experiment_id,
        "current_variant_id": current_variant_id,
        "baseline_variant_id": baseline_variant_id,
        "preferred_baseline_variant_id": preferred_baseline_variant_id,
        "title": title,
        "overview": overview,
        "variant_lines": lines,
        "decision_action": decision_action,
    }, None


def apply_experiment_decision(
    state: Dict[str, Any],
    *,
    prompt: str,
    timestamp: str,
) -> tuple[Dict[str, Any], Dict[str, Any] | None, str | None]:
    decision_action = _decision_action(prompt)
    if not decision_action:
        return state, None, None

    tracking = dict(state.get("experiment_tracking") or {})
    experiments = [dict(item) for item in tracking.get("experiments", []) if isinstance(item, dict)]
    active_experiment_id = str(tracking.get("active_experiment_id") or "").strip()
    experiment = None
    for item in experiments:
        if str(item.get("experiment_id") or "").strip() == active_experiment_id:
            experiment = item
            break
    if experiment is None:
        return state, None, _no_active_experiment_message(
            prompt,
            detail="record an experiment decision only after a supported zombie result exists in the current session",
        )

    variants = _normalized_variants(experiment)
    current_variant = _active_variant(experiment, variants=variants)
    if not current_variant:
        return state, None, _no_active_experiment_message(
            prompt,
            detail="record an experiment decision only when the active experiment has a current variant",
        )

    current_variant_id = str(current_variant.get("variant_id") or "").strip()
    variant_index = next(
        (
            index
            for index, variant in enumerate(variants)
            if str(variant.get("variant_id") or "").strip() == current_variant_id
        ),
        -1,
    )
    if variant_index < 0:
        return state, None, _no_active_experiment_message(
            prompt,
            detail="record an experiment decision only when the active experiment has a current variant",
        )

    decision_order = max(_int_or_default(tracking.get("next_decision_order"), default=1), 1)
    updated_variant = dict(variants[variant_index])
    message = ""
    summary = ""
    if decision_action == "keep_current_variant":
        updated_variant.update(
            decision_status="kept",
            decision_order=decision_order,
            decision_timestamp=str(timestamp or "").strip(),
            decision_source=EXPERIMENT_DECISION_SOURCE,
        )
        message = f"Recorded: {current_variant_id} is kept in {experiment.get('experiment_id') or 'the active experiment'}."
        summary = f"Latest explicit user decision: kept {current_variant_id}."
    elif decision_action == "reject_current_variant":
        updated_variant.update(
            decision_status="rejected",
            decision_order=decision_order,
            decision_timestamp=str(timestamp or "").strip(),
            decision_source=EXPERIMENT_DECISION_SOURCE,
        )
        message = f"Recorded: {current_variant_id} is rejected in {experiment.get('experiment_id') or 'the active experiment'}."
        summary = f"Latest explicit user decision: rejected {current_variant_id}."
    else:
        experiment["preferred_baseline_variant_id"] = current_variant_id
        updated_variant.setdefault("decision_status", _decision_status(updated_variant))
        updated_variant["decision_order"] = decision_order
        updated_variant["decision_timestamp"] = str(timestamp or "").strip()
        updated_variant["decision_source"] = EXPERIMENT_DECISION_SOURCE
        message = (
            f"Recorded: {current_variant_id} is now the preferred baseline in "
            f"{experiment.get('experiment_id') or 'the active experiment'}."
        )
        summary = f"Latest explicit user decision: set {current_variant_id} as the preferred baseline."

    variants[variant_index] = updated_variant
    experiment["variants"] = variants
    latest_decision = {
        "action": decision_action,
        "variant_id": current_variant_id,
        "timestamp": str(timestamp or "").strip(),
        "order": decision_order,
        "source": EXPERIMENT_DECISION_SOURCE,
        "summary": summary,
    }
    experiment["latest_decision"] = latest_decision
    tracking["next_decision_order"] = decision_order + 1
    tracking["experiments"] = experiments
    state["experiment_tracking"] = tracking
    state["latest_experiment_variant"] = dict(updated_variant)
    return state, {
        "experiment_id": str(experiment.get("experiment_id") or "").strip(),
        "current_variant_id": current_variant_id,
        "decision_action": decision_action,
        "message": message,
        "summary": summary,
        "preferred_baseline_variant_id": str(experiment.get("preferred_baseline_variant_id") or "").strip(),
        "decision_status": _decision_status(updated_variant),
    }, None


def apply_experiment_tracking(
    state: Dict[str, Any],
    *,
    task: Dict[str, Any],
    details: Dict[str, Any],
    timestamp: str,
) -> Dict[str, Any]:
    if not _is_result_boundary(task):
        return state

    tracking = dict(state.get("experiment_tracking") or {})
    experiments = [dict(item) for item in tracking.get("experiments", []) if isinstance(item, dict)]
    active_experiment_id = str(tracking.get("active_experiment_id") or "").strip()
    experiment = None
    for item in experiments:
        if str(item.get("experiment_id") or "").strip() == active_experiment_id:
            experiment = item
            break
    if experiment is None:
        experiment = {
            "experiment_id": active_experiment_id or "experiment_0001",
            "target_entity": "zombie",
            "created_at": timestamp,
            "active_variant_id": "",
            "baseline_variant_id": "",
            "preferred_baseline_variant_id": "",
            "latest_decision": {},
            "variants": [],
        }
        experiments.append(experiment)

    variants = _normalized_variants(experiment)
    variant_id = f"variant_{len(variants) + 1:04d}"
    parent_variant_id = str(variants[-1].get("variant_id") or "").strip() if variants else ""
    variant_kind = _variant_kind(task=task, details=details, existing_variants=variants)
    baseline_marker = variant_kind == "baseline"
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    if not baseline_variant_id or baseline_marker:
        baseline_variant_id = variant_id

    speed_record = _family_record(state, family="speed")
    aggression_record = _family_record(state, family="aggression")
    movement_record = _family_record(state, family="movement")

    record = {
        "experiment_id": str(experiment.get("experiment_id") or "").strip(),
        "variant_id": variant_id,
        "parent_variant_id": parent_variant_id,
        "baseline_variant_id": baseline_variant_id,
        "preferred_baseline_variant_id": str(experiment.get("preferred_baseline_variant_id") or "").strip(),
        "baseline_marker": baseline_marker,
        "variant_kind": variant_kind,
        "order": len(variants) + 1,
        "timestamp": str(timestamp or "").strip(),
        "task_id": str(task.get("task_id") or "").strip(),
        "request_id": str(task.get("request_id") or "").strip(),
        "plan_id": str(task.get("plan_id") or "").strip(),
        "plan_title": str(task.get("plan_title") or "").strip(),
        "source_prompt": str(task.get("source_prompt") or task.get("operator_prompt") or "").strip(),
        "canonical_prompt": str(details.get("translated_command") or task.get("operator_prompt") or "").strip(),
        "resolution_source": str(details.get("resolution_source") or task.get("resolution_source") or "").strip(),
        "resolved_from_prompt": str(details.get("resolved_from_prompt") or task.get("resolved_from_prompt") or "").strip(),
        "speed_tier": str(speed_record.get("resulting_tier") or "").strip(),
        "speed_value": speed_record.get("observed_value"),
        "aggression_tier": str(aggression_record.get("resulting_tier") or "").strip(),
        "aggression_value": aggression_record.get("observed_value"),
        "movement_tier": str(movement_record.get("resulting_tier") or "").strip(),
        "movement_value": movement_record.get("observed_value"),
        "executed": _bool_or_default(details.get("executed"), default=True),
        "result_reason": str(details.get("result_reason") or "applied").strip().lower() or "applied",
        "decision_status": "undecided",
        "decision_order": None,
        "decision_timestamp": "",
        "decision_source": "",
        "outcome_summary": _outcome_summary(
            speed_tier=str(speed_record.get("resulting_tier") or "").strip(),
            aggression_tier=str(aggression_record.get("resulting_tier") or "").strip(),
            movement_tier=str(movement_record.get("resulting_tier") or "").strip(),
            details=details,
        ),
    }
    variants.append(record)
    experiment["variants"] = variants
    experiment["active_variant_id"] = variant_id
    experiment["baseline_variant_id"] = baseline_variant_id

    tracking["active_experiment_id"] = str(experiment.get("experiment_id") or "").strip()
    tracking["next_experiment_index"] = max(_int_or_default(tracking.get("next_experiment_index"), default=2), 2)
    tracking["experiments"] = experiments
    state["experiment_tracking"] = tracking
    state["latest_experiment_variant"] = dict(record)
    return state


def find_variant_for_task(
    state: Dict[str, Any],
    *,
    task_id: str = "",
    request_id: str = "",
    plan_id: str = "",
) -> Dict[str, Any]:
    tracking = state.get("experiment_tracking")
    if not isinstance(tracking, dict):
        return {}
    experiments = tracking.get("experiments")
    if not isinstance(experiments, list):
        return {}

    for experiment in experiments:
        if not isinstance(experiment, dict):
            continue
        for variant in reversed(_normalized_variants(experiment)):
            if task_id and str(variant.get("task_id") or "").strip() == task_id:
                return variant
            if request_id and str(variant.get("request_id") or "").strip() == request_id:
                if not plan_id or str(variant.get("plan_id") or "").strip() == plan_id:
                    return variant
            if plan_id and str(variant.get("plan_id") or "").strip() == plan_id:
                return variant
    return {}


def find_variant_by_id(state: Dict[str, Any], *, experiment_id: str, variant_id: str) -> Dict[str, Any]:
    tracking = state.get("experiment_tracking")
    if not isinstance(tracking, dict):
        return {}
    experiments = tracking.get("experiments")
    if not isinstance(experiments, list):
        return {}
    for experiment in experiments:
        if not isinstance(experiment, dict):
            continue
        if str(experiment.get("experiment_id") or "").strip() != experiment_id:
            continue
        for variant in _normalized_variants(experiment):
            if str(variant.get("variant_id") or "").strip() == variant_id:
                return variant
    return {}


def find_experiment_by_id(state: Dict[str, Any], *, experiment_id: str) -> Dict[str, Any]:
    tracking = state.get("experiment_tracking")
    if not isinstance(tracking, dict):
        return {}
    experiments = tracking.get("experiments")
    if not isinstance(experiments, list):
        return {}
    for experiment in experiments:
        if not isinstance(experiment, dict):
            continue
        if str(experiment.get("experiment_id") or "").strip() == experiment_id:
            return dict(experiment)
    return {}


def _active_experiment(session_state: Dict[str, Any]) -> Dict[str, Any] | None:
    tracking = session_state.get("experiment_tracking")
    if not isinstance(tracking, dict):
        return None
    experiments = tracking.get("experiments")
    if not isinstance(experiments, list):
        return None
    active_experiment_id = str(tracking.get("active_experiment_id") or "").strip()
    if not active_experiment_id:
        return None
    for experiment in experiments:
        if not isinstance(experiment, dict):
            continue
        if str(experiment.get("experiment_id") or "").strip() == active_experiment_id:
            return experiment
    return None


def _normalized_variants(experiment: Dict[str, Any]) -> List[Dict[str, Any]]:
    variants = experiment.get("variants")
    if not isinstance(variants, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in variants:
        if not isinstance(item, dict):
            continue
        variant = dict(item)
        variant.setdefault("decision_status", "undecided")
        variant.setdefault("decision_order", None)
        variant.setdefault("decision_timestamp", "")
        variant.setdefault("decision_source", "")
        normalized.append(variant)
    return normalized


def _active_variant(experiment: Dict[str, Any], *, variants: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    resolved_variants = list(variants) if isinstance(variants, list) else _normalized_variants(experiment)
    if not resolved_variants:
        return {}
    active_variant_id = str(experiment.get("active_variant_id") or "").strip()
    if active_variant_id:
        for variant in resolved_variants:
            if str(variant.get("variant_id") or "").strip() == active_variant_id:
                return dict(variant)
    return dict(resolved_variants[-1])


def _is_result_boundary(task: Dict[str, Any]) -> bool:
    total_steps = _int_or_default(task.get("plan_total_steps"), default=1)
    step_index = _int_or_default(task.get("plan_step_index"), default=1)
    if total_steps <= 1:
        return True
    return step_index == total_steps


def _family_record(state: Dict[str, Any], *, family: str) -> Dict[str, Any]:
    tuning_state = state.get("session_tuning_state")
    if not isinstance(tuning_state, dict):
        return {}
    record = tuning_state.get(family)
    return dict(record) if isinstance(record, dict) else {}


def _variant_kind(*, task: Dict[str, Any], details: Dict[str, Any], existing_variants: List[Dict[str, Any]]) -> str:
    if not existing_variants:
        return "baseline"
    if bool(details.get("revert_requested") or task.get("revert_requested")):
        return "reverted_variant"
    canonical_prompt = normalize_prompt(str(details.get("translated_command") or task.get("operator_prompt") or ""))
    if canonical_prompt in _BASELINE_RESTORE_PROMPTS:
        return "baseline_restoration"
    resolution_source = str(details.get("resolution_source") or task.get("resolution_source") or "").strip()
    if resolution_source == SESSION_FOLLOWUP_RESOLUTION:
        return "followup_variant"
    return "direct_variant"


def _decision_action(prompt: str) -> str:
    return str(_EXPERIMENT_DECISION_PROMPTS.get(normalize_prompt(prompt), "") or "").strip()


def _decision_status(variant: Dict[str, Any]) -> str:
    status = str(variant.get("decision_status") or "").strip().lower()
    if status in {"kept", "rejected"}:
        return status
    return "undecided"


def _decision_variant_line(variant: Dict[str, Any], *, preferred_baseline_variant_id: str) -> str:
    variant_id = str(variant.get("variant_id") or "").strip()
    prompt = str(variant.get("source_prompt") or variant.get("canonical_prompt") or "Supported zombie change").strip()
    decision_status = _decision_status(variant)
    outcome = str(variant.get("outcome_summary") or "Outcome summary not available").strip()
    suffixes: List[str] = [f"decision: {decision_status}"]
    if bool(variant.get("baseline_marker")):
        suffixes.append("original baseline")
    if preferred_baseline_variant_id and variant_id == preferred_baseline_variant_id:
        suffixes.append("preferred baseline")
    return f"{variant_id}: {prompt} -> {outcome} ({', '.join(suffixes)})."


def _latest_decision_summary(experiment: Dict[str, Any]) -> str:
    latest_decision = experiment.get("latest_decision")
    if not isinstance(latest_decision, dict):
        return ""
    summary = str(latest_decision.get("summary") or "").strip()
    return summary


def _no_active_experiment_message(prompt: str, *, detail: str) -> str:
    _ = prompt
    return (
        f"AI-E can {detail}. Start with something like: 'make zombie faster'."
    )


def _outcome_summary(
    *,
    speed_tier: str,
    aggression_tier: str,
    movement_tier: str,
    details: Dict[str, Any],
) -> str:
    parts: List[str] = []
    if speed_tier:
        parts.append(f"speed {speed_tier}")
    if aggression_tier:
        parts.append(f"aggression {aggression_tier}")
    if movement_tier:
        if movement_tier == "movement_variation":
            parts.append("movement variation")
        elif movement_tier == "standard_forward":
            parts.append("standard forward movement")
        else:
            parts.append(f"movement {movement_tier}")
    if not parts:
        action_name = str(details.get("action_name") or details.get("action_type") or "supported change").strip()
        return action_name.replace("_", " ")
    return ", ".join(parts)


def _int_or_default(value: Any, *, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _bool_or_default(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


__all__ = [
    "EXPERIMENT_DECISION_RESOLUTION",
    "EXPERIMENT_DECISION_SOURCE",
    "EXPERIMENT_REVIEW_RESOLUTION",
    "apply_experiment_decision",
    "apply_experiment_tracking",
    "build_current_experiment_decisions",
    "build_current_experiment_review",
    "build_experiment_decision_preview",
    "find_experiment_by_id",
    "find_variant_by_id",
    "find_variant_for_task",
    "is_experiment_decision_prompt",
    "is_experiment_decisions_prompt",
    "is_experiment_review_prompt",
]
