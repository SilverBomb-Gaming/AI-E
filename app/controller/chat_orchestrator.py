"""Lightweight deterministic routing for the unified /chat entry point."""
from __future__ import annotations

from .chat_orchestrator_models import ChatOrchestrationContext, ChatOrchestrationResult


class ChatOrchestrator:
    """Classify conversational /chat requests and route them to existing subsystems."""

    _NEW_INTENT_MARKERS = (
        "i have an idea",
        "build me",
        "make me",
        "create a",
        "create an",
        "build a",
        "build an",
        "i want a",
        "i want an",
        "i need a",
        "i need an",
        "help me build",
        "let's build",
        "lets build",
    )
    _PRODUCT_TERMS = ("app", "tool", "tracker", "dashboard", "website", "site", "page", "desktop", "game", "bot")
    _BUNDLE_MARKERS = ("bundle", "next few steps", "few safe steps", "small batch", "next 3", "next three", "small approved slice")
    _NEXT_MARKERS = (
        "what's next",
        "what is next",
        "what’s next",
        "next step",
        "continue",
        "keep going",
        "keep going on the current project",
        "let's start",
        "lets start",
        "how do we start",
        "let's continue",
        "lets continue",
        "start the next step",
        "go ahead with the next step",
        "go ahead with next step",
        "i want to keep going on the current project",
    )
    _PLAN_MARKERS = ("build plan", "show plan", "view plan", "plan", "roadmap", "phases", "structure")
    _STATUS_MARKERS = ("where are we", "where do we stand", "status", "current state", "show status", "project state")
    _LAST_ACTION_MARKERS = ("last action", "what did the last action do", "what happened last")
    _VIEW_DRAFT_MARKERS = ("show draft", "show intent", "view intent", "current draft", "current intent")
    _APPROVAL_MARKERS = ("approve", "approve it", "run it", "execute it", "do it now", "go ahead", "ship it")
    _AMBIGUOUS_SHORT_MESSAGES = frozenset({"yes", "no", "ok", "okay", "maybe", "help", "continue", "next"})

    def build_context(self, *, snapshot, session, plan, bridge_state, bundle_state) -> ChatOrchestrationContext:
        blockers: list[str] = []
        if session is not None:
            blockers.extend(question for question in session.open_questions if question)
        if plan is not None:
            blockers.extend(blocker for blocker in plan.blockers if blocker)
        if bundle_state is not None and bundle_state.stop_reason:
            blockers.append(f"Bundle: {bundle_state.stop_reason}")
        last_summary = snapshot.last_execution_summary
        if last_summary == "No execution result yet.":
            last_summary = ""
        return ChatOrchestrationContext(
            has_active_translation_draft=session is not None,
            has_active_plan=plan is not None,
            has_active_step_proposal=bridge_state is not None and bridge_state.execution_proposal is not None and bridge_state.current_step_state in {"proposed", "approved", "executing"},
            has_active_bundle_proposal=bundle_state is not None and bundle_state.state in {"proposed", "approved"},
            has_running_bundle=bundle_state is not None and bundle_state.state == "running",
            last_loop_action_summary=last_summary,
            current_blockers=tuple(blockers[:5]),
        )

    def orchestrate(
        self,
        message: str,
        *,
        orchestration_id: str,
        chat_id: str,
        context: ChatOrchestrationContext,
    ) -> ChatOrchestrationResult:
        normalized = " ".join(message.lower().split())
        if not normalized:
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="unknown",
                rationale="No conversational content was provided.",
                routed_capability="",
                routed_action="",
                user_visible_summary="Tell me what you want to do with the current project or describe a new idea.",
                follow_up_questions=("Do you want to start a new idea, refine the current draft, build a plan, or ask what is next?",),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=False,
            )

        if context.has_active_bundle_proposal and self._looks_like_approval_request(normalized):
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="approve_bundle_request",
                rationale="The user asked to execute an already proposed bundle.",
                routed_capability="build.bundle.approve.query",
                routed_action="/bundleapprove",
                user_visible_summary="Approval stays explicit. Review the proposed bundle, then use /bundleapprove to execute the approved slice.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=True,
            )

        if context.has_active_step_proposal and self._looks_like_approval_request(normalized):
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="approve_step_request",
                rationale="The user asked to execute an already proposed plan step.",
                routed_capability="build.step.approve.query",
                routed_action="/planapprove",
                user_visible_summary="Approval stays explicit. Review the proposed plan step, then use /planapprove to execute it.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=True,
            )

        if self._looks_like_bundle_request(normalized):
            if context.has_active_plan:
                return self._result(
                    orchestration_id=orchestration_id,
                    chat_id=chat_id,
                    detected_mode="propose_bundle",
                    rationale="The user asked for a small multi-step batch and an active plan exists.",
                    routed_capability="build.bundle.propose.read",
                    routed_action="/planstepbundle",
                    user_visible_summary="Preparing a small bounded step bundle. Execution will still require explicit /bundleapprove.",
                    follow_up_questions=(),
                    blockers=context.current_blockers,
                    requires_explicit_operator_confirmation=True,
                )
            if context.has_active_translation_draft:
                return self._result(
                    orchestration_id=orchestration_id,
                    chat_id=chat_id,
                    detected_mode="build_plan",
                    rationale="The user asked for a bundle, but a build plan must exist first.",
                    routed_capability="build.plan.read",
                    routed_action="/planbuild",
                    user_visible_summary="I need a build plan before I can propose a bundle, so I’m building the plan first.",
                    follow_up_questions=(),
                    blockers=context.current_blockers,
                    requires_explicit_operator_confirmation=False,
                )

        if self._looks_like_last_action_request(normalized):
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="status_request",
                rationale="The user asked what the last action did.",
                routed_capability="action.last.read",
                routed_action="/lastaction",
                user_visible_summary="Showing the latest operator action and next explicit step.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=False,
            )

        if self._looks_like_status_request(normalized):
            routed_capability = "status.read"
            routed_action = "/status"
            rationale = "The user asked for current system or project state."
            if context.has_running_bundle or context.has_active_bundle_proposal:
                routed_capability = "build.bundle.status.read"
                routed_action = "/bundlestatus"
                rationale = "A bundle is active, so bundle status is the most relevant state surface."
            elif context.has_active_plan:
                routed_capability = "build.status.read"
                routed_action = "/planstatus"
                rationale = "An active plan exists, so plan status is the most relevant state surface."
            elif context.has_active_translation_draft:
                routed_capability = "intent.view.read"
                routed_action = "/translateview"
                rationale = "An active translation draft exists, so draft view is the most relevant state surface."
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="status_request",
                rationale=rationale,
                routed_capability=routed_capability,
                routed_action=routed_action,
                user_visible_summary="Showing the most relevant current state.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=False,
            )

        if self._looks_like_plan_request(normalized):
            if context.has_active_plan:
                return self._result(
                    orchestration_id=orchestration_id,
                    chat_id=chat_id,
                    detected_mode="view_plan",
                    rationale="The user asked for the current plan and one already exists.",
                    routed_capability="build.plan.view.read",
                    routed_action="/planview",
                    user_visible_summary="Showing the current build plan.",
                    follow_up_questions=(),
                    blockers=context.current_blockers,
                    requires_explicit_operator_confirmation=False,
                )
            if context.has_active_translation_draft:
                return self._result(
                    orchestration_id=orchestration_id,
                    chat_id=chat_id,
                    detected_mode="build_plan",
                    rationale="The user asked for a plan and an active draft exists.",
                    routed_capability="build.plan.read",
                    routed_action="/planbuild",
                    user_visible_summary="Building a structured plan from the current draft.",
                    follow_up_questions=(),
                    blockers=context.current_blockers,
                    requires_explicit_operator_confirmation=False,
                )

        if self._looks_like_next_request(normalized):
            if context.has_active_plan:
                return self._result(
                    orchestration_id=orchestration_id,
                    chat_id=chat_id,
                    detected_mode="propose_step",
                    rationale="The user asked how to continue and an active plan exists.",
                    routed_capability="build.step.read",
                    routed_action="/planstep",
                    user_visible_summary="Proposing the next bounded plan step. Execution will still require explicit /planapprove.",
                    follow_up_questions=(),
                    blockers=context.current_blockers,
                    requires_explicit_operator_confirmation=True,
                )
            if context.has_active_translation_draft:
                return self._result(
                    orchestration_id=orchestration_id,
                    chat_id=chat_id,
                    detected_mode="build_plan",
                    rationale="The user asked what comes next, but only a draft exists so planning should happen first.",
                    routed_capability="build.plan.read",
                    routed_action="/planbuild",
                    user_visible_summary="The next step is to turn the current draft into a build plan.",
                    follow_up_questions=(),
                    blockers=context.current_blockers,
                    requires_explicit_operator_confirmation=False,
                )

        if context.has_active_translation_draft and self._looks_like_view_intent_request(normalized):
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="view_intent",
                rationale="The user asked to see the active translation draft.",
                routed_capability="intent.view.read",
                routed_action="/translateview",
                user_visible_summary="Showing the current translation draft.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=False,
            )

        if self._looks_like_new_intent(normalized, has_project_context=context.has_active_translation_draft or context.has_active_plan):
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="new_intent",
                rationale="The message looks like a new product request rather than a continuation request.",
                routed_capability="intent.translate.read",
                routed_action="/translate",
                user_visible_summary="Starting a new structured translation draft from your idea.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=False,
            )

        if context.has_active_translation_draft and self._should_refine_active_draft(normalized):
            return self._result(
                orchestration_id=orchestration_id,
                chat_id=chat_id,
                detected_mode="refine_intent",
                rationale="An active draft exists and the message looks like new constraints or refinements.",
                routed_capability="intent.refine.read",
                routed_action="/refine",
                user_visible_summary="Refining the current draft with your updated constraints.",
                follow_up_questions=(),
                blockers=context.current_blockers,
                requires_explicit_operator_confirmation=False,
            )

        return self._result(
            orchestration_id=orchestration_id,
            chat_id=chat_id,
            detected_mode="unknown",
            rationale="The message was too ambiguous to route confidently without guessing.",
            routed_capability="",
            routed_action="",
            user_visible_summary="I can route a new idea, refine the current draft, build a plan, show current state, or propose the next step, but this message is too ambiguous as written.",
            follow_up_questions=("Do you want to start a new idea, refine the current draft, build a plan, or ask what is next?",),
            blockers=context.current_blockers,
            requires_explicit_operator_confirmation=False,
        )

    def _looks_like_new_intent(self, message: str, *, has_project_context: bool) -> bool:
        if self._contains_any(message, self._NEW_INTENT_MARKERS):
            return True
        words = tuple(part for part in message.split(" ") if part)
        if has_project_context:
            return False
        if len(words) < 4 or message in self._AMBIGUOUS_SHORT_MESSAGES:
            return False
        return self._contains_any(message, self._PRODUCT_TERMS)

    def _looks_like_bundle_request(self, message: str) -> bool:
        return self._contains_any(message, self._BUNDLE_MARKERS)

    def _looks_like_next_request(self, message: str) -> bool:
        return self._contains_any(message, self._NEXT_MARKERS)

    def _looks_like_plan_request(self, message: str) -> bool:
        return self._contains_any(message, self._PLAN_MARKERS)

    def _looks_like_status_request(self, message: str) -> bool:
        return self._contains_any(message, self._STATUS_MARKERS)

    def _looks_like_last_action_request(self, message: str) -> bool:
        return self._contains_any(message, self._LAST_ACTION_MARKERS)

    def _looks_like_view_intent_request(self, message: str) -> bool:
        return self._contains_any(message, self._VIEW_DRAFT_MARKERS)

    def _looks_like_approval_request(self, message: str) -> bool:
        return self._contains_any(message, self._APPROVAL_MARKERS)

    def _should_refine_active_draft(self, message: str) -> bool:
        if self._looks_like_plan_request(message) or self._looks_like_next_request(message) or self._looks_like_status_request(message):
            return False
        if self._looks_like_bundle_request(message) or self._looks_like_view_intent_request(message) or self._looks_like_last_action_request(message):
            return False
        return True

    @staticmethod
    def _contains_any(message: str, markers: tuple[str, ...]) -> bool:
        return any(marker in message for marker in markers)

    @staticmethod
    def _result(
        *,
        orchestration_id: str,
        chat_id: str,
        detected_mode,
        rationale: str,
        routed_capability: str,
        routed_action: str,
        user_visible_summary: str,
        follow_up_questions: tuple[str, ...],
        blockers: tuple[str, ...],
        requires_explicit_operator_confirmation: bool,
    ) -> ChatOrchestrationResult:
        return ChatOrchestrationResult(
            orchestration_id=orchestration_id,
            chat_id=chat_id,
            detected_mode=detected_mode,
            rationale=rationale,
            routed_capability=routed_capability,
            routed_action=routed_action,
            user_visible_summary=user_visible_summary,
            follow_up_questions=follow_up_questions,
            blockers=blockers,
            requires_explicit_operator_confirmation=requires_explicit_operator_confirmation,
        )