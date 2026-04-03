from __future__ import annotations

from typing import Any, Dict, List

from .encounter_profiles import encounter_display_name
from .intent_normalizer import normalize_prompt
from .session_tuning import SESSION_FOLLOWUP_RESOLUTION
from .tuning_contexts import (
    baseline_restore_prompts_for_context,
    detect_supported_tuning_context,
    is_supported_encounter_context,
    supported_tuning_contexts,
    tuning_context_display_name,
)


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
    prompt
    for context in supported_tuning_contexts()
    for prompt in baseline_restore_prompts_for_context(context)
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
            detail="show current experiment variants only after a supported tuning result exists in the current session",
        )

    variants = _normalized_variants(experiment)
    if not variants:
        return None, _no_active_experiment_message(
            "show current experiment variants",
            detail="show current experiment variants only after a supported tuning result exists in the current session",
        )

    experiment_id = str(experiment.get("experiment_id") or "").strip()
    current_variant_id = str(experiment.get("active_variant_id") or variants[-1].get("variant_id") or "").strip()
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
    target_context = _experiment_target_context(experiment, variants=variants)
    variant_lines: List[str] = []
    for variant in variants:
        variant_id = str(variant.get("variant_id") or "").strip()
        prompt = str(
            variant.get("source_prompt")
            or variant.get("canonical_prompt")
            or f"Supported {target_context or 'tuning'} change"
        ).strip()
        outcome = str(variant.get("outcome_summary") or "Outcome summary not available").strip()
        suffixes: List[str] = []
        if current_variant_id and variant_id == current_variant_id:
            suffixes.append("current variant")
        if bool(variant.get("baseline_marker")):
            suffixes.append("baseline")
        if preferred_baseline_variant_id and variant_id == preferred_baseline_variant_id:
            suffixes.append("preferred baseline")
        if _decision_status(variant) == "rejected":
            suffixes.append("rejected")
        variant_kind = str(variant.get("variant_kind") or "").strip()
        if variant_kind and variant_kind not in suffixes:
            suffixes.append(variant_kind.replace("_", " "))
        suffix_text = f" ({', '.join(suffixes)})" if suffixes else ""
        variant_lines.append(f"{variant_id}: {prompt} -> {outcome}{suffix_text}.")

    overview = (
        f"AI-E is tracking {len(variants)} recorded variant(s) in {experiment_id}. "
        f"Current variant: {current_variant_id or 'not available'}."
    )
    if target_context:
        overview += f" Target context: {tuning_context_display_name(target_context)}."
    if baseline_variant_id:
        overview += f" Baseline: {baseline_variant_id}."
    if preferred_baseline_variant_id:
        overview += f" Preferred baseline: {preferred_baseline_variant_id}."
    overview += f" Rejected variants: {_rejected_variants_text(variants)}."
    return {
        "experiment_id": experiment_id,
        "current_variant_id": current_variant_id,
        "baseline_variant_id": baseline_variant_id,
        "preferred_baseline_variant_id": preferred_baseline_variant_id,
        "variant_lines": variant_lines,
        "overview": overview,
    }, None


