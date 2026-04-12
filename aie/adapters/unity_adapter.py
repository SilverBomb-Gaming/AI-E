from __future__ import annotations

import json
from pathlib import Path

from aie.core.models import ConstraintReport, ExecutionPlan, IntentSpec


class UnityAdapter:
    """Emit machine-readable and Codex-ready outputs for Unity-scoped plans."""

    def __init__(self) -> None:
        self._template_path = Path(__file__).resolve().parents[2] / "prompts" / "codex_handoff_template.md"

    def to_payload(self, intent: IntentSpec, report: ConstraintReport, plan: ExecutionPlan) -> dict:
        return {
            "adapter": "unity",
            "supported": report.supported and plan.status not in {"unsupported_target", "blocked_unsafe"},
            "intent": intent.to_dict(),
            "constraints": report.to_dict(),
            "plan": plan.to_dict(),
        }

    def to_json(self, intent: IntentSpec, report: ConstraintReport, plan: ExecutionPlan) -> str:
        return json.dumps(self.to_payload(intent, report, plan), indent=2)

    def to_codex_handoff(self, intent: IntentSpec, report: ConstraintReport, plan: ExecutionPlan) -> str:
        if not self._template_path.exists():
            raise FileNotFoundError(f"Missing Codex handoff template at {self._template_path}")
        template = self._template_path.read_text(encoding="utf-8")
        tasks = self._render_tasks(plan)
        file_operations = self._render_file_operations(plan)
        verification = self._render_list(plan.verification_steps, fallback="- Confirm the next bounded step before implementation.")
        warnings = self._render_list(plan.warnings, fallback="- No additional warnings.")
        limitations = self._render_list(plan.limitations, fallback="- Keep the plan bounded and scaffold-first.")
        replacements = {
            "{{goal}}": intent.goal or intent.raw_request,
            "{{engine_target}}": plan.engine_target or report.engine_target or "unconfirmed",
            "{{plan_status}}": plan.status,
            "{{summary}}": plan.summary,
            "{{tasks}}": tasks,
            "{{file_operations}}": file_operations,
            "{{verification_steps}}": verification,
            "{{warnings}}": warnings,
            "{{limitations}}": limitations,
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
    def _render_file_operations(plan: ExecutionPlan) -> str:
        if not plan.file_operations:
            return "- No file operations are available for this plan state."
        lines = []
        for operation in plan.file_operations:
            path = operation.get("path") or operation.get("path_hint") or "<unresolved>"
            lines.append(f"- {operation['action']}: {path} — {operation['reason']}")
        return "\n".join(lines)

    @staticmethod
    def _render_list(values: tuple[str, ...], *, fallback: str) -> str:
        if not values:
            return fallback
        return "\n".join(f"- {value}" for value in values)
