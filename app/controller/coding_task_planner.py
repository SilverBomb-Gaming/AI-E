"""Deterministic bounded coding-task planner for supported repo-local development slices."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

from .feature_bundle_models import CodingTaskPlan, FeatureBundleFile, FeatureBundleRecord, FeatureValidationPlan


CodingTaskPlanningKind = Literal["planned", "refused", "needs_clarification", "not_applicable"]


@dataclass(frozen=True)
class CodingTaskPlanningDecision:
    kind: CodingTaskPlanningKind
    bundle: FeatureBundleRecord | None = None
    refusal_reason: str = ""
    clarification_question: str = ""
    next_step: str = ""


class CodingTaskPlanner:
    """Convert a narrow coding allowlist into bounded feature-bundle proposals."""

    def plan(
        self,
        *,
        bundle_id: str,
        prompt: str,
        timestamp: str,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> CodingTaskPlanningDecision:
        lowered = " ".join(prompt.lower().replace(".", " ").replace(",", " ").split())
        if not self._looks_like_coding_request(lowered):
            return CodingTaskPlanningDecision(kind="not_applicable")
        clarification_question = self._clarification_question(lowered)
        if clarification_question:
            return CodingTaskPlanningDecision(
                kind="needs_clarification",
                clarification_question=clarification_question,
                next_step="Reply with the intended controller, formatter, model, or test surface so I can keep the coding bundle bounded.",
            )
        if self._matches_commit_summary_helper_request(lowered):
            bundle = self._plan_commit_summary_helper_bundle(
                bundle_id=bundle_id,
                prompt=prompt,
                timestamp=timestamp,
                read_text=read_text,
                path_exists=path_exists,
            )
            if bundle is None:
                return CodingTaskPlanningDecision(
                    kind="refused",
                    refusal_reason="The bounded coding bundle could not be prepared because one or more required files were missing or changed unexpectedly.",
                    next_step="Use /file to inspect the formatter and task-chain files, then retry the bounded coding request.",
                )
            return CodingTaskPlanningDecision(kind="planned", bundle=bundle)
        return CodingTaskPlanningDecision(
            kind="refused",
            refusal_reason="That coding request is outside the current bounded coding allowlist.",
            next_step="Tighten the request to a supported slice such as 'Add a helper that formats feature bundle commit summaries and update the related tests.'",
        )

    @staticmethod
    def _looks_like_coding_request(prompt: str) -> bool:
        primary_markers = (
            "helper",
            "function",
            "method",
            "formatter",
            "controller",
            "model field",
            "refactor",
            "code",
            "coding",
            "extend",
        )
        if any(marker in prompt for marker in primary_markers):
            return True
        if "bundle logic" in prompt:
            return True
        if "related tests" in prompt or "update tests" in prompt:
            return True
        return False

    @staticmethod
    def _clarification_question(prompt: str) -> str:
        if prompt in {"update the bundle logic", "update bundle logic", "update the bundle", "update bundle"}:
            return "Which bundle behavior should be updated: apply, validation tracking, commit prep, or push flow?"
        if "controller" in prompt and "feature bundle" in prompt and "formatter" not in prompt and "tests" not in prompt:
            return "Which controller should I extend, and should this update also change tests?"
        if "refactor" in prompt and "tests" not in prompt and "behavior" not in prompt:
            return "Is this a refactor only, or should the bounded coding bundle also update behavior and tests?"
        return ""

    @staticmethod
    def _matches_commit_summary_helper_request(prompt: str) -> bool:
        has_helper = "helper" in prompt or "format" in prompt or "formatter" in prompt
        has_commit_summary = "feature bundle commit summar" in prompt
        has_tests = "test" in prompt
        return has_helper and has_commit_summary and has_tests

    def _plan_commit_summary_helper_bundle(
        self,
        *,
        bundle_id: str,
        prompt: str,
        timestamp: str,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> FeatureBundleRecord | None:
        formatter_text = read_text("app/controller/feature_bundle_formatter.py")
        task_chain_tests = read_text("tests/test_task_chains.py")
        if formatter_text is None or task_chain_tests is None or not path_exists("app/controller/feature_bundle_models.py"):
            return None
        formatter_patch = self._build_formatter_patch(formatter_text)
        tests_patch = self._build_task_chain_tests_patch(task_chain_tests)
        if formatter_patch is None or tests_patch is None:
            return None
        coding_plan = CodingTaskPlan(
            task_type="formatter_output_update",
            status="proposal_ready",
            target_files=("app/controller/feature_bundle_formatter.py", "tests/test_task_chains.py"),
            intended_change_type="Add a helper that formats feature bundle commit summary lines and align the task-chain coverage.",
            expected_test_impact="Feature bundle status coverage gains an explicit commit-prep-reason assertion without widening runtime scope.",
            affected_tests=("tests/test_task_chains.py",),
            validation_command="python -m pytest tests/test_task_chains.py",
            clarification_needed=False,
            playtest_required=False,
        )
        files = (
            FeatureBundleFile(
                relative_path="app/controller/feature_bundle_models.py",
                inclusion_reason="Model metadata anchors the bounded coding surface without mutating it in this recipe.",
                change_summary="Keep the coding bundle scoped to formatter output and task-chain coverage.",
                editable=False,
                scope_confidence=0.68,
            ),
            FeatureBundleFile(
                relative_path="app/controller/feature_bundle_formatter.py",
                inclusion_reason="Formatter commit summary lines are the direct implementation surface for this helper extraction.",
                change_summary="Extract commit summary line formatting into a dedicated helper used by completion advisory rendering.",
                editable=True,
                scope_confidence=0.97,
                patch_argument=formatter_patch,
            ),
            FeatureBundleFile(
                relative_path="tests/test_task_chains.py",
                inclusion_reason="Task-chain feature bundle assertions are the focused regression surface for this formatter change.",
                change_summary="Add a bounded assertion for the commit prep reason line to keep formatter output covered.",
                editable=True,
                scope_confidence=0.95,
                patch_argument=tests_patch,
            ),
        )
        return FeatureBundleRecord(
            bundle_id=bundle_id,
            feature_request=prompt,
            feature_title="Add helper for feature bundle commit summary formatting",
            intended_outcome="Extract bounded formatter logic for feature bundle commit summaries and keep the existing task-chain coverage aligned.",
            bundle_summary="Bounded coding bundle for formatter output refinement plus focused regression alignment.",
            files=files,
            assumptions=(
                "The change remains inside the existing formatter and task-chain surfaces.",
                "The helper extraction should not alter feature-bundle apply, commit, or push behavior.",
            ),
            risk_notes=(
                "The coding bundle is patch-based and fails closed if the formatter or test snippets drift.",
                "No runtime playtest is required because the change is formatter-only and covered by existing task-chain assertions.",
            ),
            validation_plan=FeatureValidationPlan(
                command_text="python -m pytest tests/test_task_chains.py",
                rationale="The bounded coding change only affects formatter output and task-chain feature-bundle assertions.",
            ),
            state="proposed",
            validation_state="not_run",
            created_at=timestamp,
            updated_at=timestamp,
            approval_required=True,
            coding_task_plan=coding_plan,
        )

    def _build_formatter_patch(self, current_text: str) -> str | None:
        replacements = (
            (
                "        lines.append(f\"Commit prep: {advisory.commit_readiness_status}\")\n        if advisory.commit_readiness_reason:\n            lines.append(f\"Commit prep reason: {advisory.commit_readiness_reason}\")\n",
                "        lines.extend(FeatureBundleFormatter._commit_summary_lines(advisory))\n",
            ),
            (
                "    @staticmethod\n    def _append_completion_advisory(lines: list[str], bundle: FeatureBundleRecord) -> None:\n",
                "    @staticmethod\n    def _commit_summary_lines(advisory) -> tuple[str, ...]:\n        lines = [f\"Commit prep: {advisory.commit_readiness_status}\"]\n        if advisory.commit_readiness_reason:\n            lines.append(f\"Commit prep reason: {advisory.commit_readiness_reason}\")\n        return tuple(lines)\n\n    @staticmethod\n    def _append_completion_advisory(lines: list[str], bundle: FeatureBundleRecord) -> None:\n",
            ),
        )
        return self._build_patch_argument(
            relative_path="app/controller/feature_bundle_formatter.py",
            operator_reason="extract feature bundle commit summary formatter helper",
            current_text=current_text,
            replacements=replacements,
        )

    def _build_task_chain_tests_patch(self, current_text: str) -> str | None:
        replacements = (
            (
                "            self.assertIn(\"Commit prep:\", status.user_message)\n            self.assertIn(\"Included paths:\", status.user_message)\n",
                "            self.assertIn(\"Commit prep:\", status.user_message)\n            self.assertIn(\"Commit prep reason:\", status.user_message)\n            self.assertIn(\"Included paths:\", status.user_message)\n",
            ),
        )
        return self._build_patch_argument(
            relative_path="tests/test_task_chains.py",
            operator_reason="align task-chain coverage with commit summary helper extraction",
            current_text=current_text,
            replacements=replacements,
        )

    @staticmethod
    def _build_patch_argument(
        *,
        relative_path: str,
        operator_reason: str,
        current_text: str,
        replacements: tuple[tuple[str, str], ...],
    ) -> str | None:
        lines = [relative_path, f"Reason: {operator_reason}"]
        updated = current_text
        for old, new in replacements:
            if old not in updated:
                return None
            updated = updated.replace(old, new, 1)
            lines.extend(("@@ FIND", old.rstrip("\n"), "@@ REPLACE", new.rstrip("\n")))
        return "\n".join(lines)