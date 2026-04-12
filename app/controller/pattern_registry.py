"""Static pattern registry for deterministic bounded coding-task reuse."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .feature_bundle_models import CodingTaskType


PatternRouteFamily = Literal[
    "commit_summary_helper",
    "autonomous_dev_refactor",
    "capability_wiring",
    "execution_output_formatting",
]
PatternScopeType = Literal["single_cluster", "multi_cluster", "ambiguous"]
PatternConfidence = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class CodingPattern:
    pattern_id: str
    route_family: PatternRouteFamily
    task_type: CodingTaskType
    task_category: str
    scope_type: PatternScopeType
    cluster_ids: tuple[str, ...]
    target_files: tuple[str, ...]
    validation_command: str
    plan_structure: str
    keyword_groups: tuple[tuple[str, ...], ...]
    optional_keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class CodingPatternMatch:
    pattern: CodingPattern
    matched_keywords: tuple[str, ...]
    confidence: PatternConfidence
    adaptation_summary: str


class PatternRegistry:
    """Deterministic pattern registry for known-good bounded coding families."""

    _PATTERNS: tuple[CodingPattern, ...] = (
        CodingPattern(
            pattern_id="commit_summary_helper_v1",
            route_family="commit_summary_helper",
            task_type="formatter_output_update",
            task_category="helper_extraction",
            scope_type="multi_cluster",
            cluster_ids=("bundle_cluster", "test_cluster"),
            target_files=(
                "app/controller/feature_bundle_models.py",
                "app/controller/feature_bundle_formatter.py",
                "tests/test_task_chains.py",
                "tests/test_cli_chat.py",
            ),
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            plan_structure="Formatter helper extraction anchored to the bundle cluster with focused regression coverage.",
            keyword_groups=(
                ("feature bundle commit summar", "commit summar"),
                ("helper", "extract", "formatter", "format"),
                ("test", "tests"),
            ),
            optional_keywords=("feature bundle", "tests", "cli", "task-chain", "commit prep"),
        ),
        CodingPattern(
            pattern_id="autonomous_dev_formatter_refactor_v1",
            route_family="autonomous_dev_refactor",
            task_type="bounded_refactor",
            task_category="autonomous_dev_loop_refactor",
            scope_type="multi_cluster",
            cluster_ids=("autonomous_dev_cluster", "bundle_cluster", "test_cluster"),
            target_files=(
                "app/controller/autonomous_dev_models.py",
                "app/controller/feature_bundle_models.py",
                "app/controller/feature_bundle_formatter.py",
                "tests/test_task_chains.py",
                "tests/test_cli_chat.py",
            ),
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            plan_structure="Autonomous dev loop formatter refactor aligned across state, bundle formatting, and focused tests.",
            keyword_groups=(
                ("autonomous dev", "autonomous-dev", "dev loop", "devchain"),
                ("refactor", "helper", "extract"),
                ("format", "formatter", "step", "status"),
            ),
            optional_keywords=("task-chain", "cli", "tests"),
        ),
        CodingPattern(
            pattern_id="capability_wiring_v1",
            route_family="capability_wiring",
            task_type="capability_wiring_update",
            task_category="capability_wiring_update",
            scope_type="multi_cluster",
            cluster_ids=("capability_cluster", "test_cluster"),
            target_files=(
                "app/controller/command_grammar.py",
                "app/controller/capability_registry.py",
                "app/controller/capability_evaluator.py",
                "app/controller/capability_executor.py",
                "tests/test_task_chains.py",
                "tests/test_cli_chat.py",
            ),
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            plan_structure="Capability wiring route spanning grammar, registry, evaluator, executor, and focused tests.",
            keyword_groups=(
                ("capability",),
                ("wire", "wiring", "grammar", "registry", "executor", "evaluator", "routing", "route", "feature bundling"),
            ),
            optional_keywords=("tests", "controller", "bounded"),
        ),
        CodingPattern(
            pattern_id="execution_output_formatting_v1",
            route_family="execution_output_formatting",
            task_type="formatter_model_executor_alignment",
            task_category="execution_output_formatting",
            scope_type="multi_cluster",
            cluster_ids=("execution_cluster", "bundle_cluster", "test_cluster"),
            target_files=(
                "app/controller/app_service.py",
                "app/controller/task_execution_conversation.py",
                "app/controller/multi_file_feature_planner.py",
                "app/controller/feature_bundle_models.py",
                "app/controller/feature_bundle_formatter.py",
                "tests/test_task_chains.py",
                "tests/test_cli_chat.py",
            ),
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            plan_structure="Cross-feature output formatting alignment across execution, bundle formatting, and focused tests.",
            keyword_groups=(
                ("execution",),
                ("output format", "output formatting", "execution flow", "task execution", "planner flow", "formatting", "format"),
                ("update", "change", "align", "refactor"),
            ),
            optional_keywords=("execution flow", "bundle", "tests", "controller"),
        ),
    )

    def patterns(self) -> tuple[CodingPattern, ...]:
        return self._PATTERNS

    def match(self, prompt: str) -> CodingPatternMatch | None:
        normalized = " ".join(prompt.lower().split())
        for pattern in self._PATTERNS:
            matched_keywords: list[str] = []
            for keyword_group in pattern.keyword_groups:
                match = next((keyword for keyword in keyword_group if keyword in normalized), None)
                if match is None:
                    break
                matched_keywords.append(match)
            else:
                optional_hits = tuple(keyword for keyword in pattern.optional_keywords if keyword in normalized)
                confidence: PatternConfidence = "high" if optional_hits else "medium"
                adaptation_summary = (
                    f"Reused {pattern.pattern_id} as the base {pattern.scope_type} plan across "
                    f"{', '.join(pattern.cluster_ids)}."
                )
                return CodingPatternMatch(
                    pattern=pattern,
                    matched_keywords=tuple(matched_keywords) + optional_hits,
                    confidence=confidence,
                    adaptation_summary=adaptation_summary,
                )
        return None
