"""Natural chat ingress that classifies and routes plain-English operator messages."""
from __future__ import annotations

from typing import TYPE_CHECKING

from .fallback_handler import FallbackHandler
from .intent_classifier import IntentClassifier
from .intent_router import IntentRouter
from .routing_types import NaturalChatClassification, NaturalChatContext, NaturalChatRouteDecision

if TYPE_CHECKING:
    from .app_service import ControllerService
    from .chat_orchestrator_models import ChatOrchestrationResult
    from .models import ControllerSnapshot


class ChatIngress:
    """Build deterministic natural-chat routing decisions without bypassing existing handlers."""

    def __init__(
        self,
        *,
        classifier: IntentClassifier | None = None,
        router: IntentRouter | None = None,
        fallback_handler: FallbackHandler | None = None,
    ) -> None:
        self._classifier = classifier or IntentClassifier()
        self._router = router or IntentRouter()
        self._fallback_handler = fallback_handler or FallbackHandler()

    def build_context(self, *, service: ControllerService, snapshot: ControllerSnapshot, chat_id: str) -> NaturalChatContext:
        latest_context = service.latest_context_for_chat(chat_id=chat_id)
        last_run = service.latest_run_for_chat(chat_id=chat_id)
        active_project = service.active_generated_project_for_chat(chat_id=chat_id)
        session = service._intent_store.get_active(chat_id=chat_id)
        plan = service._build_plan_store.get_active(chat_id=chat_id)
        bridge_state = service._plan_bridge_store.get_active(chat_id=chat_id)
        bundle_state = service._autonomy_bundle_store.get_active(chat_id=chat_id)
        return NaturalChatContext(
            has_active_translation_draft=session is not None,
            has_active_plan=plan is not None,
            has_active_step_proposal=bridge_state is not None and bridge_state.execution_proposal is not None and bridge_state.current_step_state in {"proposed", "approved", "executing"},
            has_active_bundle_proposal=bundle_state is not None and bundle_state.state in {"proposed", "approved"},
            has_running_bundle=bundle_state is not None and bundle_state.state == "running",
            has_active_generated_project=active_project is not None,
            active_generated_project_root=active_project.project_root if active_project is not None else "",
            has_recent_context=latest_context is not None,
            latest_context_id=latest_context.context_id if latest_context is not None else "",
            latest_context_kind=latest_context.content_kind if latest_context is not None else "",
            latest_context_source=latest_context.source_summary if latest_context is not None else "",
            has_recent_run=last_run is not None,
            last_run_command_label=last_run.command_label if last_run is not None else "",
            last_run_target_root=last_run.target_root or "" if last_run is not None else "",
            last_run_entrypoint_path=last_run.entrypoint_path or "" if last_run is not None else "",
        )

    def classify_and_route(
        self,
        *,
        message: str,
        context: NaturalChatContext,
        legacy_orchestration: ChatOrchestrationResult,
    ) -> tuple[NaturalChatClassification, NaturalChatRouteDecision]:
        classification = self._classifier.classify(message=message, context=context)
        if classification.intent_label in {"planning", "status_or_context"} and legacy_orchestration.detected_mode != "unknown":
            return classification, NaturalChatRouteDecision(
                route_kind="legacy_chat",
                selected_route=f"legacy:{legacy_orchestration.routed_action or '/chat'}",
                route_command=legacy_orchestration.routed_action,
                route_argument="",
                rationale="Use the existing /chat orchestrator for established project, plan, and status flows.",
            )
        if classification.intent_label == "unknown_or_ambiguous" and legacy_orchestration.detected_mode != "unknown":
            return classification, NaturalChatRouteDecision(
                route_kind="legacy_chat",
                selected_route=f"legacy:{legacy_orchestration.routed_action or '/chat'}",
                route_command=legacy_orchestration.routed_action,
                route_argument="",
                rationale="Defer to the established /chat orchestrator because it found a deterministic route.",
            )
        return classification, self._router.route(message=message, classification=classification, context=context)

    def fallback_reply(
        self,
        *,
        classification: NaturalChatClassification,
        route_decision: NaturalChatRouteDecision,
        context: NaturalChatContext,
    ) -> str:
        return self._fallback_handler.build_reply(
            classification=classification,
            route_decision=route_decision,
            context=context,
        )