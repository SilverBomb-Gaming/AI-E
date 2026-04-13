"""Deterministic routing for bounded coding-task families across known repo clusters."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

from .pattern_registry import CodingPatternMatch, PatternRegistry
from .repo_structure_map import (
    RepoClusterReason,
    RepoImpactAnalysis,
    RepoStructureMap,
    RepoTaskConfidence,
    RepoTaskRiskLevel,
    RepoTaskScopeType,
)


RepoTaskRouteKind = Literal["proposal_ready", "needs_clarification", "not_applicable"]
RepoTaskType = Literal[
    "formatter_output_update",
    "capability_wiring_update",
    "controller_state_alignment",
    "formatter_model_executor_alignment",
    "test_repair_alignment",
    "bounded_refactor",
]


@dataclass(frozen=True)
class RepoTaskRouteFile:
    relative_path: str
    inclusion_reason: str
    change_type: str
    editable: bool
    scope_confidence: float


@dataclass(frozen=True)
class RepoTaskRoute:
    kind: RepoTaskRouteKind
    task_type: RepoTaskType = "bounded_refactor"
    task_category: str = ""
    feature_title: str = ""
    intended_outcome: str = ""
    bundle_summary: str = ""
    files: tuple[RepoTaskRouteFile, ...] = ()
    affected_tests: tuple[str, ...] = ()
    validation_command: str = ""
    validation_rationale: str = ""
    expected_test_impact: str = ""
    assumptions: tuple[str, ...] = ()
    risk_notes: tuple[str, ...] = ()
    clarification_question: str = ""
    next_step: str = ""
    playtest_required: bool = False
    route_key: str = ""
    cluster_ids: tuple[str, ...] = ()
    cluster_reasons: tuple[RepoClusterReason, ...] = ()
    impact_analysis: RepoImpactAnalysis = field(default_factory=RepoImpactAnalysis)
    scope_type: RepoTaskScopeType = "ambiguous"
    risk_level: RepoTaskRiskLevel = "high"
    confidence: RepoTaskConfidence = "low"
    pattern_used: str = ""
    pattern_confidence: RepoTaskConfidence = "low"
    pattern_summary: str = ""
    selection_summary: str = ""
    expansion_summary: str = ""


class RepoTaskRouter:
    _CODING_MARKERS = (
        "helper",
        "function",
        "method",
        "formatter",
        "formatting",
        "controller",
        "model",
        "state",
        "refactor",
        "code",
        "coding",
        "extend",
        "wire",
        "routing",
        "route",
        "capability",
        "executor",
        "grammar",
        "registry",
        "planner",
        "execution flow",
    )

    def __init__(self) -> None:
        self._pattern_registry = PatternRegistry()
        self._structure_map = RepoStructureMap()

    def plan(self, prompt: str) -> RepoTaskRoute:
        normalized = self._normalize(prompt)
        pattern_match = self._pattern_registry.match(normalized)
        if self._needs_bundle_logic_clarification(normalized):
            return self._apply_pattern_match(
                self._clarification_route(
                task_type="controller_state_alignment",
                task_category="feature_bundle_scope_selection",
                cluster_ids=("bundle_cluster", "test_cluster"),
                confidence="low",
                clarification_question="Which bundle behavior should be updated: apply, validation tracking, commit prep, or push flow?",
                next_step="Reply with the intended bundle slice so I can keep the coding plan inside the current feature-bundle surfaces.",
                ),
                pattern_match,
            )
        if pattern_match is not None:
            matched_route = self._route_for_pattern(pattern_match, normalized)
            if matched_route is not None:
                return matched_route
        if self._matches_execution_output_formatting_request(normalized):
            return self._execution_output_formatting_route()
        if not self._looks_like_coding_request(normalized):
            return RepoTaskRoute(kind="not_applicable")
        if self._matches_wide_scope_request(normalized):
            return self._clarification_route(
                task_type="bounded_refactor",
                task_category="wide_scope_refactor",
                cluster_ids=("capability_cluster", "execution_cluster", "bundle_cluster", "autonomous_dev_cluster", "test_cluster"),
                confidence="low",
                risk_level="high",
                scope_type="ambiguous",
                clarification_question="This request spans multiple clusters and is too broad. Which specific subsystem should be targeted?",
                next_step="Reply with one bounded subsystem or one known cross-feature interaction so I can keep the plan inside the current repo map.",
            )
        if self._matches_commit_summary_helper_request(normalized):
            return self._commit_summary_helper_route()
        if self._matches_autonomous_dev_refactor_request(normalized):
            return self._autonomous_dev_refactor_route()
        if self._matches_capability_wiring_request(normalized):
            return self._clarification_route(
                task_type="capability_wiring_update",
                task_category="capability_wiring_update",
                cluster_ids=("capability_cluster", "test_cluster"),
                confidence="medium",
                clarification_question=(
                    f"{self._structure_map.clarification_for_clusters(('capability_cluster', 'test_cluster'), action='update capability routing')} "
                    "Also, what command or capability name should be wired?"
                ),
                next_step="Reply with the command or capability id plus whether this is wiring-only or a behavior change.",
            )
        if self._matches_execution_flow_refactor_request(normalized):
            return self._execution_flow_refactor_route()
        if self._matches_controller_state_request(normalized):
            return self._clarification_route(
                task_type="controller_state_alignment",
                task_category="controller_state_alignment",
                cluster_ids=("execution_cluster", "bundle_cluster", "test_cluster"),
                confidence="medium",
                clarification_question=(
                    f"{self._structure_map.clarification_for_clusters(('execution_cluster', 'bundle_cluster', 'test_cluster'), action='align controller state flow')} "
                    "Should I update only the controller entrypoints, or also propagate the change through bundle formatting and focused tests?"
                ),
                next_step="Reply with the module cluster this should stay within and whether the change should also touch tests and formatter output.",
            )
        if self._matches_dev_loop_refactor_request(normalized):
            return self._clarification_route(
                task_type="bounded_refactor",
                task_category="autonomous_dev_loop_refactor",
                cluster_ids=("autonomous_dev_cluster", "bundle_cluster", "test_cluster"),
                confidence="medium",
                clarification_question=(
                    "This may affect the autonomous dev cluster "
                    "(app/controller/autonomous_dev_models.py), the bundle formatter surface, "
                    "and the focused task-chain and CLI tests. Should the refactor stay inside the formatter, "
                    "or align the full loop output and tests?"
                ),
                next_step="Reply with the narrow loop slice to refactor so I can keep the patch inside one bounded module cluster.",
            )
        if self._matches_test_repair_request(normalized):
            cluster_ids = self._cluster_ids_for_test_repair(normalized)
            return self._clarification_route(
                task_type="test_repair_alignment",
                task_category="test_repair_alignment",
                cluster_ids=cluster_ids,
                confidence="medium",
                clarification_question=(
                    f"{self._structure_map.clarification_for_clusters(cluster_ids, action='repair the drifting validation path')} "
                    "Should I repair only the tests, or also align the underlying controller or formatter logic?"
                ),
                next_step="Reply with the smallest module cluster to keep the repair bounded.",
            )
        return self._clarification_route(
            task_type="bounded_refactor",
            task_category="bounded_repo_task",
            cluster_ids=("capability_cluster", "execution_cluster", "bundle_cluster", "autonomous_dev_cluster", "test_cluster"),
            confidence="low",
            clarification_question=(
                "Which module cluster should this stay within: capability cluster, execution cluster, bundle cluster, "
                "or autonomous dev cluster?"
            ),
            next_step="Reply with the bounded repo slice plus whether this is a behavior change, test repair, or refactor only.",
        )

    def _route_for_pattern(self, pattern_match: CodingPatternMatch, normalized_prompt: str) -> RepoTaskRoute | None:
        route_family = pattern_match.pattern.route_family
        if route_family == "commit_summary_helper":
            return self._apply_pattern_match(self._commit_summary_helper_route(), pattern_match)
        if route_family == "autonomous_dev_refactor":
            return self._apply_pattern_match(self._autonomous_dev_refactor_route(), pattern_match)
        if route_family == "execution_output_formatting":
            if self._matches_execution_flow_refactor_request(normalized_prompt):
                return self._apply_pattern_match(self._execution_flow_refactor_route(), pattern_match)
            return self._apply_pattern_match(self._execution_output_formatting_route(), pattern_match)
        if route_family == "capability_wiring":
            return self._apply_pattern_match(
                self._clarification_route(
                    task_type="capability_wiring_update",
                    task_category="capability_wiring_update",
                    cluster_ids=pattern_match.pattern.cluster_ids,
                    confidence="high" if pattern_match.confidence == "high" else "medium",
                    clarification_question=(
                        f"{self._structure_map.clarification_for_clusters(pattern_match.pattern.cluster_ids, action='update capability routing')} "
                        "What command or capability name should be wired?"
                    ),
                    next_step="Reply with the command or capability id plus whether this is wiring-only or a behavior change.",
                ),
                pattern_match,
            )
        return None

    def _execution_flow_refactor_route(self) -> RepoTaskRoute:
        return self._clarification_route(
            task_type="bounded_refactor",
            task_category="execution_flow_refactor",
            cluster_ids=("execution_cluster", "bundle_cluster", "test_cluster"),
            confidence="medium",
            clarification_question=(
                "This may affect the execution cluster "
                "(app/controller/app_service.py, app/controller/task_execution_conversation.py, "
                "app/controller/multi_file_feature_planner.py). Should the refactor stay within one file, "
                "or align the full execution flow plus formatter and focused tests?"
            ),
            next_step="Reply with whether this should stay inside a single execution file or align the broader execution cluster.",
        )

    @classmethod
    def _looks_like_coding_request(cls, prompt: str) -> bool:
        if any(marker in prompt for marker in cls._CODING_MARKERS):
            return True
        if cls._needs_bundle_logic_clarification(prompt):
            return True
        if cls._matches_execution_output_formatting_request(prompt):
            return True
        return cls._matches_test_repair_request(prompt)

    @staticmethod
    def _normalize(prompt: str) -> str:
        return " ".join(prompt.lower().replace(".", " ").replace(",", " ").split())

    @staticmethod
    def _needs_bundle_logic_clarification(prompt: str) -> bool:
        return prompt in {"update the bundle logic", "update bundle logic", "update the bundle", "update bundle"}

    @staticmethod
    def _matches_commit_summary_helper_request(prompt: str) -> bool:
        has_helper = any(marker in prompt for marker in ("helper", "format", "formatter", "extract"))
        has_commit_summary = "feature bundle commit summar" in prompt
        has_tests = "test" in prompt
        return has_helper and has_commit_summary and has_tests

    @staticmethod
    def _matches_execution_output_formatting_request(prompt: str) -> bool:
        return (
            "execution" in prompt
            and any(marker in prompt for marker in ("output format", "output formatting", "formatting", "format"))
            and any(marker in prompt for marker in ("update", "change", "align"))
        )

    @staticmethod
    def _matches_autonomous_dev_refactor_request(prompt: str) -> bool:
        loop_markers = ("autonomous dev", "autonomous-dev", "dev loop", "devchain", "/devchain")
        refactor_markers = ("refactor", "helper", "extract")
        formatting_markers = ("format", "formatter", "step", "status")
        return (
            any(marker in prompt for marker in loop_markers)
            and any(marker in prompt for marker in refactor_markers)
            and any(marker in prompt for marker in formatting_markers)
        )

    @staticmethod
    def _matches_capability_wiring_request(prompt: str) -> bool:
        wiring_markers = ("wire", "wiring", "grammar", "registry", "executor", "evaluator", "capability", "routing", "route")
        return "capability" in prompt and any(marker in prompt for marker in wiring_markers)

    @staticmethod
    def _matches_controller_state_request(prompt: str) -> bool:
        return any(
            marker in prompt
            for marker in (
                "state flow",
                "state-model",
                "state model",
                "controller state",
                "controller surfaces",
                "propagate state",
                "formatter model executor alignment",
            )
        )

    @staticmethod
    def _matches_execution_flow_refactor_request(prompt: str) -> bool:
        return "refactor" in prompt and any(
            marker in prompt
            for marker in ("execution flow", "execution cluster", "task execution", "multi file planner", "planner flow")
        )

    @staticmethod
    def _matches_dev_loop_refactor_request(prompt: str) -> bool:
        return "refactor" in prompt and any(marker in prompt for marker in ("dev loop", "autonomous dev", "devchain", "/devchain"))

    @staticmethod
    def _matches_test_repair_request(prompt: str) -> bool:
        return any(marker in prompt for marker in ("repair tests", "fix tests", "test repair", "update tests")) and any(
            marker in prompt for marker in ("controller", "formatter", "capability", "bundle", "autonomous", "execution")
        )

    @staticmethod
    def _matches_wide_scope_request(prompt: str) -> bool:
        return any(
            marker in prompt
            for marker in (
                "entire system",
                "whole system",
                "entire repo",
                "whole repo",
                "everything",
                "all clusters",
            )
        )

    def _cluster_ids_for_test_repair(self, prompt: str) -> tuple[str, ...]:
        if "capability" in prompt:
            return ("capability_cluster", "test_cluster")
        if "autonomous" in prompt or "dev loop" in prompt:
            return ("autonomous_dev_cluster", "bundle_cluster", "test_cluster")
        if "execution" in prompt or "controller" in prompt:
            return ("execution_cluster", "bundle_cluster", "test_cluster")
        return ("bundle_cluster", "test_cluster")

    def _clarification_route(
        self,
        *,
        task_type: RepoTaskType,
        task_category: str,
        cluster_ids: tuple[str, ...],
        confidence: RepoTaskConfidence,
        risk_level: RepoTaskRiskLevel | None = None,
        scope_type: RepoTaskScopeType | None = None,
        clarification_question: str,
        next_step: str,
    ) -> RepoTaskRoute:
        selection = self._build_selection(
            cluster_ids=cluster_ids,
            confidence=confidence,
            risk_level=risk_level,
            scope_type=scope_type,
            seed_paths=(),
        )
        return RepoTaskRoute(
            kind="needs_clarification",
            task_type=task_type,
            task_category=task_category,
            clarification_question=clarification_question,
            next_step=next_step,
            cluster_ids=selection.cluster_ids,
            cluster_reasons=selection.cluster_reasons,
            impact_analysis=selection.impact_analysis,
            scope_type=selection.scope_type,
            risk_level=selection.risk_level,
            confidence=selection.confidence,
            selection_summary=selection.selection_summary,
            expansion_summary=selection.expansion_summary,
        )

    @staticmethod
    def _apply_pattern_match(route: RepoTaskRoute, pattern_match: CodingPatternMatch | None) -> RepoTaskRoute:
        if pattern_match is None:
            return route
        return replace(
            route,
            pattern_used=pattern_match.pattern.pattern_id,
            pattern_confidence=pattern_match.confidence,
            pattern_summary=pattern_match.adaptation_summary,
            confidence=(
                "high"
                if pattern_match.confidence == "high" and route.kind == "proposal_ready"
                else route.confidence
            ),
        )

    def _build_selection(
        self,
        *,
        cluster_ids: tuple[str, ...],
        confidence: RepoTaskConfidence,
        risk_level: RepoTaskRiskLevel | None = None,
        scope_type: RepoTaskScopeType | None = None,
        seed_paths: tuple[str, ...],
    ):
        selection_summary = self._structure_map.selection_summary_for_clusters(cluster_ids)
        missing_paths = self._structure_map.partial_cluster_gaps(seed_paths) if seed_paths else ()
        if missing_paths:
            expansion_summary = f"Expanded the plan to keep cluster integrity: {', '.join(missing_paths)}"
        elif seed_paths:
            expansion_summary = f"Seed files already cover the full {selection_summary}."
        else:
            expansion_summary = f"Cluster-aware clarification is anchored to the full {selection_summary}."
        return self._structure_map.build_selection(
            cluster_ids=cluster_ids,
            confidence=confidence,
            risk_level=risk_level,
            scope_type=scope_type,
            selection_summary=selection_summary,
            expansion_summary=expansion_summary,
        )

    def _build_route_file(
        self,
        *,
        relative_path: str,
        cluster_ids: tuple[str, ...],
        file_overrides: dict[str, RepoTaskRouteFile],
    ) -> RepoTaskRouteFile:
        existing = file_overrides.get(relative_path)
        if existing is not None:
            return existing
        cluster_titles = [
            self._structure_map.cluster(cluster_id).title
            for cluster_id in cluster_ids
            if relative_path in self._structure_map.cluster(cluster_id).files
        ]
        joined_titles = ", ".join(cluster_titles) or "selected cluster"
        if relative_path.startswith("tests/"):
            return RepoTaskRouteFile(
                relative_path=relative_path,
                inclusion_reason=f"Included to keep the focused regression package aligned with the {joined_titles}.",
                change_type="Validation surface only: keep the broader regression package intact for the selected repo slice.",
                editable=False,
                scope_confidence=0.84,
            )
        return RepoTaskRouteFile(
            relative_path=relative_path,
            inclusion_reason=f"Included to keep the {joined_titles} intact so the plan does not drift into a partial multi-file update.",
            change_type=f"Context only: preserve {joined_titles} integrity while the editable change stays in the primary implementation file.",
            editable=False,
            scope_confidence=0.8,
        )

    def _proposal_route(
        self,
        *,
        task_type: RepoTaskType,
        task_category: str,
        feature_title: str,
        intended_outcome: str,
        bundle_summary: str,
        cluster_ids: tuple[str, ...],
        file_overrides: dict[str, RepoTaskRouteFile],
        validation_command: str,
        validation_rationale: str,
        expected_test_impact: str,
        assumptions: tuple[str, ...],
        risk_notes: tuple[str, ...],
        route_key: str,
        playtest_required: bool = False,
        risk_level: RepoTaskRiskLevel | None = None,
        scope_type: RepoTaskScopeType | None = None,
    ) -> RepoTaskRoute:
        seed_paths = tuple(file_overrides)
        selection = self._build_selection(
            cluster_ids=cluster_ids,
            confidence="high",
            risk_level=risk_level,
            scope_type=scope_type,
            seed_paths=seed_paths,
        )
        files = tuple(
            self._build_route_file(relative_path=relative_path, cluster_ids=selection.cluster_ids, file_overrides=file_overrides)
            for relative_path in selection.target_files
        )
        return RepoTaskRoute(
            kind="proposal_ready",
            task_type=task_type,
            task_category=task_category,
            feature_title=feature_title,
            intended_outcome=intended_outcome,
            bundle_summary=bundle_summary,
            files=files,
            affected_tests=selection.impact_analysis.tests,
            validation_command=validation_command,
            validation_rationale=validation_rationale,
            expected_test_impact=expected_test_impact,
            assumptions=assumptions,
            risk_notes=risk_notes,
            playtest_required=playtest_required,
            route_key=route_key,
            cluster_ids=selection.cluster_ids,
            cluster_reasons=selection.cluster_reasons,
            impact_analysis=selection.impact_analysis,
            scope_type=selection.scope_type,
            risk_level=selection.risk_level,
            confidence=selection.confidence,
            selection_summary=selection.selection_summary,
            expansion_summary=selection.expansion_summary,
        )

    def _execution_output_formatting_route(self) -> RepoTaskRoute:
        return self._proposal_route(
            task_type="formatter_model_executor_alignment",
            task_category="execution_output_formatting",
            feature_title="Align execution output formatting across controller, bundle formatter, and focused tests",
            intended_outcome="Keep execution-flow output formatting aligned across controller entrypoints, bundle formatting, and focused regression coverage.",
            bundle_summary="Cross-feature coding bundle for execution output formatting across the execution, bundle, and test clusters.",
            cluster_ids=("execution_cluster", "bundle_cluster", "test_cluster"),
            file_overrides={
                "app/controller/app_service.py": RepoTaskRouteFile(
                    relative_path="app/controller/app_service.py",
                    inclusion_reason="Controller entrypoints produce the execution-flow messages that feed bundle and CLI output.",
                    change_type="Context only: preserve the execution entrypoints that define the upstream output contract.",
                    editable=False,
                    scope_confidence=0.83,
                ),
                "app/controller/task_execution_conversation.py": RepoTaskRouteFile(
                    relative_path="app/controller/task_execution_conversation.py",
                    inclusion_reason="Conversational execution flow consumes controller status and shapes the operator-facing output path.",
                    change_type="Context only: keep the execution conversation path visible while aligning output formatting.",
                    editable=False,
                    scope_confidence=0.81,
                ),
                "app/controller/multi_file_feature_planner.py": RepoTaskRouteFile(
                    relative_path="app/controller/multi_file_feature_planner.py",
                    inclusion_reason="Multi-file planning ties execution flow to bundle formatting, so it stays in scope as a bounded interaction point.",
                    change_type="Context only: preserve planner-to-bundle integration while the output formatting change stays downstream.",
                    editable=False,
                    scope_confidence=0.79,
                ),
                "app/controller/feature_bundle_models.py": RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_models.py",
                    inclusion_reason="Bundle models define the payload contract that formatter output must continue to honor.",
                    change_type="Context only: preserve the bundle model contract that downstream formatting reads from.",
                    editable=False,
                    scope_confidence=0.84,
                ),
                "app/controller/feature_bundle_formatter.py": RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_formatter.py",
                    inclusion_reason="Bundle formatter is the direct implementation surface for operator-facing execution output formatting.",
                    change_type="Edit the formatter output so cross-feature coding scope, risk, and interaction lines stay consistent and readable.",
                    editable=False,
                    scope_confidence=0.9,
                ),
                "tests/test_task_chains.py": RepoTaskRouteFile(
                    relative_path="tests/test_task_chains.py",
                    inclusion_reason="Task-chain coverage validates execution and bundle output alignment across the bounded coding flow.",
                    change_type="Validation surface only: confirm task-chain output still reflects the aligned execution formatting contract.",
                    editable=False,
                    scope_confidence=0.85,
                ),
                "tests/test_cli_chat.py": RepoTaskRouteFile(
                    relative_path="tests/test_cli_chat.py",
                    inclusion_reason="CLI chat coverage validates operator-facing output when execution and bundle formatting move together.",
                    change_type="Validation surface only: confirm CLI output still reads cleanly after the cross-feature formatting alignment.",
                    editable=False,
                    scope_confidence=0.85,
                ),
            },
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            validation_rationale="The known cross-feature pattern spans execution, bundle formatting, and focused tests, so the existing task-chain and CLI coverage remain the smallest safe regression package.",
            expected_test_impact="Task-chain and CLI coverage should confirm the execution-to-bundle output contract still reads consistently after the cross-feature formatting alignment.",
            assumptions=(
                "The change stays within the known execution, bundle, and focused test clusters.",
                "No capability routing or autonomous-dev behavior is widened beyond the current cross-feature output path.",
            ),
            risk_notes=(
                "This is a known multi-cluster pattern, so the plan highlights execution-to-bundle interaction points before any apply step.",
                "The route stays bounded by the current repo structure map and fails closed if an unknown subsystem is requested.",
            ),
            route_key="",
            risk_level="medium",
            scope_type="multi_cluster",
        )

    def _commit_summary_helper_route(self) -> RepoTaskRoute:
        return self._proposal_route(
            task_type="formatter_output_update",
            task_category="helper_extraction",
            feature_title="Add helper for feature bundle commit summary formatting",
            intended_outcome="Extract bounded formatter logic for feature bundle commit summaries and keep the focused task-chain and CLI coverage aligned.",
            bundle_summary="Bounded coding bundle for feature-bundle formatter helper extraction plus cluster-aware regression alignment.",
            cluster_ids=("bundle_cluster", "test_cluster"),
            file_overrides={
                "app/controller/feature_bundle_models.py": RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_models.py",
                    inclusion_reason="Model metadata anchors the bundle cluster contract and keeps the formatter helper extraction grounded in the current feature-bundle payload shape.",
                    change_type="Context only: keep the coding bundle tied to the existing feature-bundle models.",
                    editable=False,
                    scope_confidence=0.79,
                ),
                "app/controller/feature_bundle_formatter.py": RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_formatter.py",
                    inclusion_reason="Formatter commit summary lines are the direct implementation surface for the helper extraction.",
                    change_type="Extract commit summary line formatting into a dedicated helper used by completion advisory rendering.",
                    editable=True,
                    scope_confidence=0.97,
                ),
                "tests/test_task_chains.py": RepoTaskRouteFile(
                    relative_path="tests/test_task_chains.py",
                    inclusion_reason="Task-chain assertions are the tightest regression surface for the feature-bundle formatter output.",
                    change_type="Update task-chain coverage to assert the extracted commit prep reason line and richer coding-plan metadata.",
                    editable=True,
                    scope_confidence=0.95,
                ),
            },
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            validation_rationale="The change stays inside the bundle formatter surface, but the full bundle and test clusters keep both task-chain and CLI operator output aligned.",
            expected_test_impact="Task-chain coverage gains an explicit commit-prep-reason assertion while CLI chat confirms the broader formatter contract still reads cleanly.",
            assumptions=(
                "The change remains inside the existing formatter and focused test surfaces.",
                "The helper extraction should not alter feature-bundle apply, commit, or push behavior.",
            ),
            risk_notes=(
                "The coding bundle is patch-based and fails closed if the formatter or focused regression snippets drift.",
                "Cluster expansion adds CLI chat as context so the plan does not stop at a partial formatter-only view of the operator output.",
            ),
            route_key="commit_summary_helper",
        )

    def _autonomous_dev_refactor_route(self) -> RepoTaskRoute:
        return self._proposal_route(
            task_type="bounded_refactor",
            task_category="autonomous_dev_loop_refactor",
            feature_title="Refactor autonomous dev loop step formatting into a helper",
            intended_outcome="Keep autonomous dev loop status rendering in the formatter while extracting repeated step-line construction into a dedicated helper.",
            bundle_summary="Bounded refactor for autonomous dev loop step formatting plus cluster-aware regression validation.",
            cluster_ids=("autonomous_dev_cluster", "bundle_cluster", "test_cluster"),
            file_overrides={
                "app/controller/autonomous_dev_models.py": RepoTaskRouteFile(
                    relative_path="app/controller/autonomous_dev_models.py",
                    inclusion_reason="The formatter step helper still renders autonomous dev step metadata defined by the current model contract.",
                    change_type="Context only: keep the refactor anchored to the existing autonomous step model fields.",
                    editable=False,
                    scope_confidence=0.82,
                ),
                "app/controller/feature_bundle_formatter.py": RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_formatter.py",
                    inclusion_reason="Autonomous dev chain step rendering is implemented here, so the refactor stays inside the current formatter layer.",
                    change_type="Extract repeated autonomous dev step-line formatting into a dedicated helper without changing behavior.",
                    editable=True,
                    scope_confidence=0.96,
                ),
                "tests/test_task_chains.py": RepoTaskRouteFile(
                    relative_path="tests/test_task_chains.py",
                    inclusion_reason="Task-chain coverage already exercises the autonomous dev loop and is part of the smallest stable regression set.",
                    change_type="Validation surface only: confirm the autonomous dev workflow still reads cleanly after the formatter refactor.",
                    editable=False,
                    scope_confidence=0.85,
                ),
                "tests/test_cli_chat.py": RepoTaskRouteFile(
                    relative_path="tests/test_cli_chat.py",
                    inclusion_reason="CLI chat coverage exercises conversational autonomous loop summaries and completes the operator-facing regression package.",
                    change_type="Validation surface only: confirm the CLI conversational layer still presents the loop status correctly.",
                    editable=False,
                    scope_confidence=0.84,
                ),
            },
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            validation_rationale="Task-chain and CLI chat coverage already exercise the autonomous dev loop output, and the bundle cluster keeps the formatter contract from drifting.",
            expected_test_impact="No behavior change is intended; the focused task-chain and CLI chat coverage confirm the loop status output still reads the same after cluster-aware expansion.",
            assumptions=(
                "The refactor stays inside the existing autonomous dev formatter surface.",
                "Step ordering, confirmation gates, and chain state transitions remain unchanged.",
            ),
            risk_notes=(
                "The patch is formatter-only and fails closed if the expected autonomous step-formatting block drifts.",
                "Cluster expansion keeps the broader formatter contract visible so the refactor does not silently ignore bundle-model coupling.",
            ),
            route_key="autonomous_dev_step_refactor",
        )
