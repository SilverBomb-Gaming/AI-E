"""Deterministic bounded planner for supported multi-file feature requests."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

from .feature_bundle_models import FeatureBundleFile, FeatureBundleRecord, FeatureValidationPlan


FeaturePlanningDecisionKind = Literal["planned", "refused", "not_applicable"]


@dataclass(frozen=True)
class FeaturePlanningDecision:
    kind: FeaturePlanningDecisionKind
    bundle: FeatureBundleRecord | None = None
    refusal_reason: str = ""
    next_step: str = ""


class MultiFileFeaturePlanner:
    def plan(
        self,
        *,
        bundle_id: str,
        prompt: str,
        timestamp: str,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> FeaturePlanningDecision:
        lowered = " ".join(prompt.lower().split())
        broad_reason = self._broad_request_reason(lowered)
        if broad_reason:
            return FeaturePlanningDecision(
                kind="refused",
                refusal_reason=broad_reason,
                next_step="Ask for one bounded slice such as 'show feature bundle id in the CLI debug output'.",
            )
        if self._matches_cli_debug_bundle(lowered):
            bundle = self._plan_cli_debug_bundle(
                bundle_id=bundle_id,
                prompt=prompt,
                timestamp=timestamp,
                read_text=read_text,
                path_exists=path_exists,
            )
            if bundle is None:
                return FeaturePlanningDecision(
                    kind="refused",
                    refusal_reason="The bounded CLI debug bundle could not be prepared because one or more required files were missing or changed unexpectedly.",
                    next_step="Use /repo or /file to confirm the CLI files are present and retry the bounded feature request.",
                )
            return FeaturePlanningDecision(kind="planned", bundle=bundle)
        if self._looks_feature_like(lowered):
            return FeaturePlanningDecision(
                kind="refused",
                refusal_reason="That feature request is outside the current bounded multi-file allowlist.",
                next_step="Tighten the request to a smaller supported slice, such as the CLI debug output workflow.",
            )
        return FeaturePlanningDecision(kind="not_applicable")

    @staticmethod
    def _broad_request_reason(prompt: str) -> str:
        patterns = (
            "entire app",
            "whole app",
            "whole system",
            "everything better",
            "make everything better",
            "refactor the entire",
            "convert the whole system",
        )
        for pattern in patterns:
            if pattern in prompt:
                return "The request is too broad for bounded multi-file planning."
        return ""

    @staticmethod
    def _looks_feature_like(prompt: str) -> bool:
        return any(token in prompt for token in ("throughout", "across", "wire it", "feature", "support ", "implement "))

    @staticmethod
    def _matches_cli_debug_bundle(prompt: str) -> bool:
        return "feature bundle id" in prompt and "cli" in prompt and "debug" in prompt

    def _plan_cli_debug_bundle(
        self,
        *,
        bundle_id: str,
        prompt: str,
        timestamp: str,
        read_text: Callable[[str], str | None],
        path_exists: Callable[[str], bool],
    ) -> FeatureBundleRecord | None:
        chat_cli_text = read_text("app/cli/chat_cli.py")
        tests_text = read_text("tests/test_cli_chat.py")
        if chat_cli_text is None or tests_text is None or not path_exists("app/cli/chat.py"):
            return None
        chat_cli_patch = self._build_chat_cli_patch(chat_cli_text)
        tests_patch = self._build_cli_tests_patch(tests_text)
        if chat_cli_patch is None or tests_patch is None:
            return None
        files = (
            FeatureBundleFile(
                relative_path="app/cli/chat.py",
                inclusion_reason="Entry module anchors the bounded CLI feature scope even though parser and formatter logic live downstream.",
                change_summary="Keep the module entry stable while the debug bundle changes adjacent CLI behavior.",
                editable=False,
                scope_confidence=0.74,
            ),
            FeatureBundleFile(
                relative_path="app/cli/chat_cli.py",
                inclusion_reason="CLI parser and debug output formatting both live here.",
                change_summary="Add feature bundle id visibility to CLI debug output.",
                editable=True,
                scope_confidence=0.98,
                patch_argument=chat_cli_patch,
            ),
            FeatureBundleFile(
                relative_path="tests/test_cli_chat.py",
                inclusion_reason="The CLI behavior change needs bounded regression coverage in the existing local chat test surface.",
                change_summary="Cover feature bundle id visibility in the bounded CLI feature flow.",
                editable=True,
                scope_confidence=0.94,
                patch_argument=tests_patch,
            ),
        )
        return FeatureBundleRecord(
            bundle_id=bundle_id,
            feature_request=prompt,
            feature_title="Show feature bundle id in the CLI debug output",
            intended_outcome="Expose the active feature bundle id in CLI debug diagnostics without widening capability scope.",
            bundle_summary="CLI feature bundle id visibility across debug output and focused regression coverage.",
            files=files,
            assumptions=(
                "The existing --debug behavior remains the underlying control for routed diagnostics.",
                "The bounded change stays inside the local CLI and its existing regression tests.",
            ),
            risk_notes=(
                "The bundle only patches files with exact expected snippets and will fail closed if those snippets drift.",
                "Validation is still explicit; the planner only suggests the focused pytest command.",
            ),
            validation_plan=FeatureValidationPlan(
                command_text="pytest tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing",
                rationale="The feature only changes CLI debug rendering, so the shared-status debug test is the smallest stable validation slice after the bundle is applied.",
            ),
            state="proposed",
            validation_state="not_run",
            created_at=timestamp,
            updated_at=timestamp,
            approval_required=True,
        )

    def _build_chat_cli_patch(self, current_text: str) -> str | None:
        replacements = (
            (
                "            if route:\n                self._write(f\"[ROUTE: {route}]\")\n            self._write(f\"[COMMAND: {result.command_label}]\")\n            routed_capability = self._routed_capability_label(result)\n            if routed_capability:\n                self._write(f\"[ROUTED CAPABILITY: {routed_capability}]\")\n            self._write(f\"[OUTCOME: {result.outcome} / {result.outcome_reason_code}]\")\n",
                "            if route:\n                self._write(f\"[ROUTE: {route}]\")\n            self._write(f\"[COMMAND: {result.command_label}]\")\n            routed_capability = self._routed_capability_label(result)\n            if routed_capability:\n                self._write(f\"[ROUTED CAPABILITY: {routed_capability}]\")\n            feature_bundle_id = self._feature_bundle_id_label(result)\n            if feature_bundle_id:\n                self._write(f\"[FEATURE BUNDLE ID: {feature_bundle_id}]\")\n            self._write(f\"[OUTCOME: {result.outcome} / {result.outcome_reason_code}]\")\n",
            ),
            (
                "    def _route_label(result: CapabilityExecutionResult) -> str:\n        payload = result.telemetry.get(\"natural_chat_route\")\n        if not isinstance(payload, dict):\n            return \"\"\n        route = str(payload.get(\"selected_route\") or payload.get(\"route_command\") or \"\").strip()\n        if route.startswith(\"legacy:\"):\n            return route.split(\":\", 1)[1]\n        return route\n\n    @staticmethod\n    def _routed_capability_label(result: CapabilityExecutionResult) -> str:\n        routed = str(result.telemetry.get(\"routed_capability_id\") or \"\").strip()\n        if not routed or routed == result.capability_id:\n            return \"\"\n        return routed\n\n    @staticmethod\n    def _action_tag(result: CapabilityExecutionResult, intent: str) -> str:\n",
                "    def _route_label(result: CapabilityExecutionResult) -> str:\n        payload = result.telemetry.get(\"natural_chat_route\")\n        if not isinstance(payload, dict):\n            return \"\"\n        route = str(payload.get(\"selected_route\") or payload.get(\"route_command\") or \"\").strip()\n        if route.startswith(\"legacy:\"):\n            return route.split(\":\", 1)[1]\n        return route\n\n    @staticmethod\n    def _routed_capability_label(result: CapabilityExecutionResult) -> str:\n        routed = str(result.telemetry.get(\"routed_capability_id\") or \"\").strip()\n        if not routed or routed == result.capability_id:\n            return \"\"\n        return routed\n\n    @staticmethod\n    def _feature_bundle_id_label(result: CapabilityExecutionResult) -> str:\n        return str(result.telemetry.get(\"feature_bundle_id\") or \"\").strip()\n\n    @staticmethod\n    def _action_tag(result: CapabilityExecutionResult, intent: str) -> str:\n",
            ),
        )
        return self._build_patch_argument(
            relative_path="app/cli/chat_cli.py",
            operator_reason="show feature bundle id in CLI debug output",
            current_text=current_text,
            replacements=replacements,
        )

    def _build_cli_tests_patch(self, current_text: str) -> str | None:
        replacements = (
            (
                "self.assertIn(\"_feature_bundle_id_label\", updated_cli)\n",
                "self.assertIn(\"[FEATURE BUNDLE ID: {feature_bundle_id}]\", updated_cli)\n            self.assertIn(\"_feature_bundle_id_label\", updated_cli)\n",
            ),
        )
        return self._build_patch_argument(
            relative_path="tests/test_cli_chat.py",
            operator_reason="cover feature bundle id debug output behavior",
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