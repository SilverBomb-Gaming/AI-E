"""Deterministic repo structure map for bounded coding-task planning."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


RepoTaskConfidence = Literal["high", "medium", "low"]
RepoTaskScopeType = Literal["single_cluster", "multi_cluster", "ambiguous"]
RepoTaskRiskLevel = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class RepoImpactAnalysis:
    clusters: tuple[str, ...] = ()
    upstream: tuple[str, ...] = ()
    downstream: tuple[str, ...] = ()
    tests: tuple[str, ...] = ()
    interaction_points: tuple[str, ...] = ()


@dataclass(frozen=True)
class RepoClusterReason:
    cluster_id: str
    reason: str


@dataclass(frozen=True)
class RepoModuleCluster:
    cluster_id: str
    title: str
    files: tuple[str, ...]
    summary: str
    plan_reason: str
    upstream: tuple[str, ...] = ()
    downstream: tuple[str, ...] = ()
    tests: tuple[str, ...] = ()


@dataclass(frozen=True)
class RepoStructureSelection:
    cluster_ids: tuple[str, ...]
    target_files: tuple[str, ...]
    impact_analysis: RepoImpactAnalysis
    scope_type: RepoTaskScopeType
    risk_level: RepoTaskRiskLevel
    cluster_reasons: tuple[RepoClusterReason, ...]
    confidence: RepoTaskConfidence
    selection_summary: str
    expansion_summary: str


class RepoStructureMap:
    """Explicit repo module clusters and deterministic expansion rules."""

    _CLUSTERS: tuple[RepoModuleCluster, ...] = (
        RepoModuleCluster(
            cluster_id="capability_cluster",
            title="capability cluster",
            files=(
                "app/controller/command_grammar.py",
                "app/controller/capability_registry.py",
                "app/controller/capability_evaluator.py",
                "app/controller/capability_executor.py",
            ),
            summary="Command parsing, capability registration, evaluation, and execution routing.",
            plan_reason="Owns command parsing, capability registration, evaluation, and execution routing for bounded controller capabilities.",
            upstream=("app/controller/command_grammar.py",),
            downstream=("app/controller/capability_executor.py",),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
        RepoModuleCluster(
            cluster_id="execution_cluster",
            title="execution cluster",
            files=(
                "app/controller/app_service.py",
                "app/controller/task_execution_conversation.py",
                "app/controller/multi_file_feature_planner.py",
            ),
            summary="Controller entrypoints, execution conversation, and multi-file planning flow.",
            plan_reason="Owns controller entrypoints and execution-flow behavior that drives cross-surface changes.",
            upstream=("app/controller/app_service.py",),
            downstream=("app/controller/multi_file_feature_planner.py",),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
        RepoModuleCluster(
            cluster_id="bundle_cluster",
            title="bundle cluster",
            files=(
                "app/controller/feature_bundle_models.py",
                "app/controller/feature_bundle_formatter.py",
            ),
            summary="Feature-bundle models and operator-facing formatter output.",
            plan_reason="Owns feature-bundle models and operator-facing formatting for execution and planning summaries.",
            upstream=("app/controller/feature_bundle_models.py",),
            downstream=("app/controller/feature_bundle_formatter.py",),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
        RepoModuleCluster(
            cluster_id="autonomous_dev_cluster",
            title="autonomous dev cluster",
            files=("app/controller/autonomous_dev_models.py",),
            summary="Autonomous dev loop state and step metadata.",
            plan_reason="Owns autonomous dev loop state that feeds bundle-formatting and conversational status output.",
            upstream=("app/controller/autonomous_dev_models.py",),
            downstream=("app/controller/feature_bundle_formatter.py",),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
        RepoModuleCluster(
            cluster_id="test_cluster",
            title="test cluster",
            files=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
            summary="Focused regression coverage for task chains and CLI routing.",
            plan_reason="Validates focused task-chain and CLI routing behavior for the bounded coding surfaces.",
            upstream=(),
            downstream=(),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
    )
    _INTERACTION_POINTS: dict[frozenset[str], tuple[str, ...]] = {
        frozenset(("capability_cluster", "execution_cluster")): ("capability routing -> controller execution flow",),
        frozenset(("capability_cluster", "test_cluster")): ("capability routing -> focused CLI/task-chain tests",),
        frozenset(("execution_cluster", "bundle_cluster")): ("execution output -> bundle formatter",),
        frozenset(("execution_cluster", "test_cluster")): ("execution flow -> focused CLI/task-chain tests",),
        frozenset(("bundle_cluster", "test_cluster")): ("bundle model -> formatter -> tests",),
        frozenset(("autonomous_dev_cluster", "bundle_cluster")): ("autonomous dev state -> bundle formatter",),
        frozenset(("autonomous_dev_cluster", "test_cluster")): ("autonomous dev summaries -> focused CLI/task-chain tests",),
        frozenset(("autonomous_dev_cluster", "execution_cluster")): ("controller execution flow -> autonomous dev summaries",),
    }

    def cluster(self, cluster_id: str) -> RepoModuleCluster:
        for cluster in self._CLUSTERS:
            if cluster.cluster_id == cluster_id:
                return cluster
        raise KeyError(cluster_id)

    def cluster_ids_for_files(self, relative_paths: tuple[str, ...]) -> tuple[str, ...]:
        ordered: list[str] = []
        for relative_path in relative_paths:
            for cluster in self._CLUSTERS:
                if relative_path in cluster.files and cluster.cluster_id not in ordered:
                    ordered.append(cluster.cluster_id)
        return tuple(ordered)

    def expand_cluster_files(self, cluster_ids: tuple[str, ...]) -> tuple[str, ...]:
        ordered: list[str] = []
        for cluster_id in cluster_ids:
            for relative_path in self.cluster(cluster_id).files:
                if relative_path not in ordered:
                    ordered.append(relative_path)
        return tuple(ordered)

    def describe_cluster(self, cluster_id: str) -> str:
        cluster = self.cluster(cluster_id)
        return f"{cluster.title} ({', '.join(cluster.files)})"

    def partial_cluster_gaps(self, relative_paths: tuple[str, ...]) -> tuple[str, ...]:
        gaps: list[str] = []
        selected = set(relative_paths)
        for cluster_id in self.cluster_ids_for_files(relative_paths):
            cluster_files = self.cluster(cluster_id).files
            if selected.intersection(cluster_files) and not set(cluster_files).issubset(selected):
                for candidate in cluster_files:
                    if candidate not in selected and candidate not in gaps:
                        gaps.append(candidate)
        return tuple(gaps)

    def build_selection(
        self,
        *,
        cluster_ids: tuple[str, ...],
        confidence: RepoTaskConfidence,
        risk_level: RepoTaskRiskLevel | None = None,
        scope_type: RepoTaskScopeType | None = None,
        selection_summary: str,
        expansion_summary: str,
    ) -> RepoStructureSelection:
        target_files = self.expand_cluster_files(cluster_ids)
        clusters = self._iter_clusters(cluster_ids)
        upstream = self._unique_path_order(*(cluster.upstream for cluster in clusters))
        downstream = self._unique_path_order(*(cluster.downstream for cluster in clusters))
        tests = self._unique_path_order(*(cluster.tests for cluster in clusters))
        resolved_scope_type = scope_type or self._scope_type_for_clusters(cluster_ids)
        resolved_risk_level = risk_level or self._risk_level_for_clusters(cluster_ids, scope_type=resolved_scope_type)
        return RepoStructureSelection(
            cluster_ids=cluster_ids,
            target_files=target_files,
            impact_analysis=RepoImpactAnalysis(
                clusters=cluster_ids,
                upstream=upstream,
                downstream=downstream,
                tests=tests,
                interaction_points=self._interaction_points_for_clusters(cluster_ids),
            ),
            scope_type=resolved_scope_type,
            risk_level=resolved_risk_level,
            cluster_reasons=tuple(
                RepoClusterReason(cluster_id=cluster.cluster_id, reason=cluster.plan_reason)
                for cluster in clusters
            ),
            confidence=confidence,
            selection_summary=selection_summary,
            expansion_summary=expansion_summary,
        )

    def clarification_for_clusters(self, cluster_ids: tuple[str, ...], *, action: str) -> str:
        described = ", ".join(self.describe_cluster(cluster_id) for cluster_id in cluster_ids)
        return f"This change affects the {described}. Should I {action} across the full cluster, or only a subset?"

    def selection_summary_for_clusters(self, cluster_ids: tuple[str, ...]) -> str:
        return ", ".join(self.cluster(cluster_id).title for cluster_id in cluster_ids)

    def expansion_summary_for_clusters(self, cluster_ids: tuple[str, ...]) -> str:
        files = self.expand_cluster_files(cluster_ids)
        return f"Expanded to the full cluster set: {', '.join(files)}"

    def _iter_clusters(self, cluster_ids: tuple[str, ...]) -> tuple[RepoModuleCluster, ...]:
        return tuple(self.cluster(cluster_id) for cluster_id in cluster_ids)

    def _interaction_points_for_clusters(self, cluster_ids: tuple[str, ...]) -> tuple[str, ...]:
        ordered: list[str] = []
        if len(cluster_ids) < 2:
            return ()
        for index, left_cluster in enumerate(cluster_ids):
            for right_cluster in cluster_ids[index + 1 :]:
                for interaction in self._INTERACTION_POINTS.get(frozenset((left_cluster, right_cluster)), ()):
                    if interaction not in ordered:
                        ordered.append(interaction)
        return tuple(ordered)

    @staticmethod
    def _scope_type_for_clusters(cluster_ids: tuple[str, ...]) -> RepoTaskScopeType:
        if not cluster_ids:
            return "ambiguous"
        if len(cluster_ids) == 1:
            return "single_cluster"
        return "multi_cluster"

    @staticmethod
    def _risk_level_for_clusters(
        cluster_ids: tuple[str, ...],
        *,
        scope_type: RepoTaskScopeType,
    ) -> RepoTaskRiskLevel:
        if scope_type == "ambiguous":
            return "high"
        if len(cluster_ids) == 1:
            return "low"
        return "medium"

    @staticmethod
    def _unique_path_order(*groups: tuple[str, ...]) -> tuple[str, ...]:
        ordered: list[str] = []
        for group in groups:
            for relative_path in group:
                if relative_path not in ordered:
                    ordered.append(relative_path)
        return tuple(ordered)
