"""Deterministic bounded coding-task planner for supported repo-local development slices."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .feature_bundle_models import (
    CodingTaskClusterPlan,
    CodingTaskFilePlan,
    CodingTaskImpactAnalysis,
    CodingTaskPlan,
    FeatureBundleFile,
    FeatureBundleRecord,
    FeatureValidationPlan,
)
from .repo_task_routing import RepoTaskRoute, RepoTaskRouter


CodingTaskPlanningKind = str


@dataclass(frozen=True)
class CodingTaskPlanningDecision:
    kind: CodingTaskPlanningKind
    bundle: FeatureBundleRecord | None = None
    refusal_reason: str = ""
    clarification_question: str = ""
    next_step: str = ""


class CodingTaskPlanner:
    """Convert a bounded coding allowlist into grounded feature-bundle proposals."""

    def __init__(self) -> None:
        self._repo_task_router = RepoTaskRouter()

    def plan(
        self,
        *,
        bundle_id: str,
        prompt: str,
        timestamp: str,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> CodingTaskPlanningDecision:
        route = self._repo_task_router.plan(prompt)
        if route.kind == "not_applicable":
            return CodingTaskPlanningDecision(kind="not_applicable")
        if route.kind == "needs_clarification":
            return CodingTaskPlanningDecision(
                kind="needs_clarification",
                clarification_question=route.clarification_question,
                next_step=route.next_step,
            )
        bundle = self._build_bundle_from_route(
            route=route,
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
                next_step="Use /file to inspect the targeted controller, formatter, model, or test files, then retry the bounded coding request.",
            )
        return CodingTaskPlanningDecision(kind="planned", bundle=bundle)

    def _build_bundle_from_route(
        self,
        *,
        route: RepoTaskRoute,
        bundle_id: str,
        prompt: str,
        timestamp: str,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> FeatureBundleRecord | None:
        patch_arguments: dict[str, str] = {}
        if route.route_key == "commit_summary_helper":
            patch_arguments = self._build_commit_summary_helper_patches(read_text=read_text, path_exists=path_exists)
        elif route.route_key == "autonomous_dev_step_refactor":
            patch_arguments = self._build_autonomous_dev_refactor_patches(read_text=read_text, path_exists=path_exists)
        else:
            return None
        if patch_arguments is None:
            return None
        files: list[FeatureBundleFile] = []
        for item in route.files:
            if not path_exists(item.relative_path):
                return None
            patch_argument = patch_arguments.get(item.relative_path, "")
            if item.editable and not patch_argument:
                return None
            files.append(
                FeatureBundleFile(
                    relative_path=item.relative_path,
                    inclusion_reason=item.inclusion_reason,
                    change_summary=item.change_type,
                    editable=item.editable,
                    scope_confidence=item.scope_confidence,
                    patch_argument=patch_argument,
                )
            )
        coding_plan = CodingTaskPlan(
            task_type=route.task_type,
            status="proposal_ready",
            target_files=tuple(item.relative_path for item in route.files),
            intended_change_type=route.intended_outcome,
            expected_test_impact=route.expected_test_impact,
            affected_tests=route.affected_tests,
            validation_command=route.validation_command,
            clarification_needed=False,
            playtest_required=route.playtest_required,
            task_category=route.task_category,
            validation_rationale=route.validation_rationale,
            file_plans=tuple(
                CodingTaskFilePlan(
                    relative_path=item.relative_path,
                    reason=item.inclusion_reason,
                    change_type=item.change_type,
                    editable=item.editable,
                    scope_confidence=item.scope_confidence,
                )
                for item in route.files
            ),
            module_clusters=route.cluster_ids,
            cluster_plans=tuple(
                CodingTaskClusterPlan(cluster_id=item.cluster_id, reason=item.reason)
                for item in route.cluster_reasons
            ),
            impact_analysis=CodingTaskImpactAnalysis(
                clusters=route.impact_analysis.clusters,
                upstream=route.impact_analysis.upstream,
                downstream=route.impact_analysis.downstream,
                tests=route.impact_analysis.tests,
                interaction_points=route.impact_analysis.interaction_points,
            ),
            scope_type=route.scope_type,
            risk_level=route.risk_level,
            confidence=route.confidence,
            selection_summary=route.selection_summary,
            expansion_summary=route.expansion_summary,
        )
        return FeatureBundleRecord(
            bundle_id=bundle_id,
            feature_request=prompt,
            feature_title=route.feature_title,
            intended_outcome=route.intended_outcome,
            bundle_summary=route.bundle_summary,
            files=tuple(files),
            assumptions=route.assumptions,
            risk_notes=route.risk_notes,
            validation_plan=FeatureValidationPlan(
                command_text=route.validation_command,
                rationale=route.validation_rationale,
            ),
            state="proposed",
            validation_state="not_run",
            created_at=timestamp,
            updated_at=timestamp,
            approval_required=True,
            coding_task_plan=coding_plan,
        )

    def _build_commit_summary_helper_patches(
        self,
        *,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> dict[str, str] | None:
        formatter_path = "app/controller/feature_bundle_formatter.py"
        tests_path = "tests/test_task_chains.py"
        if not path_exists("app/controller/feature_bundle_models.py") or not path_exists(formatter_path) or not path_exists(tests_path):
            return None
        formatter_text = read_text(formatter_path)
        task_chain_tests = read_text(tests_path)
        if formatter_text is None or task_chain_tests is None:
            return None
        formatter_patch = self._build_formatter_patch(formatter_text)
        tests_patch = self._build_task_chain_tests_patch(task_chain_tests)
        if formatter_patch is None or tests_patch is None:
            return None
        return {
            formatter_path: formatter_patch,
            tests_path: tests_patch,
        }

    def _build_autonomous_dev_refactor_patches(
        self,
        *,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> dict[str, str] | None:
        required_paths = (
            "app/controller/autonomous_dev_models.py",
            "app/controller/feature_bundle_formatter.py",
            "tests/test_task_chains.py",
            "tests/test_cli_chat.py",
        )
        if any(not path_exists(relative_path) for relative_path in required_paths):
            return None
        formatter_text = read_text("app/controller/feature_bundle_formatter.py")
        if formatter_text is None:
            return None
        formatter_patch = self._build_autonomous_formatter_patch(formatter_text)
        if formatter_patch is None:
            return None
        return {"app/controller/feature_bundle_formatter.py": formatter_patch}

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

    def _build_autonomous_formatter_patch(self, current_text: str) -> str | None:
        replacements = (
            (
                "            for step in chain.steps:\n                lines.append(\n                    f\"- {step.name}: {step.status} | confirmation={'yes' if step.confirmation_required else 'no'} | eligible={'yes' if step.next_step_eligible else 'no'}\"\n                )\n                if step.prerequisites:\n                    lines.append(f\"  Prerequisites: {', '.join(step.prerequisites)}\")\n                if step.result_summary:\n                    lines.append(f\"  Result: {step.result_summary}\")\n",
                "            for step in chain.steps:\n                lines.extend(FeatureBundleFormatter._autonomous_dev_step_lines(step))\n",
            ),
            (
                "    def format_no_autonomous_dev_chain(self) -> str:\n",
                "    @staticmethod\n    def _autonomous_dev_step_lines(step) -> tuple[str, ...]:\n        lines = [\n            f\"- {step.name}: {step.status} | confirmation={'yes' if step.confirmation_required else 'no'} | eligible={'yes' if step.next_step_eligible else 'no'}\"\n        ]\n        if step.prerequisites:\n            lines.append(f\"  Prerequisites: {', '.join(step.prerequisites)}\")\n        if step.result_summary:\n            lines.append(f\"  Result: {step.result_summary}\")\n        return tuple(lines)\n\n    def format_no_autonomous_dev_chain(self) -> str:\n",
            ),
        )
        return self._build_patch_argument(
            relative_path="app/controller/feature_bundle_formatter.py",
            operator_reason="extract autonomous dev loop step formatting helper",
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
