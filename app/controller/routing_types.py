"""Shared models for natural chat classification and routing."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


NaturalChatIntentLabel = Literal[
    "explanation",
    "planning",
    "patch_request",
    "execution_request",
    "status_or_context",
    "unknown_or_ambiguous",
]

NaturalChatRouteKind = Literal["direct_handler", "legacy_chat", "fallback"]


@dataclass(frozen=True)
class NaturalChatContext:
    has_active_translation_draft: bool
    has_active_plan: bool
    has_active_step_proposal: bool
    has_active_bundle_proposal: bool
    has_running_bundle: bool
    has_active_generated_project: bool
    active_generated_project_root: str
    has_recent_context: bool
    latest_context_id: str
    latest_context_kind: str
    latest_context_source: str
    has_recent_run: bool
    last_run_command_label: str
    last_run_target_root: str
    last_run_entrypoint_path: str

    def to_payload(self) -> dict[str, object]:
        return {
            "has_active_translation_draft": self.has_active_translation_draft,
            "has_active_plan": self.has_active_plan,
            "has_active_step_proposal": self.has_active_step_proposal,
            "has_active_bundle_proposal": self.has_active_bundle_proposal,
            "has_running_bundle": self.has_running_bundle,
            "has_active_generated_project": self.has_active_generated_project,
            "active_generated_project_root": self.active_generated_project_root,
            "has_recent_context": self.has_recent_context,
            "latest_context_id": self.latest_context_id,
            "latest_context_kind": self.latest_context_kind,
            "latest_context_source": self.latest_context_source,
            "has_recent_run": self.has_recent_run,
            "last_run_command_label": self.last_run_command_label,
            "last_run_target_root": self.last_run_target_root,
            "last_run_entrypoint_path": self.last_run_entrypoint_path,
        }


@dataclass(frozen=True)
class NaturalChatClassification:
    intent_label: NaturalChatIntentLabel
    confidence: float
    action_hints: tuple[str, ...]
    rationale: str

    def to_payload(self) -> dict[str, object]:
        return {
            "intent_label": self.intent_label,
            "confidence": round(self.confidence, 2),
            "action_hints": list(self.action_hints),
            "rationale": self.rationale,
        }


@dataclass(frozen=True)
class NaturalChatRouteDecision:
    route_kind: NaturalChatRouteKind
    selected_route: str
    route_command: str
    route_argument: str
    rationale: str
    fallback_reason: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "route_kind": self.route_kind,
            "selected_route": self.selected_route,
            "route_command": self.route_command,
            "route_argument": self.route_argument,
            "rationale": self.rationale,
            "fallback_reason": self.fallback_reason,
        }