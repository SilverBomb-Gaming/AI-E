"""Heuristic translation from natural-language product requests into structured intent."""
from __future__ import annotations

import re

from .intent_models import (
    IntentProductGoal,
    IntentRefinementProfile,
    IntentRequestType,
    IntentTranslationSession,
    IntentTranslationSpec,
)


_WEBSITE_KEYWORDS = ("website", "landing page", "homepage", "marketing site", "site")
_GAME_KEYWORDS = ("game", "multiplayer", "survival", "creature collecting", "creature collector", "rpg")
_CLI_KEYWORDS = ("cli", "command line", "command-line", "terminal tool", "console tool", "args", "argparse")
_DESKTOP_KEYWORDS = ("desktop", "desktop app", "desktop tool", "windows app", "local app", "gui", "window", "pyside", "pyside6")
_LIBRARY_KEYWORDS = ("library", "module", "package", "reusable code")
_BACKEND_KEYWORDS = ("backend", "api", "service", "server", "webhook")
_AUTOMATION_KEYWORDS = ("automation", "automate", "pipeline", "workflow tool", "bot")
_FEATURE_KEYWORDS = ("feature", "add support", "enhance", "extend", "improve")
_REPO_TASK_KEYWORDS = ("repo", "repository", "bug", "fix", "refactor", "tests", "test suite")
_STACK_KEYWORDS = (
    "react",
    "next.js",
    "nextjs",
    "vue",
    "svelte",
    "astro",
    "unity",
    "babylon.js",
    "electron",
    "tauri",
    "pyside",
    "pyside6",
    "pyqt",
    "fastapi",
    "flask",
    "django",
    "node",
    "typescript",
    "javascript",
    "python",
)
_DEPLOY_KEYWORDS = ("deploy", "deployment", "vercel", "netlify", "steam", "itch", "desktop installer", "hosted", "cloud")
_DEPLOY_TARGET_KEYWORDS = ("vercel", "netlify", "steam", "itch", "desktop installer", "hosted", "cloud")
_STYLE_KEYWORDS = ("cozy", "dark", "darker", "minimal", "bold", "gritty", "whimsical", "cinematic", "retro")
_PLATFORM_KEYWORDS = ("web", "desktop", "windows", "mac", "linux", "ios", "android", "steam")
_MAIL_PROVIDER_KEYWORDS = ("mailchimp", "convertkit", "beehiiv", "substack", "hubspot")
_DISCOVERY_BLOCKING_KEYWORDS = (
    "website",
    "landing page",
    "homepage",
    "game",
    "backend",
    "api",
    "service",
    "server",
    "webhook",
    "automation",
    "automate",
    "workflow",
    "repo",
    "repository",
)


