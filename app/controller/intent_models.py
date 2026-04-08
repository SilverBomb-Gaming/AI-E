"""Structured product-intent translation models for the operator console."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


IntentRequestType = Literal[
    "website",
    "game",
    "desktop_app",
    "backend_service",
    "automation_tool",
    "feature_request",
    "repo_task",
    "unknown",
]

IntentSessionState = Literal["draft", "refined", "complete", "archived"]


@dataclass(frozen=True)
class IntentProductGoal:
    what: str
    who: str
    why: str

    def to_payload(self) -> dict[str, str]:
        return {
            "what": self.what,
            "who": self.who,
            "why": self.why,
        }


@dataclass(frozen=True)
class IntentTranslationSpec:
    intent_id: str
    title: str
    request_type: IntentRequestType
    summary: str
    product_goal: IntentProductGoal
    delivery_target: str
    constraints: tuple[str, ...]
    functional_requirements: tuple[str, ...]
    non_functional_requirements: tuple[str, ...]
    clarification_questions: tuple[str, ...]
    open_questions: tuple[str, ...]
    assumptions: tuple[str, ...]
    confirmed_values: tuple[str, ...]
    proposed_phases: tuple[str, ...]
    execution_brief: str
    execution_handoff: str

    def to_payload(self) -> dict[str, object]:
        return {
            "intent_id": self.intent_id,
            "title": self.title,
            "request_type": self.request_type,
            "summary": self.summary,
            "product_goal": self.product_goal.to_payload(),
            "delivery_target": self.delivery_target,
            "constraints": list(self.constraints),
            "functional_requirements": list(self.functional_requirements),
            "non_functional_requirements": list(self.non_functional_requirements),
            "clarification_questions": list(self.clarification_questions),
            "open_questions": list(self.open_questions),
            "assumptions": list(self.assumptions),
            "confirmed_values": list(self.confirmed_values),
            "proposed_phases": list(self.proposed_phases),
            "execution_brief": self.execution_brief,
            "execution_handoff": self.execution_handoff,
        }


@dataclass(frozen=True)
class IntentRefinementProfile:
    delivery_target: str = ""
    platform: str = ""
    stack: str = ""
    style_direction: str = ""
    deployment_target: str = ""
    delivery_stage: str = ""
    site_scope: str = ""
    mailing_provider: str = ""

    def merge(self, other: "IntentRefinementProfile") -> "IntentRefinementProfile":
        return IntentRefinementProfile(
            delivery_target=other.delivery_target or self.delivery_target,
            platform=other.platform or self.platform,
            stack=other.stack or self.stack,
            style_direction=other.style_direction or self.style_direction,
            deployment_target=other.deployment_target or self.deployment_target,
            delivery_stage=other.delivery_stage or self.delivery_stage,
            site_scope=other.site_scope or self.site_scope,
            mailing_provider=other.mailing_provider or self.mailing_provider,
        )

    def to_payload(self) -> dict[str, str]:
        return {
            "delivery_target": self.delivery_target,
            "platform": self.platform,
            "stack": self.stack,
            "style_direction": self.style_direction,
            "deployment_target": self.deployment_target,
            "delivery_stage": self.delivery_stage,
            "site_scope": self.site_scope,
            "mailing_provider": self.mailing_provider,
        }


@dataclass(frozen=True)
class IntentTranslationSession:
    translation_session_id: str
    intent_id: str
    state: IntentSessionState
    created_at: str
    updated_at: str
    source_request: str
    current_spec: IntentTranslationSpec
    profile: IntentRefinementProfile
    conversation_notes: tuple[str, ...]
    resolved_fields: tuple[str, ...]
    open_questions: tuple[str, ...]
    assumptions: tuple[str, ...]
    latest_handoff: str

    def with_state(self, state: IntentSessionState, *, updated_at: str) -> "IntentTranslationSession":
        return replace(self, state=state, updated_at=updated_at)

    def to_payload(self) -> dict[str, object]:
        return {
            "translation_session_id": self.translation_session_id,
            "intent_id": self.intent_id,
            "state": self.state,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "source_request": self.source_request,
            "current_spec": self.current_spec.to_payload(),
            "profile": self.profile.to_payload(),
            "conversation_notes": list(self.conversation_notes),
            "resolved_fields": list(self.resolved_fields),
            "open_questions": list(self.open_questions),
            "assumptions": list(self.assumptions),
            "latest_handoff": self.latest_handoff,
        }