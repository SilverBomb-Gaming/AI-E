"""Deterministic repo structure map for bounded coding-task planning."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


RepoTaskConfidence = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class RepoImpactAnalysis:
    upstream: tuple[str, ...] = ()
    downstream: tuple[str, ...] = ()
    tests: tuple[str, ...] = ()


@dataclass(frozen=True)
class RepoModuleCluster:
    cluster_id: str
    title: str
    files: tuple[str, ...]
    summary: str
    upstream: tuple[str, ...] = ()
    downstream: tuple[str, ...] = ()
    tests: tuple[str, ...] = ()


@dataclass(frozen=True)
class RepoStructureSelection:
    cluster_ids: tuple[str, ...]
    target_files: tuple[str, ...]
    impact_analysis: RepoImpactAnalysis
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
            upstream=("app/controller/feature_bundle_models.py",),
            downstream=("app/controller/feature_bundle_formatter.py",),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
        RepoModuleCluster(
            cluster_id="autonomous_dev_cluster",
            title="autonomous dev cluster",
            files=("app/controller/autonomous_dev_models.py",),
            summary="Autonomous dev loop state and step metadata.",
            upstream=("app/controller/autonomous_dev_models.py",),
            downstream=("app/controller/feature_bundle_formatter.py",),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
        RepoModuleCluster(
            cluster_id="test_cluster",
            title="test cluster",
            files=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
            summary="Focused regression coverage for task chains and CLI routing.",
            upstream=(),
            downstream=(),
            tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
        ),
    )
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
        selection_summary: str,
        expansion_summary: str,
    ) -> RepoStructureSelection:
        target_files = self.expand_cluster_files(cluster_ids)
        clusters = self._iter_clusters(cluster_ids)
        upstream = self._unique_path_order(*(cluster.upstream for cluster in clusters))
        downstream = self._unique_path_order(*(cluster.downstream for cluster in clusters))
        tests = self._unique_path_order(*(cluster.tests for cluster in clusters))
        return RepoStructureSelection(
            cluster_ids=cluster_ids,
            target_files=target_files,
            impact_analysis=RepoImpactAnalysis(upstream=upstream, downstream=downstream, tests=tests),
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

    @staticmethod
    def _unique_path_order(*groups: tuple[str, ...]) -> tuple[str, ...]:
        ordered: list[str] = []
        for group in groups:
            for relative_path in group:
                if relative_path not in ordered:
                    ordered.append(relative_path)
        return tuple(ordered)