def build_current_experiment_decisions(session_state: Dict[str, Any]) -> tuple[Dict[str, Any] | None, str | None]:
    experiment = _active_experiment(session_state)
    if experiment is None:
        return None, _no_active_experiment_message(
            "show current experiment decisions",
            detail="show current experiment decisions only after a supported tuning result exists in the current session",
        )

    variants = _normalized_variants(experiment)
    if not variants:
        return None, _no_active_experiment_message(
            "show current experiment decisions",
            detail="show current experiment decisions only after a supported tuning result exists in the current session",
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
    target_context = _experiment_target_context(experiment, variants=variants)
    variant_lines = [
        _decision_variant_line(
            variant,
            preferred_baseline_variant_id=preferred_baseline_variant_id,
            target_context=target_context,
            current_variant_id=current_variant_id,
        )
        for variant in variants
    ]
    overview = (
        f"AI-E is tracking explicit decisions for {len(variants)} recorded variant(s) in {experiment_id}. "
        f"Current variant: {current_variant_id or 'not available'}."
    )
    if target_context:
        overview += f" Target context: {tuning_context_display_name(target_context)}."
    if baseline_variant_id:
        overview += f" Original baseline: {baseline_variant_id}."
    if preferred_baseline_variant_id:
        overview += f" Preferred baseline: {preferred_baseline_variant_id}."
    overview += f" Rejected variants: {_rejected_variants_text(variants)}."
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
            detail="record an experiment decision only after a supported tuning result exists in the current session",
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
    comparison_lines = _decision_comparison_lines(
        session_state,
        experiment_id=experiment_id,
        current_variant_id=current_variant_id,
    )
    current_status = _decision_status(current_variant)
    lines = [
        f"Current variant: {current_variant_id}.",
        f"Current decision status: {current_status}.",
        f"Rejected variants: {_rejected_variants_text(variants)}.",
    ]
    if baseline_variant_id:
        lines.append(f"Original baseline: {baseline_variant_id}.")
    if preferred_baseline_variant_id:
        lines.append(f"Preferred baseline: {preferred_baseline_variant_id}.")
    if decision_action == "keep_current_variant":
        overview = (
            f"AI-E will record {current_variant_id} as kept in {experiment_id}. "
            f"{_baseline_consequence_text(baseline_variant_id, preferred_baseline_variant_id=preferred_baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)} "
            "No execution will start."
        )
        lines.append("Decision to record: kept.")
        lines.append(
            f"Decision outcome: {current_variant_id} stays available for comparison. "
            f"{_baseline_consequence_text(baseline_variant_id, preferred_baseline_variant_id=preferred_baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}"
        )
        title = "Keep current variant"
    elif decision_action == "reject_current_variant":
        overview = (
            f"AI-E will record {current_variant_id} as rejected in {experiment_id}. "
            f"{current_variant_id} will remain in history but will not be used. No execution will start."
        )
        lines.append("Decision to record: rejected.")
        lines.append(f"Decision outcome: {current_variant_id} will remain in history but will not be used.")
        title = "Reject current variant"
    else:
        overview = (
            f"AI-E will set {current_variant_id} as the preferred baseline in {experiment_id}. "
            f"{_baseline_consequence_text(baseline_variant_id, preferred_baseline_variant_id=preferred_baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)} "
            "No execution will start."
        )
        lines.append("Decision to record: preferred baseline.")
        lines.append(
            f"Decision outcome: {current_variant_id} becomes the preferred baseline for later comparisons. "
            f"{_baseline_consequence_text(baseline_variant_id, preferred_baseline_variant_id=preferred_baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}"
        )
        title = "Set current variant as baseline"
    if comparison_lines:
        lines.append("Changes relative to baseline:")
        lines.extend(comparison_lines)
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
            detail="record an experiment decision only after a supported tuning result exists in the current session",
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
        message = (
            f"Recorded: {current_variant_id} was kept in {experiment.get('experiment_id') or 'the active experiment'}. "
            f"{_baseline_consequence_text(str(experiment.get('baseline_variant_id') or '').strip(), preferred_baseline_variant_id=str(experiment.get('preferred_baseline_variant_id') or '').strip(), action=decision_action, current_variant_id=current_variant_id)}"
        )
        summary = (
            f"Latest explicit user decision: kept {current_variant_id}. "
            f"{_baseline_consequence_text(str(experiment.get('baseline_variant_id') or '').strip(), preferred_baseline_variant_id=str(experiment.get('preferred_baseline_variant_id') or '').strip(), action=decision_action, current_variant_id=current_variant_id)}"
        )
    elif decision_action == "reject_current_variant":
        updated_variant.update(
            decision_status="rejected",
            decision_order=decision_order,
            decision_timestamp=str(timestamp or "").strip(),
            decision_source=EXPERIMENT_DECISION_SOURCE,
        )
        message = f"Recorded: {current_variant_id} was rejected in {experiment.get('experiment_id') or 'the active experiment'} and will not be used."
        summary = f"Latest explicit user decision: rejected {current_variant_id}; it will not be used."
    else:
        experiment["preferred_baseline_variant_id"] = current_variant_id
        updated_variant.setdefault("decision_status", _decision_status(updated_variant))
        updated_variant["decision_order"] = decision_order
        updated_variant["decision_timestamp"] = str(timestamp or "").strip()
        updated_variant["decision_source"] = EXPERIMENT_DECISION_SOURCE
        message = (
            f"Recorded: {current_variant_id} is now the preferred baseline in "
            f"{experiment.get('experiment_id') or 'the active experiment'}. "
            f"{_baseline_consequence_text(str(experiment.get('baseline_variant_id') or '').strip(), preferred_baseline_variant_id=current_variant_id, action=decision_action, current_variant_id=current_variant_id)}"
        )
        summary = (
            f"Latest explicit user decision: set {current_variant_id} as the preferred baseline. "
            f"{_baseline_consequence_text(str(experiment.get('baseline_variant_id') or '').strip(), preferred_baseline_variant_id=current_variant_id, action=decision_action, current_variant_id=current_variant_id)}"
        )

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

    target_context = detect_supported_tuning_context(
        details.get("target_context"),
        details.get("target_entity"),
        details.get("entity_type"),
        details.get("translated_command"),
        details.get("spawner_name"),
        task.get("target_entity"),
        task.get("source_prompt"),
        task.get("operator_prompt"),
        task.get("capability_id"),
    )
    tracking = dict(state.get("experiment_tracking") or {})
    experiments = [dict(item) for item in tracking.get("experiments", []) if isinstance(item, dict)]
    active_experiment_id = str(tracking.get("active_experiment_id") or "").strip()
    experiment = None
    for item in experiments:
        if str(item.get("experiment_id") or "").strip() == active_experiment_id:
            experiment = item
            break
    if experiment is not None and _experiment_target_context(experiment) != target_context:
        experiment = None
    if experiment is None:
        next_experiment_index = max(_int_or_default(tracking.get("next_experiment_index"), default=1), 1)
        experiment = {
            "experiment_id": f"experiment_{next_experiment_index:04d}",
            "target_entity": target_context,
            "target_context": target_context,
            "created_at": timestamp,
            "active_variant_id": "",
            "baseline_variant_id": "",
            "preferred_baseline_variant_id": "",
            "latest_decision": {},
            "variants": [],
        }
        experiments.append(experiment)
        tracking["next_experiment_index"] = next_experiment_index + 1

    variants = _normalized_variants(experiment)
    variant_id = f"variant_{len(variants) + 1:04d}"
    parent_variant_id = str(variants[-1].get("variant_id") or "").strip() if variants else ""
    variant_kind = _variant_kind(task=task, details=details, existing_variants=variants)
    baseline_marker = variant_kind == "baseline"
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    if not baseline_variant_id or baseline_marker:
        baseline_variant_id = variant_id

    speed_record = _family_record(state, family="speed", target_context=target_context)
    aggression_record = _family_record(state, family="aggression", target_context=target_context)
    movement_record = _family_record(state, family="movement", target_context=target_context)
    count_record = _family_record(state, family="encounter_count", target_context=target_context)
    pressure_record = _family_record(state, family="spawn_pressure", target_context=target_context)

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
        "encounter_count_tier": str(count_record.get("resulting_tier") or "").strip(),
        "encounter_count_value": count_record.get("observed_value"),
        "spawn_pressure_tier": str(pressure_record.get("resulting_tier") or "").strip(),
        "spawn_pressure_value": pressure_record.get("observed_value"),
        "executed": _bool_or_default(details.get("executed"), default=True),
        "result_reason": str(details.get("result_reason") or "applied").strip().lower() or "applied",
        "target_entity": target_context,
        "target_context": target_context,
        "decision_status": "undecided",
        "decision_order": None,
        "decision_timestamp": "",
        "decision_source": "",
        "outcome_summary": _outcome_summary(
            speed_tier=str(speed_record.get("resulting_tier") or "").strip(),
            aggression_tier=str(aggression_record.get("resulting_tier") or "").strip(),
            movement_tier=str(movement_record.get("resulting_tier") or "").strip(),
            encounter_count_tier=str(count_record.get("resulting_tier") or "").strip(),
            spawn_pressure_tier=str(pressure_record.get("resulting_tier") or "").strip(),
            details=details,
        ),
    }
    variants.append(record)
    experiment["variants"] = variants
    experiment["active_variant_id"] = variant_id
    experiment["baseline_variant_id"] = baseline_variant_id
    experiment["target_entity"] = target_context
    experiment["target_context"] = target_context

    tracking["active_experiment_id"] = str(experiment.get("experiment_id") or "").strip()
    tracking["next_experiment_index"] = max(
        _int_or_default(tracking.get("next_experiment_index"), default=2),
        len(experiments) + 1,
    )
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


