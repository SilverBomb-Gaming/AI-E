from __future__ import annotations

import re
from typing import Any, Dict, List

from .encounter_profiles import encounter_display_name
from .generic_capabilities import build_generic_capability_state
from .intent_normalizer import normalize_prompt
from .platformer_profiles import platformer_display_name
from .racing_profiles import racing_display_name
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
EXPERIMENT_NAVIGATION_RESOLUTION = "experiment_navigation_review"
EXPERIMENT_DECISION_SOURCE = "explicit_user_review"
EXPERIMENT_NAVIGATION_SOURCE = "explicit_user_navigation"

_EXPERIMENT_REVIEW_PROMPT = "show current experiment variants"
_EXPERIMENT_DECISIONS_PROMPT = "show current experiment decisions"
_EXPERIMENT_LIST_PROMPTS = {"show experiments", "list experiments"}
_EXPERIMENT_DECISION_PROMPTS = {
    "keep current variant": "keep_current_variant",
    "reject current variant": "reject_current_variant",
    "set current variant as baseline": "set_current_variant_as_baseline",
}
_EXPERIMENT_OPEN_PROMPT = re.compile(r"^(?:open|switch to)\s+(experiment_\d{4})$")
_EXPERIMENT_SUMMARY_PROMPT = re.compile(r"^show\s+(experiment_\d{4})\s+summary$")
_VARIANT_INSPECT_PROMPT = re.compile(r"^(?:show|inspect)\s+(variant_\d{4})$")
_VARIANT_COMPARE_PROMPT = re.compile(
    r"^compare\s+(variant_\d{4})\s+in\s+(experiment_\d{4})\s+with\s+(variant_\d{4})\s+in\s+(experiment_\d{4})$"
)
_EXPERIMENT_COMPARE_PROMPT = re.compile(r"^compare\s+(experiment_\d{4})\s+and\s+(experiment_\d{4})$")
_BASELINE_COMPARE_PROMPT = re.compile(r"^compare\s+baselines\s+of\s+(experiment_\d{4})\s+and\s+(experiment_\d{4})$")
_VARIANT_COMPARE_AMBIGUOUS_PROMPT = re.compile(r"^compare\s+(variant_\d{4})$")
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


def is_experiment_navigation_prompt(prompt: str) -> bool:
    normalized = normalize_prompt(prompt)
    if normalized in _EXPERIMENT_LIST_PROMPTS:
        return True
    return any(
        pattern.fullmatch(normalized)
        for pattern in (
            _EXPERIMENT_OPEN_PROMPT,
            _EXPERIMENT_SUMMARY_PROMPT,
            _VARIANT_INSPECT_PROMPT,
            _VARIANT_COMPARE_PROMPT,
            _EXPERIMENT_COMPARE_PROMPT,
            _BASELINE_COMPARE_PROMPT,
            _VARIANT_COMPARE_AMBIGUOUS_PROMPT,
        )
    )


