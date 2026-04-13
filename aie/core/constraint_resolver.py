from __future__ import annotations

import json
from pathlib import Path

from .models import ConstraintReport, IntentSpec


def _load_policy_file(file_name: str) -> dict:
    policy_path = Path(__file__).resolve().parents[1] / "policies" / file_name
    return json.loads(policy_path.read_text(encoding="utf-8"))


class ConstraintResolver:
    """Apply engine rules and execution guardrails to a parsed request."""

    def __init__(self) -> None:
        self._unity_rules = _load_policy_file("unity_rules.json")
        self._guardrails = _load_policy_file("execution_guardrails.json")

    def resolve(self, intent: IntentSpec) -> ConstraintReport:
        normalized = " ".join(intent.raw_request.lower().split())
        blocked_actions = self._blocked_actions(normalized)
        warnings = list(self._warnings(intent))
        ambiguities = list(self._ambiguities(intent))
        missing_inputs = list(self._missing_inputs(intent))
        guardrail_notes = list(self._guardrails.get("overpromising_prevention", []))
        scaffold_only = self._scaffold_only(intent)
        playtest_required = self._playtest_required(intent)
        human_review_required = self._human_review_required(intent, provisional_status="supported_ready")
        confirmation_required = self._confirmation_required()

        if intent.engine_target == "unity":
            guardrail_notes.extend(self._unity_rules.get("scaffold_first_assumptions", []))
            guardrail_notes.extend(self._unity_rules.get("unity_specific_warnings", []))
        if scaffold_only:
            warnings.extend(self._scaffold_only_notes(intent))

        if blocked_actions:
            return ConstraintReport(
                supported=False,
                engine_target=intent.engine_target,
                warnings=tuple(warnings),
                blocked_actions=tuple(blocked_actions),
                ambiguities=tuple(ambiguities),
                missing_inputs=tuple(missing_inputs),
                guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
                status="blocked_unsafe",
                implementation_allowed=False,
                scaffold_only=True,
                confirmation_required=False,
                playtest_required=False,
                human_review_required=True,
                commit_preparation_allowed=False,
            )

        if intent.engine_target not in (None, "unity"):
            warnings.append(self._guardrails.get("unsupported_target_message", "Unsupported engine target."))
            return ConstraintReport(
                supported=False,
                engine_target=intent.engine_target,
                warnings=tuple(dict.fromkeys(warnings)),
                blocked_actions=(),
                ambiguities=tuple(ambiguities),
                missing_inputs=tuple(missing_inputs),
                guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
                status="unsupported_target",
                implementation_allowed=False,
                scaffold_only=True,
                confirmation_required=False,
                playtest_required=False,
                human_review_required=True,
                commit_preparation_allowed=False,
            )

        if intent.engine_target is None or ambiguities or missing_inputs:
            human_review_required = self._human_review_required(intent, provisional_status="bounded_draft_only")
            warnings.append(self._guardrails.get("bounded_draft_note", "Keep the plan bounded and draft-only."))
            return ConstraintReport(
                supported=True,
                engine_target=intent.engine_target,
                warnings=tuple(dict.fromkeys(warnings)),
                blocked_actions=(),
                ambiguities=tuple(ambiguities),
                missing_inputs=tuple(missing_inputs),
                guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
                status="bounded_draft_only",
                implementation_allowed=False,
                scaffold_only=True,
                confirmation_required=False,
                playtest_required=playtest_required,
                human_review_required=human_review_required,
                commit_preparation_allowed=False,
            )

        if warnings:
            status = "supported_with_warnings"
            human_review_required = self._human_review_required(intent, provisional_status=status)
            commit_preparation_allowed = self._commit_preparation_allowed(
                status=status,
                scaffold_only=scaffold_only,
                human_review_required=human_review_required,
            )
            return ConstraintReport(
                supported=True,
                engine_target=intent.engine_target,
                warnings=tuple(dict.fromkeys(warnings)),
                blocked_actions=(),
                ambiguities=(),
                missing_inputs=(),
                guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
                status=status,
                implementation_allowed=True,
                scaffold_only=scaffold_only,
                confirmation_required=confirmation_required,
                playtest_required=playtest_required,
                human_review_required=human_review_required,
                commit_preparation_allowed=commit_preparation_allowed,
            )

        status = "supported_ready"
        human_review_required = self._human_review_required(intent, provisional_status=status)
        commit_preparation_allowed = self._commit_preparation_allowed(
            status=status,
            scaffold_only=scaffold_only,
            human_review_required=human_review_required,
        )
        return ConstraintReport(
            supported=True,
            engine_target=intent.engine_target,
            warnings=(),
            blocked_actions=(),
            ambiguities=(),
            missing_inputs=(),
            guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
            status=status,
            implementation_allowed=True,
            scaffold_only=scaffold_only,
            confirmation_required=confirmation_required,
            playtest_required=playtest_required,
            human_review_required=human_review_required,
            commit_preparation_allowed=commit_preparation_allowed,
        )

    def _blocked_actions(self, normalized: str) -> tuple[str, ...]:
        reasons: list[str] = []
        for condition in self._guardrails.get("blocked_conditions", []):
            keywords = tuple(condition.get("keywords", []))
            if any(keyword in normalized for keyword in keywords):
                reasons.append(condition["reason"])
        return tuple(dict.fromkeys(reasons))

    def _warnings(self, intent: IntentSpec) -> tuple[str, ...]:
        warnings: list[str] = []
        if intent.tone == "polished":
            warnings.append("Keep the first pass scaffold-level even if the request sounds production-ready.")
        if intent.platform_target == "mobile":
            warnings.append("Keep input and UI assumptions minimal until the mobile control scheme is confirmed.")
        return tuple(dict.fromkeys(warnings))

    def _scaffold_only(self, intent: IntentSpec) -> bool:
        for rule in self._guardrails.get("scaffold_only_rules", []):
            if rule.get("scope") == intent.scope:
                return True
        return False

    def _scaffold_only_notes(self, intent: IntentSpec) -> tuple[str, ...]:
        notes: list[str] = []
        for rule in self._guardrails.get("scaffold_only_rules", []):
            if rule.get("scope") == intent.scope:
                notes.append(rule["reason"])
        return tuple(dict.fromkeys(notes))

    def _playtest_required(self, intent: IntentSpec) -> bool:
        for rule in self._guardrails.get("playtest_rules", []):
            if rule.get("scope") == intent.scope and rule.get("requires_playtest", False):
                return True
        return False

    def _human_review_required(self, intent: IntentSpec, *, provisional_status: str) -> bool:
        for rule in self._guardrails.get("human_review_rules", []):
            if rule.get("status") == provisional_status and rule.get("requires_human_review", False):
                return True
            if rule.get("scope") == intent.scope and rule.get("requires_human_review", False):
                return True
            if rule.get("tone") == intent.tone and rule.get("requires_human_review", False):
                return True
        return False

    def _confirmation_required(self) -> bool:
        return bool(self._guardrails.get("confirmation_rules", {}).get("default_implementation_requires_confirmation", False))

    def _commit_preparation_allowed(
        self,
        *,
        status: str,
        scaffold_only: bool,
        human_review_required: bool,
    ) -> bool:
        rules = self._guardrails.get("commit_preparation_rules", {})
        if status not in tuple(rules.get("allow_when_supported_statuses", [])):
            return False
        if scaffold_only and rules.get("deny_when_scaffold_only", False):
            return False
        if human_review_required and rules.get("deny_when_human_review_required", False):
            return False
        return True

    @staticmethod
    def _ambiguities(intent: IntentSpec) -> tuple[str, ...]:
        ambiguities: list[str] = []
        if intent.engine_target is None:
            ambiguities.append("Engine target is missing; only Unity is implemented in v1.")
        if intent.scope is None:
            ambiguities.append("Implementation scope is still vague.")
        if len(intent.raw_request.split()) <= 3:
            ambiguities.append("Request is short enough that the safest result is a scaffold draft.")
        return tuple(dict.fromkeys(ambiguities))

    @staticmethod
    def _missing_inputs(intent: IntentSpec) -> tuple[str, ...]:
        labels = {
            "engine_target": "engine_target",
            "scope": "scope_detail",
            "features": "feature_detail",
        }
        return tuple(labels.get(field, field) for field in intent.missing_fields)
