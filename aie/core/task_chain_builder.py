from __future__ import annotations

import re

from .models import ConstraintReport, ExecutionPlan, IntentSpec, TaskChain, TaskStep


class TaskChainBuilder:
    """Convert bounded router plans into deterministic supervised execution chains."""

    def build(self, intent: IntentSpec, report: ConstraintReport, plan: ExecutionPlan) -> TaskChain:
        chain_id = self._build_chain_id(intent=intent, report=report)
        if report.status in {"unsupported_target", "blocked_unsafe"}:
            return self._build_blocked_chain(chain_id=chain_id, intent=intent, report=report, plan=plan)
        if report.status == "bounded_draft_only":
            return self._build_draft_chain(chain_id=chain_id, intent=intent, report=report, plan=plan)
        if plan.scaffold_only:
            return self._build_scaffold_first_chain(chain_id=chain_id, intent=intent, report=report, plan=plan)
        return self._build_execution_ready_chain(chain_id=chain_id, intent=intent, report=report, plan=plan)

    def _build_execution_ready_chain(
        self,
        *,
        chain_id: str,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
    ) -> TaskChain:
        feature_label = self._feature_label(intent)
        analyze_step = TaskStep(
            step_id="analyze-request",
            step_type="analyze",
            title="Analyze normalized Unity request",
            purpose="Confirm the parsed intent, plan summary, and policy-backed execution boundaries before code changes.",
            target_area=intent.scope or "gameplay_scaffold",
            engine_context="unity",
            suggested_outputs=("normalized intent", "constraint summary", "bounded plan summary"),
            boundedness_notes=("Stay inside script-level Unity work only.",),
        )
        implement_step = TaskStep(
            step_id="implement-slice",
            step_type="implement",
            title=f"Implement the bounded {feature_label} slice",
            purpose="Apply the smallest useful Unity script change that satisfies the bounded plan.",
            target_area=feature_label,
            engine_context="unity",
            repo_impact_level=self._repo_impact_level(plan),
            risk_level="medium" if plan.playtest_required else "low",
            requires_confirmation=plan.confirmation_required,
            depends_on=(analyze_step.step_id,),
            suggested_outputs=self._suggested_outputs(plan),
            boundedness_notes=("Do not mutate scenes, prefabs, or build pipelines.",),
        )
        validate_step = TaskStep(
            step_id="validate-slice",
            step_type="validate",
            title="Validate the bounded Unity slice",
            purpose="Check script compilation, touched-path correctness, and the bounded verification checklist.",
            target_area=feature_label,
            engine_context="unity",
            repo_impact_level="low",
            risk_level="low",
            depends_on=(implement_step.step_id,),
            suggested_outputs=("verification notes", "validation result"),
            boundedness_notes=("Keep validation focused on the touched mechanic slice.",),
        )
        document_step = TaskStep(
            step_id="document-hooks",
            step_type="document",
            title="Document manual Unity hooks",
            purpose="Capture any inspector, scene, or operator setup still required after the bounded code change.",
            target_area=feature_label,
            engine_context="unity",
            repo_impact_level="low",
            risk_level="low",
            depends_on=(validate_step.step_id,),
            suggested_outputs=("manual setup notes",),
            boundedness_notes=("Document manual steps instead of automating engine wiring.",),
        )
        steps = [analyze_step, implement_step, validate_step, document_step]
        last_dependency = document_step.step_id
        if plan.playtest_required:
            playtest_step = TaskStep(
                step_id="request-playtest",
                step_type="request_playtest",
                title="Request supervised Unity playtest",
                purpose="Require an operator playtest pass before the chain is considered ready for commit preparation.",
                target_area=feature_label,
                engine_context="unity",
                repo_impact_level="none",
                risk_level="medium",
                requires_playtest=True,
                requires_human_review=True,
                depends_on=(validate_step.step_id,),
                suggested_outputs=("playtest notes",),
                boundedness_notes=("Playtesting stays manual and supervised.",),
            )
            steps.append(playtest_step)
            last_dependency = playtest_step.step_id
        if plan.commit_preparation_allowed:
            commit_step = TaskStep(
                step_id="prepare-commit",
                step_type="prepare_commit",
                title="Prepare commit summary",
                purpose="Summarize the bounded implementation once validation and manual checks are complete.",
                target_area=feature_label,
                engine_context="unity",
                repo_impact_level="low",
                risk_level="medium",
                requires_confirmation=True,
                depends_on=(last_dependency,),
                suggested_outputs=("commit summary draft",),
                boundedness_notes=("Commit preparation remains supervised and does not bypass later review.",),
            )
            steps.append(commit_step)
        return TaskChain(
            chain_id=chain_id,
            status="execution_ready",
            summary=f"Execution-ready supervised chain for the bounded {feature_label} slice.",
            bounded=True,
            engine_target=report.engine_target,
            steps=tuple(steps),
            open_assumptions=plan.open_assumptions,
            blocked_items=plan.blocked_items,
            confirmation_requirements=self._confirmation_requirements(plan),
            playtest_required=plan.playtest_required,
            human_review_required=plan.human_review_required,
            codex_handoff_ready=plan.codex_handoff_ready,
            notes=plan.limitations,
        )

    def _build_scaffold_first_chain(
        self,
        *,
        chain_id: str,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
    ) -> TaskChain:
        feature_label = self._feature_label(intent)
        analyze_step = TaskStep(
            step_id="analyze-request",
            step_type="analyze",
            title="Analyze the requested feature scope",
            purpose="Confirm why the request is being kept scaffold-first and which bounded slice should land first.",
            target_area=intent.scope or feature_label,
            engine_context=report.engine_target,
            suggested_outputs=("risk notes", "first-slice decision"),
            boundedness_notes=("Do not treat the whole system request as implementation-ready.",),
        )
        scaffold_step = TaskStep(
            step_id="scaffold-first-slice",
            step_type="scaffold",
            title=f"Scaffold the first {feature_label} slice",
            purpose="Create a bounded structure that makes the request concrete without claiming the full system is implemented.",
            target_area=feature_label,
            engine_context=report.engine_target,
            repo_impact_level=self._repo_impact_level(plan),
            risk_level="medium",
            requires_confirmation=plan.confirmation_required,
            depends_on=(analyze_step.step_id,),
            suggested_outputs=self._suggested_outputs(plan),
            boundedness_notes=("Keep the first pass to one narrow gameplay slice.",),
        )
        review_step = TaskStep(
            step_id="request-review",
            step_type="request_review",
            title="Request human review of the scaffold-first plan",
            purpose="Require a human decision before broader implementation continues.",
            target_area=feature_label,
            engine_context=report.engine_target,
            repo_impact_level="none",
            risk_level="medium",
            requires_human_review=True,
            depends_on=(scaffold_step.step_id,),
            suggested_outputs=("review decision",),
            boundedness_notes=("Review gates the next implementation step.",),
        )
        steps = [analyze_step, scaffold_step, review_step]
        last_dependency = review_step.step_id
        if plan.implementation_allowed:
            implement_step = TaskStep(
                step_id="implement-reviewed-slice",
                step_type="implement",
                title=f"Implement the reviewed {feature_label} slice",
                purpose="Apply the narrow reviewed implementation only after scaffold review is complete.",
                target_area=feature_label,
                engine_context=report.engine_target,
                repo_impact_level=self._repo_impact_level(plan),
                risk_level="medium",
                requires_confirmation=plan.confirmation_required,
                requires_human_review=True,
                depends_on=(review_step.step_id,),
                suggested_outputs=self._suggested_outputs(plan),
                boundedness_notes=("Implementation is conditional on review; do not expand beyond the first slice.",),
            )
            validate_step = TaskStep(
                step_id="validate-reviewed-slice",
                step_type="validate",
                title="Validate the reviewed slice",
                purpose="Run the focused verification checklist on the reviewed implementation only.",
                target_area=feature_label,
                engine_context=report.engine_target,
                repo_impact_level="low",
                risk_level="low",
                depends_on=(implement_step.step_id,),
                suggested_outputs=("verification notes",),
                boundedness_notes=("Keep validation constrained to the reviewed slice.",),
            )
            document_step = TaskStep(
                step_id="document-reviewed-hooks",
                step_type="document",
                title="Document manual Unity hooks",
                purpose="Capture the manual setup and guardrails that still apply after the reviewed slice.",
                target_area=feature_label,
                engine_context=report.engine_target,
                repo_impact_level="low",
                risk_level="low",
                depends_on=(validate_step.step_id,),
                suggested_outputs=("manual setup notes",),
                boundedness_notes=("Document manual work instead of automating engine changes.",),
            )
            steps.extend((implement_step, validate_step, document_step))
            last_dependency = document_step.step_id
            if plan.playtest_required:
                playtest_step = TaskStep(
                    step_id="request-playtest",
                    step_type="request_playtest",
                    title="Request supervised playtest",
                    purpose="Require a playtest pass before considering any broader follow-up work.",
                    target_area=feature_label,
                    engine_context=report.engine_target,
                    repo_impact_level="none",
                    risk_level="medium",
                    requires_playtest=True,
                    requires_human_review=True,
                    depends_on=(validate_step.step_id,),
                    suggested_outputs=("playtest notes",),
                    boundedness_notes=("Playtesting remains supervised and manual.",),
                )
                steps.append(playtest_step)
                last_dependency = playtest_step.step_id
        return TaskChain(
            chain_id=chain_id,
            status="draft_supervised",
            summary=f"Scaffold-first supervised chain for {feature_label}, with review before broader implementation.",
            bounded=True,
            engine_target=report.engine_target,
            steps=tuple(steps),
            open_assumptions=plan.open_assumptions,
            blocked_items=plan.blocked_items,
            confirmation_requirements=self._confirmation_requirements(plan),
            playtest_required=plan.playtest_required,
            human_review_required=True,
            codex_handoff_ready=plan.codex_handoff_ready,
            notes=plan.limitations,
        )

    def _build_draft_chain(
        self,
        *,
        chain_id: str,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
    ) -> TaskChain:
        feature_label = self._feature_label(intent)
        analyze_step = TaskStep(
            step_id="analyze-draft",
            step_type="analyze",
            title="Analyze the underspecified request",
            purpose="Capture the missing engine, scope, or feature details before any implementation path is proposed.",
            target_area=feature_label,
            engine_context=report.engine_target,
            risk_level="medium",
            suggested_outputs=("missing inputs", "draft plan summary"),
            boundedness_notes=("Do not proceed to implementation while key inputs are missing.",),
        )
        scaffold_step = TaskStep(
            step_id="scaffold-draft",
            step_type="scaffold",
            title=f"Draft the smallest {feature_label} scaffold",
            purpose="Turn the vague request into one bounded implementation slice without claiming execution readiness.",
            target_area=feature_label,
            engine_context=report.engine_target,
            repo_impact_level="low",
            risk_level="medium",
            depends_on=(analyze_step.step_id,),
            suggested_outputs=self._suggested_outputs(plan),
            boundedness_notes=("This stays draft-only until the missing inputs are confirmed.",),
        )
        review_step = TaskStep(
            step_id="request-review",
            step_type="request_review",
            title="Request clarification and human review",
            purpose="Resolve missing inputs and approve the first bounded slice before implementation is added.",
            target_area=feature_label,
            engine_context=report.engine_target,
            risk_level="medium",
            requires_human_review=True,
            depends_on=(scaffold_step.step_id,),
            suggested_outputs=("clarification response", "review decision"),
            boundedness_notes=("No implementation step is emitted while the request remains draft-only.",),
        )
        return TaskChain(
            chain_id=chain_id,
            status="draft_supervised",
            summary=f"Draft-only supervised chain for {feature_label}; execution stays paused until clarification lands.",
            bounded=True,
            engine_target=report.engine_target,
            steps=(analyze_step, scaffold_step, review_step),
            open_assumptions=plan.open_assumptions,
            blocked_items=plan.blocked_items,
            confirmation_requirements=(),
            playtest_required=False,
            human_review_required=True,
            codex_handoff_ready=False,
            notes=plan.limitations,
        )

    def _build_blocked_chain(
        self,
        *,
        chain_id: str,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
    ) -> TaskChain:
        analyze_step = TaskStep(
            step_id="analyze-block",
            step_type="analyze",
            title="Analyze blocked request boundaries",
            purpose="Explain why execution cannot proceed under the current engine target or blocked action set.",
            target_area=intent.scope or "request",
            engine_context=report.engine_target,
            risk_level="high",
            suggested_outputs=("blocked reason",),
            boundedness_notes=("Stay at guidance-only depth while the request is blocked.",),
        )
        review_step = TaskStep(
            step_id="request-review",
            step_type="request_review",
            title="Request retargeting or scope reduction",
            purpose="Ask for a Unity retarget or a safer bounded slice before another execution chain is proposed.",
            target_area=intent.scope or "request",
            engine_context=report.engine_target,
            risk_level="high",
            requires_human_review=True,
            depends_on=(analyze_step.step_id,),
            suggested_outputs=("retarget decision",),
            boundedness_notes=("No implementation or validation steps are emitted for blocked requests.",),
        )
        return TaskChain(
            chain_id=chain_id,
            status="blocked",
            summary="Blocked supervised chain; execution cannot proceed under the current constraints.",
            bounded=True,
            engine_target=report.engine_target,
            steps=(analyze_step, review_step),
            open_assumptions=plan.open_assumptions,
            blocked_items=plan.blocked_items or report.blocked_actions,
            confirmation_requirements=(),
            playtest_required=False,
            human_review_required=True,
            codex_handoff_ready=False,
            notes=plan.limitations,
        )

    @staticmethod
    def _build_chain_id(*, intent: IntentSpec, report: ConstraintReport) -> str:
        feature = "-".join(intent.features) if intent.features else "general-request"
        base = f"{report.engine_target or 'unconfirmed'}-{feature}-{report.status}"
        slug = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
        return f"tc-{slug}"

    @staticmethod
    def _suggested_outputs(plan: ExecutionPlan) -> tuple[str, ...]:
        outputs = [operation.get("path") or operation.get("path_hint") for operation in plan.file_operations]
        filtered = tuple(item for item in outputs if item)
        return filtered or ("bounded implementation notes",)

    @staticmethod
    def _repo_impact_level(plan: ExecutionPlan) -> str:
        count = len(plan.file_operations)
        if count == 0:
            return "none"
        if count == 1:
            return "low"
        if count <= 3:
            return "medium"
        return "high"

    @staticmethod
    def _feature_label(intent: IntentSpec) -> str:
        if not intent.features:
            return "gameplay feature"
        return intent.features[0].replace("_", " ")

    @staticmethod
    def _confirmation_requirements(plan: ExecutionPlan) -> tuple[str, ...]:
        requirements: list[str] = []
        if plan.confirmation_required:
            requirements.append("Implementation steps require explicit operator confirmation before code modification.")
        if plan.commit_preparation_allowed:
            requirements.append("Commit preparation remains supervised and follows confirmation-aware review.")
        return tuple(requirements)
