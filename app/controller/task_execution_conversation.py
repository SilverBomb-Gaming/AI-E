"""Deterministic conversational planner for bounded task-chain execution."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
import json

from .feature_bundle_models import FeatureBundleRecord


@dataclass(frozen=True)
class TaskExecutionConversationRequest:
    intent: str
    scope_key: str
    title: str
    objective: str
    chain_type: str
    bounded_command: str
    max_steps: int
    max_failures: int
    max_no_progress: int
    missing_fields: tuple[str, ...] = ()
    clarification_question: str = ""
    requires_clarification: bool = False


@dataclass(frozen=True)
class TaskExecutionConversationOutcome:
    matched: bool
    request: TaskExecutionConversationRequest | None = None
    reply: str = ""
    routed_command: str = ""
    summary: str = ""
    telemetry: dict[str, object] = field(default_factory=dict)


class TaskExecutionConversationPlanner:
    """Compile a narrow set of natural-language validation requests into task-chain previews."""

    _EXECUTION_MARKERS = (
        "run",
        "validate",
        "verification",
        "verify",
        "check",
        "test",
        "tests",
        "smoke",
        "regression",
        "execution loop",
        "task execution",
    )
    _STACK_MARKERS = (
        "full stack",
        "full conversational ingestion stack",
        "ingestion stack",
        "clarification loop and ingestion",
        "ingestion and clarification",
        "full regression",
        "full conversational stack",
        "conversation stack",
    )
    _CONVERSATIONAL_MARKERS = (
        "conversational",
        "clarification",
        "multi-turn",
        "accessibility layer",
        "conversation",
    )
    _POLICY_MARKERS = (
        "policy-aware",
        "policy aware",
        "ingestion pipeline",
        "source ingest",
        "ingest docs",
    )
    _GENERIC_INGESTION_MARKERS = (
        "ingestion",
        "ingest",
    )

    def plan(
        self,
        *,
        message: str,
        previous_request: TaskExecutionConversationRequest | None = None,
        active_feature_bundle: FeatureBundleRecord | None = None,
    ) -> TaskExecutionConversationOutcome:
        normalized = " ".join(message.lower().split())
        feature_bundle_outcome = self._plan_feature_bundle_action(
            normalized=normalized,
            active_feature_bundle=active_feature_bundle,
        )
        if feature_bundle_outcome is not None:
            return feature_bundle_outcome
        if previous_request is not None and previous_request.requires_clarification:
            return self._continue_from_clarification(message=message, normalized=normalized, previous_request=previous_request)
        if not self._looks_like_execution_request(normalized):
            return TaskExecutionConversationOutcome(matched=False)
        scope_key = self._detect_scope(normalized)
        if not scope_key:
            partial = TaskExecutionConversationRequest(
                intent="validate_repo_slice",
                scope_key="",
                title="",
                objective="",
                chain_type="validate_then_report",
                bounded_command="",
                max_steps=2,
                max_failures=2,
                max_no_progress=1,
                missing_fields=("scope",),
                clarification_question=(
                    "What should I validate: policy-aware ingestion, conversational ingestion, or the full conversational ingestion stack?"
                ),
                requires_clarification=True,
            )
            return TaskExecutionConversationOutcome(
                matched=True,
                request=partial,
                reply=self._format_clarification(partial),
                summary="Conversational execution request needs a bounded validation target.",
                telemetry={"requires_clarification": True, "missing_fields": list(partial.missing_fields)},
            )
        request = self._build_request(scope_key)
        return TaskExecutionConversationOutcome(
            matched=True,
            request=request,
            reply=self._format_preparation_reply(request),
            routed_command=self._build_chain_create_command(request),
            summary=f"Prepared bounded task-chain definition for {request.scope_key}.",
            telemetry={
                "requires_clarification": False,
                "scope_key": request.scope_key,
                "chain_type": request.chain_type,
                "bounded_command": request.bounded_command,
            },
        )

    def _continue_from_clarification(
        self,
        *,
        message: str,
        normalized: str,
        previous_request: TaskExecutionConversationRequest,
    ) -> TaskExecutionConversationOutcome:
        scope_key = self._detect_scope(normalized)
        if not scope_key:
            partial = replace(previous_request, requires_clarification=True)
            return TaskExecutionConversationOutcome(
                matched=True,
                request=partial,
                reply=self._format_clarification(partial),
                summary="Conversational execution follow-up still needs a bounded validation target.",
                telemetry={"requires_clarification": True, "missing_fields": list(partial.missing_fields)},
            )
        request = self._build_request(scope_key)
        return TaskExecutionConversationOutcome(
            matched=True,
            request=request,
            reply=self._format_preparation_reply(request),
            routed_command=self._build_chain_create_command(request),
            summary=f"Resolved conversational execution target from follow-up: {request.scope_key}.",
            telemetry={
                "requires_clarification": False,
                "scope_key": request.scope_key,
                "chain_type": request.chain_type,
                "bounded_command": request.bounded_command,
                "continued_from_clarification": True,
                "follow_up_message": " ".join(message.split()),
            },
        )

    def _plan_feature_bundle_action(
        self,
        *,
        normalized: str,
        active_feature_bundle: FeatureBundleRecord | None,
    ) -> TaskExecutionConversationOutcome | None:
        if active_feature_bundle is None:
            return None
        if self._looks_like_feature_bundle_apply_request(normalized):
            if active_feature_bundle.state != "proposed":
                return TaskExecutionConversationOutcome(
                    matched=True,
                    reply="\n".join(
                        (
                            f"Feature bundle {active_feature_bundle.bundle_id} is not waiting for apply approval.",
                            f"State: {active_feature_bundle.state}",
                            "Next: Use /featurestatus to inspect the active bundle before asking to apply it.",
                        )
                    ),
                    summary=f"Feature bundle {active_feature_bundle.bundle_id} is not in proposed state.",
                    telemetry={
                        "feature_bundle_id": active_feature_bundle.bundle_id,
                        "feature_bundle_state": active_feature_bundle.state,
                        "feature_bundle_action": "apply",
                    },
                )
            return TaskExecutionConversationOutcome(
                matched=True,
                reply="\n".join(
                    (
                        f"Preparing grouped apply approval for feature bundle {active_feature_bundle.bundle_id}.",
                        f"Feature: {active_feature_bundle.feature_title}",
                        "Mutation will still require explicit /confirm approval.",
                    )
                ),
                routed_command="/featureapply",
                summary=f"Prepared grouped apply request for feature bundle {active_feature_bundle.bundle_id}.",
                telemetry={
                    "feature_bundle_id": active_feature_bundle.bundle_id,
                    "feature_bundle_state": active_feature_bundle.state,
                    "feature_bundle_action": "apply",
                },
            )
        if self._looks_like_feature_bundle_validation_request(normalized):
            if active_feature_bundle.validation_plan is None or not active_feature_bundle.validation_plan.command_text.strip():
                return TaskExecutionConversationOutcome(
                    matched=True,
                    reply="\n".join(
                        (
                            f"Feature bundle {active_feature_bundle.bundle_id} does not have a bounded validation command.",
                            "Next: Use /featurestatus to inspect the bundle or prepare a new bounded feature request.",
                        )
                    ),
                    summary=f"Feature bundle {active_feature_bundle.bundle_id} has no validation plan.",
                    telemetry={
                        "feature_bundle_id": active_feature_bundle.bundle_id,
                        "feature_bundle_state": active_feature_bundle.state,
                        "feature_bundle_action": "validate",
                    },
                )
            request = self._build_feature_bundle_validation_request(active_feature_bundle)
            return TaskExecutionConversationOutcome(
                matched=True,
                request=request,
                reply="\n".join(
                    (
                        f"Preparing a gated validation chain for feature bundle {active_feature_bundle.bundle_id}.",
                        f"Command family: {request.bounded_command}",
                        "Execution will still require explicit /chainstart and /confirm approval.",
                    )
                ),
                routed_command=self._build_chain_create_command(request),
                summary=f"Prepared gated validation chain for feature bundle {active_feature_bundle.bundle_id}.",
                telemetry={
                    "feature_bundle_id": active_feature_bundle.bundle_id,
                    "feature_bundle_state": active_feature_bundle.state,
                    "feature_bundle_action": "validate",
                    "chain_type": request.chain_type,
                    "bounded_command": request.bounded_command,
                },
            )
        return None

    def _looks_like_execution_request(self, normalized: str) -> bool:
        return any(marker in normalized for marker in self._EXECUTION_MARKERS)

    @staticmethod
    def _looks_like_feature_bundle_apply_request(normalized: str) -> bool:
        exact_matches = {
            "apply it",
            "apply the bundle",
            "apply the feature bundle",
            "apply the active feature bundle",
            "go ahead and apply it",
            "go ahead with the feature bundle",
        }
        return normalized in exact_matches or (
            "apply" in normalized and "feature bundle" in normalized
        )

    @staticmethod
    def _looks_like_feature_bundle_validation_request(normalized: str) -> bool:
        exact_matches = {
            "validate it",
            "test it",
            "run validation",
            "validate the bundle",
            "validate the feature bundle",
            "validate the active feature bundle",
            "run the feature bundle validation",
            "test the feature bundle",
        }
        if normalized in exact_matches:
            return True
        has_validation_word = any(token in normalized for token in ("validate", "validation", "test", "verify", "smoke"))
        return has_validation_word and "feature bundle" in normalized

    def _detect_scope(self, normalized: str) -> str:
        has_policy = any(marker in normalized for marker in self._POLICY_MARKERS)
        has_generic_ingestion = any(marker in normalized for marker in self._GENERIC_INGESTION_MARKERS)
        has_conversational = any(marker in normalized for marker in self._CONVERSATIONAL_MARKERS)
        if any(marker in normalized for marker in self._STACK_MARKERS):
            return "conversational_ingestion_stack"
        if has_policy and has_conversational:
            return "conversational_ingestion_stack"
        if has_conversational:
            return "conversational_ingestion"
        if has_policy or has_generic_ingestion:
            return "policy_aware_ingestion"
        return ""

    def _build_request(self, scope_key: str) -> TaskExecutionConversationRequest:
        if scope_key == "policy_aware_ingestion":
            return TaskExecutionConversationRequest(
                intent="validate_repo_slice",
                scope_key=scope_key,
                title="policy_ingestion_validation",
                objective="Validate the policy-aware ingestion pipeline before reporting status.",
                chain_type="validate_then_report",
                bounded_command="/test tests.test_policy_aware_ingestion",
                max_steps=2,
                max_failures=2,
                max_no_progress=1,
            )
        if scope_key == "conversational_ingestion":
            return TaskExecutionConversationRequest(
                intent="validate_repo_slice",
                scope_key=scope_key,
                title="conversational_ingestion_validation",
                objective="Validate the conversational ingestion and clarification loop before reporting status.",
                chain_type="validate_then_report",
                bounded_command="/test tests.test_conversational_ingestion",
                max_steps=2,
                max_failures=2,
                max_no_progress=1,
            )
        return TaskExecutionConversationRequest(
            intent="validate_repo_slice",
            scope_key="conversational_ingestion_stack",
            title="conversational_ingestion_stack_validation",
            objective="Validate the ingestion pipeline and conversational clarification stack before reporting status.",
            chain_type="validate_then_report",
            bounded_command="/test tests.test_policy_aware_ingestion tests.test_conversational_ingestion",
            max_steps=2,
            max_failures=2,
            max_no_progress=1,
        )

    @staticmethod
    def _build_feature_bundle_validation_request(bundle: FeatureBundleRecord) -> TaskExecutionConversationRequest:
        validation_command = bundle.validation_plan.command_text.strip() if bundle.validation_plan is not None else ""
        bounded_command = f"/run {validation_command}".strip()
        return TaskExecutionConversationRequest(
            intent="validate_feature_bundle",
            scope_key=f"feature_bundle:{bundle.bundle_id}",
            title=f"feature_bundle_validation_{bundle.bundle_id.lower()}",
            objective=f"Validate feature bundle {bundle.bundle_id} before reporting status.",
            chain_type="feature_validate_gate",
            bounded_command=bounded_command,
            max_steps=4,
            max_failures=3,
            max_no_progress=2,
        )

    def _format_clarification(self, request: TaskExecutionConversationRequest) -> str:
        return "\n".join(
            (
                "I can prepare a bounded validation chain, but I need the target first.",
                f"Question: {request.clarification_question}",
                "Next: Reply with one of those scopes and I will convert it into a /chaincreate preview.",
            )
        )

    def _format_preparation_reply(self, request: TaskExecutionConversationRequest) -> str:
        return "\n".join(
            (
                f"Preparing a bounded validation chain for {request.scope_key.replace('_', ' ')}.",
                f"Command family: {request.bounded_command}",
                "Execution will still require explicit /chainstart and /confirm approval.",
            )
        )

    def _build_chain_create_command(self, request: TaskExecutionConversationRequest) -> str:
        return " ".join(
            (
                "/chaincreate",
                "--title",
                self._quote(request.title),
                "--objective",
                self._quote(request.objective),
                "--type",
                request.chain_type,
                "--command",
                self._quote(request.bounded_command),
                "--steps",
                str(request.max_steps),
                "--failures",
                str(request.max_failures),
                "--no-progress",
                str(request.max_no_progress),
            )
        )

    @staticmethod
    def _quote(value: str) -> str:
        return json.dumps(value)