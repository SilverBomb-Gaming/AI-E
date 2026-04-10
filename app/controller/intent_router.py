"""Route classified natural chat intents into existing operator handlers."""
from __future__ import annotations

from .routing_types import NaturalChatClassification, NaturalChatContext, NaturalChatRouteDecision


class IntentRouter:
    """Choose the bounded internal route for a classified natural chat message."""

    def route(self, *, message: str, classification: NaturalChatClassification, context: NaturalChatContext) -> NaturalChatRouteDecision:
        intent = classification.intent_label
        if intent == "status_or_context":
            return self._route_status_context(message=message, classification=classification, context=context)
        if intent == "explanation":
            if context.latest_context_id:
                return self._contextual_route(route_command="/askctx", route_argument=f"{context.latest_context_id} {message}", rationale="Use the latest explicit context to answer the explanation request.")
            if context.has_recent_run:
                return self._direct_route(route_command="/asklast", route_argument=message, rationale="Use the latest run-aware context to answer the explanation request.")
            return self._direct_route(route_command="/ask", route_argument=message, rationale="Use a bounded provider ask because no explicit local context is available.")
        if intent == "planning":
            if "legacy_chat_candidate" in classification.action_hints:
                return self._legacy_route(rationale="Use the existing /chat orchestration flow for project-level planning or translation requests.")
            if context.latest_context_id:
                return self._contextual_route(route_command="/askctx", route_argument=f"{context.latest_context_id} {message}", rationale="Use the latest explicit context to keep the planning response bounded.")
            return self._direct_route(route_command="/askd", route_argument=message, rationale="Use the existing detailed ask flow for a non-destructive planning response.")
        if intent == "patch_request":
            if context.has_recent_run and context.latest_context_kind == "execution_result":
                return self._direct_route(route_command="/asklast", route_argument=message, rationale="Use the latest run record first when the current context came from execution output.")
            if context.latest_context_id:
                return self._contextual_route(route_command="/askctx", route_argument=f"{context.latest_context_id} {message}", rationale="Use the latest explicit context to prepare a bounded patch suggestion.")
            if context.has_recent_run:
                return self._direct_route(route_command="/asklast", route_argument=message, rationale="Use the latest run record to prepare a bounded patch suggestion.")
            return self._fallback_route("Patch requests need a recent file or run context so the target stays explicit.")
        if intent == "execution_request":
            if "test" in classification.action_hints:
                argument = self._resolve_test_target(context=context)
                return self._direct_route(route_command="/test", route_argument=argument, rationale="Use the bounded test handler so the normal confirmation and audit path stays intact.")
            run_argument = self._resolve_run_target(context=context)
            if not run_argument:
                return self._fallback_route("Execution requests need a recent approved run, active generated project, or explicit main entrypoint context.")
            return self._direct_route(route_command="/run", route_argument=run_argument, rationale="Use the bounded run handler so confirmation and runtime gates remain intact.")
        return self._fallback_route("The message is too ambiguous to route safely without guessing.")

    def _route_status_context(
        self,
        *,
        message: str,
        classification: NaturalChatClassification,
        context: NaturalChatContext,
    ) -> NaturalChatRouteDecision:
        normalized = " ".join(message.lower().split())
        if "help" in classification.action_hints or normalized == "help":
            return self._direct_route(route_command="/help", route_argument="", rationale="Use the built-in help surface for operator guidance.")
        if "lastaction" in classification.action_hints:
            return self._direct_route(route_command="/lastaction", route_argument="", rationale="Use the last-action surface for recent result status.")
        if ("project_or_context" in classification.action_hints or "project" in normalized) and context.has_active_generated_project:
            return self._direct_route(route_command="/projectview", route_argument="", rationale="Use the active generated project view for current project targeting state.")
        if ("project_or_context" in classification.action_hints or "context" in normalized or "file" in normalized) and context.has_recent_context:
            return self._direct_route(route_command="/contexts", route_argument="", rationale="Use the explicit context list to show current file or context scope.")
        return self._direct_route(route_command="/status", route_argument="", rationale="Use the status surface for a safe state summary.")

    def _resolve_run_target(self, *, context: NaturalChatContext) -> str:
        if context.last_run_command_label == "main":
            if context.last_run_target_root:
                return f"main {context.last_run_target_root}" if context.last_run_target_root != "." else "main ."
            if context.last_run_entrypoint_path == "src/main.py":
                return "main"
        if context.has_active_generated_project and context.active_generated_project_root:
            return f"main {context.active_generated_project_root}"
        latest_source = context.latest_context_source.strip().replace("\\", "/")
        if context.latest_context_kind == "file_preview":
            if latest_source == "src/main.py":
                return "main ."
            if latest_source.startswith("generated/") and latest_source.endswith("/src/main.py"):
                return f"main {latest_source[:-len('/src/main.py')]}"
        return ""

    def _resolve_test_target(self, *, context: NaturalChatContext) -> str:
        latest_source = context.latest_context_source.strip().replace("\\", "/")
        if context.latest_context_kind == "file_preview" and latest_source.startswith("tests/"):
            return latest_source
        return ""

    @staticmethod
    def _direct_route(*, route_command: str, route_argument: str, rationale: str) -> NaturalChatRouteDecision:
        selected_route = route_command if not route_argument else f"{route_command} {route_argument}"
        return NaturalChatRouteDecision(
            route_kind="direct_handler",
            selected_route=selected_route,
            route_command=route_command,
            route_argument=route_argument,
            rationale=rationale,
        )

    @staticmethod
    def _contextual_route(*, route_command: str, route_argument: str, rationale: str) -> NaturalChatRouteDecision:
        return IntentRouter._direct_route(route_command=route_command, route_argument=route_argument, rationale=rationale)

    @staticmethod
    def _legacy_route(*, rationale: str) -> NaturalChatRouteDecision:
        return NaturalChatRouteDecision(
            route_kind="legacy_chat",
            selected_route="legacy:/chat",
            route_command="/chat",
            route_argument="",
            rationale=rationale,
        )

    @staticmethod
    def _fallback_route(reason: str) -> NaturalChatRouteDecision:
        return NaturalChatRouteDecision(
            route_kind="fallback",
            selected_route="fallback",
            route_command="",
            route_argument="",
            rationale="Return a safe clarification instead of guessing.",
            fallback_reason=reason,
        )