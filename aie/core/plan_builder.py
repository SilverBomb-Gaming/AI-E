from __future__ import annotations

import json
from pathlib import Path

from .models import ConstraintReport, ExecutionPlan, IntentSpec


def _load_policy_file(file_name: str) -> dict:
    policy_path = Path(__file__).resolve().parents[1] / "policies" / file_name
    return json.loads(policy_path.read_text(encoding="utf-8"))


class PlanBuilder:
    """Build bounded scaffold-first execution plans from parsed requests and constraints."""

    _FEATURE_TITLES = {
        "third_person_controller": "third-person controller",
        "first_person_controller": "first-person controller",
        "inventory": "inventory",
        "camera": "camera follow",
        "movement": "movement",
        "combat": "combat",
        "dialogue": "dialogue",
        "crafting": "crafting",
        "save_system": "save system",
    }

    def __init__(self) -> None:
        self._unity_rules = _load_policy_file("unity_rules.json")

    def build(self, intent: IntentSpec, report: ConstraintReport) -> ExecutionPlan:
        if report.status == "unsupported_target":
            return ExecutionPlan(
                status=report.status,
                summary=f"Unsupported engine target: {report.engine_target}. Unity is the only implemented adapter in Constraint Router v1.",
                bounded=True,
                engine_target=report.engine_target,
                tasks=(
                    {
                        "id": "unsupported-target",
                        "title": "Confirm a supported engine target",
                        "detail": "Switch the request to Unity or defer the task until another engine adapter exists.",
                        "bounded": True,
                    },
                ),
                file_operations=(),
                verification_steps=("Confirm the intended engine before implementation.",),
                warnings=report.warnings,
                codex_handoff_ready=False,
                limitations=("Only the Unity adapter is implemented in v1.",),
            )
        if report.status == "blocked_unsafe":
            return ExecutionPlan(
                status=report.status,
                summary="Requested work crosses a blocked Constraint Router boundary and stays plan-only.",
                bounded=True,
                engine_target=report.engine_target,
                tasks=(
                    {
                        "id": "blocked-scope",
                        "title": "Reduce the request to a safe bounded slice",
                        "detail": "Stay inside script-level planning and remove direct engine automation or blocked scope.",
                        "bounded": True,
                    },
                ),
                file_operations=(),
                verification_steps=("Remove blocked actions before requesting execution planning.",),
                warnings=report.warnings + report.blocked_actions,
                codex_handoff_ready=False,
                limitations=("Scene, prefab, and build automation remain outside v1 scope.",),
            )
        if report.status == "bounded_draft_only":
            return self._build_draft_plan(intent, report)
        return self._build_unity_plan(intent, report)

    def _build_unity_plan(self, intent: IntentSpec, report: ConstraintReport) -> ExecutionPlan:
        feature_key = self._primary_feature(intent.features)
        feature_title = self._FEATURE_TITLES.get(feature_key, "Unity gameplay feature")
        summary = f"Bounded Unity scaffold plan for {feature_title}."
        tasks = (
            {
                "id": "inspect-surface",
                "title": "Inspect the closest Unity gameplay script surface",
                "detail": "Locate the current player, camera, or gameplay entrypoint before adding new code.",
                "bounded": True,
            },
            {
                "id": "add-scaffold",
                "title": f"Add a minimal {feature_title} scaffold",
                "detail": "Implement the smallest usable script slice before layering polish or content.",
                "bounded": True,
            },
            {
                "id": "document-hooks",
                "title": "Document manual scene and inspector hooks",
                "detail": "Leave explicit notes for any Unity wiring the operator must complete manually.",
                "bounded": True,
            },
        )
        file_operations = tuple(self._feature_file_hints(feature_key))
        verification_steps = tuple(self._unity_rules.get("default_verification_guidance", []))
        limitations = tuple(report.guardrail_notes)
        return ExecutionPlan(
            status=report.status,
            summary=summary,
            bounded=True,
            engine_target="unity",
            tasks=tasks,
            file_operations=file_operations,
            verification_steps=verification_steps,
            warnings=report.warnings,
            codex_handoff_ready=report.status in {"supported_ready", "supported_with_warnings"},
            limitations=limitations,
        )

    def _build_draft_plan(self, intent: IntentSpec, report: ConstraintReport) -> ExecutionPlan:
        feature_key = self._primary_feature(intent.features)
        feature_title = self._FEATURE_TITLES.get(feature_key, "requested feature")
        draft_file_operations = tuple(self._draft_file_hints(feature_key))
        tasks = [
            {
                "id": "confirm-missing-inputs",
                "title": "Confirm the missing implementation inputs",
                "detail": "Resolve engine target and scope before converting the draft into an engine-bound execution plan.",
                "bounded": True,
            },
        ]
        if feature_key == "inventory":
            tasks.extend(
                [
                    {
                        "id": "inventory-model",
                        "title": "Draft a minimal inventory data model",
                        "detail": "Keep the first slice to slots, item data, and one clear storage path.",
                        "bounded": True,
                    },
                    {
                        "id": "inventory-ui",
                        "title": "Draft one minimal presentation hook",
                        "detail": "Limit the first pass to a small UI or debug surface instead of a full inventory workflow.",
                        "bounded": True,
                    },
                ]
            )
        else:
            tasks.append(
                {
                    "id": "scaffold-feature",
                    "title": f"Draft the smallest {feature_title} scaffold",
                    "detail": "Translate the request into one bounded mechanic slice before any broader system work.",
                    "bounded": True,
                }
            )
        verification_steps = (
            "Confirm the engine target and intended gameplay slice.",
            "Keep the first implementation to one mechanic or one UI surface.",
        )
        limitations = tuple(report.guardrail_notes) + ("Draft-only until the missing inputs are confirmed.",)
        summary = f"Draft-only bounded plan for {feature_title}; missing inputs prevent engine-bound execution."
        return ExecutionPlan(
            status=report.status,
            summary=summary,
            bounded=True,
            engine_target=report.engine_target,
            tasks=tuple(tasks),
            file_operations=draft_file_operations,
            verification_steps=verification_steps,
            warnings=report.warnings + report.ambiguities,
            codex_handoff_ready=False,
            limitations=limitations,
        )

    def _primary_feature(self, features: tuple[str, ...]) -> str:
        if not features:
            return "generic_unity_feature"
        return features[0]

    def _feature_file_hints(self, feature_key: str) -> list[dict]:
        hints = self._unity_rules.get("feature_file_hints", {})
        return list(hints.get(feature_key, hints.get("generic_unity_feature", [])))

    def _draft_file_hints(self, feature_key: str) -> list[dict]:
        if feature_key == "inventory":
            return [
                {
                    "action": "draft_path_hint",
                    "path": None,
                    "path_hint": "Assets/Scripts/Inventory/InventoryService.cs",
                    "reason": "Unity-first suggestion only; keep draft-only until the engine target is confirmed.",
                },
                {
                    "action": "draft_path_hint",
                    "path": None,
                    "path_hint": "Assets/Scripts/UI/InventoryPanelPresenter.cs",
                    "reason": "Bounded presentation hook once the engine target and UI approach are confirmed.",
                },
            ]
        return [
            {
                "action": "draft_path_hint",
                "path": None,
                "path_hint": "Assets/Scripts",
                "reason": "Unity-first placeholder only; confirm the engine before binding concrete files.",
            }
        ]
