"""Declarative bounded policy definitions for supervised task chains."""
from __future__ import annotations

from dataclasses import dataclass

from .task_chain_models import (
    TaskChainBranchRule,
    TaskChainFallbackAction,
    TaskChainProgressState,
    TaskChainRecord,
    TaskChainStepRecord,
)


V1_CHAIN_TYPES = frozenset({"validate_then_report", "feature_validate_loop", "dispatch_validate_recover"})
V2_CHAIN_TYPES = frozenset({"validate_with_fallback", "validate_compare_report", "dispatch_recover_resume", "feature_validate_gate"})


@dataclass(frozen=True)
class TaskChainDecision:
    progress_state: TaskChainProgressState
    matched_rule_id: str
    next_stage: str
    next_action: str
    transition_reason: str
    summary: str
    terminal_status: str = ""
    pause_reason: str = ""
    report_status: str = ""
    fallback_action_id: str = ""


def build_chain_policy(
    *,
    chain_type: str,
    fallback_kind: str,
    fallback_selector: str,
    fallback_display: str,
) -> tuple[str, str, tuple[TaskChainBranchRule, ...], tuple[TaskChainFallbackAction, ...], tuple[str, ...]]:
    if chain_type in V1_CHAIN_TYPES:
        return "v1", _initial_stage(chain_type), (), (), ()
    if chain_type == "validate_with_fallback":
        fallback_actions = _fallback_actions(fallback_kind=fallback_kind, fallback_selector=fallback_selector, fallback_display=fallback_display)
        return "v2", "validate_primary", (
            TaskChainBranchRule(
                rule_id="validate-primary-success",
                stage="validate_primary",
                step_statuses=("success",),
                next_stage="report",
                next_action="final report",
                transition_reason="validation_succeeded",
                report_status="completed",
                summary_template="Primary validation succeeded; emit the final report.",
            ),
            TaskChainBranchRule(
                rule_id="validate-primary-fallback",
                stage="validate_primary",
                step_statuses=("failed", "timed_out", "unavailable", "refused"),
                next_stage="validate_fallback",
                next_action="fallback validation",
                transition_reason="fallback_selected",
                fallback_action_id="fallback-validate",
                summary_template="Primary validation did not succeed; run the approved fallback validation.",
            ),
            TaskChainBranchRule(
                rule_id="validate-fallback-success",
                stage="validate_fallback",
                step_statuses=("success",),
                next_stage="report",
                next_action="final report",
                transition_reason="fallback_recovered",
                report_status="completed",
                fallback_action_id="fallback-validate",
                summary_template="Fallback validation recovered the chain; emit the final report.",
            ),
            TaskChainBranchRule(
                rule_id="validate-fallback-failed",
                stage="validate_fallback",
                step_statuses=("failed", "timed_out", "unavailable", "refused"),
                next_stage="report",
                next_action="final report",
                transition_reason="fallback_exhausted",
                report_status="failed",
                fallback_action_id="fallback-validate",
                summary_template="Fallback validation also failed; emit a failure report.",
            ),
        ), fallback_actions, _default_transition_reasons()
    if chain_type == "validate_compare_report":
        fallback_actions = _fallback_actions(fallback_kind=fallback_kind, fallback_selector=fallback_selector, fallback_display=fallback_display, action_id="compare-validate", reason="compare_result")
        return "v2", "validate_primary", (
            TaskChainBranchRule(
                rule_id="compare-primary-recorded",
                stage="validate_primary",
                step_statuses=("success", "failed", "timed_out", "unavailable", "refused"),
                next_stage="compare_target",
                next_action="comparison validation",
                transition_reason="primary_result_recorded",
                fallback_action_id="compare-validate",
                summary_template="Primary validation recorded; run the comparison target next.",
            ),
            TaskChainBranchRule(
                rule_id="compare-target-complete",
                stage="compare_target",
                step_statuses=("success", "failed", "timed_out", "unavailable", "refused"),
                next_stage="report",
                next_action="final comparison report",
                transition_reason="comparison_complete",
                report_status="auto_compare",
                fallback_action_id="compare-validate",
                summary_template="Comparison run recorded; emit the comparison report.",
            ),
        ), fallback_actions, _default_transition_reasons()
    if chain_type == "dispatch_recover_resume":
        fallback_actions = _fallback_actions(fallback_kind=fallback_kind, fallback_selector=fallback_selector, fallback_display=fallback_display)
        return "v2", "validate_primary", (
            TaskChainBranchRule(
                rule_id="dispatch-primary-success",
                stage="validate_primary",
                step_statuses=("success",),
                next_stage="report",
                next_action="final report",
                transition_reason="primary_dispatch_succeeded",
                report_status="completed",
                summary_template="Primary dispatch validation succeeded; emit the final report.",
            ),
            TaskChainBranchRule(
                rule_id="dispatch-primary-fallback",
                stage="validate_primary",
                step_statuses=("failed", "timed_out", "unavailable", "refused"),
                next_stage="validate_fallback",
                next_action="fallback recovery validation",
                transition_reason="fallback_selected",
                fallback_action_id="fallback-validate",
                summary_template="Primary dispatch path degraded; run the approved recovery path.",
            ),
            TaskChainBranchRule(
                rule_id="dispatch-fallback-success",
                stage="validate_fallback",
                step_statuses=("success",),
                next_stage="report",
                next_action="final report",
                transition_reason="recovered_state",
                report_status="completed",
                fallback_action_id="fallback-validate",
                summary_template="Recovery path succeeded; emit the final report.",
            ),
            TaskChainBranchRule(
                rule_id="dispatch-fallback-pause",
                stage="validate_fallback",
                step_statuses=("failed", "timed_out", "unavailable", "refused"),
                next_stage="validate_fallback",
                next_action="operator review",
                transition_reason="fallback_exhausted",
                pause_reason="Fallback recovery path is exhausted. Inspect the last decision and resume only if the environment changed.",
                fallback_action_id="fallback-validate",
                summary_template="Recovery path failed; pause for operator review.",
            ),
        ), fallback_actions, _default_transition_reasons()
    if chain_type == "feature_validate_gate":
        return "v2", "feature_gate_before", (
            TaskChainBranchRule(
                rule_id="feature-gate-before-success",
                stage="feature_gate_before",
                step_statuses=("success",),
                next_stage="validate_primary",
                next_action="bounded validation",
                transition_reason="feature_gate_confirmed",
                summary_template="Feature bundle context is present; run the bounded validation step.",
            ),
            TaskChainBranchRule(
                rule_id="feature-gate-before-pause",
                stage="feature_gate_before",
                step_statuses=("failed",),
                next_stage="feature_gate_before",
                next_action="operator review",
                transition_reason="feature_gate_missing",
                pause_reason="No active bounded feature bundle is available for this chain.",
                summary_template="Feature bundle context is missing; pause safely.",
            ),
            TaskChainBranchRule(
                rule_id="feature-validate-success",
                stage="validate_primary",
                step_statuses=("success",),
                next_stage="feature_gate_after",
                next_action="post-validation feature gate",
                transition_reason="validation_succeeded",
                summary_template="Validation succeeded; re-check feature bundle state before reporting.",
            ),
            TaskChainBranchRule(
                rule_id="feature-validate-pause",
                stage="validate_primary",
                step_statuses=("failed", "timed_out", "unavailable", "refused"),
                next_stage="validate_primary",
                next_action="operator review",
                transition_reason="validation_failed",
                pause_reason="Validation did not clear the feature gate. Inspect the result before resuming.",
                summary_template="Validation failed inside the gated chain; pause for operator review.",
            ),
            TaskChainBranchRule(
                rule_id="feature-gate-after-success",
                stage="feature_gate_after",
                step_statuses=("success",),
                next_stage="report",
                next_action="final report",
                transition_reason="feature_gate_closed",
                report_status="completed",
                summary_template="Feature bundle gate passed after validation; emit the final report.",
            ),
            TaskChainBranchRule(
                rule_id="feature-gate-after-pause",
                stage="feature_gate_after",
                step_statuses=("failed",),
                next_stage="feature_gate_after",
                next_action="operator review",
                transition_reason="feature_gate_lost",
                pause_reason="Feature bundle context changed after validation. Inspect the bundle before resuming.",
                summary_template="Post-validation feature gate failed; pause for operator review.",
            ),
        ), (), _default_transition_reasons()
    raise ValueError(f"Unsupported task chain type: {chain_type}")