class IntentTranslator:
    """Build a stable intent spec from a messy product request."""

    def translate(self, request_text: str) -> IntentTranslationSpec:
        normalized = self._normalize_text(request_text)
        profile = self._extract_profile(normalized)
        return self._build_spec(base_request=normalized, conversation_notes=(), profile=profile)

    def start_session(
        self,
        request_text: str,
        *,
        translation_session_id: str,
        timestamp: str,
    ) -> IntentTranslationSession:
        normalized = self._normalize_text(request_text)
        profile = self._extract_profile(normalized)
        spec = self._build_spec(base_request=normalized, conversation_notes=(), profile=profile)
        state = "draft"
        return IntentTranslationSession(
            translation_session_id=translation_session_id,
            intent_id=spec.intent_id,
            state=state,
            created_at=timestamp,
            updated_at=timestamp,
            source_request=normalized,
            current_spec=spec,
            profile=profile,
            conversation_notes=(),
            resolved_fields=self._resolved_fields(spec, profile),
            open_questions=spec.open_questions,
            assumptions=spec.assumptions,
            latest_handoff=spec.execution_handoff,
        )

    def refine_session(
        self,
        session: IntentTranslationSession,
        clarification_text: str,
        *,
        timestamp: str,
    ) -> IntentTranslationSession:
        normalized = self._normalize_text(clarification_text)
        update_profile = self._extract_profile(normalized)
        merged_profile = session.profile.merge(update_profile)
        notes = self._merged_notes(session.conversation_notes, normalized)
        spec = self._build_spec(base_request=session.source_request, conversation_notes=notes, profile=merged_profile)
        state = "complete" if not spec.open_questions else "refined"
        return IntentTranslationSession(
            translation_session_id=session.translation_session_id,
            intent_id=spec.intent_id,
            state=state,
            created_at=session.created_at,
            updated_at=timestamp,
            source_request=session.source_request,
            current_spec=spec,
            profile=merged_profile,
            conversation_notes=notes,
            resolved_fields=self._resolved_fields(spec, merged_profile),
            open_questions=spec.open_questions,
            assumptions=spec.assumptions,
            latest_handoff=spec.execution_handoff,
        )

    def archive_session(self, session: IntentTranslationSession, *, timestamp: str) -> IntentTranslationSession:
        return IntentTranslationSession(
            translation_session_id=session.translation_session_id,
            intent_id=session.intent_id,
            state="archived",
            created_at=session.created_at,
            updated_at=timestamp,
            source_request=session.source_request,
            current_spec=session.current_spec,
            profile=session.profile,
            conversation_notes=session.conversation_notes,
            resolved_fields=session.resolved_fields,
            open_questions=session.open_questions,
            assumptions=session.assumptions,
            latest_handoff=session.latest_handoff,
        )

    def _build_spec(
        self,
        *,
        base_request: str,
        conversation_notes: tuple[str, ...],
        profile: IntentRefinementProfile,
    ) -> IntentTranslationSpec:
        combined_text = self._combined_text(base_request=base_request, conversation_notes=conversation_notes)
        lowered = combined_text.lower()
        request_type = self._determine_request_type(lowered, profile)
        delivery_target = profile.delivery_target or (request_type if request_type != "unknown" else "clarify_target")
        title = self._build_title(base_request, request_type)
        functional_requirements = self._extract_functional_requirements(base_request, lowered, request_type, profile)
        constraints = self._extract_constraints(lowered, request_type, profile)
        non_functional_requirements = self._extract_non_functional_requirements(lowered, request_type, profile)
        open_questions = self._extract_open_questions(lowered, request_type, profile)
        assumptions = self._extract_assumptions(lowered, request_type, profile)
        clarification_questions = open_questions[:3]
        product_goal = self._build_product_goal(base_request, lowered, request_type, title)
        proposed_phases = self._build_proposed_phases(request_type)
        confirmed_values = self._confirmed_values(request_type=request_type, profile=profile)
        execution_brief = self._build_execution_brief(
            request_type=request_type,
            title=title,
            functional_requirements=functional_requirements,
            constraints=constraints,
            assumptions=assumptions,
            open_questions=open_questions,
        )
        execution_handoff = self._build_execution_handoff(
            request_type=request_type,
            title=title,
            functional_requirements=functional_requirements,
            constraints=constraints,
            non_functional_requirements=non_functional_requirements,
            assumptions=assumptions,
            open_questions=open_questions,
            confirmed_values=confirmed_values,
        )
        summary = self._build_summary(base_request, lowered, request_type, title, functional_requirements, profile)
        return IntentTranslationSpec(
            intent_id=self._build_intent_id(request_type, title),
            title=title,
            request_type=request_type,
            summary=summary,
            product_goal=product_goal,
            delivery_target=delivery_target,
            constraints=constraints,
            functional_requirements=functional_requirements,
            non_functional_requirements=non_functional_requirements,
            clarification_questions=clarification_questions,
            open_questions=open_questions,
            assumptions=assumptions,
            confirmed_values=confirmed_values,
            proposed_phases=proposed_phases,
            execution_brief=execution_brief,
            execution_handoff=execution_handoff,
        )

    def _classify_bounded_tool_request(self, lowered: str) -> IntentRequestType | None:
        if self._contains_any(lowered, _CLI_KEYWORDS):
            return "python_cli"
        if self._contains_any(lowered, _DESKTOP_KEYWORDS):
            return "desktop_app"
        if self._contains_any(lowered, _LIBRARY_KEYWORDS):
            return "simple_library"
        if self._looks_like_small_python_request(lowered):
            return "python_script"
        return None

    def _classify_request_type(self, lowered: str) -> IntentRequestType:
        bounded = self._classify_bounded_tool_request(lowered)
        if bounded is not None:
            return bounded
        if self._contains_any(lowered, _WEBSITE_KEYWORDS):
            return "website"
        if self._contains_any(lowered, _BACKEND_KEYWORDS):
            return "backend_service"
        if self._contains_any(lowered, _GAME_KEYWORDS):
            return "game"
        if self._contains_any(lowered, _AUTOMATION_KEYWORDS):
            return "automation_tool"
        if self._contains_any(lowered, _FEATURE_KEYWORDS):
            return "feature_request"
        if self._contains_any(lowered, _REPO_TASK_KEYWORDS):
            return "repo_task"
        return "unknown"

    def _determine_request_type(self, lowered: str, profile: IntentRefinementProfile) -> IntentRequestType:
        if profile.delivery_target in {
            "website",
            "game",
            "desktop_app",
            "python_cli",
            "python_script",
            "simple_library",
            "backend_service",
            "automation_tool",
            "feature_request",
            "repo_task",
            "unknown",
        }:
            return profile.delivery_target  # type: ignore[return-value]
        return self._classify_request_type(lowered)

    def _build_title(self, request_text: str, request_type: IntentRequestType) -> str:
        lowered = request_text.lower().strip()
        prefixes = (
            "build me ",
            "build ",
            "make me ",
            "make ",
            "create ",
            "i want ",
            "i need ",
            "help me turn ",
            "help me ",
        )
        stripped = request_text.strip()
        for prefix in prefixes:
            if lowered.startswith(prefix):
                stripped = request_text[len(prefix):].strip()
                break
        stripped = re.sub(r"^(a|an|the)\s+", "", stripped, flags=re.IGNORECASE)
        stripped = stripped.rstrip(". ")
        if not stripped:
            stripped = {
                "website": "Website concept",
                "game": "Game concept",
                "desktop_app": "Desktop app concept",
                "python_cli": "Python CLI concept",
                "python_script": "Python script concept",
                "simple_library": "Python library concept",
                "backend_service": "Backend service concept",
                "automation_tool": "Automation tool concept",
                "feature_request": "Feature request",
                "repo_task": "Repository task",
                "unknown": "Product idea",
            }[request_type]
        return stripped[0].upper() + stripped[1:]

    def _build_product_goal(
        self,
        request_text: str,
        lowered: str,
        request_type: IntentRequestType,
        title: str,
    ) -> IntentProductGoal:
        subject = self._extract_subject(request_text)
        if request_type == "website":
            return IntentProductGoal(
                what=f"Build a conversion-oriented website concept for {subject or title}.",
                who="Prospective players, customers, or community members.",
                why="Present the product clearly and convert interest into a concrete next step.",
            )
        if request_type == "game":
            return IntentProductGoal(
                what=f"Define a buildable game concept for {subject or title}.",
                who="Players who match the requested genre, tone, and progression loop.",
                why="Turn a high-level idea into a scoped design and implementation brief.",
            )
        if request_type == "desktop_app":
            return IntentProductGoal(
                what=f"Define a desktop workflow for {subject or title}.",
                who="The operator or internal team using the tool day to day.",
                why="Reduce manual work and convert the idea into a build-ready desktop spec.",
            )
        if request_type == "python_cli":
            return IntentProductGoal(
                what=f"Define a bounded Python CLI for {subject or title}.",
                who="The operator running the tool locally from a terminal.",
                why="Turn the request into a deterministic CLI implementation brief.",
            )
        if request_type == "python_script":
            return IntentProductGoal(
                what=f"Define a bounded Python script for {subject or title}.",
                who="The operator running a small local utility.",
                why="Turn the request into a deterministic script implementation brief.",
            )
        if request_type == "simple_library":
            return IntentProductGoal(
                what=f"Define a reusable Python library for {subject or title}.",
                who="Developers importing the code into a local project.",
                why="Convert the request into a deterministic, clearly scoped library brief.",
            )
        if request_type == "backend_service":
            return IntentProductGoal(
                what=f"Define a backend service for {subject or title}.",
                who="Client apps, operators, or internal systems consuming the service.",
                why="Provide a stable service boundary before controlled implementation starts.",
            )
        if request_type == "automation_tool":
            return IntentProductGoal(
                what=f"Define an automation tool for {subject or title}.",
                who="Operators or teams that need a repeatable structured workflow.",
                why="Translate repeated manual work into a controlled automation brief.",
            )
        if request_type == "feature_request":
            return IntentProductGoal(
                what=f"Clarify the requested feature around {subject or title}.",
                who="The users affected by the requested feature change.",
                why="Turn the feature request into scoped requirements and acceptance criteria.",
            )
        if request_type == "repo_task":
            return IntentProductGoal(
                what=f"Clarify the repository task around {subject or title}.",
                who="The maintainers or operators responsible for the repo.",
                why="Turn a vague repo request into a safe execution brief.",
            )
        return IntentProductGoal(
            what="Clarify the real product or build target before execution begins.",
            who="The intended end user is still unclear.",
            why="A delivery target and audience are required before a controlled build handoff is credible.",
        )

    def _extract_constraints(
        self,
        lowered: str,
        request_type: IntentRequestType,
        profile: IntentRefinementProfile,
    ) -> tuple[str, ...]:
        constraints: list[str] = []
        if request_type == "website":
            constraints.append("Target platform: web")
        elif request_type == "game":
            constraints.append("Target class: game product")
        elif request_type == "desktop_app":
            constraints.append("Target platform: desktop")
        elif request_type == "python_cli":
            constraints.append("Target interface: CLI")
        elif request_type == "python_script":
            constraints.append("Target interface: Python script")
        elif request_type == "simple_library":
            constraints.append("Target interface: Python library")
        elif request_type == "backend_service":
            constraints.append("Target platform: backend service")
        elif request_type == "automation_tool":
            constraints.append("Target class: operator automation tool")
        if profile.stack:
            constraints.append(f"Preferred stack: {profile.stack}")
        elif self._contains_any(lowered, _STACK_KEYWORDS):
            constraints.append(f"Preferred stack signal: {self._first_match(lowered, _STACK_KEYWORDS)}")
        if profile.platform:
            constraints.append(f"Explicit platform: {profile.platform}")
        elif self._contains_any(lowered, _PLATFORM_KEYWORDS):
            constraints.append(f"Explicit platform signal: {self._first_match(lowered, _PLATFORM_KEYWORDS)}")
        if profile.delivery_stage:
            constraints.append(f"Delivery expectation: {profile.delivery_stage}")
        elif "prototype" in lowered:
            constraints.append("Delivery expectation: prototype")
        elif "production" in lowered or "production-ready" in lowered:
            constraints.append("Delivery expectation: production-ready")
        if profile.deployment_target:
            constraints.append(f"Deployment target: {profile.deployment_target}")
        if "local" in lowered:
            constraints.append("Runtime preference: local-first")
        if "hosted" in lowered or "cloud" in lowered:
            constraints.append("Deployment preference: hosted")
        if profile.site_scope == "one-page":
            constraints.append("Site structure: one-page")
        if profile.site_scope == "multi-page":
            constraints.append("Site structure: multi-page")
        constraints.append("Execution must remain operator-controlled and non-autonomous")
        return self._unique(constraints)

    def _extract_functional_requirements(
        self,
        request_text: str,
        lowered: str,
        request_type: IntentRequestType,
        profile: IntentRefinementProfile,
    ) -> tuple[str, ...]:
        requirements: list[str] = []
        if request_type == "website":
            if profile.site_scope == "multi-page":
                requirements.append("Multi-page information architecture")
            elif profile.site_scope == "one-page" or "landing page" in lowered:
                requirements.append("One-page landing flow")
            requirements.append("Hero section")
            requirements.append("Core value proposition or premise section")
            if "wishlist" in lowered:
                requirements.append("Wishlist CTA")
            if "email signup" in lowered or "newsletter" in lowered or "email sign-up" in lowered:
                requirements.append("Email signup capture")
            if "trailer" in lowered or "media" in lowered or "video" in lowered:
                requirements.append("Trailer or media section")
            if "studio" in lowered:
                requirements.append("Studio/about section")
        elif request_type == "game":
            requirements.append("Core gameplay loop definition")
            if "survival" in lowered:
                requirements.append("Survival systems")
            if "async multiplayer" in lowered or "asynchronous multiplayer" in lowered:
                requirements.append("Asynchronous multiplayer interactions")
            elif "multiplayer" in lowered:
                requirements.append("Multiplayer support")
            if "creature collecting" in lowered or "creature collector" in lowered:
                requirements.append("Creature collection and progression")
            if "craft" in lowered:
                requirements.append("Crafting or resource loop")
        elif request_type == "desktop_app":
            requirements.append("Desktop-first local workflow")
            if "summar" in lowered and "doc" in lowered:
                requirements.append("Summarize design documents")
            if "export" in lowered and "milestone" in lowered:
                requirements.append("Export milestone summaries")
            if "track" in lowered and "milestone" in lowered:
                requirements.append("Track milestone state")
        elif request_type == "python_cli":
            requirements.append("CLI entrypoint")
            requirements.extend(self._extract_bounded_tool_requirements(lowered))
        elif request_type == "python_script":
            requirements.append("Local script entrypoint")
            requirements.extend(self._extract_bounded_tool_requirements(lowered))
        elif request_type == "simple_library":
            requirements.append("Reusable Python module surface")
            requirements.extend(self._extract_bounded_tool_requirements(lowered))
        elif request_type == "backend_service":
            requirements.extend(("Service interface definition", "Bounded API or endpoint surface"))
        elif request_type == "automation_tool":
            requirements.append("Repeatable automation workflow")
            if "summar" in lowered:
                requirements.append("Content summarization step")
            if "export" in lowered:
                requirements.append("Structured export output")
        elif request_type == "feature_request":
            requirements.append("Feature scope definition")
            requirements.append("Acceptance criteria")
        elif request_type == "repo_task":
            requirements.append("Explicit task boundary")
            requirements.append("Validation target")
        else:
            if "deployable product" in lowered:
                requirements.append("Product definition and delivery target selection")
            requirements.append("Clarified product scope")
        if "cta" in lowered and "Wishlist CTA" not in requirements:
            requirements.append("Primary CTA")
        return self._unique(requirements)

    def _extract_non_functional_requirements(
        self,
        lowered: str,
        request_type: IntentRequestType,
        profile: IntentRefinementProfile,
    ) -> tuple[str, ...]:
        requirements: list[str] = []
        if request_type == "website":
            requirements.append("Mobile-responsive layout")
            requirements.append("Clear conversion-oriented messaging")
        elif request_type == "game":
            requirements.append("Scope small enough for a first playable prototype")
            requirements.append("Tone should stay coherent with the requested theme")
        elif request_type == "desktop_app":
            requirements.append("Simple local operator workflow")
            requirements.append("Low-friction export and review flow")
        elif request_type in {"python_cli", "python_script", "simple_library"}:
            requirements.append("Keep the implementation local, reviewable, and intentionally small")
        elif request_type == "backend_service":
            requirements.append("Clear interface boundaries")
        elif request_type == "automation_tool":
            requirements.append("Deterministic, reviewable automation steps")
        if profile.style_direction:
            requirements.append(f"Visual direction should stay {profile.style_direction}")
        if "small" in lowered or "mvp" in lowered:
            requirements.append("Keep v1 scope intentionally small")
        if profile.delivery_stage == "production-ready" or "production" in lowered or "production-ready" in lowered:
            requirements.append("Quality bar should support production expectations")
        return self._unique(requirements)

    def _extract_open_questions(
        self,
        lowered: str,
        request_type: IntentRequestType,
        profile: IntentRefinementProfile,
    ) -> tuple[str, ...]:
        questions: list[str] = []
        if request_type == "website":
            if not profile.stack and not self._contains_any(lowered, _STACK_KEYWORDS):
                questions.append("Which web stack should this use?")
            if not profile.deployment_target and not self._contains_any(lowered, _DEPLOY_KEYWORDS):
                questions.append("Where should the site be deployed?")
            if ("email signup" in lowered or "newsletter" in lowered) and not profile.mailing_provider and not self._contains_any(lowered, _MAIL_PROVIDER_KEYWORDS):
                questions.append("Which mailing or CRM provider should handle signups?")
            if not profile.style_direction and not self._contains_any(lowered, _STYLE_KEYWORDS):
                questions.append("What visual style should the site follow?")
        elif request_type == "game":
            if not self._contains_any(lowered, ("unity", "unreal", "godot", "babylon")):
                questions.append("Which engine or framework should the game use?")
            if not profile.platform and not self._contains_any(lowered, _PLATFORM_KEYWORDS):
                questions.append("What is the primary target platform?")
            if not profile.delivery_stage and not self._contains_any(lowered, ("prototype", "vertical slice", "production", "production-ready")):
                questions.append("Is this meant to be a prototype, vertical slice, or production plan?")
            if "multiplayer" in lowered and not self._contains_any(lowered, ("turn-based", "drop-in", "server", "hosted", "peer")):
                questions.append("How lightweight should the multiplayer layer be?")
        elif request_type == "desktop_app":
            if not profile.platform and not self._contains_any(lowered, ("windows", "mac", "linux")):
                questions.append("Which desktop OS matters first?")
            if not profile.stack and not self._contains_any(lowered, _STACK_KEYWORDS):
                questions.append("Should this stay in Python and PySide6 or use another desktop stack?")
            if "doc" in lowered and not self._contains_any(lowered, ("markdown", "md", "pdf", "docx", "txt", "json")):
                questions.append("What document formats need to be supported?")
            if "export" in lowered and not self._contains_any(lowered, ("json", "csv", "markdown", "md", "html", "pdf")):
                questions.append("Which export formats are required?")
        elif request_type in {"python_cli", "python_script", "simple_library"}:
            questions = []
        elif request_type == "backend_service":
            if not self._contains_any(lowered, ("rest", "graphql", "queue", "worker", "webhook")):
                questions.append("What interface style should the service expose?")
            if not profile.deployment_target and not self._contains_any(lowered, _DEPLOY_KEYWORDS):
                questions.append("Where should the service run?")
            if not self._contains_any(lowered, ("postgres", "sqlite", "redis", "s3", "database")):
                questions.append("What storage or persistence layer is required?")
        elif request_type == "automation_tool":
            if not profile.platform and not self._contains_any(lowered, ("local", "desktop", "server", "cloud")):
                questions.append("Where should the automation run?")
            if not self._contains_any(lowered, ("schedule", "manual", "trigger", "event")):
                questions.append("What should trigger the automation?")
            if not self._contains_any(lowered, ("json", "csv", "markdown", "email", "slack")):
                questions.append("What output format or destination is required?")
        elif request_type == "feature_request":
            questions.append("Which existing surface or workflow should this feature change?")
            questions.append("What acceptance criteria would make this feature complete?")
        elif request_type == "repo_task":
            questions.append("Which repo area or file set is in scope?")
            questions.append("What validation proves the task is complete?")
        else:
            questions.append("What is the first deliverable: website, game, desktop app, backend service, or automation tool?")
            questions.append("Who is the intended end user?")
            questions.append("What does deployable mean here: prototype, internal tool, or production release?")
        return self._unique(questions)

    def _extract_assumptions(
        self,
        lowered: str,
        request_type: IntentRequestType,
        profile: IntentRefinementProfile,
    ) -> tuple[str, ...]:
        assumptions: list[str] = []
        if request_type == "website":
            if profile.site_scope == "one-page":
                assumptions.append("Confirmed as a one-page site")
            elif profile.site_scope == "multi-page":
                assumptions.append("Confirmed as a multi-page site")
            elif "landing page" in lowered:
                assumptions.append("Assume a one-page marketing site unless a larger sitemap is requested")
            assumptions.append("Assume the site should work well on mobile and desktop")
            if not self._contains_any(lowered, ("dashboard", "account", "login", "cms")):
                assumptions.append("Assume a mostly static marketing surface unless dynamic features are clarified")
        elif request_type == "game":
            assumptions.append("Assume the first pass is a scoped design-to-prototype brief")
            if self._contains_any(lowered, _STYLE_KEYWORDS):
                assumptions.append("Assume the tone should preserve the requested genre adjectives")
        elif request_type == "desktop_app":
            assumptions.append("Assume the first release is local-first and operator-facing")
            if "doc" in lowered:
                assumptions.append("Assume document ingestion starts with a small supported file set")
        elif request_type in {"python_cli", "python_script", "simple_library"}:
            assumptions = []
        elif request_type == "backend_service":
            assumptions.append("Assume the first pass should define a narrow service boundary before implementation")
        elif request_type == "automation_tool":
            assumptions.append("Assume the workflow stays operator-reviewed and does not run autonomously")
        else:
            assumptions.append("Treat this as product-discovery input until the delivery target is clarified")
        return self._unique(assumptions)

    def _build_proposed_phases(self, request_type: IntentRequestType) -> tuple[str, ...]:
        if request_type == "unknown":
            return (
                "Clarify delivery target, audience, and success criteria",
                "Draft a structured product spec and implementation brief",
                "Hand off the approved brief to the controlled operator loop",
            )
        return (
            "Clarify missing constraints and unresolved product decisions",
            "Synthesize the approved scope into an implementation-ready brief",
            "Hand off the brief to the controlled operator system for explicit execution",
        )

    def _build_summary(
        self,
        request_text: str,
        lowered: str,
        request_type: IntentRequestType,
        title: str,
        functional_requirements: tuple[str, ...],
        profile: IntentRefinementProfile,
    ) -> str:
        if request_type == "website":
            if "landing page" in lowered:
                if profile.site_scope == "multi-page":
                    return f"Marketing site for {self._extract_subject(request_text) or title} with a multi-page conversion structure."
                return f"Marketing landing page for {self._extract_subject(request_text) or title} focused on conversion."
            return f"Website brief for {self._extract_subject(request_text) or title} with a clear conversion path."
        if request_type == "game":
            return f"Game concept brief for {title.lower()} with the core loop and delivery questions made explicit."
        if request_type == "desktop_app":
            return f"Desktop tool brief for {title.lower()} with local workflow requirements extracted."
        if request_type in {"python_cli", "python_script", "simple_library"}:
            return self._ensure_sentence(title)
        if request_type == "backend_service":
            return f"Backend service brief for {title.lower()} with interface and deployment questions highlighted."
        if request_type == "automation_tool":
            return f"Automation-tool brief for {title.lower()} with controlled workflow boundaries kept explicit."
        if request_type == "feature_request":
            return f"Feature request translated into scoped requirements and follow-up questions for {title.lower()}."
        if request_type == "repo_task":
            return f"Repository task translated into an execution-ready brief for {title.lower()}."
        if functional_requirements:
            return f"Broad product request captured as a draft brief for {title.lower()}, but the delivery target still needs clarification."
        return "Broad product request captured, but the delivery target and audience still need clarification before execution handoff."

    def _build_execution_brief(
        self,
        *,
        request_type: IntentRequestType,
        title: str,
        functional_requirements: tuple[str, ...],
        constraints: tuple[str, ...],
        assumptions: tuple[str, ...],
        open_questions: tuple[str, ...],
    ) -> str:
        brief = [f"Prepare a controlled implementation brief for {request_type}: {title}."]
        if functional_requirements:
            brief.append(f"Deliver: {', '.join(functional_requirements)}.")
        if constraints:
            brief.append(f"Respect: {', '.join(constraints[:3])}.")
        if assumptions:
            brief.append(f"Current assumptions: {', '.join(assumptions[:2])}.")
        if open_questions:
            brief.append(f"Block final execution planning on: {', '.join(open_questions[:3])}.")
        return " ".join(brief)

    def _build_execution_handoff(
        self,
        *,
        request_type: IntentRequestType,
        title: str,
        functional_requirements: tuple[str, ...],
        constraints: tuple[str, ...],
        non_functional_requirements: tuple[str, ...],
        assumptions: tuple[str, ...],
        open_questions: tuple[str, ...],
        confirmed_values: tuple[str, ...],
    ) -> str:
        lines = [
            f"Build target: {request_type}",
            f"Working title: {title}",
        ]
        if confirmed_values:
            lines.append("Confirmed values: " + "; ".join(confirmed_values))
        if functional_requirements:
            lines.append("Required capabilities: " + "; ".join(functional_requirements))
        if constraints:
            lines.append("Constraints: " + "; ".join(constraints))
        if non_functional_requirements:
            lines.append("Quality expectations: " + "; ".join(non_functional_requirements))
        if assumptions:
            lines.append("Assumptions: " + "; ".join(assumptions))
        if open_questions:
            lines.append("Open questions: " + "; ".join(open_questions))
        lines.append("Execution mode: translation only in this phase; implementation remains explicit and operator-controlled.")
        return "\n".join(lines)

    @staticmethod
    def _extract_subject(request_text: str) -> str:
        match = re.search(r"\bfor\s+([^.,]+)", request_text, flags=re.IGNORECASE)
        if not match:
            return ""
        subject = match.group(1).strip()
        subject = re.split(r"\b(with|that|and)\b", subject, maxsplit=1, flags=re.IGNORECASE)[0].strip()
        return subject

    @staticmethod
    def _build_intent_id(request_type: IntentRequestType, title: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "_", f"{request_type}_{title.lower()}").strip("_")
        slug = re.sub(r"_+", "_", slug)
        return f"intent_{slug[:48].rstrip('_')}"

    @staticmethod
    def _contains_any(text: str, values: tuple[str, ...]) -> bool:
        return any(value in text for value in values)

    @staticmethod
    def _first_match(text: str, values: tuple[str, ...]) -> str:
        for value in values:
            if value in text:
                return value
        return ""

    @staticmethod
    def _unique(values: list[str]) -> tuple[str, ...]:
        seen: set[str] = set()
        ordered: list[str] = []
        for value in values:
            normalized = " ".join(value.split())
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
        return tuple(ordered)

    @staticmethod
    def _normalize_text(text: str) -> str:
        return " ".join(text.split())

    def _combined_text(self, *, base_request: str, conversation_notes: tuple[str, ...]) -> str:
        values = [base_request]
        values.extend(conversation_notes)
        return self._normalize_text(" ".join(values))

    def _merged_notes(self, existing: tuple[str, ...], note: str) -> tuple[str, ...]:
        values = list(existing)
        if note:
            values.append(note)
        return tuple(values[-6:])

    def _extract_profile(self, text: str) -> IntentRefinementProfile:
        lowered = text.lower()
        delivery_target = self._classify_request_type(lowered)
        if delivery_target == "unknown":
            delivery_target = ""
        platform = self._first_match(lowered, _PLATFORM_KEYWORDS)
        stack = self._extract_stack(lowered)
        if delivery_target in {"python_cli", "python_script", "simple_library"} and not stack:
            stack = "python"
        style = self._first_match(lowered, _STYLE_KEYWORDS)
        deployment = self._extract_deployment_target(lowered)
        if any(value in lowered for value in ("multi-page", "multi page", "multiple pages")):
            site_scope = "multi-page"
        elif any(value in lowered for value in ("one-page", "one page", "single page")):
            site_scope = "one-page"
        else:
            site_scope = ""
        if "production-ready" in lowered or "production ready" in lowered:
            delivery_stage = "production-ready"
        elif "prototype" in lowered or "mvp" in lowered or "vertical slice" in lowered:
            delivery_stage = "prototype"
        else:
            delivery_stage = ""
        mailing_provider = self._first_match(lowered, _MAIL_PROVIDER_KEYWORDS)
        return IntentRefinementProfile(
            delivery_target=delivery_target,
            platform=platform,
            stack=stack,
            style_direction=style,
            deployment_target=deployment,
            delivery_stage=delivery_stage,
            site_scope=site_scope,
            mailing_provider=mailing_provider,
        )

    def _extract_stack(self, lowered: str) -> str:
        has_python = "python" in lowered
        has_pyside = "pyside6" in lowered or "pyside" in lowered
        has_typescript = "typescript" in lowered
        has_react = "react" in lowered
        if has_python and has_pyside:
            return "python + pyside6"
        if has_typescript and has_react:
            return "typescript + react"
        if "next.js" in lowered or "nextjs" in lowered:
            return "next.js"
        if "pyside6" in lowered:
            return "pyside6"
        return self._first_match(lowered, _STACK_KEYWORDS)

    def _extract_deployment_target(self, lowered: str) -> str:
        return self._first_match(lowered, _DEPLOY_TARGET_KEYWORDS)

    def _confirmed_values(
        self,
        *,
        request_type: IntentRequestType,
        profile: IntentRefinementProfile,
    ) -> tuple[str, ...]:
        values: list[str] = []
        if request_type != "unknown":
            values.append(f"request_type: {request_type}")
        if profile.stack:
            values.append(f"stack: {profile.stack}")
        if request_type == "python_cli":
            values.append("interface: CLI")
        elif request_type == "python_script":
            values.append("interface: script")
        elif request_type == "simple_library":
            values.append("interface: library")
        if profile.platform:
            values.append(f"platform: {profile.platform}")
        if profile.style_direction:
            values.append(f"style_direction: {profile.style_direction}")
        if profile.deployment_target:
            values.append(f"deployment_target: {profile.deployment_target}")
        if profile.delivery_stage:
            values.append(f"delivery_stage: {profile.delivery_stage}")
        if profile.site_scope:
            values.append(f"site_scope: {profile.site_scope}")
        if profile.mailing_provider:
            values.append(f"mailing_provider: {profile.mailing_provider}")
        return self._unique(values)

    def _resolved_fields(self, spec: IntentTranslationSpec, profile: IntentRefinementProfile) -> tuple[str, ...]:
        field_names = [
            value.split(":", 1)[0].strip() for value in spec.confirmed_values if ":" in value
        ]
        if profile.delivery_target:
            field_names.append("delivery_target")
        return self._unique(field_names)

    def _looks_like_small_python_request(self, lowered: str) -> bool:
        if any(value in lowered for value in _DISCOVERY_BLOCKING_KEYWORDS):
            return False
        if "python script" in lowered or re.search(r"\bscript\b", lowered):
            return True
        if "python" in lowered and any(
            marker in lowered
            for marker in (
                "tool",
                "utility",
                "helper",
                "scan",
                "folder",
                "directory",
                "csv",
                "json",
                "parse",
                "rename",
                "read",
                "write",
                "generate",
            )
        ):
            return True
        return any(marker in lowered for marker in ("simple tool", "small tool", "simple helper", "small helper"))

    def _extract_bounded_tool_requirements(self, lowered: str) -> tuple[str, ...]:
        requirements: list[str] = []
        if ("scan" in lowered or "walk" in lowered) and any(term in lowered for term in ("folder", "directory")):
            requirements.append("Scan a folder")
        if "csv" in lowered:
            requirements.append("Write CSV output")
        if "file size" in lowered or "file sizes" in lowered:
            requirements.append("Summarize file sizes")
        if "rename" in lowered and "file" in lowered:
            requirements.append("Rename files in a folder")
        if ("parse" in lowered or "parsing" in lowered) and "csv" in lowered:
            requirements.append("Parse CSV rows")
        if "track" in lowered and "note" in lowered:
            requirements.append("Track notes locally")
        return self._unique(requirements)

    @staticmethod
    def _ensure_sentence(text: str) -> str:
        normalized = " ".join(text.split()).rstrip(".")
        if not normalized:
            return ""
        return f"{normalized}."
