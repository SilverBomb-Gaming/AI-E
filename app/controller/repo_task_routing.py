"""Deterministic routing for bounded coding-task families across known repo clusters."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


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


class RepoTaskRouter:
    _CODING_MARKERS = (
        "helper",
        "function",
        "method",
        "formatter",
        "controller",
        "model",
        "state",
        "refactor",
        "code",
        "coding",
        "extend",
        "wire",
        "capability",
        "executor",
        "grammar",
        "registry",
    )
    _CAPABILITY_CLUSTER = (
        "app/controller/command_grammar.py",
        "app/controller/capability_registry.py",
        "app/controller/capability_evaluator.py",
        "app/controller/capability_executor.py",
        "tests/test_task_chains.py",
        "tests/test_cli_chat.py",
    )
    _CONTROLLER_STATE_CLUSTER = (
        "app/controller/app_service.py",
        "app/controller/feature_bundle_models.py",
        "app/controller/feature_bundle_formatter.py",
        "tests/test_task_chains.py",
        "tests/test_cli_chat.py",
    )

    def plan(self, prompt: str) -> RepoTaskRoute:
        normalized = self._normalize(prompt)
        if self._needs_bundle_logic_clarification(normalized):
            return RepoTaskRoute(
                kind="needs_clarification",
                task_type="controller_state_alignment",
                task_category="feature_bundle_scope_selection",
                clarification_question="Which bundle behavior should be updated: apply, validation tracking, commit prep, or push flow?",
                next_step="Reply with the intended bundle slice so I can keep the coding plan inside the current feature-bundle surfaces.",
            )
        if not self._looks_like_coding_request(normalized):
            return RepoTaskRoute(kind="not_applicable")
        if self._matches_commit_summary_helper_request(normalized):
            return self._commit_summary_helper_route()
        if self._matches_autonomous_dev_refactor_request(normalized):
            return self._autonomous_dev_refactor_route()
        if self._matches_capability_wiring_request(normalized):
            return RepoTaskRoute(
                kind="needs_clarification",
                task_type="capability_wiring_update",
                task_category="capability_wiring_update",
                clarification_question=(
                    "Should this stay within "
                    f"{', '.join(self._CAPABILITY_CLUSTER[:-1])}, and the focused tests {self._CAPABILITY_CLUSTER[-2]} and {self._CAPABILITY_CLUSTER[-1]} only? "
                    "Also, what command or capability name should be wired?"
                ),
                next_step="Reply with the command or capability id plus whether this is wiring-only or a behavior change.",
            )
        if self._matches_controller_state_request(normalized):
            return RepoTaskRoute(
                kind="needs_clarification",
                task_type="controller_state_alignment",
                task_category="controller_state_alignment",
                clarification_question=(
                    "Should I update only "
                    f"{self._CONTROLLER_STATE_CLUSTER[0]}, or also propagate the state through "
                    f"{self._CONTROLLER_STATE_CLUSTER[1]}, {self._CONTROLLER_STATE_CLUSTER[2]}, and the focused tests?"
                ),
                next_step="Reply with the module cluster this should stay within and whether the change should also touch tests and formatter output.",
            )
        if self._matches_dev_loop_refactor_request(normalized):
            return RepoTaskRoute(
                kind="needs_clarification",
                task_type="bounded_refactor",
                task_category="autonomous_dev_loop_refactor",
                clarification_question="Should this stay within the autonomous-dev loop only, or also update commit/push/PR planning and tests?",
                next_step="Reply with the narrow loop slice to refactor so I can keep the patch inside one bounded module cluster.",
            )
        if self._matches_test_repair_request(normalized):
            return RepoTaskRoute(
                kind="needs_clarification",
                task_type="test_repair_alignment",
                task_category="test_repair_alignment",
                clarification_question="Should I repair only the focused task-chain and CLI tests, or also update the controller or formatter logic that made them drift?",
                next_step="Reply with the smallest module cluster to keep the repair bounded.",
            )
        return RepoTaskRoute(
            kind="needs_clarification",
            task_type="bounded_refactor",
            task_category="bounded_repo_task",
            clarification_question="Which module cluster should this stay within: capability wiring, controller state flow, feature-bundle formatting, or autonomous-dev loop refactor?",
            next_step="Reply with the bounded repo slice plus whether this is a behavior change, test repair, or refactor only.",
        )

    @classmethod
    def _looks_like_coding_request(cls, prompt: str) -> bool:
        if any(marker in prompt for marker in cls._CODING_MARKERS):
            return True
        if cls._needs_bundle_logic_clarification(prompt):
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
        wiring_markers = ("wire", "wiring", "grammar", "registry", "executor", "evaluator", "capability")
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
    def _matches_dev_loop_refactor_request(prompt: str) -> bool:
        return "refactor" in prompt and any(marker in prompt for marker in ("dev loop", "autonomous dev", "devchain", "/devchain"))

    @staticmethod
    def _matches_test_repair_request(prompt: str) -> bool:
        return any(marker in prompt for marker in ("repair tests", "fix tests", "test repair", "update tests")) and any(
            marker in prompt for marker in ("controller", "formatter", "capability", "bundle", "autonomous")
        )

    @staticmethod
    def _commit_summary_helper_route() -> RepoTaskRoute:
        return RepoTaskRoute(
            kind="proposal_ready",
            task_type="formatter_output_update",
            task_category="helper_extraction",
            feature_title="Add helper for feature bundle commit summary formatting",
            intended_outcome="Extract bounded formatter logic for feature bundle commit summaries and keep the focused task-chain coverage aligned.",
            bundle_summary="Bounded coding bundle for feature-bundle formatter helper extraction plus focused regression alignment.",
            files=(
                RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_models.py",
                    inclusion_reason="Model metadata anchors the bounded feature-bundle formatter surface and keeps the plan grounded in the existing contract.",
                    change_type="Context only: keep the coding bundle tied to the existing feature-bundle models.",
                    editable=False,
                    scope_confidence=0.72,
                ),
                RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_formatter.py",
                    inclusion_reason="Formatter commit summary lines are the direct implementation surface for the helper extraction.",
                    change_type="Extract commit summary line formatting into a dedicated helper used by completion advisory rendering.",
                    editable=True,
                    scope_confidence=0.97,
                ),
                RepoTaskRouteFile(
                    relative_path="tests/test_task_chains.py",
                    inclusion_reason="Task-chain feature bundle assertions are the smallest stable regression surface for the formatter change.",
                    change_type="Update bounded task-chain coverage to assert the extracted commit prep reason line.",
                    editable=True,
                    scope_confidence=0.95,
                ),
            ),
            affected_tests=("tests/test_task_chains.py",),
            validation_command="python -m pytest tests/test_task_chains.py",
            validation_rationale="The bounded change stays inside feature-bundle formatter output and its focused task-chain assertions.",
            expected_test_impact="Task-chain coverage gains an explicit commit-prep-reason assertion without widening runtime scope.",
            assumptions=(
                "The change remains inside the existing formatter and task-chain surfaces.",
                "The helper extraction should not alter feature-bundle apply, commit, or push behavior.",
            ),
            risk_notes=(
                "The coding bundle is patch-based and fails closed if the formatter or task-chain snippets drift.",
                "No runtime playtest is required because the change is formatter-only and covered by existing task-chain assertions.",
            ),
            route_key="commit_summary_helper",
        )

    @staticmethod
    def _autonomous_dev_refactor_route() -> RepoTaskRoute:
        return RepoTaskRoute(
            kind="proposal_ready",
            task_type="bounded_refactor",
            task_category="autonomous_dev_loop_refactor",
            feature_title="Refactor autonomous dev loop step formatting into a helper",
            intended_outcome="Keep autonomous dev loop status rendering in the formatter while extracting repeated step-line construction into a dedicated helper.",
            bundle_summary="Bounded refactor for autonomous dev loop step formatting plus focused regression validation.",
            files=(
                RepoTaskRouteFile(
                    relative_path="app/controller/autonomous_dev_models.py",
                    inclusion_reason="The formatter step helper still renders autonomous dev step metadata defined by the current model contract.",
                    change_type="Context only: keep the refactor anchored to the existing autonomous step model fields.",
                    editable=False,
                    scope_confidence=0.74,
                ),
                RepoTaskRouteFile(
                    relative_path="app/controller/feature_bundle_formatter.py",
                    inclusion_reason="Autonomous dev chain step rendering is implemented here, so the refactor stays inside the current formatter layer.",
                    change_type="Extract repeated autonomous dev step-line formatting into a dedicated helper without changing behavior.",
                    editable=True,
                    scope_confidence=0.96,
                ),
                RepoTaskRouteFile(
                    relative_path="tests/test_task_chains.py",
                    inclusion_reason="Task-chain coverage already exercises the autonomous dev loop and is part of the smallest stable regression set.",
                    change_type="Validation surface only: confirm the autonomous dev workflow still reads cleanly after the formatter refactor.",
                    editable=False,
                    scope_confidence=0.83,
                ),
                RepoTaskRouteFile(
                    relative_path="tests/test_cli_chat.py",
                    inclusion_reason="CLI chat coverage already hits the conversational autonomous loop summaries and keeps the refactor grounded in operator-facing output.",
                    change_type="Validation surface only: confirm the CLI conversational layer still presents the loop status correctly.",
                    editable=False,
                    scope_confidence=0.81,
                ),
            ),
            affected_tests=("tests/test_task_chains.py", "tests/test_cli_chat.py"),
            validation_command="python -m pytest tests/test_task_chains.py tests/test_cli_chat.py",
            validation_rationale="Task-chain and CLI chat coverage already exercise the autonomous dev loop output, so they are the smallest stable regression package for this refactor.",
            expected_test_impact="No behavior change is intended; the focused task-chain and CLI chat coverage confirm the loop status output still reads the same.",
            assumptions=(
                "The refactor stays inside the existing autonomous dev formatter surface.",
                "Step ordering, confirmation gates, and chain state transitions remain unchanged.",
            ),
            risk_notes=(
                "The patch is formatter-only and fails closed if the expected autonomous step-formatting block drifts.",
                "Validation should stay on task-chain and CLI chat coverage because they already exercise the bounded autonomous dev loop output.",
            ),
            route_key="autonomous_dev_step_refactor",
        )