def _family_record(state: Dict[str, Any], *, family: str, target_context: str) -> Dict[str, Any]:
    tuning_state = state.get("session_tuning_state")
    if not isinstance(tuning_state, dict):
        return {}
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


def _decision_variant_line(
    variant: Dict[str, Any],
    *,
    preferred_baseline_variant_id: str,
    target_context: str,
    current_variant_id: str = "",
) -> str:
    variant_id = str(variant.get("variant_id") or "").strip()
    prompt = str(
        variant.get("source_prompt")
        or variant.get("canonical_prompt")
        or f"Supported {target_context or 'tuning'} change"
    ).strip()
    decision_status = _decision_status(variant)
    outcome = str(variant.get("outcome_summary") or "Outcome summary not available").strip()
    suffixes: List[str] = [f"decision: {decision_status}"]
    if current_variant_id and variant_id == current_variant_id:
        suffixes.append("current variant")
    if bool(variant.get("baseline_marker")):
        suffixes.append("original baseline")
    if preferred_baseline_variant_id and variant_id == preferred_baseline_variant_id:
        suffixes.append("preferred baseline")
    return f"{variant_id}: {prompt} -> {outcome} ({', '.join(suffixes)})."


def _rejected_variants_text(variants: List[Dict[str, Any]]) -> str:
    rejected = [
        str(variant.get("variant_id") or "").strip()
        for variant in variants
        if _decision_status(variant) == "rejected"
    ]
    rejected = [variant_id for variant_id in rejected if variant_id]
    if not rejected:
        return "none"
    return ", ".join(rejected)


