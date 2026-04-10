"""Safe clarification replies for natural chat routing."""
from __future__ import annotations

from .routing_types import NaturalChatClassification, NaturalChatContext, NaturalChatRouteDecision


class FallbackHandler:
    """Build explicit, non-destructive fallback replies for ambiguous natural chat."""

    def build_reply(
        self,
        *,
        classification: NaturalChatClassification,
        route_decision: NaturalChatRouteDecision,
        context: NaturalChatContext,
    ) -> str:
        if classification.intent_label == "patch_request":
            return (
                "I can help with that change, but I need bounded context first.\n"
                "Reason: No recent file or run target is available for a safe patch suggestion.\n"
                "Next: Use /file <relative_path>, /run main <target>, or /askctx <context_id> <change request>."
            )
        if classification.intent_label == "execution_request":
            return (
                "I can't decide what to execute safely from that message alone.\n"
                f"Reason: {route_decision.fallback_reason or 'No bounded execution target is available.'}\n"
                "Next: Use /run main <target>, /test [target], or establish context with /run main <target> first."
            )
        if classification.intent_label == "unknown_or_ambiguous":
            return (
                "I can route natural chat safely, but this message is too ambiguous as written.\n"
                "Do you want to start a new idea, ask for a plan, request a patch, run a bounded target, or ask for status?"
            )
        if classification.intent_label == "planning" and not context.has_recent_context:
            return (
                "I can give a bounded plan, but I need either explicit context or a broader planning question.\n"
                "Next: Use /file <relative_path>, /run main <target>, or ask a higher-level planning question such as 'Give me a plan for this feature.'"
            )
        return (
            "I can't route that natural-language request safely right now.\n"
            f"Reason: {route_decision.fallback_reason or classification.rationale}\n"
            "Next: Use /help for supported paths or restate the request more explicitly."
        )