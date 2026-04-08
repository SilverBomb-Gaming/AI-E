"""Deterministic build-planning helpers derived from active intent drafts."""
from __future__ import annotations

from .build_plan_models import BuildPlan, BuildPlanPhase, BuildPlanTaskGroup
from .intent_models import IntentTranslationSession


class BuildPlanner:
    """Create a read-only build plan from an active translated intent session."""

    def build_plan(self, session: IntentTranslationSession, *, plan_id: str) -> BuildPlan:
        blockers = self._blockers_for_session(session)
        phases = self._phases_for_session(session)
        dependencies = self._dependencies_for_session(session)
        state = "blocked" if blockers else "ready"
        next_step = self._next_step(state)
        plan = BuildPlan(
            plan_id=plan_id,
            translation_session_id=session.translation_session_id,
            intent_id=session.intent_id,
            request_type=session.current_spec.request_type,
            title=session.current_spec.title,
            summary=session.current_spec.summary,
            state=state,
            phases=phases,
            cross_phase_dependencies=dependencies,
            blockers=blockers,
            assumptions=session.assumptions,
            confirmed_values=session.current_spec.confirmed_values,
            next_step=next_step,
            operator_handoff=self._build_handoff(session, phases, blockers, dependencies, next_step, state),
        )
        return plan

    def _phases_for_session(self, session: IntentTranslationSession) -> tuple[BuildPlanPhase, ...]:
        request_type = session.current_spec.request_type
        if request_type == "website":
            return (
                BuildPlanPhase(
                    name="Scope contract",
                    goal="Lock the audience, page structure, and key implementation decisions.",
                    task_groups=(
                        BuildPlanTaskGroup(
                            name="Audience and pages",
                            objective="Turn the translated request into a concrete sitemap and CTA flow.",
                            tasks=(
                                "Confirm the target audience, primary CTA, and page count.",
                                "List the sections, content inputs, and required conversion points.",
                            ),
                        ),
                        BuildPlanTaskGroup(
                            name="Technical decisions",
                            objective="Capture the stack, hosting, and integration choices before implementation.",
                            tasks=(
                                "Confirm the frontend stack and styling direction.",
                                "Confirm deployment target and any third-party service dependencies.",
                            ),
                        ),
                    ),
                    dependencies=self._phase_dependencies(session, "scope"),
                ),
                BuildPlanPhase(
                    name="Experience build",
                    goal="Implement the marketing experience, interaction flows, and supporting integrations.",
                    task_groups=(
                        BuildPlanTaskGroup(
                            name="UI implementation",
                            objective="Build the page shell, layout, and visual system.",
                            tasks=(
                                "Implement the hero, feature, and CTA sections.",
                                "Apply the agreed styling direction and responsive behavior.",
                            ),
                        ),
                        BuildPlanTaskGroup(
                            name="Capture and integrations",
                            objective="Wire the conversion path and supporting service calls.",
                            tasks=(
                                "Implement wishlist or email capture behavior.",
                                "Connect the capture flow to the selected provider or placeholder adapter.",
                            ),
                        ),
                    ),
                    dependencies=self._phase_dependencies(session, "build"),
                ),
                BuildPlanPhase(
                    name="Launch prep",
                    goal="Validate the finished site, package deployment details, and hand off the bounded implementation brief.",
                    task_groups=(
                        BuildPlanTaskGroup(
                            name="Quality checks",
                            objective="Validate content, conversion flow, and responsive behavior.",
                            tasks=(
                                "Verify all CTA paths, form behavior, and content placeholders.",
                                "Review desktop and mobile presentation against the requested style.",
                            ),
                        ),
                        BuildPlanTaskGroup(
                            name="Deployment prep",
                            objective="Package the launch shape without triggering deployment automation.",
                            tasks=(
                                "Document environment needs, secrets, and deployment target expectations.",
                                "Prepare the operator handoff for explicit implementation and launch steps.",
                            ),
                        ),
                    ),
                    dependencies=self._phase_dependencies(session, "launch"),
                ),
            )
        if request_type == "desktop_app":
            return (
                BuildPlanPhase(
                    name="Workflow contract",
                    goal="Clarify the desktop workflows, supported files, and operator-facing outcomes.",
                    task_groups=(
                        BuildPlanTaskGroup(
                            name="User flows",
                            objective="Define the inputs, outputs, and core interaction path.",
                            tasks=(
                                "Confirm the primary desktop workflow and export expectations.",
                                "List the input formats, output formats, and failure states.",
                            ),
                        ),
                        BuildPlanTaskGroup(
                            name="Platform choices",
                            objective="Fix the desktop stack and supported OS targets.",
                            tasks=(
                                "Confirm the UI stack and runtime environment.",
                                "Confirm target operating systems and packaging expectations.",
                            ),
                        ),
                    ),
                    dependencies=self._phase_dependencies(session, "scope"),
                ),
                BuildPlanPhase(
                    name="Application shell",
                    goal="Implement the UI shell, document-processing pipeline, and export path.",
                    task_groups=(
                        BuildPlanTaskGroup(
                            name="Shell and state",
                            objective="Build the windows, views, and state transitions.",
                            tasks=(
                                "Implement the navigation shell and core workspace views.",
                                "Add local state handling for input selection, progress, and results.",
                            ),
                        ),
                        BuildPlanTaskGroup(
                            name="Processing and exports",
                            objective="Connect document parsing to the requested export formats.",
                            tasks=(
                                "Implement the summarization or extraction pipeline behind the UI.",
                                "Implement markdown and structured export output paths.",
                            ),
                        ),
                    ),
                    dependencies=self._phase_dependencies(session, "build"),
                ),
                BuildPlanPhase(
                    name="Packaging and validation",
                    goal="Prepare local packaging, validation, and an explicit operator handoff.",
                    task_groups=(
                        BuildPlanTaskGroup(
                            name="Packaging",
                            objective="Define installable build expectations without performing release automation.",
                            tasks=(
                                "Document packaging targets, runtime dependencies, and installer shape.",
                                "Prepare asset, icon, and local configuration requirements.",
                            ),
                        ),
                        BuildPlanTaskGroup(
                            name="Acceptance review",
                            objective="Verify core flows and export correctness.",
                            tasks=(
                                "Validate the primary input-to-output workflow and error handling path.",
                                "Prepare a bounded implementation handoff for explicit operator execution.",
                            ),
                        ),
                    ),
                    dependencies=self._phase_dependencies(session, "launch"),
                ),
            )
        return (
            BuildPlanPhase(
                name="Scope contract",
                goal="Translate the request into a bounded implementation contract.",
                task_groups=(
                    BuildPlanTaskGroup(
                        name="Clarify request",
                        objective="Capture the requested outcome, constraints, and delivery target.",
                        tasks=(
                            "Confirm the product shape, primary user, and success outcome.",
                            "Confirm the stack, platform, and deployment or packaging target.",
                        ),
                    ),
                ),
                dependencies=self._phase_dependencies(session, "scope"),
            ),
            BuildPlanPhase(
                name="Implementation outline",
                goal="Group the main build work into bounded operator-owned task groups.",
                task_groups=(
                    BuildPlanTaskGroup(
                        name="Core delivery",
                        objective="Define the core implementation workstream.",
                        tasks=(
                            "Break the requested functionality into explicit feature slices.",
                            "Identify the validation points and any external dependencies.",
                        ),
                    ),
                ),
                dependencies=self._phase_dependencies(session, "build"),
            ),
            BuildPlanPhase(
                name="Handoff prep",
                goal="Prepare the next explicit operator step without triggering execution.",
                task_groups=(
                    BuildPlanTaskGroup(
                        name="Execution handoff",
                        objective="Package the next bounded operator instruction.",
                        tasks=(
                            "Convert the plan into confirmation-gated implementation tasks.",
                            "Document blockers, assumptions, and acceptance checkpoints.",
                        ),
                    ),
                ),
                dependencies=self._phase_dependencies(session, "launch"),
            ),
        )

    def _phase_dependencies(self, session: IntentTranslationSession, phase: str) -> tuple[str, ...]:
        dependencies = list(self._dependencies_for_session(session))
        if phase == "scope":
            dependencies.append("Current translated intent draft")
        if phase == "launch":
            dependencies.append("Validated operator execution handoff")
        return self._unique_items(dependencies)

    def _dependencies_for_session(self, session: IntentTranslationSession) -> tuple[str, ...]:
        profile = session.profile
        dependencies: list[str] = []
        if profile.stack:
            dependencies.append(f"Confirmed stack: {profile.stack}")
        if profile.platform:
            dependencies.append(f"Target platform: {profile.platform}")
        if profile.deployment_target:
            dependencies.append(f"Deployment target: {profile.deployment_target}")
        if profile.mailing_provider:
            dependencies.append(f"Mailing provider: {profile.mailing_provider}")
        if profile.style_direction:
            dependencies.append(f"Style direction: {profile.style_direction}")
        if not dependencies:
            dependencies.append("Resolved translation draft details")
        return self._unique_items(dependencies)

    def _blockers_for_session(self, session: IntentTranslationSession) -> tuple[str, ...]:
        blockers = list(session.open_questions)
        profile = session.profile
        request_type = session.current_spec.request_type
        if request_type == "website":
            if not profile.stack:
                blockers.append("Frontend stack is not confirmed.")
            if not profile.deployment_target:
                blockers.append("Deployment target is not confirmed.")
            if self._needs_email_provider(session) and not profile.mailing_provider:
                blockers.append("Mailing or CRM provider is not confirmed for the signup flow.")
        elif request_type == "desktop_app":
            if not profile.platform:
                blockers.append("Desktop platform target is not confirmed.")
            if not profile.stack:
                blockers.append("Application stack is not confirmed.")
        else:
            if not profile.stack and request_type != "unknown":
                blockers.append("Implementation stack is not confirmed.")
        return self._unique_items(blockers)

    def _needs_email_provider(self, session: IntentTranslationSession) -> bool:
        return any("email signup" in item.lower() or "signup" in item.lower() for item in session.current_spec.functional_requirements)

    @staticmethod
    def _next_step(state: str) -> str:
        if state == "blocked":
            return "Resolve the blockers, then rerun /planbuild to refresh the operator handoff."
        return "Turn phase 1 task groups into explicit, confirmation-gated operator tasks."

    def _build_handoff(
        self,
        session: IntentTranslationSession,
        phases: tuple[BuildPlanPhase, ...],
        blockers: tuple[str, ...],
        dependencies: tuple[str, ...],
        next_step: str,
        state: str,
    ) -> str:
        lines = [
            "Build planning handoff",
            f"Plan source: {session.translation_session_id}",
            f"Intent id: {session.intent_id}",
            f"State: {state}",
            f"Goal: {session.current_spec.product_goal.what}",
            "Phases:",
        ]
        for phase in phases:
            lines.append(f"- {phase.name}: {phase.goal}")
        if dependencies:
            lines.append("Dependencies:")
            lines.extend(f"- {item}" for item in dependencies)
        if blockers:
            lines.append("Blockers:")
            lines.extend(f"- {item}" for item in blockers)
        if session.current_spec.confirmed_values:
            lines.append("Confirmed values:")
            lines.extend(f"- {item}" for item in session.current_spec.confirmed_values)
        lines.append(f"Next: {next_step}")
        lines.append("Operator note: keep implementation explicit, bounded, and confirmation-gated.")
        return "\n".join(lines)

    @staticmethod
    def _unique_items(items: list[str]) -> tuple[str, ...]:
        ordered: list[str] = []
        seen: set[str] = set()
        for item in items:
            normalized = item.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
        return tuple(ordered)