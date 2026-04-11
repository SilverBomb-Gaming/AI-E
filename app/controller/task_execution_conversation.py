"""Deterministic conversational planner for bounded task-chain execution."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
import json


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
    chain_create_command: str = ""
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
    ) -> TaskExecutionConversationOutcome:
        normalized = " ".join(message.lower().split())
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
            chain_create_command=self._build_chain_create_command(request),
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
            chain_create_command=self._build_chain_create_command(request),
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

    def _looks_like_execution_request(self, normalized: str) -> bool:
        return any(marker in normalized for marker in self._EXECUTION_MARKERS)

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