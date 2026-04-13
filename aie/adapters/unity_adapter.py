from __future__ import annotations

import json
from pathlib import Path

from aie.core.models import ConstraintReport, ConstraintRouterHandoff, ExecutionPlan, IntentSpec, TaskChain


class UnityAdapter:
    """Emit machine-readable and Codex-ready outputs for Unity-scoped router handoffs."""

    def __init__(self) -> None:
        self._template_path = Path(__file__).resolve().parents[2] / "prompts" / "codex_handoff_template.md"

    def build_handoff(
        self,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
        task_chain: TaskChain,
    ) -> ConstraintRouterHandoff:
        return ConstraintRouterHandoff(
            intent=intent,
            constraints=report,
            plan=plan,
            task_chain=task_chain,
            adapter_guidance=(
                "Unity adapter output remains planning and handoff only in Constraint Router v2.",
                "Translate scaffold or implement steps into supervised repo work; do not automate scene, prefab, or build changes.",
            ),
            open_assumptions=plan.open_assumptions,
            blocked_items=plan.blocked_items,
            confirmation_requirements=task_chain.confirmation_requirements,
            requires_playtest=task_chain.playtest_required,
            requires_human_review=task_chain.human_review_required,
        )

    def to_payload(
        self,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
        task_chain: TaskChain,
    ) -> dict:
        handoff = self.build_handoff(intent, report, plan, task_chain)
        return {
            "adapter": "unity",
            "supported": report.supported and plan.status not in {"unsupported_target", "blocked_unsafe"},
            **handoff.to_dict(),
        }

    def to_json(
        self,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
        task_chain: TaskChain,
    ) -> str:
        return json.dumps(self.to_payload(intent, report, plan, task_chain), indent=2)

    def to_codex_handoff(
        self,
        intent: IntentSpec,
        report: ConstraintReport,
        plan: ExecutionPlan,
        task_chain: TaskChain,
    ) -> str:
        if not self._template_path.exists():
            raise FileNotFoundError(f"Missing Codex handoff template at {self._template_path}")
        handoff = self.build_handoff(intent, report, plan, task_chain)
        template = self._template_path.read_text(encoding="utf-8")
        replacements = {
            "{{goal}}": intent.goal or intent.raw_request,
            "{{engine_target}}": plan.engine_target or report.engine_target or "unconfirmed",
            "{{plan_status}}": plan.status,
            "{{task_chain_status}}": task_chain.status,
            "{{summary}}": plan.summary,
            "{{tasks}}": self._render_tasks(plan),
            "{{task_chain_steps}}": self._render_task_chain(task_chain),
            "{{file_operations}}": self._render_file_operations(plan),
            "{{verification_steps}}": self._render_list(
                plan.verification_steps,
                fallback="- Confirm the next bounded step before implementation.",
            ),
            "{{warnings}}": self._render_list(plan.warnings, fallback="- No additional warnings."),
            "{{limitations}}": self._render_list(plan.limitations, fallback="- Keep the plan bounded and scaffold-first."),
            "{{open_assumptions}}": self._render_list(handoff.open_assumptions, fallback="- No additional assumptions."),
            "{{blocked_items}}": self._render_list(handoff.blocked_items, fallback="- No blocked items."),
            "{{confirmation_requirements}}": self._render_list(
                handoff.confirmation_requirements,
                fallback="- No additional confirmation requirements.",
            ),
        }
        rendered = template
        for token, value in replacements.items():
            rendered = rendered.replace(token, value)
        return rendered

    @staticmethod
    def _render_tasks(plan: ExecutionPlan) -> str:
        if not plan.tasks:
            return "- No execution tasks are available for this plan state."
        lines = []
        for task in plan.tasks:
            lines.append(f"- {task['title']}: {task['detail']}")
        return "\n".join(lines)

    @staticmethod
    def _render_task_chain(task_chain: TaskChain) -> str:
        if not task_chain.steps:
            return "- No task steps are available for this chain."
        lines = []
        for step in task_chain.steps:
            flags = []
            if step.requires_confirmation:
                flags.append("confirmation")
            if step.requires_human_review:
                flags.append("review")
            if step.requires_playtest:
                flags.append("playtest")
            suffix = f" [{', '.join(flags)}]" if flags else ""
            lines.append(f"- {step.step_type}: {step.title}{suffix}")
            lines.append(f"  Purpose: {step.purpose}")
        return "\n".join(lines)

    @staticmethod
    def _render_file_operations(plan: ExecutionPlan) -> str:
        if not plan.file_operations:
            return "- No file operations are available for this plan state."
        lines = []
        for operation in plan.file_operations:
            path = operation.get("path") or operation.get("path_hint") or "<unresolved>"
            lines.append(f"- {operation['action']}: {path} - {operation['reason']}")
        return "\n".join(lines)

    @staticmethod
    def _render_list(values: tuple[str, ...], *, fallback: str) -> str:
        if not values:
            return fallback
        return "\n".join(f"- {value}" for value in values)
