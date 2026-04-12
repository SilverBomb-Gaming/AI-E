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

        if intent.engine_target == "unity":
            guardrail_notes.extend(self._unity_rules.get("scaffold_first_assumptions", []))
            guardrail_notes.extend(self._unity_rules.get("unity_specific_warnings", []))

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
            )

        if intent.engine_target is None or ambiguities or missing_inputs:
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
            )

        if warnings:
            return ConstraintReport(
                supported=True,
                engine_target=intent.engine_target,
                warnings=tuple(dict.fromkeys(warnings)),
                blocked_actions=(),
                ambiguities=(),
                missing_inputs=(),
                guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
                status="supported_with_warnings",
            )

        return ConstraintReport(
            supported=True,
            engine_target=intent.engine_target,
            warnings=(),
            blocked_actions=(),
            ambiguities=(),
            missing_inputs=(),
            guardrail_notes=tuple(dict.fromkeys(guardrail_notes)),
            status="supported_ready",
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
