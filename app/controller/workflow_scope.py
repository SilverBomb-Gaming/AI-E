"""Workflow scope analysis before runtime-agent escalation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


WorkflowKind = Literal["conversation", "inspection", "diagnostics", "planning", "mutation_request", "execution_request"]
MutationRisk = Literal["none", "read_only", "possible_mutation", "mutation_requested", "execution_requested"]
ApprovalRequirement = Literal["none", "before_mutation", "before_execution"]


@dataclass(frozen=True)
class WorkflowScopeAnalysis:
    original_prompt: str
    normalized_prompt: str
    workflow_kind: WorkflowKind
    intent_class: str
    execution_boundary: str
    mutation_risk: MutationRisk
    approval_required: bool
    approval_requirement: ApprovalRequirement
    runtime_execution_allowed: bool
    mutation_allowed: bool
    validation_required: bool
    audit_visibility: str

    @property
    def truth_scope_line(self) -> str:
        approval = "Approval Required" if self.approval_required else "Approval Not Required"
        return f"Scope: {self.workflow_kind} | Risk: {self.mutation_risk} | {approval} | Boundary: {self.execution_boundary}"

    def runtime_instruction(self) -> str:
        return (
            "Workflow scope analysis has already run inside AI-E. "
            f"Classified workflow: {self.workflow_kind}. "
            f"Intent class: {self.intent_class}. "
            f"Execution boundary: {self.execution_boundary}. "
            f"Mutation risk: {self.mutation_risk}. "
            f"Approval requirement: {self.approval_requirement}. "
            f"Runtime execution allowed now: {self.runtime_execution_allowed}. "
            f"Mutation allowed now: {self.mutation_allowed}. "
            f"Validation required after execution: {self.validation_required}."
        )


class WorkflowScopeAnalyzer:
    """Deterministic first-pass classifier for governed workflow escalation."""

    _EXECUTION_TERMS = (
        "run",
        "execute",
        "build",
        "test",
        "playtest",
        "deploy",
        "commit",
        "push",
        "install",
        "pull",
    )
    _MUTATION_TERMS = (
        "change",
        "fix",
        "patch",
        "write",
        "delete",
        "create",
        "edit",
        "modify",
        "update",
        "remove",
    )
    _DIAGNOSTIC_TERMS = ("diagnose", "health", "status", "readiness", "logs", "error", "failure")
    _INSPECTION_TERMS = ("inspect", "review", "analyze", "explain", "why", "understand", "summarize")
    _PLANNING_TERMS = ("plan", "prepare", "scope", "design", "proposal", "next step")

    def analyze(self, prompt: str) -> WorkflowScopeAnalysis:
        normalized_prompt = " ".join(prompt.lower().split())
        original_prompt = " ".join(prompt.split())

        if self._contains_any(normalized_prompt, self._EXECUTION_TERMS):
            return WorkflowScopeAnalysis(
                original_prompt=original_prompt,
                normalized_prompt=normalized_prompt,
                workflow_kind="execution_request",
                intent_class="execution_escalation_requested",
                execution_boundary="planning_only_until_operator_approval",
                mutation_risk="execution_requested",
                approval_required=True,
                approval_requirement="before_execution",
                runtime_execution_allowed=False,
                mutation_allowed=False,
                validation_required=True,
                audit_visibility="scope_visible_runtime_execution_blocked",
            )

        if self._contains_any(normalized_prompt, self._MUTATION_TERMS):
            return WorkflowScopeAnalysis(
                original_prompt=original_prompt,
                normalized_prompt=normalized_prompt,
                workflow_kind="mutation_request",
                intent_class="mutation_or_patch_planning",
                execution_boundary="read_only_plan_until_operator_approval",
                mutation_risk="mutation_requested",
                approval_required=True,
                approval_requirement="before_mutation",
                runtime_execution_allowed=False,
                mutation_allowed=False,
                validation_required=True,
                audit_visibility="scope_visible_mutation_blocked",
            )

        if self._contains_any(normalized_prompt, self._DIAGNOSTIC_TERMS):
            return self._read_only_scope(
                original_prompt=original_prompt,
                normalized_prompt=normalized_prompt,
                workflow_kind="diagnostics",
                intent_class="read_only_diagnostics",
            )

        if self._contains_any(normalized_prompt, self._INSPECTION_TERMS):
            return self._read_only_scope(
                original_prompt=original_prompt,
                normalized_prompt=normalized_prompt,
                workflow_kind="inspection",
                intent_class="read_only_inspection",
            )

        if self._contains_any(normalized_prompt, self._PLANNING_TERMS):
            return self._read_only_scope(
                original_prompt=original_prompt,
                normalized_prompt=normalized_prompt,
                workflow_kind="planning",
                intent_class="safe_operational_planning",
            )

        return self._read_only_scope(
            original_prompt=original_prompt,
            normalized_prompt=normalized_prompt,
            workflow_kind="conversation",
            intent_class="conversation",
            mutation_risk="none",
        )

    @staticmethod
    def _contains_any(value: str, terms: tuple[str, ...]) -> bool:
        return any(term in value for term in terms)

    @staticmethod
    def _read_only_scope(
        *,
        original_prompt: str,
        normalized_prompt: str,
        workflow_kind: WorkflowKind,
        intent_class: str,
        mutation_risk: MutationRisk = "read_only",
    ) -> WorkflowScopeAnalysis:
        return WorkflowScopeAnalysis(
            original_prompt=original_prompt,
            normalized_prompt=normalized_prompt,
            workflow_kind=workflow_kind,
            intent_class=intent_class,
            execution_boundary="read_only_runtime_response",
            mutation_risk=mutation_risk,
            approval_required=False,
            approval_requirement="none",
            runtime_execution_allowed=False,
            mutation_allowed=False,
            validation_required=False,
            audit_visibility="scope_visible_no_execution",
        )