def _decision_comparison_lines(
    session_state: Dict[str, Any],
    *,
    experiment_id: str,
    current_variant_id: str,
) -> List[str]:
    if not experiment_id or not current_variant_id:
        return []

    candidates: List[Dict[str, Any]] = []
    latest = session_state.get("latest_result_evaluation")
    if isinstance(latest, dict):
        candidates.append(latest)
    history = session_state.get("result_evaluation_history")
    if isinstance(history, list):
        for item in history:
            if isinstance(item, dict):
                candidates.append(item)

    for item in reversed(candidates):
        if str(item.get("experiment_id") or "").strip() != experiment_id:
            continue
        if str(item.get("variant_id") or "").strip() != current_variant_id:
            continue
        summary = str(item.get("experiment_comparison_description") or "").strip()
        if summary:
            return [line.strip() for line in summary.splitlines() if line.strip()]

    return ["Structured baseline comparison is not available for this variant yet."]


def _baseline_consequence_text(
    baseline_variant_id: str,
    *,
    preferred_baseline_variant_id: str,
    action: str,
    current_variant_id: str,
) -> str:
    if action == "set_current_variant_as_baseline":
        if baseline_variant_id:
            return f"Original baseline remains {baseline_variant_id}."
        return f"{current_variant_id} becomes the baseline used for future comparisons."
    if preferred_baseline_variant_id:
        return f"Preferred baseline remains {preferred_baseline_variant_id}."
    if baseline_variant_id:
        return f"Original baseline remains {baseline_variant_id}."
    return "The current baseline does not change."


def _latest_decision_summary(experiment: Dict[str, Any]) -> str:
    latest_decision = experiment.get("latest_decision")
    if not isinstance(latest_decision, dict):
        return ""
    summary = str(latest_decision.get("summary") or "").strip()
    return summary


def _no_active_experiment_message(prompt: str, *, detail: str) -> str:
    _ = prompt
    return (
        f"AI-E can {detail}. Start with something like: 'make zombie faster', 'make runner faster', or 'increase encounter count'."
    )


def _outcome_summary(
    *,
    speed_tier: str,
    aggression_tier: str,
    movement_tier: str,
    encounter_count_tier: str,
    spawn_pressure_tier: str,
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
    if encounter_count_tier:
        parts.append(f"encounter count {encounter_count_tier}")
    if spawn_pressure_tier:
        if spawn_pressure_tier == "high":
            parts.append("spawn pressure high")
        elif spawn_pressure_tier == "low":
            parts.append("spawn pressure low")
        else:
            parts.append(f"spawn pressure {spawn_pressure_tier}")
    if not parts:
        action_name = str(details.get("action_name") or details.get("action_type") or "supported change").strip()
        return action_name.replace("_", " ")
    return ", ".join(parts)


def _experiment_target_context(experiment: Dict[str, Any], *, variants: List[Dict[str, Any]] | None = None) -> str:
    target_context = detect_supported_tuning_context(
        experiment.get("target_context"),
        experiment.get("target_entity"),
    )
    if target_context:
        return target_context
    resolved_variants = list(variants) if isinstance(variants, list) else _normalized_variants(experiment)
    for variant in reversed(resolved_variants):
        detected = detect_supported_tuning_context(
            variant.get("target_context"),
            variant.get("target_entity"),
            variant.get("source_prompt"),
            variant.get("canonical_prompt"),
        )
        if detected:
            return detected
    return encounter_display_name(None)


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
