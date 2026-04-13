from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from .execution_history import ExecutionHistory
from .models import (
    ActivePolicyProfile,
    ArtifactRequirementStatus,
    AuditEventType,
    AutonomyActionType,
    AutonomyPolicyContext,
    AutonomyPolicyDecision,
    AutonomyPolicyReason,
    AutonomyPolicyStatus,
    AwarenessBlockerKind,
    DependencyStatus,
    LifecycleState,
    MultiTaskSessionStatus,
    PolicyConfigStatus,
    PolicyEvaluationResult,
    PolicyGateRequirement,
    SessionHealthSummary,
)
from .policy_config import PolicyConfigLoader


class AutonomyPolicy:
    """Evaluate bounded action permissions without selecting, executing, or mutating work."""

    _SUPPORTED_ACTIONS = {
        AutonomyActionType.RUN_SINGLE_CYCLE,
        AutonomyActionType.RUN_BOUNDED_LOOP,
        AutonomyActionType.RESUME_SESSION,
        AutonomyActionType.APPROVE_GATE,
        AutonomyActionType.REPRIORITIZE_SESSION,
        AutonomyActionType.INSPECT_ONLY,
        AutonomyActionType.SELECT_SESSION,
        AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE,
    }
    _SUPPORTED_OPERATOR_ACTIONS = {
        AutonomyActionType.RUN_SINGLE_CYCLE,
        AutonomyActionType.RUN_BOUNDED_LOOP,
        AutonomyActionType.APPROVE_GATE,
        AutonomyActionType.REPRIORITIZE_SESSION,
        AutonomyActionType.INSPECT_ONLY,
        AutonomyActionType.SELECT_SESSION,
    }

    def __init__(
        self,
        *,
        active_policy_profile: ActivePolicyProfile | None = None,
        policy_config_loader: PolicyConfigLoader | None = None,
        execution_history: ExecutionHistory | None = None,
    ) -> None:
        self._policy_config_loader = policy_config_loader or PolicyConfigLoader()
        self._active_policy_profile = active_policy_profile or self._policy_config_loader.load_profile("standard")
        self._execution_history = execution_history

    def evaluate(self, context: AutonomyPolicyContext) -> PolicyEvaluationResult:
        action_type = self._normalize_action_type(context.action_type)
        active_profile = context.active_policy_profile or self._active_policy_profile
        context = replace(context, active_policy_profile=active_profile)
        if action_type is None:
            result = self._build_invalid_decision(
                context=context,
                reasons=(AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,),
                note="The requested autonomy action type is not recognized.",
            )
            self._record_policy_decision(result)
            return result
        if context.awareness_snapshot is None:
            result = self._build_invalid_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.UNSAFE_STATE,),
                note="Policy evaluation requires an awareness snapshot derived from current system truth.",
            )
            self._record_policy_decision(result)
            return result
        if active_profile.status not in {PolicyConfigStatus.LOADED, PolicyConfigStatus.FALLBACK_DEFAULT}:
            result = self._build_invalid_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.UNSAFE_STATE,),
                note="Policy evaluation requires a valid active policy configuration profile.",
            )
            self._record_policy_decision(result)
            return result
        if action_type not in self._SUPPORTED_ACTIONS:
            result = self._build_unsupported_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.UNSUPPORTED_IN_V1,),
                note=f"Action type {action_type.value} is outside the bounded autonomy policy v1 surface.",
            )
            self._record_policy_decision(result)
            return result
        if action_type == AutonomyActionType.INSPECT_ONLY:
            if not active_profile.effective_flags.allow_inspection_commands:
                result = self._build_blocked_decision(
                    context=context,
                    action_type=action_type,
                    reasons=(AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,),
                    note=f"Policy profile {active_profile.profile_name.value} disables inspection commands.",
                )
                self._record_policy_decision(result)
                return result
            reason = (
                AutonomyPolicyReason.OPERATOR_COMMAND_PRESENT
                if context.operator_command_present
                else AutonomyPolicyReason.SELF_INITIATED_ACTION_ALLOWED
            )
            result = self._build_allowed_decision(
                context=context,
                action_type=action_type,
                reasons=(reason,),
                note="Inspect-only actions are always allowed because they do not mutate bounded execution state.",
            )
            self._record_policy_decision(result)
            return result
        if context.operator_command_present:
            result = self._evaluate_operator_command(context, action_type)
        else:
            result = self._evaluate_self_initiated_action(context, action_type)
        self._record_policy_decision(result)
        return result

    def _record_policy_decision(self, result: PolicyEvaluationResult) -> None:
        if self._execution_history is None:
            return
        reason = result.decision.reasons[0].value if result.decision.reasons else None
        self._execution_history.record_event(
            event_type=AuditEventType.POLICY_DECISION_MADE,
            session_id=result.decision.target_session_id,
            action_type=(
                result.decision.action_type.value
                if hasattr(result.decision.action_type, "value")
                else str(result.decision.action_type)
            ),
            policy_decision=result.decision.decision_status.value,
            reason=reason,
            source_component="autonomy_policy",
            notes=result.decision.policy_notes,
        )

    def _evaluate_operator_command(
        self,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
    ) -> PolicyEvaluationResult:
        active_profile = context.active_policy_profile or self._active_policy_profile
        if action_type not in self._SUPPORTED_OPERATOR_ACTIONS:
            return self._build_unsupported_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.UNSUPPORTED_IN_V1,),
                note=f"Operator-driven action {action_type.value} is not supported in autonomy policy v1.",
            )
        if action_type in {AutonomyActionType.RUN_SINGLE_CYCLE, AutonomyActionType.RUN_BOUNDED_LOOP}:
            if context.requested_max_cycles is not None and context.requested_max_cycles < 1:
                return self._build_invalid_decision(
                    context=context,
                    action_type=action_type,
                    reasons=(AutonomyPolicyReason.LOOP_BUDGET_EXCEEDED,),
                    note="Loop commands require a positive bounded cycle budget.",
                )
            if context.requested_max_cycles is not None and context.requested_max_cycles > active_profile.effective_limits.max_bounded_loop_cycles:
                return self._build_blocked_decision(
                    context=context,
                    action_type=action_type,
                    reasons=(AutonomyPolicyReason.LOOP_BUDGET_EXCEEDED,),
                    note=(
                        f"Policy profile {active_profile.profile_name.value} caps bounded loop requests at "
                        f"{active_profile.effective_limits.max_bounded_loop_cycles} cycle(s)."
                    ),
                )
        if action_type == AutonomyActionType.RUN_SINGLE_CYCLE and not active_profile.effective_flags.allow_operator_run_single_cycle:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,),
                note=f"Policy profile {active_profile.profile_name.value} disables operator single-cycle execution.",
            )
        if action_type == AutonomyActionType.RUN_BOUNDED_LOOP and not active_profile.effective_flags.allow_operator_run_loop:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,),
                note=f"Policy profile {active_profile.profile_name.value} disables operator bounded-loop execution.",
            )
        if action_type == AutonomyActionType.REPRIORITIZE_SESSION and not active_profile.effective_flags.allow_operator_reprioritization:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,),
                note=f"Policy profile {active_profile.profile_name.value} disables operator reprioritization.",
            )
        if action_type == AutonomyActionType.SELECT_SESSION and not active_profile.effective_flags.allow_select_session_validation:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,),
                note=f"Policy profile {active_profile.profile_name.value} disables session selection validation.",
            )

        target_summary = self._find_session_summary(context)
        if target_summary is not None and target_summary.session_status in {
            MultiTaskSessionStatus.FAILED,
            MultiTaskSessionStatus.INVALID,
        }:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.UNSAFE_STATE,),
                note=(
                    f"Operator command {action_type.value} is blocked because session {target_summary.session_id} "
                    "is already failed or invalid."
                ),
            )
        if action_type == AutonomyActionType.SELECT_SESSION:
            if target_summary is None or not target_summary.actionable:
                return self._build_blocked_decision(
                    context=context,
                    action_type=action_type,
                    reasons=(AutonomyPolicyReason.SESSION_NOT_ACTIONABLE,),
                    note="Session selection is blocked because the target session is not currently actionable.",
                )

        return self._build_allowed_decision(
            context=context,
            action_type=action_type,
            reasons=(AutonomyPolicyReason.OPERATOR_COMMAND_PRESENT,),
            note=f"Action {action_type.value} is permitted because an explicit operator command is present.",
        )

    def _evaluate_self_initiated_action(
        self,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
    ) -> PolicyEvaluationResult:
        active_profile = context.active_policy_profile or self._active_policy_profile
        if action_type != AutonomyActionType.SELF_INITIATED_LOOP_ADVANCE:
            return self._build_requires_approval_decision(
                context=context,
                action_type=action_type,
                reasons=(
                    AutonomyPolicyReason.MISSING_REQUIRED_APPROVAL,
                    AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,
                ),
                gate_requirement=PolicyGateRequirement.OPERATOR_COMMAND,
                note=f"Action {action_type.value} requires an explicit operator command in autonomy policy v1.",
            )

        if not active_profile.effective_flags.allow_self_initiated_loop_advance:
            return self._build_requires_approval_decision(
                context=context,
                action_type=action_type,
                reasons=(
                    AutonomyPolicyReason.POLICY_DISALLOWS_ACTION_TYPE,
                    AutonomyPolicyReason.MISSING_REQUIRED_APPROVAL,
                ),
                gate_requirement=PolicyGateRequirement.OPERATOR_COMMAND,
                note=f"Policy profile {active_profile.profile_name.value} disables self-initiated loop advancement.",
            )

        if (
            context.requested_max_cycles is not None
            and context.requested_max_cycles > active_profile.effective_limits.max_bounded_loop_cycles
        ):
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.LOOP_BUDGET_EXCEEDED,),
                note=(
                    f"Policy profile {active_profile.profile_name.value} caps bounded loop requests at "
                    f"{active_profile.effective_limits.max_bounded_loop_cycles} cycle(s)."
                ),
            )

        if context.requested_max_cycles is not None and context.current_cycle_index >= context.requested_max_cycles:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.LOOP_BUDGET_EXCEEDED,),
                note="Self-initiated loop advancement is blocked because the bounded cycle budget is exhausted.",
            )

        snapshot = context.awareness_snapshot.snapshot
        target_summary = self._find_session_summary(context)
        if snapshot.invalid_session_ids or snapshot.failed_session_ids:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.UNSAFE_STATE,),
                note="Self-initiated advancement is blocked because the system contains failed or invalid sessions.",
            )
        if target_summary is not None and not target_summary.actionable:
            return self._blocked_decision_for_summary(context, action_type, target_summary)
        if target_summary is None and snapshot.active_session_ids:
            return self._build_allowed_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.SELF_INITIATED_ACTION_ALLOWED,),
                note="Self-initiated loop advancement is allowed because at least one bounded session is actionable.",
            )
        if target_summary is not None and target_summary.actionable:
            return self._build_allowed_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.SELF_INITIATED_ACTION_ALLOWED,),
                note=f"Self-initiated loop advancement is allowed for actionable session {target_summary.session_id}.",
            )
        if snapshot.waiting_session_ids:
            gate_requirement = self._derive_gate_requirement(context)
            return self._build_requires_approval_decision(
                context=context,
                action_type=action_type,
                reasons=(
                    AutonomyPolicyReason.WAITING_ON_HUMAN_GATE,
                    AutonomyPolicyReason.MISSING_REQUIRED_APPROVAL,
                ),
                gate_requirement=gate_requirement,
                note="Self-initiated loop advancement is blocked until the required human gate is cleared.",
            )

        blocker_reason = self._blocked_reason_from_awareness(context)
        if blocker_reason is not None:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(blocker_reason, AutonomyPolicyReason.SELF_INITIATED_ACTION_BLOCKED),
                note=f"Self-initiated loop advancement is blocked because the current bounded state reports {blocker_reason.value}.",
            )
        return self._build_blocked_decision(
            context=context,
            action_type=action_type,
            reasons=(AutonomyPolicyReason.SESSION_NOT_ACTIONABLE,),
            note="Self-initiated loop advancement is blocked because no actionable session exists.",
        )

    def _blocked_decision_for_summary(
        self,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
        summary: SessionHealthSummary,
    ) -> PolicyEvaluationResult:
        if summary.lifecycle_state in {
            LifecycleState.AWAITING_CONFIRMATION,
            LifecycleState.AWAITING_REVIEW,
            LifecycleState.AWAITING_PLAYTEST,
        }:
            gate_requirement = self._derive_gate_requirement(context, summary)
            return self._build_requires_approval_decision(
                context=context,
                action_type=action_type,
                reasons=(
                    AutonomyPolicyReason.WAITING_ON_HUMAN_GATE,
                    AutonomyPolicyReason.MISSING_REQUIRED_APPROVAL,
                ),
                gate_requirement=gate_requirement,
                note=(
                    f"Self-initiated loop advancement is blocked because session {summary.session_id} is waiting on "
                    f"{gate_requirement.value}."
                ),
            )
        if summary.dependency_status == DependencyStatus.BLOCKED_BY_DEPENDENCY:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.BLOCKED_BY_DEPENDENCY,),
                note=f"Self-initiated loop advancement is blocked because session {summary.session_id} is waiting on dependencies.",
            )
        if summary.requirement_status in {
            ArtifactRequirementStatus.BLOCKED_BY_MISSING_ARTIFACT,
            ArtifactRequirementStatus.BLOCKED_BY_INVALID_ARTIFACT,
        }:
            return self._build_blocked_decision(
                context=context,
                action_type=action_type,
                reasons=(AutonomyPolicyReason.BLOCKED_BY_ARTIFACT,),
                note=f"Self-initiated loop advancement is blocked because session {summary.session_id} is waiting on required artifacts.",
            )
        return self._build_blocked_decision(
            context=context,
            action_type=action_type,
            reasons=(AutonomyPolicyReason.SESSION_NOT_ACTIONABLE,),
            note=f"Self-initiated loop advancement is blocked because session {summary.session_id} is not actionable.",
        )

    def _build_allowed_decision(
        self,
        *,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
        reasons: tuple[AutonomyPolicyReason, ...],
        note: str,
    ) -> PolicyEvaluationResult:
        return self._result(
            context=context,
            action_type=action_type,
            status=AutonomyPolicyStatus.ALLOWED,
            reasons=reasons,
            operator_approval_required=False,
            gate_requirement=PolicyGateRequirement.NONE,
            notes=(note,),
        )

    def _build_blocked_decision(
        self,
        *,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
        reasons: tuple[AutonomyPolicyReason, ...],
        note: str,
    ) -> PolicyEvaluationResult:
        return self._result(
            context=context,
            action_type=action_type,
            status=AutonomyPolicyStatus.BLOCKED,
            reasons=reasons,
            operator_approval_required=False,
            gate_requirement=PolicyGateRequirement.NONE,
            notes=(note,),
        )

    def _build_requires_approval_decision(
        self,
        *,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
        reasons: tuple[AutonomyPolicyReason, ...],
        gate_requirement: PolicyGateRequirement,
        note: str,
    ) -> PolicyEvaluationResult:
        return self._result(
            context=context,
            action_type=action_type,
            status=AutonomyPolicyStatus.REQUIRES_OPERATOR_APPROVAL,
            reasons=reasons,
            operator_approval_required=True,
            gate_requirement=gate_requirement,
            notes=(note,),
        )

    def _build_unsupported_decision(
        self,
        *,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType,
        reasons: tuple[AutonomyPolicyReason, ...],
        note: str,
    ) -> PolicyEvaluationResult:
        return self._result(
            context=context,
            action_type=action_type,
            status=AutonomyPolicyStatus.UNSUPPORTED,
            reasons=reasons,
            operator_approval_required=False,
            gate_requirement=PolicyGateRequirement.NONE,
            notes=(note,),
        )

    def _build_invalid_decision(
        self,
        *,
        context: AutonomyPolicyContext,
        reasons: tuple[AutonomyPolicyReason, ...],
        note: str,
        action_type: AutonomyActionType | None = None,
    ) -> PolicyEvaluationResult:
        resolved_action = action_type or self._normalize_action_type(context.action_type) or context.action_type
        decision = AutonomyPolicyDecision(
            action_type=resolved_action,
            target_session_id=context.target_session_id,
            decision_status=AutonomyPolicyStatus.INVALID_REQUEST,
            reasons=reasons,
            operator_approval_required=False,
            gate_requirement=PolicyGateRequirement.NONE,
            policy_notes=(note,),
            evaluation_time=self._timestamp(),
            context_summary=self._context_summary(context),
        )
        return PolicyEvaluationResult(context=context, decision=decision)

    def _result(
        self,
        *,
        context: AutonomyPolicyContext,
        action_type: AutonomyActionType | str,
        status: AutonomyPolicyStatus,
        reasons: tuple[AutonomyPolicyReason, ...],
        operator_approval_required: bool,
        gate_requirement: PolicyGateRequirement,
        notes: tuple[str, ...],
    ) -> PolicyEvaluationResult:
        decision = AutonomyPolicyDecision(
            action_type=action_type,
            target_session_id=context.target_session_id,
            decision_status=status,
            reasons=reasons,
            operator_approval_required=operator_approval_required,
            gate_requirement=gate_requirement,
            policy_notes=notes,
            evaluation_time=self._timestamp(),
            context_summary=self._context_summary(context),
        )
        return PolicyEvaluationResult(context=context, decision=decision)

    @staticmethod
    def _normalize_action_type(action_type: AutonomyActionType | str) -> AutonomyActionType | None:
        if isinstance(action_type, AutonomyActionType):
            return action_type
        try:
            return AutonomyActionType(action_type)
        except ValueError:
            return None

    @staticmethod
    def _find_session_summary(context: AutonomyPolicyContext) -> SessionHealthSummary | None:
        if context.awareness_snapshot is None or context.target_session_id is None:
            return None
        for summary in context.awareness_snapshot.session_summaries:
            if summary.session_id == context.target_session_id:
                return summary
        return None

    def _derive_gate_requirement(
        self,
        context: AutonomyPolicyContext,
        summary: SessionHealthSummary | None = None,
    ) -> PolicyGateRequirement:
        resolved_summary = summary or self._find_session_summary(context)
        if resolved_summary is not None:
            if resolved_summary.lifecycle_state == LifecycleState.AWAITING_CONFIRMATION:
                return PolicyGateRequirement.CONFIRMATION
            if resolved_summary.lifecycle_state == LifecycleState.AWAITING_REVIEW:
                return PolicyGateRequirement.REVIEW
            if resolved_summary.lifecycle_state == LifecycleState.AWAITING_PLAYTEST:
                return PolicyGateRequirement.PLAYTEST
        if context.awareness_snapshot is None:
            return PolicyGateRequirement.OPERATOR_COMMAND
        for blocker in context.awareness_snapshot.blocker_summaries:
            if blocker.blocker_kind == AwarenessBlockerKind.WAITING_ON_CONFIRMATION:
                return PolicyGateRequirement.CONFIRMATION
            if blocker.blocker_kind == AwarenessBlockerKind.WAITING_ON_REVIEW:
                return PolicyGateRequirement.REVIEW
            if blocker.blocker_kind == AwarenessBlockerKind.WAITING_ON_PLAYTEST:
                return PolicyGateRequirement.PLAYTEST
        return PolicyGateRequirement.OPERATOR_COMMAND

    @staticmethod
    def _blocked_reason_from_awareness(context: AutonomyPolicyContext) -> AutonomyPolicyReason | None:
        if context.awareness_snapshot is None:
            return AutonomyPolicyReason.UNSAFE_STATE
        blocker_kinds = {blocker.blocker_kind for blocker in context.awareness_snapshot.blocker_summaries}
        if blocker_kinds & {
            AwarenessBlockerKind.INVALID_DEPENDENCY_CONFIGURATION,
            AwarenessBlockerKind.INVALID_ARTIFACT_REQUIREMENT,
            AwarenessBlockerKind.INVALID_SESSION_STATE,
            AwarenessBlockerKind.FAILED_SESSION,
            AwarenessBlockerKind.BLOCKED_BY_EXECUTION_STATE,
        }:
            return AutonomyPolicyReason.UNSAFE_STATE
        if AwarenessBlockerKind.BLOCKED_BY_DEPENDENCY in blocker_kinds:
            return AutonomyPolicyReason.BLOCKED_BY_DEPENDENCY
        if AwarenessBlockerKind.BLOCKED_BY_ARTIFACT in blocker_kinds:
            return AutonomyPolicyReason.BLOCKED_BY_ARTIFACT
        return None

    @staticmethod
    def _context_summary(context: AutonomyPolicyContext) -> str:
        if context.awareness_snapshot is None:
            return (
                f"policy_profile={context.active_policy_profile.profile_name.value if context.active_policy_profile else 'none'}; "
                f"operator_command_present={context.operator_command_present}; "
                f"requested_max_cycles={context.requested_max_cycles}; "
                f"current_cycle_index={context.current_cycle_index}"
            )
        snapshot = context.awareness_snapshot.snapshot
        return (
            f"policy_profile={context.active_policy_profile.profile_name.value if context.active_policy_profile else 'none'}; "
            f"operator_command_present={context.operator_command_present}; "
            f"active={len(snapshot.active_session_ids)}; waiting={len(snapshot.waiting_session_ids)}; "
            f"blocked={len(snapshot.blocked_session_ids)}; failed={len(snapshot.failed_session_ids)}; "
            f"invalid={len(snapshot.invalid_session_ids)}; requested_max_cycles={context.requested_max_cycles}; "
            f"current_cycle_index={context.current_cycle_index}"
        )

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()