def evaluate_chain_decision(*, chain: TaskChainRecord, step: TaskChainStepRecord) -> TaskChainDecision:
    progress_state = classify_progress_state(chain=chain, step=step)
    current_stage = chain.metadata.get("stage", "")
    for rule in chain.branch_rules:
        if rule.stage != current_stage:
            continue
        if rule.step_statuses and step.status not in rule.step_statuses:
            continue
        if rule.progress_states and progress_state not in rule.progress_states:
            continue
        summary = rule.summary_template or _default_summary(rule=rule, step=step)
        return TaskChainDecision(
            progress_state=progress_state,
            matched_rule_id=rule.rule_id,
            next_stage=rule.next_stage,
            next_action=rule.next_action,
            transition_reason=rule.transition_reason,
            summary=summary,
            terminal_status=rule.terminal_status,
            pause_reason=rule.pause_reason,
            report_status=rule.report_status,
            fallback_action_id=rule.fallback_action_id,
        )
    return TaskChainDecision(
        progress_state="paused",
        matched_rule_id="no-rule-match",
        next_stage=current_stage,
        next_action="operator review",
        transition_reason="unsupported_transition",
        summary="No approved transition rule matched the latest step outcome.",
        pause_reason="No approved transition matched the observed result. Inspect the chain decision before resuming.",
    )