def build_experiment_navigation_preview(prompt: str, session_state: Dict[str, Any]) -> Dict[str, Any] | None:
    normalized = normalize_prompt(prompt)
    if normalized in _EXPERIMENT_LIST_PROMPTS:
        return _build_experiment_list_preview(session_state)

    open_match = _EXPERIMENT_OPEN_PROMPT.fullmatch(normalized)
    if open_match is not None:
        return _build_experiment_selection_preview(session_state, experiment_id=open_match.group(1))

    summary_match = _EXPERIMENT_SUMMARY_PROMPT.fullmatch(normalized)
    if summary_match is not None:
        return _build_experiment_summary_preview(session_state, experiment_id=summary_match.group(1))

    variant_match = _VARIANT_INSPECT_PROMPT.fullmatch(normalized)
    if variant_match is not None:
        return _build_variant_inspection_preview(session_state, variant_id=variant_match.group(1))

    variant_compare_match = _VARIANT_COMPARE_PROMPT.fullmatch(normalized)
    if variant_compare_match is not None:
        return _build_cross_experiment_variant_comparison_preview(
            session_state,
            left_experiment_id=variant_compare_match.group(2),
            left_variant_id=variant_compare_match.group(1),
            right_experiment_id=variant_compare_match.group(4),
            right_variant_id=variant_compare_match.group(3),
        )

    experiment_compare_match = _EXPERIMENT_COMPARE_PROMPT.fullmatch(normalized)
    if experiment_compare_match is not None:
        return _build_cross_experiment_current_variant_comparison_preview(
            session_state,
            left_experiment_id=experiment_compare_match.group(1),
            right_experiment_id=experiment_compare_match.group(2),
        )

    baseline_compare_match = _BASELINE_COMPARE_PROMPT.fullmatch(normalized)
    if baseline_compare_match is not None:
        return _build_cross_experiment_baseline_comparison_preview(
            session_state,
            left_experiment_id=baseline_compare_match.group(1),
            right_experiment_id=baseline_compare_match.group(2),
        )

    ambiguous_compare_match = _VARIANT_COMPARE_AMBIGUOUS_PROMPT.fullmatch(normalized)
    if ambiguous_compare_match is not None:
        return _build_ambiguous_variant_comparison_preview(session_state, variant_id=ambiguous_compare_match.group(1))

    return None


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
    baseline_variant = _variant_by_id(variants, baseline_variant_id)
    variant_lines = [
        _review_variant_line(
            variant,
            baseline_variant=baseline_variant,
            baseline_variant_id=baseline_variant_id,
            preferred_baseline_variant_id=preferred_baseline_variant_id,
            experiment_target_context=target_context,
            current_variant_id=current_variant_id,
        )
        for variant in variants
    ]
    overview = _review_overview(
        experiment_id=experiment_id,
        variants=variants,
        current_variant_id=current_variant_id,
        baseline_variant_id=baseline_variant_id,
        preferred_baseline_variant_id=preferred_baseline_variant_id,
        target_context=target_context,
        review_label="Variant review",
    )
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
    baseline_variant = _variant_by_id(variants, baseline_variant_id)
    variant_lines = [
        _review_variant_line(
            variant,
            baseline_variant=baseline_variant,
            baseline_variant_id=baseline_variant_id,
            preferred_baseline_variant_id=preferred_baseline_variant_id,
            experiment_target_context=target_context,
            current_variant_id=current_variant_id,
        )
        for variant in variants
    ]
    latest_decision = _latest_decision_summary(experiment)
    overview = _review_overview(
        experiment_id=experiment_id,
        variants=variants,
        current_variant_id=current_variant_id,
        baseline_variant_id=baseline_variant_id,
        preferred_baseline_variant_id=preferred_baseline_variant_id,
        target_context=target_context,
        review_label="Decision review",
        latest_decision=latest_decision,
    )
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
    target_context = _experiment_target_context(experiment, variants=variants)
    baseline_variant = _variant_by_id(variants, baseline_variant_id)
    comparison_lines = _decision_comparison_lines(
        session_state,
        experiment_id=experiment_id,
        current_variant_id=current_variant_id,
    )
    current_status = _decision_status(current_variant)
    lines = [
        f"Current variant: {current_variant_id}.",
        f"Target context: {tuning_context_display_name(target_context)}.",
        f"Current status: {current_status}.",
        f"Current variant deltas from baseline: {_baseline_delta_text(current_variant, baseline_variant=baseline_variant)}.",
        f"Original baseline: {baseline_variant_id or 'not available'}.",
        f"Preferred baseline: {_preferred_baseline_summary_text(baseline_variant_id, preferred_baseline_variant_id)}.",
        f"Kept variants: {_kept_variants_text(variants)}.",
        f"Rejected variants: {_rejected_variants_text(variants)}.",
    ]
    if decision_action == "keep_current_variant":
        lines.append("Decision to record: kept.")
        lines.append(f"Status change: {current_variant_id} -> kept.")
        lines.append(f"Preferred baseline change: {_preferred_baseline_change_text(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}")
        lines.append(f"Comparison reference after decision: {_comparison_reference_after_decision(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}.")
        lines.append(f"Decision outcome: {current_variant_id} remains available for comparison and history.")
        lines.append(f"Original baseline lineage: {_original_baseline_lineage_text(baseline_variant_id)}.")
        title = "Keep current variant"
    elif decision_action == "reject_current_variant":
        lines.append("Decision to record: rejected.")
        lines.append(f"Status change: {current_variant_id} -> rejected.")
        lines.append(f"Preferred baseline change: {_preferred_baseline_change_text(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}")
        lines.append(f"Comparison reference after decision: {_comparison_reference_after_decision(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}.")
        lines.append(f"Decision outcome: {current_variant_id} remains in experiment history but will not be used.")
        lines.append(f"Original baseline lineage: {_original_baseline_lineage_text(baseline_variant_id)}.")
        title = "Reject current variant"
    else:
        lines.append("Decision to record: preferred baseline.")
        lines.append("Status change: none; the current decision status stays recorded as-is.")
        lines.append(f"Preferred baseline change: {_preferred_baseline_change_text(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}")
        lines.append(f"Comparison reference after decision: {_comparison_reference_after_decision(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}.")
        lines.append(f"Decision outcome: {current_variant_id} becomes the preferred baseline for later comparisons.")
        lines.append(f"Original baseline lineage: {_original_baseline_lineage_text(baseline_variant_id)}.")
        title = "Set current variant as baseline"
    if comparison_lines:
        lines.append("Changes relative to baseline:")
        lines.extend(comparison_lines)
    overview = _decision_preview_overview(
        experiment_id=experiment_id,
        decision_action=decision_action,
        current_variant_id=current_variant_id,
        preferred_baseline_variant_id=preferred_baseline_variant_id,
        baseline_variant_id=baseline_variant_id,
    )
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
        baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
        preferred_baseline_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
        message = (
            f"Recorded: {current_variant_id} is kept in {experiment.get('experiment_id') or 'the active experiment'}. "
            f"Preferred baseline remains {_comparison_reference_after_decision(preferred_baseline_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}. "
            f"{_original_baseline_sentence_text(baseline_variant_id)}"
        )
        summary = (
            f"Latest explicit user decision: kept {current_variant_id}. "
            f"Preferred baseline remains {_comparison_reference_after_decision(preferred_baseline_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}. "
            f"{_original_baseline_sentence_text(baseline_variant_id)}"
        )
    elif decision_action == "reject_current_variant":
        updated_variant.update(
            decision_status="rejected",
            decision_order=decision_order,
            decision_timestamp=str(timestamp or "").strip(),
            decision_source=EXPERIMENT_DECISION_SOURCE,
        )
        message = (
            f"Recorded: {current_variant_id} was rejected in {experiment.get('experiment_id') or 'the active experiment'}. "
            f"{current_variant_id} remains in experiment history but will not be used."
        )
        summary = (
            f"Latest explicit user decision: rejected {current_variant_id}. "
            f"{current_variant_id} remains in experiment history but will not be used."
        )
    else:
        experiment["preferred_baseline_variant_id"] = current_variant_id
        updated_variant.setdefault("decision_status", _decision_status(updated_variant))
        updated_variant["decision_order"] = decision_order
        updated_variant["decision_timestamp"] = str(timestamp or "").strip()
        updated_variant["decision_source"] = EXPERIMENT_DECISION_SOURCE
        baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
        message = (
            f"Recorded: {current_variant_id} is now the preferred baseline in "
            f"{experiment.get('experiment_id') or 'the active experiment'}. "
            f"Later baseline comparisons will reference {current_variant_id}. "
            f"{_original_baseline_sentence_text(baseline_variant_id)}"
        )
        summary = (
            f"Latest explicit user decision: set {current_variant_id} as the preferred baseline. "
            f"Later baseline comparisons will reference {current_variant_id}. "
            f"{_original_baseline_sentence_text(baseline_variant_id)}"
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


def apply_experiment_navigation(
    state: Dict[str, Any],
    *,
    prompt: str,
    timestamp: str,
) -> tuple[Dict[str, Any], Dict[str, Any] | None, str | None]:
    _ = timestamp
    normalized = normalize_prompt(prompt)
    open_match = _EXPERIMENT_OPEN_PROMPT.fullmatch(normalized)
    if open_match is None:
        return state, None, "AI-E can switch experiment context only from an explicit experiment navigation review prompt."

    experiment_id = open_match.group(1)
    tracking = dict(state.get("experiment_tracking") or {})
    experiments = [dict(item) for item in tracking.get("experiments", []) if isinstance(item, dict)]
    experiment = None
    for item in experiments:
        if str(item.get("experiment_id") or "").strip() == experiment_id:
            experiment = item
            break
    if experiment is None:
        available = _experiment_id_list_text(experiments)
        return state, None, f"AI-E could not find {experiment_id} in this session. Available experiments: {available}."

    previous_active_experiment_id = str(tracking.get("active_experiment_id") or "").strip()
    tracking["active_experiment_id"] = experiment_id
    state["experiment_tracking"] = tracking

    variants = _normalized_variants(experiment)
    active_variant = _active_variant(experiment, variants=variants)
    if active_variant:
        state["latest_experiment_variant"] = dict(active_variant)

    if previous_active_experiment_id == experiment_id:
        message = f"Active experiment context already points to {experiment_id}. No execution was started."
    else:
        message = (
            f"Active experiment context switched to {experiment_id}. "
            f"Current variant: {str(experiment.get('active_variant_id') or 'not available').strip() or 'not available'}. "
            f"Preferred baseline: {_preferred_baseline_summary_text(str(experiment.get('baseline_variant_id') or '').strip(), str(experiment.get('preferred_baseline_variant_id') or '').strip())}."
        )
    return state, {
        "experiment_id": experiment_id,
        "previous_active_experiment_id": previous_active_experiment_id,
        "message": message,
        "source": EXPERIMENT_NAVIGATION_SOURCE,
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
    jump_height_record = _family_record(state, family="jump_height", target_context=target_context)
    gravity_record = _family_record(state, family="gravity", target_context=target_context)
    acceleration_record = _family_record(state, family="acceleration", target_context=target_context)
    max_speed_record = _family_record(state, family="max_speed", target_context=target_context)

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
        "jump_height_tier": str(jump_height_record.get("resulting_tier") or "").strip(),
        "jump_height_value": jump_height_record.get("observed_value"),
        "gravity_tier": str(gravity_record.get("resulting_tier") or "").strip(),
        "gravity_value": gravity_record.get("observed_value"),
        "acceleration_tier": str(acceleration_record.get("resulting_tier") or "").strip(),
        "acceleration_value": acceleration_record.get("observed_value"),
        "max_speed_tier": str(max_speed_record.get("resulting_tier") or "").strip(),
        "max_speed_value": max_speed_record.get("observed_value"),
        "generic_capability_state": build_generic_capability_state(
            target_context=target_context,
            speed_tier=str(speed_record.get("resulting_tier") or "").strip(),
            speed_value=speed_record.get("observed_value"),
            aggression_tier=str(aggression_record.get("resulting_tier") or "").strip(),
            aggression_value=aggression_record.get("observed_value"),
            encounter_count_tier=str(count_record.get("resulting_tier") or "").strip(),
            encounter_count_value=count_record.get("observed_value"),
            spawn_pressure_tier=str(pressure_record.get("resulting_tier") or "").strip(),
            spawn_pressure_value=pressure_record.get("observed_value"),
            jump_height_tier=str(jump_height_record.get("resulting_tier") or "").strip(),
            jump_height_value=jump_height_record.get("observed_value"),
            gravity_tier=str(gravity_record.get("resulting_tier") or "").strip(),
            gravity_value=gravity_record.get("observed_value"),
            acceleration_tier=str(acceleration_record.get("resulting_tier") or "").strip(),
            acceleration_value=acceleration_record.get("observed_value"),
            max_speed_tier=str(max_speed_record.get("resulting_tier") or "").strip(),
            max_speed_value=max_speed_record.get("observed_value"),
        ),
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
            jump_height_tier=str(jump_height_record.get("resulting_tier") or "").strip(),
            gravity_tier=str(gravity_record.get("resulting_tier") or "").strip(),
            acceleration_tier=str(acceleration_record.get("resulting_tier") or "").strip(),
            max_speed_tier=str(max_speed_record.get("resulting_tier") or "").strip(),
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


def _review_variant_line(
    variant: Dict[str, Any],
    *,
    baseline_variant: Dict[str, Any],
    baseline_variant_id: str,
    preferred_baseline_variant_id: str,
    experiment_target_context: str,
    current_variant_id: str = "",
) -> str:
    variant_id = str(variant.get("variant_id") or "").strip()
    prompt = str(
        variant.get("source_prompt")
        or variant.get("canonical_prompt")
        or f"Supported {experiment_target_context or 'tuning'} change"
    ).strip()
    outcome = str(variant.get("outcome_summary") or "Outcome summary not available").strip()
    target_context = _variant_target_context(variant, experiment_target_context=experiment_target_context)
    status_text = ", ".join(
        _variant_status_labels(
            variant,
            baseline_variant_id=baseline_variant_id,
            preferred_baseline_variant_id=preferred_baseline_variant_id,
            current_variant_id=current_variant_id,
        )
    )
    return (
        f"{variant_id} | target context: {tuning_context_display_name(target_context)} | "
        f"status: {status_text} | prompt: {prompt} | outcome: {outcome} | "
        f"deltas from baseline: {_baseline_delta_text(variant, baseline_variant=baseline_variant)}."
    )


def _review_overview(
    *,
    experiment_id: str,
    variants: List[Dict[str, Any]],
    current_variant_id: str,
    baseline_variant_id: str,
    preferred_baseline_variant_id: str,
    target_context: str,
    review_label: str,
    latest_decision: str = "",
) -> str:
    lines = [
        f"{review_label}: {experiment_id or 'active experiment'}.",
        f"Recorded variants: {len(variants)}.",
        f"Target context: {tuning_context_display_name(target_context)}.",
        f"Current variant: {current_variant_id or 'not available'}.",
        f"Original baseline: {baseline_variant_id or 'not available'}.",
        f"Preferred baseline: {_preferred_baseline_summary_text(baseline_variant_id, preferred_baseline_variant_id)}.",
        f"Kept variants: {_kept_variants_text(variants)}.",
        f"Rejected variants: {_rejected_variants_text(variants)}.",
        f"Undecided variants: {_undecided_variants_text(variants)}.",
    ]
    if latest_decision:
        lines.append(latest_decision)
    return "\n".join(lines)


def _build_experiment_list_preview(session_state: Dict[str, Any]) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    if not experiments:
        message = _no_experiments_message("show experiments")
        return _navigation_block(
            title="Experiment list",
            overview=message,
            reason="no_experiment_history",
        )

    tracking = session_state.get("experiment_tracking") if isinstance(session_state.get("experiment_tracking"), dict) else {}
    active_experiment_id = str((tracking or {}).get("active_experiment_id") or "").strip()
    lines = [_experiment_list_line(experiment, is_active=str(experiment.get("experiment_id") or "").strip() == active_experiment_id) for experiment in experiments]
    overview_lines = [
        "Experiment list.",
        f"Recorded experiments: {len(experiments)}.",
        f"Active experiment: {active_experiment_id or 'not set'}.",
    ]
    return {
        "blocked": False,
        "title": "Experiment list",
        "overview": "\n".join(overview_lines),
        "lines": lines,
        "recommended_action": "refresh_summary",
        "decision_reason": "experiment_navigation_list",
        "plan_execution_mode": "Explicit experiment navigation",
        "expected_outcome": "Review only. No execution will start.",
    }


def _build_experiment_selection_preview(session_state: Dict[str, Any], *, experiment_id: str) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    experiment = _experiment_by_id(experiments, experiment_id)
    if experiment is None:
        message = _experiment_not_found_message(experiment_id, experiments=experiments)
        return _navigation_block(
            title="Switch experiment context",
            overview=message,
            reason="experiment_not_found",
            lines=_available_experiment_prompts(experiments),
        )

    tracking = session_state.get("experiment_tracking") if isinstance(session_state.get("experiment_tracking"), dict) else {}
    previous_active_experiment_id = str((tracking or {}).get("active_experiment_id") or "").strip()
    variants = _normalized_variants(experiment)
    overview_lines = [
        f"Experiment context switch: {experiment_id}.",
        f"Current active experiment: {previous_active_experiment_id or 'not set'}.",
        f"Requested active experiment: {experiment_id}.",
        "Execution: none.",
    ]
    return {
        "blocked": False,
        "title": "Switch experiment context",
        "overview": "\n".join(overview_lines),
        "lines": [
            f"Selected experiment: {experiment_id}.",
            f"Target context: {tuning_context_display_name(_experiment_target_context(experiment, variants=variants))}.",
            f"Recorded variants: {len(variants)}.",
            f"Current variant: {str(experiment.get('active_variant_id') or 'not available').strip() or 'not available'}.",
            f"Original baseline: {str(experiment.get('baseline_variant_id') or 'not available').strip() or 'not available'}.",
            f"Preferred baseline: {_preferred_baseline_summary_text(str(experiment.get('baseline_variant_id') or '').strip(), str(experiment.get('preferred_baseline_variant_id') or '').strip())}.",
            f"Context change after review: active experiment -> {experiment_id}.",
        ],
        "recommended_action": "set_active_experiment_context",
        "decision_reason": "experiment_context_switch",
        "plan_execution_mode": "Current session context switch",
        "expected_outcome": "Review only. No execution will start.",
    }


def _build_experiment_summary_preview(session_state: Dict[str, Any], *, experiment_id: str) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    experiment = _experiment_by_id(experiments, experiment_id)
    if experiment is None:
        message = _experiment_not_found_message(experiment_id, experiments=experiments)
        return _navigation_block(
            title="Experiment summary",
            overview=message,
            reason="experiment_not_found",
            lines=_available_experiment_prompts(experiments),
        )

    variants = _normalized_variants(experiment)
    if not variants:
        return _navigation_block(
            title="Experiment summary",
            overview=f"AI-E found {experiment_id}, but it does not have any recorded variants yet.",
            reason="experiment_has_no_variants",
        )

    current_variant_id = str(experiment.get("active_variant_id") or variants[-1].get("variant_id") or "").strip()
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
    target_context = _experiment_target_context(experiment, variants=variants)
    baseline_variant = _variant_by_id(variants, baseline_variant_id)
    variant_lines = [
        _review_variant_line(
            variant,
            baseline_variant=baseline_variant,
            baseline_variant_id=baseline_variant_id,
            preferred_baseline_variant_id=preferred_baseline_variant_id,
            experiment_target_context=target_context,
            current_variant_id=current_variant_id,
        )
        for variant in variants
    ]
    overview = _review_overview(
        experiment_id=experiment_id,
        variants=variants,
        current_variant_id=current_variant_id,
        baseline_variant_id=baseline_variant_id,
        preferred_baseline_variant_id=preferred_baseline_variant_id,
        target_context=target_context,
        review_label="Experiment summary",
        latest_decision=_latest_decision_summary(experiment),
    )
    return {
        "blocked": False,
        "title": "Experiment summary",
        "overview": overview,
        "lines": variant_lines,
        "recommended_action": "refresh_summary",
        "decision_reason": "experiment_navigation_summary",
        "plan_execution_mode": "Explicit experiment navigation",
        "expected_outcome": "Review only. No execution will start.",
    }


def _build_variant_inspection_preview(session_state: Dict[str, Any], *, variant_id: str) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    if not experiments:
        message = _no_experiments_message(f"show {variant_id}")
        return _navigation_block(
            title="Variant details",
            overview=message,
            reason="no_experiment_history",
        )

    resolved = _resolve_variant_selection(session_state, variant_id=variant_id, experiments=experiments)
    if resolved.get("blocked"):
        return resolved

    experiment = dict(resolved.get("experiment") or {})
    variant = dict(resolved.get("variant") or {})
    experiment_id = str(experiment.get("experiment_id") or "").strip()
    variants = _normalized_variants(experiment)
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
    baseline_variant = _variant_by_id(variants, baseline_variant_id)
    target_context = _variant_target_context(variant, experiment_target_context=_experiment_target_context(experiment, variants=variants))
    lines = [
        f"Experiment: {experiment_id}.",
        f"Variant: {variant_id}.",
        f"Target context: {tuning_context_display_name(target_context)}.",
        f"Status: {', '.join(_variant_status_labels(variant, baseline_variant_id=baseline_variant_id, preferred_baseline_variant_id=preferred_baseline_variant_id, current_variant_id=str(experiment.get('active_variant_id') or '').strip()))}.",
        f"Prompt: {str(variant.get('source_prompt') or variant.get('canonical_prompt') or 'not available').strip() or 'not available'}.",
        f"Outcome: {str(variant.get('outcome_summary') or 'Outcome summary not available').strip()}.",
        f"Deltas from baseline: {_baseline_delta_text(variant, baseline_variant=baseline_variant)}.",
        f"Decision status: {_decision_status(variant)}.",
    ]
    evaluation_lines = _variant_evaluation_lines(session_state, experiment_id=experiment_id, variant_id=variant_id)
    if evaluation_lines:
        lines.append("Evaluation:")
        lines.extend(evaluation_lines)
    overview = "\n".join(
        [
            f"Variant inspection: {variant_id}.",
            f"Experiment: {experiment_id}.",
            f"Current experiment context: {str(session_state.get('experiment_tracking', {}).get('active_experiment_id') or 'not set') if isinstance(session_state.get('experiment_tracking'), dict) else 'not set'}.",
            "Execution: none.",
        ]
    )
    return {
        "blocked": False,
        "title": "Variant details",
        "overview": overview,
        "lines": lines,
        "recommended_action": "refresh_summary",
        "decision_reason": "experiment_variant_review",
        "plan_execution_mode": "Explicit experiment navigation",
        "expected_outcome": "Review only. No execution will start.",
    }


def _build_cross_experiment_variant_comparison_preview(
    session_state: Dict[str, Any],
    *,
    left_experiment_id: str,
    left_variant_id: str,
    right_experiment_id: str,
    right_variant_id: str,
) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    if left_experiment_id == right_experiment_id:
        return _navigation_block(
            title="Cross-experiment comparison",
            overview="AI-E cross-experiment comparison requires two different experiments.",
            reason="same_experiment_comparison",
            expected_outcome="Clarification only. No execution will start until you choose two different experiments.",
        )
    left_experiment = _experiment_by_id(experiments, left_experiment_id)
    right_experiment = _experiment_by_id(experiments, right_experiment_id)
    if left_experiment is None or right_experiment is None:
        missing = left_experiment_id if left_experiment is None else right_experiment_id
        return _navigation_block(
            title="Cross-experiment comparison",
            overview=_experiment_not_found_message(missing, experiments=experiments),
            reason="experiment_not_found",
            lines=_available_experiment_prompts(experiments),
        )
    left_variant = _variant_by_id(_normalized_variants(left_experiment), left_variant_id)
    right_variant = _variant_by_id(_normalized_variants(right_experiment), right_variant_id)
    if not left_variant or not right_variant:
        missing_variant = left_variant_id if not left_variant else right_variant_id
        missing_experiment = left_experiment_id if not left_variant else right_experiment_id
        return _navigation_block(
            title="Cross-experiment comparison",
            overview=f"AI-E could not find {missing_variant} in {missing_experiment}.",
            reason="variant_not_found",
            lines=[
                f"show {left_variant_id}",
                f"show {right_variant_id}",
            ],
        )
    return _comparison_preview_payload(
        title="Cross-experiment variant comparison",
        decision_reason="cross_experiment_variant_comparison",
        overview_lines=[
            "Cross-experiment variant comparison.",
            f"Left side: {left_experiment_id} / {left_variant_id}.",
            f"Right side: {right_experiment_id} / {right_variant_id}.",
            "Execution: none.",
        ],
        left_experiment=left_experiment,
        left_variant=left_variant,
        right_experiment=right_experiment,
        right_variant=right_variant,
        reference_label=f"{right_experiment_id} {right_variant_id}",
        state_section_label="Compared variant vs reference variant",
    )


def _build_cross_experiment_current_variant_comparison_preview(
    session_state: Dict[str, Any],
    *,
    left_experiment_id: str,
    right_experiment_id: str,
) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    left_experiment = _experiment_by_id(experiments, left_experiment_id)
    right_experiment = _experiment_by_id(experiments, right_experiment_id)
    if left_experiment is None or right_experiment is None:
        missing = left_experiment_id if left_experiment is None else right_experiment_id
        return _navigation_block(
            title="Cross-experiment comparison",
            overview=_experiment_not_found_message(missing, experiments=experiments),
            reason="experiment_not_found",
            lines=_available_experiment_prompts(experiments),
        )
    left_variant = _active_variant(left_experiment, variants=_normalized_variants(left_experiment))
    right_variant = _active_variant(right_experiment, variants=_normalized_variants(right_experiment))
    if not left_variant or not right_variant:
        return _navigation_block(
            title="Cross-experiment comparison",
            overview="AI-E can compare experiments only when both experiments have a current variant.",
            reason="experiment_has_no_current_variant",
        )
    return _comparison_preview_payload(
        title="Cross-experiment comparison",
        decision_reason="cross_experiment_current_variant_comparison",
        overview_lines=[
            "Cross-experiment comparison.",
            f"Left experiment: {left_experiment_id} (current {str(left_variant.get('variant_id') or '').strip()}).",
            f"Right experiment: {right_experiment_id} (current {str(right_variant.get('variant_id') or '').strip()}).",
            "Execution: none.",
        ],
        left_experiment=left_experiment,
        left_variant=left_variant,
        right_experiment=right_experiment,
        right_variant=right_variant,
        reference_label=f"{right_experiment_id} current variant",
        state_section_label="Current variant vs compared experiment current variant",
    )


def _build_cross_experiment_baseline_comparison_preview(
    session_state: Dict[str, Any],
    *,
    left_experiment_id: str,
    right_experiment_id: str,
) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    left_experiment = _experiment_by_id(experiments, left_experiment_id)
    right_experiment = _experiment_by_id(experiments, right_experiment_id)
    if left_experiment is None or right_experiment is None:
        missing = left_experiment_id if left_experiment is None else right_experiment_id
        return _navigation_block(
            title="Baseline comparison",
            overview=_experiment_not_found_message(missing, experiments=experiments),
            reason="experiment_not_found",
            lines=_available_experiment_prompts(experiments),
        )

    left_variants = _normalized_variants(left_experiment)
    right_variants = _normalized_variants(right_experiment)
    left_original = _variant_by_id(left_variants, str(left_experiment.get("baseline_variant_id") or "").strip())
    right_original = _variant_by_id(right_variants, str(right_experiment.get("baseline_variant_id") or "").strip())
    if not left_original or not right_original:
        return _navigation_block(
            title="Baseline comparison",
            overview="AI-E can compare baselines only when both experiments have an original baseline variant.",
            reason="baseline_not_found",
        )

    lines = [
        f"Left experiment: {left_experiment_id}.",
        f"Right experiment: {right_experiment_id}.",
        "Execution: none.",
        "Original baseline comparison:",
    ]
    lines.extend(
        _comparison_lines(
            left_experiment=left_experiment,
            left_variant=left_original,
            right_experiment=right_experiment,
            right_variant=right_original,
            reference_label=f"{right_experiment_id} original baseline",
            state_section_label="Original baseline vs original baseline",
        )
    )

    left_preferred_id = str(left_experiment.get("preferred_baseline_variant_id") or "").strip()
    right_preferred_id = str(right_experiment.get("preferred_baseline_variant_id") or "").strip()
    left_preferred = _variant_by_id(left_variants, left_preferred_id)
    right_preferred = _variant_by_id(right_variants, right_preferred_id)
    lines.append("Preferred baseline comparison:")
    if left_preferred and right_preferred:
        lines.extend(
            _comparison_lines(
                left_experiment=left_experiment,
                left_variant=left_preferred,
                right_experiment=right_experiment,
                right_variant=right_preferred,
                reference_label=f"{right_experiment_id} preferred baseline",
                state_section_label="Preferred baseline vs preferred baseline",
            )
        )
    else:
        lines.append("Preferred baseline comparison is not available because one or both experiments do not have a preferred baseline.")

    return {
        "blocked": False,
        "title": "Baseline comparison",
        "overview": "\n".join(
            [
                "Cross-experiment baseline comparison.",
                f"Left experiment: {left_experiment_id}.",
                f"Right experiment: {right_experiment_id}.",
                "Execution: none.",
            ]
        ),
        "lines": lines,
        "recommended_action": "refresh_summary",
        "decision_reason": "cross_experiment_baseline_comparison",
        "plan_execution_mode": "Explicit experiment navigation",
        "expected_outcome": "Review only. No execution will start.",
    }


def _build_ambiguous_variant_comparison_preview(session_state: Dict[str, Any], *, variant_id: str) -> Dict[str, Any]:
    experiments = _normalized_experiments(session_state)
    matches = [
        str(experiment.get("experiment_id") or "").strip()
        for experiment in experiments
        if _variant_by_id(_normalized_variants(experiment), variant_id)
    ]
    matches = [experiment_id for experiment_id in matches if experiment_id]
    if not matches:
        return _navigation_block(
            title="Clarify experiment comparison",
            overview=f"AI-E could not find {variant_id} in this session.",
            reason="variant_not_found",
            lines=_available_experiment_prompts(experiments),
        )
    options: List[str] = []
    for index, left_experiment_id in enumerate(matches):
        for right_experiment_id in matches[index + 1 :]:
            options.append(
                f"compare {variant_id} in {left_experiment_id} with {variant_id} in {right_experiment_id}"
            )
    if not options:
        options = [f"show {variant_id}"]
    return _navigation_block(
        title="Clarify experiment comparison",
        overview=f"This request is ambiguous across experiments. Specify which experiment variants to compare for {variant_id}.",
        reason="ambiguous_experiment_comparison",
        lines=options,
        clarification_options=options,
        expected_outcome="Clarification only. No execution will start until you choose explicit experiment variants.",
    )


def _comparison_preview_payload(
    *,
    title: str,
    decision_reason: str,
    overview_lines: List[str],
    left_experiment: Dict[str, Any],
    left_variant: Dict[str, Any],
    right_experiment: Dict[str, Any],
    right_variant: Dict[str, Any],
    reference_label: str,
    state_section_label: str,
) -> Dict[str, Any]:
    return {
        "blocked": False,
        "title": title,
        "overview": "\n".join(overview_lines),
        "lines": _comparison_lines(
            left_experiment=left_experiment,
            left_variant=left_variant,
            right_experiment=right_experiment,
            right_variant=right_variant,
            reference_label=reference_label,
            state_section_label=state_section_label,
        ),
        "recommended_action": "refresh_summary",
        "decision_reason": decision_reason,
        "plan_execution_mode": "Explicit experiment navigation",
        "expected_outcome": "Review only. No execution will start.",
    }


def _comparison_lines(
    *,
    left_experiment: Dict[str, Any],
    left_variant: Dict[str, Any],
    right_experiment: Dict[str, Any],
    right_variant: Dict[str, Any],
    reference_label: str,
    state_section_label: str,
) -> List[str]:
    left_snapshot = _variant_snapshot_for_comparison(left_experiment, left_variant)
    right_snapshot = _variant_snapshot_for_comparison(right_experiment, right_variant)
    comparison = _build_cross_experiment_comparison(
        left_snapshot,
        right_snapshot,
        reference_label=reference_label,
        state_section_label=state_section_label,
    )
    lines = [
        f"Left experiment: {str(left_experiment.get('experiment_id') or '').strip()}.",
        f"Left variant: {str(left_variant.get('variant_id') or '').strip()}.",
        f"Left target context: {tuning_context_display_name(str(left_snapshot.get('target_context') or '').strip())}.",
        f"Right experiment: {str(right_experiment.get('experiment_id') or '').strip()}.",
        f"Right variant: {str(right_variant.get('variant_id') or '').strip()}.",
        f"Right target context: {tuning_context_display_name(str(right_snapshot.get('target_context') or '').strip())}.",
    ]
    lines.extend(
        [line.strip() for line in str(comparison.get("comparison_description") or "").splitlines() if line.strip()]
    )
    differences = [
        str(item).strip()
        for item in (comparison.get("detected_differences") or [])
        if str(item).strip()
    ]
    if differences:
        lines.append("Explicit deltas:")
        lines.extend(differences)
    return lines


def _build_cross_experiment_comparison(
    left_snapshot: Dict[str, Any],
    right_snapshot: Dict[str, Any],
    *,
    reference_label: str,
    state_section_label: str,
) -> Dict[str, Any]:
    from .outcome_evaluation import build_structured_state_comparison

    return build_structured_state_comparison(
        right_snapshot,
        left_snapshot,
        reference_label=reference_label,
        state_section_label=state_section_label,
        inline_key_differences=True,
    )


def _variant_snapshot_for_comparison(experiment: Dict[str, Any], variant: Dict[str, Any]) -> Dict[str, Any]:
    target_context = _variant_target_context(
        variant,
        experiment_target_context=_experiment_target_context(experiment, variants=_normalized_variants(experiment)),
    )
    movement_target = None
    movement_value = variant.get("movement_value")
    if isinstance(movement_value, list) and len(movement_value) >= 3:
        movement_target = _float_or_none(movement_value[2])
    return {
        "experiment_id": str(experiment.get("experiment_id") or "").strip(),
        "variant_id": str(variant.get("variant_id") or "").strip(),
        "target_context": target_context,
        "target_entity": target_context,
        "speed_tier": str(variant.get("speed_tier") or "").strip(),
        "aggression_tier": str(variant.get("aggression_tier") or "").strip(),
        "movement_tier": str(variant.get("movement_tier") or "").strip(),
        "movement_target_z": movement_target,
        "encounter_count_tier": str(variant.get("encounter_count_tier") or "").strip(),
        "encounter_count_value": _float_or_none(variant.get("encounter_count_value")),
        "spawn_pressure_tier": str(variant.get("spawn_pressure_tier") or "").strip(),
        "spawn_pressure_value": _float_or_none(variant.get("spawn_pressure_value")),
        "jump_height_tier": str(variant.get("jump_height_tier") or "").strip(),
        "jump_height_value": _float_or_none(variant.get("jump_height_value")),
        "gravity_tier": str(variant.get("gravity_tier") or "").strip(),
        "gravity_value": _float_or_none(variant.get("gravity_value")),
        "acceleration_tier": str(variant.get("acceleration_tier") or "").strip(),
        "acceleration_value": _float_or_none(variant.get("acceleration_value")),
        "max_speed_tier": str(variant.get("max_speed_tier") or "").strip(),
        "max_speed_value": _float_or_none(variant.get("max_speed_value")),
        "generic_capability_state": list(variant.get("generic_capability_state") or []),
    }


def _resolve_variant_selection(
    session_state: Dict[str, Any],
    *,
    variant_id: str,
    experiments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    active_experiment = _active_experiment(session_state)
    if active_experiment is not None:
        active_variant = _variant_by_id(_normalized_variants(active_experiment), variant_id)
        if active_variant:
            return {"blocked": False, "experiment": active_experiment, "variant": active_variant}

    matches: List[Dict[str, Any]] = []
    for experiment in experiments:
        variant = _variant_by_id(_normalized_variants(experiment), variant_id)
        if variant:
            matches.append({"experiment": experiment, "variant": variant})

    if not matches:
        active_experiment_id = ""
        if active_experiment is not None:
            active_experiment_id = str(active_experiment.get("experiment_id") or "").strip()
        message = _variant_not_found_message(variant_id, active_experiment_id=active_experiment_id, experiments=experiments)
        return _navigation_block(
            title="Variant details",
            overview=message,
            reason="variant_not_found",
            lines=_available_experiment_prompts(experiments),
        )

    if len(matches) > 1:
        options = [f"open {str(match['experiment'].get('experiment_id') or '').strip()}" for match in matches if str(match['experiment'].get('experiment_id') or '').strip()]
        return _navigation_block(
            title="Clarify experiment context",
            overview="This request is ambiguous across multiple experiments. Choose one explicit experiment context first.",
            reason="ambiguous_experiment_context",
            lines=options,
            clarification_options=options,
            expected_outcome="Clarification only. No execution will start until you choose one explicit experiment.",
        )

    return {"blocked": False, **matches[0]}


def _variant_evaluation_lines(session_state: Dict[str, Any], *, experiment_id: str, variant_id: str) -> List[str]:
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
        if str(item.get("variant_id") or "").strip() != variant_id:
            continue
        description = str(item.get("experiment_comparison_description") or item.get("comparison_description") or "").strip()
        if description:
            return [line.strip() for line in description.splitlines() if line.strip()]
        differences = item.get("detected_differences")
        if isinstance(differences, list):
            lines = [str(line).strip() for line in differences if str(line).strip()]
            if lines:
                return lines

    return ["Structured evaluation is not available for this variant yet."]


def _normalized_experiments(session_state: Dict[str, Any]) -> List[Dict[str, Any]]:
    tracking = session_state.get("experiment_tracking")
    if not isinstance(tracking, dict):
        return []
    experiments = tracking.get("experiments")
    if not isinstance(experiments, list):
        return []
    return [dict(item) for item in experiments if isinstance(item, dict)]


def _experiment_by_id(experiments: List[Dict[str, Any]], experiment_id: str) -> Dict[str, Any] | None:
    target_id = str(experiment_id or "").strip()
    if not target_id:
        return None
    for experiment in experiments:
        if str(experiment.get("experiment_id") or "").strip() == target_id:
            return dict(experiment)
    return None


def _experiment_list_line(experiment: Dict[str, Any], *, is_active: bool) -> str:
    variants = _normalized_variants(experiment)
    experiment_id = str(experiment.get("experiment_id") or "").strip() or "not available"
    target_context = tuning_context_display_name(_experiment_target_context(experiment, variants=variants))
    baseline_variant_id = str(experiment.get("baseline_variant_id") or "").strip()
    preferred_baseline_variant_id = str(experiment.get("preferred_baseline_variant_id") or "").strip()
    current_variant_id = str(experiment.get("active_variant_id") or variants[-1].get("variant_id") if variants else "").strip() or "not available"
    status = "active" if is_active else "inactive"
    return (
        f"{experiment_id} | target context: {target_context} | status: {status} | variants: {len(variants)} | "
        f"current: {current_variant_id} | original baseline: {baseline_variant_id or 'not available'} | "
        f"preferred baseline: {_preferred_baseline_summary_text(baseline_variant_id, preferred_baseline_variant_id)}."
    )


def _experiment_id_list_text(experiments: List[Dict[str, Any]]) -> str:
    ids = [str(item.get("experiment_id") or "").strip() for item in experiments if str(item.get("experiment_id") or "").strip()]
    if not ids:
        return "none"
    return ", ".join(ids)


def _available_experiment_prompts(experiments: List[Dict[str, Any]]) -> List[str]:
    return [f"open {experiment_id}" for experiment_id in _experiment_id_list_text(experiments).split(", ") if experiment_id and experiment_id != "none"]


def _navigation_block(
    *,
    title: str,
    overview: str,
    reason: str,
    lines: List[str] | None = None,
    clarification_options: List[str] | None = None,
    expected_outcome: str = "Review only. No execution will start.",
) -> Dict[str, Any]:
    return {
        "blocked": True,
        "title": title,
        "overview": overview,
        "lines": [str(item).strip() for item in (lines or []) if str(item).strip()],
        "recommended_action": "refresh_summary",
        "decision_reason": reason,
        "plan_execution_mode": "Explicit experiment navigation",
        "expected_outcome": expected_outcome,
        "clarification_options": [str(item).strip() for item in (clarification_options or []) if str(item).strip()],
    }


def _no_experiments_message(prompt: str) -> str:
    _ = prompt
    return (
        "AI-E can show experiment history only after a supported tuning result creates at least one experiment in this session. "
        "Start with something like: 'make zombie faster', 'make runner faster', or 'increase encounter count'."
    )


def _experiment_not_found_message(experiment_id: str, *, experiments: List[Dict[str, Any]]) -> str:
    return f"AI-E could not find {experiment_id} in this session. Available experiments: {_experiment_id_list_text(experiments)}."


def _variant_not_found_message(variant_id: str, *, active_experiment_id: str, experiments: List[Dict[str, Any]]) -> str:
    if active_experiment_id:
        return f"AI-E could not find {variant_id} in {active_experiment_id}. Available experiments: {_experiment_id_list_text(experiments)}."
    return f"AI-E could not find {variant_id} in this session. Available experiments: {_experiment_id_list_text(experiments)}."


def _decision_preview_overview(
    *,
    experiment_id: str,
    decision_action: str,
    current_variant_id: str,
    preferred_baseline_variant_id: str,
    baseline_variant_id: str,
) -> str:
    action_label = {
        "keep_current_variant": "keep current variant",
        "reject_current_variant": "reject current variant",
        "set_current_variant_as_baseline": "set current variant as baseline",
    }.get(decision_action, decision_action.replace("_", " "))
    lines = [
        f"Decision preview: {experiment_id or 'active experiment'}.",
        f"Action: {action_label}.",
    ]
    if decision_action == "keep_current_variant":
        lines.append(f"Status change: {current_variant_id} -> kept.")
    elif decision_action == "reject_current_variant":
        lines.append(f"Status change: {current_variant_id} -> rejected.")
    else:
        lines.append("Status change: none; current variant status stays recorded as-is.")
    lines.append(
        f"Preferred baseline change: {_preferred_baseline_change_text(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}"
    )
    lines.append(
        f"Comparison reference after decision: {_comparison_reference_after_decision(preferred_baseline_variant_id, baseline_variant_id=baseline_variant_id, action=decision_action, current_variant_id=current_variant_id)}."
    )
    lines.append(f"Original baseline lineage: {_original_baseline_lineage_text(baseline_variant_id)}.")
    lines.append("Execution: none.")
    return "\n".join(lines)


def _variant_status_labels(
    variant: Dict[str, Any],
    *,
    baseline_variant_id: str,
    preferred_baseline_variant_id: str,
    current_variant_id: str,
) -> List[str]:
    variant_id = str(variant.get("variant_id") or "").strip()
    labels: List[str] = []
    if current_variant_id and variant_id == current_variant_id:
        labels.append("current")
    if bool(variant.get("baseline_marker")) or (baseline_variant_id and variant_id == baseline_variant_id):
        labels.append("original baseline")
    if preferred_baseline_variant_id and variant_id == preferred_baseline_variant_id:
        labels.append("preferred baseline")
    labels.append(_decision_status(variant))
    return labels


def _variant_by_id(variants: List[Dict[str, Any]], variant_id: str) -> Dict[str, Any]:
    target_variant_id = str(variant_id or "").strip()
    if not target_variant_id:
        return {}
    for variant in variants:
        if str(variant.get("variant_id") or "").strip() == target_variant_id:
            return dict(variant)
    return {}


def _variant_target_context(variant: Dict[str, Any], *, experiment_target_context: str) -> str:
    detected = detect_supported_tuning_context(
        variant.get("target_context"),
        variant.get("target_entity"),
        variant.get("source_prompt"),
        variant.get("canonical_prompt"),
    )
    if detected:
        return detected
    return experiment_target_context


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


def _kept_variants_text(variants: List[Dict[str, Any]]) -> str:
    kept = [
        str(variant.get("variant_id") or "").strip()
        for variant in variants
        if _decision_status(variant) == "kept"
    ]
    kept = [variant_id for variant_id in kept if variant_id]
    if not kept:
        return "none"
    return ", ".join(kept)


def _undecided_variants_text(variants: List[Dict[str, Any]]) -> str:
    undecided = [
        str(variant.get("variant_id") or "").strip()
        for variant in variants
        if _decision_status(variant) == "undecided"
    ]
    undecided = [variant_id for variant_id in undecided if variant_id]
    if not undecided:
        return "none"
    return ", ".join(undecided)


def _preferred_baseline_summary_text(baseline_variant_id: str, preferred_baseline_variant_id: str) -> str:
    preferred_variant_id = str(preferred_baseline_variant_id or "").strip()
    baseline_id = str(baseline_variant_id or "").strip()
    if preferred_variant_id:
        if baseline_id and preferred_variant_id == baseline_id:
            return f"{preferred_variant_id} (same as original baseline)"
        return preferred_variant_id
    if baseline_id:
        return f"not set; comparisons default to {baseline_id}"
    return "not set"


def _preferred_baseline_change_text(
    preferred_baseline_variant_id: str,
    *,
    baseline_variant_id: str,
    action: str,
    current_variant_id: str,
) -> str:
    current_preferred = str(preferred_baseline_variant_id or "").strip()
    baseline_id = str(baseline_variant_id or "").strip()
    if action == "set_current_variant_as_baseline":
        if current_preferred and current_preferred != current_variant_id:
            return f"{current_preferred} -> {current_variant_id}."
        if current_preferred == current_variant_id:
            return f"none; remains {current_variant_id}."
        if baseline_id:
            return f"{baseline_id} -> {current_variant_id}."
        return f"not set -> {current_variant_id}."
    if current_preferred:
        return f"none; remains {current_preferred}."
    if baseline_id:
        return f"none; comparisons continue to use original baseline {baseline_id}."
    return "none; no preferred baseline is set."


def _comparison_reference_after_decision(
    preferred_baseline_variant_id: str,
    *,
    baseline_variant_id: str,
    action: str,
    current_variant_id: str,
) -> str:
    if action == "set_current_variant_as_baseline" and current_variant_id:
        return current_variant_id
    preferred_variant_id = str(preferred_baseline_variant_id or "").strip()
    if preferred_variant_id:
        return preferred_variant_id
    baseline_id = str(baseline_variant_id or "").strip()
    if baseline_id:
        return baseline_id
    return "not set"


def _original_baseline_lineage_text(baseline_variant_id: str) -> str:
    baseline_id = str(baseline_variant_id or "").strip()
    if baseline_id:
        return f"remains {baseline_id}"
    return "remains unchanged"


def _original_baseline_sentence_text(baseline_variant_id: str) -> str:
    baseline_id = str(baseline_variant_id or "").strip()
    if baseline_id:
        return f"Original baseline remains {baseline_id}."
    return "Original baseline lineage remains unchanged."


def _baseline_delta_text(variant: Dict[str, Any], *, baseline_variant: Dict[str, Any]) -> str:
    if not baseline_variant:
        return "not available"
    variant_id = str(variant.get("variant_id") or "").strip()
    baseline_variant_id = str(baseline_variant.get("variant_id") or "").strip()
    if variant_id and baseline_variant_id and variant_id == baseline_variant_id:
        return "none"

    deltas: List[str] = []
    speed_delta = _tier_delta_text(variant, baseline_variant=baseline_variant, key="speed_tier", label="Speed")
    if speed_delta:
        deltas.append(speed_delta)
    aggression_delta = _tier_delta_text(variant, baseline_variant=baseline_variant, key="aggression_tier", label="Aggression")
    if aggression_delta:
        deltas.append(aggression_delta)
    movement_delta = _movement_delta_text(variant, baseline_variant=baseline_variant)
    if movement_delta:
        deltas.append(movement_delta)
    count_delta = _encounter_count_delta_text(variant, baseline_variant=baseline_variant)
    if count_delta:
        deltas.append(count_delta)
    pressure_delta = _spawn_pressure_delta_text(variant, baseline_variant=baseline_variant)
    if pressure_delta:
        deltas.append(pressure_delta)
    jump_height_delta = _tier_delta_text(variant, baseline_variant=baseline_variant, key="jump_height_tier", label="Jump height")
    if jump_height_delta:
        deltas.append(jump_height_delta)
    gravity_delta = _tier_delta_text(variant, baseline_variant=baseline_variant, key="gravity_tier", label="Gravity")
    if gravity_delta:
        deltas.append(gravity_delta)
    acceleration_delta = _tier_delta_text(variant, baseline_variant=baseline_variant, key="acceleration_tier", label="Acceleration")
    if acceleration_delta:
        deltas.append(acceleration_delta)
    max_speed_delta = _tier_delta_text(variant, baseline_variant=baseline_variant, key="max_speed_tier", label="Max speed")
    if max_speed_delta:
        deltas.append(max_speed_delta)

    if not deltas:
        return "none"
    return "; ".join(deltas)


def _tier_delta_text(variant: Dict[str, Any], *, baseline_variant: Dict[str, Any], key: str, label: str) -> str:
    baseline_value = str(baseline_variant.get(key) or "").strip()
    current_value = str(variant.get(key) or "").strip()
    if not baseline_value or not current_value or baseline_value == current_value:
        return ""
    return f"{label}: {baseline_value} -> {current_value}"


def _movement_delta_text(variant: Dict[str, Any], *, baseline_variant: Dict[str, Any]) -> str:
    baseline_value = baseline_variant.get("movement_value")
    current_value = variant.get("movement_value")
    if isinstance(baseline_value, (int, float)) and isinstance(current_value, (int, float)) and baseline_value != current_value:
        return f"Movement target: Z={baseline_value:g} -> Z={current_value:g}"
    return _tier_delta_text(variant, baseline_variant=baseline_variant, key="movement_tier", label="Movement")


def _encounter_count_delta_text(variant: Dict[str, Any], *, baseline_variant: Dict[str, Any]) -> str:
    baseline_value = baseline_variant.get("encounter_count_value")
    current_value = variant.get("encounter_count_value")
    if isinstance(baseline_value, (int, float)) and isinstance(current_value, (int, float)) and baseline_value != current_value:
        return f"Spawn count: {baseline_value:g} -> {current_value:g}"
    return _tier_delta_text(variant, baseline_variant=baseline_variant, key="encounter_count_tier", label="Spawn count")


def _spawn_pressure_delta_text(variant: Dict[str, Any], *, baseline_variant: Dict[str, Any]) -> str:
    baseline_value = baseline_variant.get("spawn_pressure_value")
    current_value = variant.get("spawn_pressure_value")
    if isinstance(baseline_value, (int, float)) and isinstance(current_value, (int, float)) and baseline_value != current_value:
        pressure_note = "higher pressure" if current_value < baseline_value else "lower pressure"
        return f"Spawn interval: {baseline_value:g}s -> {current_value:g}s ({pressure_note})"
    return _tier_delta_text(variant, baseline_variant=baseline_variant, key="spawn_pressure_tier", label="Spawn pressure")


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
    jump_height_tier: str,
    gravity_tier: str,
    acceleration_tier: str,
    max_speed_tier: str,
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
    if jump_height_tier:
        parts.append(f"jump height {jump_height_tier}")
    if gravity_tier:
        parts.append(f"gravity {gravity_tier.replace('_', ' ')}")
    if acceleration_tier:
        parts.append(f"acceleration {acceleration_tier}")
    if max_speed_tier:
        parts.append(f"max speed {max_speed_tier}")
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
    if str(experiment.get("target_context") or experiment.get("target_entity") or "").strip() == "platformer":
        return platformer_display_name(None)
    if str(experiment.get("target_context") or experiment.get("target_entity") or "").strip() == "racer":
        return racing_display_name(None)
    return encounter_display_name(None)


def _int_or_default(value: Any, *, default: int) -> int:
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


def _bool_or_default(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


__all__ = [
    "EXPERIMENT_NAVIGATION_RESOLUTION",
    "EXPERIMENT_NAVIGATION_SOURCE",
    "EXPERIMENT_DECISION_RESOLUTION",
    "EXPERIMENT_DECISION_SOURCE",
    "EXPERIMENT_REVIEW_RESOLUTION",
    "apply_experiment_navigation",
    "apply_experiment_decision",
    "apply_experiment_tracking",
    "build_experiment_navigation_preview",
    "build_current_experiment_decisions",
    "build_current_experiment_review",
    "build_experiment_decision_preview",
    "find_experiment_by_id",
    "find_variant_by_id",
    "find_variant_for_task",
    "is_experiment_decision_prompt",
    "is_experiment_decisions_prompt",
    "is_experiment_navigation_prompt",
    "is_experiment_review_prompt",
]