def classify_progress_state(*, chain: TaskChainRecord, step: TaskChainStepRecord) -> TaskChainProgressState:
    if step.status == "success":
        if chain.failure_count > 0 or chain.no_progress_count > 0 or chain.metadata.get("stage", "") in {"validate_fallback", "feature_gate_after"}:
            return "recovered"
        return "progress_made"
    if step.status in {"unavailable", "timed_out", "refused"}:
        return "degraded"
    if step.failure_reason and step.failure_reason == chain.last_failure_reason:
        return "repeated_failure"
    return "no_progress"


def report_status_for_decision(*, chain: TaskChainRecord, step: TaskChainStepRecord, decision: TaskChainDecision) -> str:
    if decision.report_status and decision.report_status != "auto_compare":
        return decision.report_status
    if decision.report_status == "auto_compare":
        primary_success = chain.success_count > 0
        current_success = step.status == "success"
        return "completed" if primary_success or current_success else "failed"
    return chain.metadata.get("report_status", "completed")


def _fallback_actions(
    *,
    fallback_kind: str,
    fallback_selector: str,
    fallback_display: str,
    action_id: str = "fallback-validate",
    reason: str = "fallback_selected",
) -> tuple[TaskChainFallbackAction, ...]:
    if not fallback_display or fallback_display == "stop":
        return ()
    step_family = "dispatch" if fallback_kind in {"node", "role"} else "test"
    return (
        TaskChainFallbackAction(
            action_id=action_id,
            step_family=step_family,
            target_kind=fallback_kind,  # type: ignore[arg-type]
            target_selector=fallback_selector,
            target_display=fallback_display,
            reason=reason,
        ),
    )


def _initial_stage(chain_type: str) -> str:
    if chain_type == "validate_then_report":
        return "validate"
    if chain_type == "dispatch_validate_recover":
        return "primary_validate"
    return ""


def _default_transition_reasons() -> tuple[str, ...]:
    return (
        "validation_succeeded",
        "validation_failed",
        "primary_result_recorded",
        "comparison_complete",
        "fallback_selected",
        "fallback_recovered",
        "fallback_exhausted",
        "primary_dispatch_succeeded",
        "recovered_state",
        "feature_gate_confirmed",
        "feature_gate_missing",
        "feature_gate_closed",
        "feature_gate_lost",
        "unsupported_transition",
    )


def _default_summary(*, rule: TaskChainBranchRule, step: TaskChainStepRecord) -> str:
    return f"Rule {rule.rule_id} matched after step {step.step_number} {step.family} {step.status}."