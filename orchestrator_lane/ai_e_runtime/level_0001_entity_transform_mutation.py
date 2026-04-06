from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

from orchestrator.utils import ensure_dir, read_json_with_status

from .capability_registry import CapabilityEvidenceStore, RuntimeCapability
from .encounter_profiles import supported_encounter_examples_for_family
from .enemy_profiles import supported_entity_examples_for_family
from .environment_theme_action_normalization import (
    canonicalize_environment_theme_action_prompt,
    resolve_environment_theme_action,
)
from .intent_normalizer import fuzzy_match, normalize_prompt, resolve_prompt
from .platformer_action_normalization import canonicalize_platformer_action_prompt, resolve_platformer_action
from .session_tuning import build_result_session_metadata
from .time_utils import get_current_timestamp


_POWERSHELL_PREFIX = [
    "powershell.exe",
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
]
_TRANSLATOR_SCRIPT_RELATIVE_PATH = Path("Tools") / "run_aie_prompt.ps1"
_ALIAS_TABLE_RELATIVE_PATH = Path("Tools") / "aie_prompt_aliases.json"
_ROUTE_TABLE_RELATIVE_PATH = Path("Tools") / "intent_layer_v1_routes.json"
_DEFAULT_TARGET_OBJECT_NAME = "AIE_Zombie_001_Instance"
_DEFAULT_ROUTE_SCENE = "entity_test"


@dataclass(frozen=True)
class EntityMutationRouteProfile:
    probe_name: str
    probe_action_type: str
    result_kind: str


@dataclass(frozen=True)
class EntityTransformRouteResolution:
    normalized_prompt: str
    translated_command: str
    action_name: str
    entity_type: str
    scene_name: str
    probe_name: str
    probe_action_type: str
    result_kind: str
    wrapper_path: Path
    target_object_name: str


_ROUTE_PROFILES = {
    "MutateEntityTransform": EntityMutationRouteProfile(
        probe_name="MutateEntityTransform",
        probe_action_type="mutate_entity_transform",
        result_kind="transform",
    ),
    "MutateEnemyMoveSpeed": EntityMutationRouteProfile(
        probe_name="MutateEnemyMoveSpeed",
        probe_action_type="mutate_enemy_move_speed",
        result_kind="speed",
    ),
    "MutateEnemyAggression": EntityMutationRouteProfile(
        probe_name="MutateEnemyAggression",
        probe_action_type="mutate_enemy_aggression",
        result_kind="aggression",
    ),
    "MutateEncounterCount": EntityMutationRouteProfile(
        probe_name="MutateEncounterCount",
        probe_action_type="mutate_encounter_count",
        result_kind="encounter_count",
    ),
    "MutateSpawnPressure": EntityMutationRouteProfile(
        probe_name="MutateSpawnPressure",
        probe_action_type="mutate_spawn_pressure",
        result_kind="spawn_pressure",
    ),
    "MutatePlatformerJumpHeight": EntityMutationRouteProfile(
        probe_name="MutatePlatformerJumpHeight",
        probe_action_type="mutate_platformer_jump_height",
        result_kind="jump_height",
    ),
    "MutatePlatformerGravity": EntityMutationRouteProfile(
        probe_name="MutatePlatformerGravity",
        probe_action_type="mutate_platformer_gravity",
        result_kind="gravity",
    ),
    "MutatePlatformerGapSize": EntityMutationRouteProfile(
        probe_name="MutatePlatformerGapSize",
        probe_action_type="mutate_platformer_gap_size",
        result_kind="gap_size",
    ),
    "MutatePlatformerObstacleDensity": EntityMutationRouteProfile(
        probe_name="MutatePlatformerObstacleDensity",
        probe_action_type="mutate_platformer_obstacle_density",
        result_kind="obstacle_density",
    ),
    "MutatePlatformerEnemyDensity": EntityMutationRouteProfile(
        probe_name="MutatePlatformerEnemyDensity",
        probe_action_type="mutate_platformer_enemy_density",
        result_kind="enemy_density",
    ),
    "MutatePlatformerSegmentCount": EntityMutationRouteProfile(
        probe_name="MutatePlatformerSegmentCount",
        probe_action_type="mutate_platformer_segment_count",
        result_kind="segment_count",
    ),
    "MutateGroundTheme": EntityMutationRouteProfile(
        probe_name="MutateGroundTheme",
        probe_action_type="mutate_ground_theme",
        result_kind="ground_theme",
    ),
}


def resolve_entity_transform_route(
    project_path: Path,
    prompt: str,
) -> Tuple[EntityTransformRouteResolution | None, str | None]:
    project_path = Path(project_path)
    if not project_path.exists():
        return None, f"Project path not found for entity-transform routing: {project_path}"

    translator_script_path = project_path / _TRANSLATOR_SCRIPT_RELATIVE_PATH
    if not translator_script_path.exists():
        return None, f"Entity-transform translator is missing at {translator_script_path}"

    alias_table_path = project_path / _ALIAS_TABLE_RELATIVE_PATH
    alias_table, alias_issue = read_json_with_status(alias_table_path, default={})
    if alias_issue is not None or not isinstance(alias_table, dict):
        return None, f"Entity-transform alias table is unavailable at {alias_table_path}"

    route_table_path = project_path / _ROUTE_TABLE_RELATIVE_PATH
    route_table, route_issue = read_json_with_status(route_table_path, default={})
    if route_issue is not None or not isinstance(route_table, dict):
        return None, f"Entity-transform route table is unavailable at {route_table_path}"

    resolution = resolve_prompt(prompt)
    normalized_prompt = resolution.normalized_prompt
    lookup_prompt = resolution.lookup_prompt
    environment_theme_action = resolve_environment_theme_action(lookup_prompt)
    platformer_action = resolve_platformer_action(lookup_prompt)
    lookup_prompt = (
        canonicalize_environment_theme_action_prompt(lookup_prompt)
        or canonicalize_platformer_action_prompt(lookup_prompt)
        or lookup_prompt
    )
    normalized_prompt = lookup_prompt
    translated_command = _resolve_translated_command(alias_table, lookup_prompt)
    if not translated_command:
        fallback_prompt = fuzzy_match(lookup_prompt)
        if fallback_prompt:
            lookup_prompt = fallback_prompt
            translated_command = _resolve_translated_command(alias_table, lookup_prompt)
    if not translated_command:
        unsupported_message = unsupported_entity_transform_prompt_message(lookup_prompt)
        if unsupported_message:
            return None, unsupported_message
        if environment_theme_action is not None:
            return None, _missing_environment_theme_route_assets_message(project_path, lookup_prompt)
        if platformer_action is not None:
            return None, _missing_platformer_route_assets_message(project_path, lookup_prompt)
        return (
            None,
            _unmatched_prompt_message(),
        )

    route = _resolve_route(route_table, translated_command)
    if route is None:
        if environment_theme_action is not None:
            return None, _missing_environment_theme_route_assets_message(project_path, translated_command)
        if platformer_action is not None:
            return None, _missing_platformer_route_assets_message(project_path, translated_command)
        return (
            None,
            "No deterministic entity-transform route matched the prompt. "
            f"Translated command '{translated_command}' is not present in the Babylon route table.",
        )

    probe_name = str(route.get("probe_name") or "").strip()
    profile = _ROUTE_PROFILES.get(probe_name)
    if profile is None:
        return (
            None,
            f"Deterministic route '{translated_command}' resolved to unexpected probe '{probe_name or 'unknown'}'.",
        )

    wrapper_relative = str(route.get("wrapper_path") or "").strip()
    if not wrapper_relative:
        if environment_theme_action is not None:
            return None, _missing_environment_theme_route_assets_message(project_path, translated_command)
        if platformer_action is not None:
            return None, _missing_platformer_route_assets_message(project_path, translated_command)
        return None, f"Deterministic route '{translated_command}' does not define a wrapper path."

    wrapper_path = (project_path / Path(wrapper_relative)).resolve()
    if not wrapper_path.exists():
        if environment_theme_action is not None:
            return None, _missing_environment_theme_route_assets_message(project_path, translated_command)
        if platformer_action is not None:
            return None, _missing_platformer_route_assets_message(project_path, translated_command)
        return None, f"Deterministic route '{translated_command}' points to missing wrapper {wrapper_path}"

    wrapper_arguments = route.get("wrapper_arguments") if isinstance(route.get("wrapper_arguments"), dict) else {}
    target_object_name = str(wrapper_arguments.get("TargetObjectName") or _DEFAULT_TARGET_OBJECT_NAME).strip()
    scene_name = str(route.get("scene_name") or wrapper_arguments.get("SceneName") or route_table.get("scene_name") or _DEFAULT_ROUTE_SCENE).strip()
    action_name = str(route.get("action_name") or "").strip()
    if not action_name:
        return None, f"Deterministic route '{translated_command}' does not define an action_name."
    entity_type = str(route.get("entity_type") or "").strip().lower()

    return EntityTransformRouteResolution(
        normalized_prompt=lookup_prompt,
        translated_command=translated_command,
        action_name=action_name,
        entity_type=entity_type,
        scene_name=scene_name,
        probe_name=probe_name,
        probe_action_type=profile.probe_action_type,
        result_kind=profile.result_kind,
        wrapper_path=wrapper_path,
        target_object_name=target_object_name,
    ), None


def run_level_0001_entity_transform_mutation(task: Dict[str, Any]) -> Dict[str, Any]:
    capability = RuntimeCapability(
        capability_id=str(task.get("capability_id") or "level_0001_move_zombie_forward"),
        title=str(task.get("capability_title") or "LEVEL_0001 move zombie forward"),
        intent="mutate",
        target_level=str(task.get("target_level") or "LEVEL_0001"),
        target_scene=str(task.get("target_scene") or "Assets/AI_E_TestScenes/entity_test.unity"),
        requested_execution_lane=str(task.get("requested_execution_lane") or "approval_required_mutation"),
        handler_name=str(task.get("handler_name") or "level_0001_entity_transform_handler"),
        agent_type=str(task.get("agent_type") or "level_0001_entity_transform_mutation_agent"),
        approval_required=bool(task.get("approval_required", True)),
        eligible_for_auto=bool(task.get("eligible_for_auto", False)),
        evidence_state=str(task.get("evidence_state") or "experimental"),
        safety_class=str(task.get("safety_class") or "approval_gated_automation"),
        match_terms=[],
        match_verbs=[],
    )
    evidence_store = CapabilityEvidenceStore(Path(str(task.get("capability_evidence_path"))))
    evidence_store.ensure_entry(capability)

    approval_state = str(task.get("approval_state") or "awaiting_approval")
    execution_decision = str(task.get("execution_decision") or "approval_required")
    auto_execution_enabled = bool(task.get("auto_execution_enabled", False))
    auto_execution_reason = str(task.get("auto_execution_reason") or "")
    if capability.approval_required and approval_state != "approved":
        evidence_store.record_result(
            capability,
            passed=False,
            validation_state="approval_missing",
            artifact_requirements_met=False,
            notes="Entity transform mutation was denied because approval metadata was missing.",
        )
        return {
            "status": "blocked",
            "summary": f"{capability.handler_name} blocked entity transform mutation for {capability.target_level}",
            "error": "Entity transform mutation requires explicit operator approval.",
            "details": {
                "capability_id": capability.capability_id,
                "handler_name": capability.handler_name,
                "approval_state": approval_state,
            },
        }

    target_repo = Path(str(task.get("target_repo") or ""))
    route_resolution, route_issue = resolve_entity_transform_route(target_repo, str(task.get("operator_prompt") or ""))
    if route_issue is not None or route_resolution is None:
        evidence_store.record_result(
            capability,
            passed=False,
            validation_state="route_missing",
            artifact_requirements_met=False,
            notes=route_issue or "Entity-transform route resolution failed.",
        )
        return {
            "status": "blocked",
            "summary": f"{capability.handler_name} could not resolve a deterministic entity-transform route",
            "error": route_issue or "Entity-transform route resolution failed.",
            "details": {
                "capability_id": capability.capability_id,
                "handler_name": capability.handler_name,
                "target_repo": str(target_repo),
            },
        }

    logs_dir = ensure_dir(target_repo / "scripts" / "logs")
    task_slug = _slugify_task_id(str(task.get("task_id") or capability.capability_id))
    translator_artifact_path = logs_dir / f"{task_slug}_aie_prompt_result.json"
    translator_log_path = logs_dir / f"{task_slug}_aie_prompt.log"
    translator_script_path = (target_repo / _TRANSLATOR_SCRIPT_RELATIVE_PATH).resolve()
    timeout_seconds = int(task.get("unity_timeout_seconds", task.get("timeout_seconds", 240)) or 240)
    command = [
        *_POWERSHELL_PREFIX,
        "-File",
        str(translator_script_path),
        "-ProjectPath",
        str(target_repo),
        "-PromptText",
        route_resolution.normalized_prompt or route_resolution.translated_command,
        "-ArtifactPath",
        str(translator_artifact_path),
        "-LogPath",
        str(translator_log_path),
        "-TimeoutSec",
        str(max(30, timeout_seconds)),
    ]

    try:
        completed = subprocess.run(
            command,
            cwd=str(target_repo),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        evidence_store.record_result(
            capability,
            passed=False,
            validation_state="launcher_failed",
            artifact_requirements_met=False,
            notes=f"Failed to start deterministic entity-transform launcher: {exc}",
        )
        return {
            "status": "blocked",
            "summary": f"{capability.handler_name} failed to start deterministic entity-transform execution",
            "error": f"Failed to start deterministic entity-transform launcher: {exc}",
            "details": {
                "capability_id": capability.capability_id,
                "handler_name": capability.handler_name,
                "target_repo": str(target_repo),
            },
        }

    translator_payload, translator_issue = read_json_with_status(translator_artifact_path, default={})
    router_payload, router_issue, probe_payload, probe_issue = _load_supporting_artifacts(translator_payload)
    failure_reason = _validate_execution_artifacts(
        completed_returncode=completed.returncode,
        translator_payload=translator_payload,
        translator_issue=translator_issue,
        router_payload=router_payload,
        router_issue=router_issue,
        probe_payload=probe_payload,
        probe_issue=probe_issue,
        expected_command=route_resolution.translated_command,
        expected_probe=route_resolution.probe_name,
        expected_action_type=route_resolution.probe_action_type,
        result_kind=route_resolution.result_kind,
    )
    if failure_reason is not None:
        evidence_store.record_result(
            capability,
            passed=False,
            validation_state="execution_failed",
            artifact_requirements_met=False,
            notes=failure_reason,
        )
        return {
            "status": "blocked",
            "summary": f"{capability.handler_name} failed to execute deterministic entity-transform mutation",
            "error": failure_reason,
            "details": {
                "capability_id": capability.capability_id,
                "handler_name": capability.handler_name,
                "target_repo": str(target_repo),
            },
            "artifacts": _supporting_artifacts(translator_payload, router_payload),
        }

    evidence_snapshot = evidence_store.record_result(
        capability,
        passed=True,
        validation_state="passed",
        artifact_requirements_met=True,
        notes=(
            f"Deterministic entity transform mutation validated through translated command "
            f"'{route_resolution.translated_command}'."
        ),
    )
    scene_path = str(probe_payload.get("scene_path") or capability.target_scene)
    result_details = {
        "capability_id": capability.capability_id,
        "capability_title": capability.title,
        "handler_name": capability.handler_name,
        "target_level": capability.target_level,
        "target_scene": capability.target_scene,
        "approval_state": approval_state,
        "execution_decision": execution_decision,
        "auto_execution_enabled": auto_execution_enabled,
        "auto_execution_reason": auto_execution_reason,
        "approved_by": task.get("approved_by"),
        "approved_at": task.get("approved_at"),
        "approval_notes": task.get("approval_notes", ""),
        "translated_command": str(translator_payload.get("translated_command") or route_resolution.translated_command),
        "matched_prompt_pattern": str(translator_payload.get("matched_prompt_pattern") or route_resolution.normalized_prompt),
        "action_name": str(router_payload.get("action_name") or route_resolution.action_name),
        "executed_probe": str(router_payload.get("executed_probe") or route_resolution.probe_name),
        "action_type": str(probe_payload.get("action_type") or route_resolution.probe_action_type),
        "entity_type": str(probe_payload.get("entity_type") or route_resolution.entity_type),
        "object_name": str(probe_payload.get("object_name") or route_resolution.target_object_name),
        "scene_name": str(probe_payload.get("scene_name") or route_resolution.scene_name),
        "scene_path": scene_path,
        "files_changed": [scene_path] if scene_path else [],
        "executed": _probe_execution_applied(probe_payload),
        "result_reason": _probe_result_reason(probe_payload),
        "timestamp": str(probe_payload.get("timestamp") or get_current_timestamp()),
        "validation": {
            "status": "passed",
            "check": _validation_check_name(route_resolution.result_kind),
        },
        "evidence": evidence_snapshot,
    }
    if route_resolution.result_kind == "transform":
        result_details.update(
            {
                "previous_position": list(probe_payload.get("previous_position") or []),
                "new_position": list(probe_payload.get("new_position") or []),
                "observed_position_before_reset": list(probe_payload.get("observed_position_before_reset") or []),
            }
        )
    elif route_resolution.result_kind == "speed":
        result_details.update(
            {
                "previous_speed": _float_or_none(probe_payload.get("previous_speed")),
                "new_speed": _float_or_none(probe_payload.get("new_speed")),
                "observed_speed_before_reset": _float_or_none(probe_payload.get("observed_speed_before_reset")),
                "baseline_speed": _float_or_none(probe_payload.get("baseline_speed")),
                "requested_speed": _float_or_none(probe_payload.get("requested_speed")),
                "minimum_speed": _float_or_none(probe_payload.get("minimum_speed")),
                "maximum_speed": _float_or_none(probe_payload.get("maximum_speed")),
                "speed_changed": bool(probe_payload.get("speed_changed", False)),
            }
        )
    elif route_resolution.result_kind == "aggression":
        result_details.update(
            {
                "previous_attack_cooldown": _float_or_none(probe_payload.get("previous_attack_cooldown")),
                "new_attack_cooldown": _float_or_none(probe_payload.get("new_attack_cooldown")),
                "observed_attack_cooldown_before_reset": _float_or_none(probe_payload.get("observed_attack_cooldown_before_reset")),
                "baseline_attack_cooldown": _float_or_none(probe_payload.get("baseline_attack_cooldown")),
                "requested_attack_cooldown": _float_or_none(probe_payload.get("requested_attack_cooldown")),
                "minimum_attack_cooldown": _float_or_none(probe_payload.get("minimum_attack_cooldown")),
                "maximum_attack_cooldown": _float_or_none(probe_payload.get("maximum_attack_cooldown")),
                "aggression_changed": bool(probe_payload.get("aggression_changed", False)),
            }
        )
    elif route_resolution.result_kind == "encounter_count":
        result_details.update(
            {
                "spawner_name": str(probe_payload.get("spawner_name") or "EncounterSpawner"),
                "previous_encounter_count": _float_or_none(probe_payload.get("previous_encounter_count")),
                "new_encounter_count": _float_or_none(probe_payload.get("new_encounter_count")),
                "baseline_encounter_count": _float_or_none(probe_payload.get("baseline_encounter_count")),
                "requested_encounter_count": _float_or_none(probe_payload.get("requested_encounter_count")),
                "minimum_encounter_count": _float_or_none(probe_payload.get("minimum_encounter_count")),
                "maximum_encounter_count": _float_or_none(probe_payload.get("maximum_encounter_count")),
                "encounter_count_changed": bool(probe_payload.get("encounter_count_changed", False)),
                "target_context": "encounter",
            }
        )
    elif route_resolution.result_kind == "spawn_pressure":
        result_details.update(
            {
                "spawner_name": str(probe_payload.get("spawner_name") or "EncounterSpawner"),
                "previous_spawn_interval": _float_or_none(probe_payload.get("previous_spawn_interval")),
                "new_spawn_interval": _float_or_none(probe_payload.get("new_spawn_interval")),
                "baseline_spawn_interval": _float_or_none(probe_payload.get("baseline_spawn_interval")),
                "requested_spawn_interval": _float_or_none(probe_payload.get("requested_spawn_interval")),
                "minimum_spawn_interval": _float_or_none(probe_payload.get("minimum_spawn_interval")),
                "maximum_spawn_interval": _float_or_none(probe_payload.get("maximum_spawn_interval")),
                "spawn_pressure_changed": bool(probe_payload.get("spawn_pressure_changed", False)),
                "target_context": "encounter",
            }
        )
    elif route_resolution.result_kind == "jump_height":
        result_details.update(
            {
                "previous_jump_height": _float_or_none(probe_payload.get("previous_jump_height")),
                "new_jump_height": _float_or_none(probe_payload.get("new_jump_height")),
                "baseline_jump_height": _float_or_none(probe_payload.get("baseline_jump_height")),
                "requested_jump_height": _float_or_none(probe_payload.get("requested_jump_height")),
                "minimum_jump_height": _float_or_none(probe_payload.get("minimum_jump_height")),
                "maximum_jump_height": _float_or_none(probe_payload.get("maximum_jump_height")),
                "jump_height_changed": bool(probe_payload.get("jump_height_changed", False)),
                "target_context": "platformer",
            }
        )
    elif route_resolution.result_kind == "gravity":
        result_details.update(
            {
                "previous_gravity": _float_or_none(probe_payload.get("previous_gravity")),
                "new_gravity": _float_or_none(probe_payload.get("new_gravity")),
                "baseline_gravity": _float_or_none(probe_payload.get("baseline_gravity")),
                "requested_gravity": _float_or_none(probe_payload.get("requested_gravity")),
                "minimum_gravity": _float_or_none(probe_payload.get("minimum_gravity")),
                "maximum_gravity": _float_or_none(probe_payload.get("maximum_gravity")),
                "gravity_changed": bool(probe_payload.get("gravity_changed", False)),
                "target_context": "platformer",
            }
        )
    elif route_resolution.result_kind == "gap_size":
        result_details.update(
            {
                "previous_gap_size": _float_or_none(probe_payload.get("previous_gap_size")),
                "new_gap_size": _float_or_none(probe_payload.get("new_gap_size")),
                "baseline_gap_size": _float_or_none(probe_payload.get("baseline_gap_size")),
                "requested_gap_size": _float_or_none(probe_payload.get("requested_gap_size")),
                "minimum_gap_size": _float_or_none(probe_payload.get("minimum_gap_size")),
                "maximum_gap_size": _float_or_none(probe_payload.get("maximum_gap_size")),
                "gap_size_changed": bool(probe_payload.get("gap_size_changed", False)),
                "target_context": "platformer",
            }
        )
    elif route_resolution.result_kind == "obstacle_density":
        result_details.update(
            {
                "previous_obstacle_density": _float_or_none(probe_payload.get("previous_obstacle_density")),
                "new_obstacle_density": _float_or_none(probe_payload.get("new_obstacle_density")),
                "baseline_obstacle_density": _float_or_none(probe_payload.get("baseline_obstacle_density")),
                "requested_obstacle_density": _float_or_none(probe_payload.get("requested_obstacle_density")),
                "minimum_obstacle_density": _float_or_none(probe_payload.get("minimum_obstacle_density")),
                "maximum_obstacle_density": _float_or_none(probe_payload.get("maximum_obstacle_density")),
                "obstacle_density_changed": bool(probe_payload.get("obstacle_density_changed", False)),
                "target_context": "platformer",
            }
        )
    elif route_resolution.result_kind == "enemy_density":
        result_details.update(
            {
                "previous_enemy_density": _float_or_none(probe_payload.get("previous_enemy_density")),
                "new_enemy_density": _float_or_none(probe_payload.get("new_enemy_density")),
                "baseline_enemy_density": _float_or_none(probe_payload.get("baseline_enemy_density")),
                "requested_enemy_density": _float_or_none(probe_payload.get("requested_enemy_density")),
                "minimum_enemy_density": _float_or_none(probe_payload.get("minimum_enemy_density")),
                "maximum_enemy_density": _float_or_none(probe_payload.get("maximum_enemy_density")),
                "previous_enemy_count": _float_or_none(probe_payload.get("previous_enemy_count")),
                "new_enemy_count": _float_or_none(probe_payload.get("new_enemy_count")),
                "baseline_enemy_count": _float_or_none(probe_payload.get("baseline_enemy_count")),
                "requested_enemy_count": _float_or_none(probe_payload.get("requested_enemy_count")),
                "minimum_enemy_count": _float_or_none(probe_payload.get("minimum_enemy_count")),
                "maximum_enemy_count": _float_or_none(probe_payload.get("maximum_enemy_count")),
                "enemy_density_changed": bool(probe_payload.get("enemy_density_changed", False)),
                "target_context": "platformer",
            }
        )
    elif route_resolution.result_kind == "segment_count":
        result_details.update(
            {
                "previous_segment_count": _float_or_none(probe_payload.get("previous_segment_count")),
                "new_segment_count": _float_or_none(probe_payload.get("new_segment_count")),
                "baseline_segment_count": _float_or_none(probe_payload.get("baseline_segment_count")),
                "requested_segment_count": _float_or_none(probe_payload.get("requested_segment_count")),
                "minimum_segment_count": _float_or_none(probe_payload.get("minimum_segment_count")),
                "maximum_segment_count": _float_or_none(probe_payload.get("maximum_segment_count")),
                "segment_count_changed": bool(probe_payload.get("segment_count_changed", False)),
                "target_context": "platformer",
            }
        )
    elif route_resolution.result_kind == "ground_theme":
        result_details.update(
            {
                "theme_name": str(probe_payload.get("theme_name") or "grass_ground"),
                "previous_material_name": str(probe_payload.get("previous_material_name") or ""),
                "previous_material_path": str(probe_payload.get("previous_material_path") or ""),
                "previous_material_guid": str(probe_payload.get("previous_material_guid") or ""),
                "new_material_name": str(probe_payload.get("new_material_name") or ""),
                "new_material_path": str(probe_payload.get("new_material_path") or ""),
                "new_material_guid": str(probe_payload.get("new_material_guid") or ""),
                "requested_material_path": str(probe_payload.get("requested_material_path") or ""),
                "requested_material_guid": str(probe_payload.get("requested_material_guid") or ""),
                "baseline_material_path": str(probe_payload.get("baseline_material_path") or ""),
                "baseline_material_guid": str(probe_payload.get("baseline_material_guid") or ""),
                "theme_changed": bool(probe_payload.get("theme_changed", False)),
                "target_context": "environment_theme",
            }
        )
    result_details.update(
        build_result_session_metadata(
            task=task,
            details=result_details,
            result_kind=route_resolution.result_kind,
        )
    )
    return {
        "status": "completed",
        "summary": (
            f"{capability.handler_name} executed {route_resolution.translated_command} "
            f"via {route_resolution.probe_action_type}"
        ),
        "details": result_details,
        "artifacts": _supporting_artifacts(translator_payload, router_payload),
    }

def _resolve_translated_command(alias_table: Dict[str, Any], normalized_prompt: str) -> str:
    aliases = alias_table.get("aliases")
    if not isinstance(aliases, list):
        return ""
    for entry in aliases:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("normalized_prompt") or "").strip() == normalized_prompt:
            return str(entry.get("translated_command") or "").strip()
    return ""


def _unmatched_prompt_message() -> str:
    return (
        "I understood part of your request, but couldn't match it to a known action. "
        "Try something like: 'move zombie forward', 'make zombie faster', 'make runner faster', "
        "'make runner more aggressive', 'apply grass ground theme', 'apply dirt ground theme', 'apply gravel ground theme', 'apply damaged-ground theme', or 'increase encounter count'."
    )


def _missing_environment_theme_route_assets_message(project_path: Path, canonical_prompt: str) -> str:
    project_name = project_path.name or str(project_path)
    return (
        f"AI-E recognized the bounded environment theme action '{canonical_prompt}', but the selected project '{project_name}' "
        "does not expose the deterministic theme prompt aliases, route entries, and wrapper scripts required for route preflight yet. "
        "Add the bounded environment theme route assets to the project Tools folder before preparing this request again."
    )


def _missing_platformer_route_assets_message(project_path: Path, canonical_prompt: str) -> str:
    project_name = project_path.name or str(project_path)
    return (
        f"AI-E recognized the bounded platformer action '{canonical_prompt}', but the selected project '{project_name}' "
        "does not expose the deterministic platformer prompt aliases, route entries, and wrapper scripts required for route preflight yet. "
        "Add the bounded platformer route assets to the project Tools folder before preparing this request again."
    )


def unsupported_entity_transform_prompt_message(prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
    generalized_entity = _generalized_entity_label(tokens)
    environment_theme_requested = bool({"ground", "terrain", "map", "battlefield"} & tokens)
    mixed_environment_art_direction = bool(
        {
            "grass",
            "dirt",
            "gravel",
            "damaged",
            "flowers",
            "battle",
            "battlefield",
            "damage",
            "crater",
            "craters",
            "debris",
            "smoke",
            "fog",
            "ruined",
            "realistic",
            "realism",
            "blend",
        }
        & tokens
    )
    if environment_theme_requested and mixed_environment_art_direction and (
        "realistic" in tokens
        or "terrain" in tokens
        or "map" in tokens
        or "battlefield" in tokens
        or "flowers" in tokens
        or "gravel" in tokens
        or "dirt" in tokens
        or "craters" in tokens
        or "crater" in tokens
        or "debris" in tokens
        or "smoke" in tokens
        or "fog" in tokens
        or "everywhere" in tokens
        or "layered" in tokens
        or "battle" in tokens
        or "damage" in tokens
        or "blend" in tokens
        or "ruined" in tokens
    ):
        return (
            "AI-E only supports bounded environment look-dev actions in this pass: applying the grass, dirt, gravel, or damaged-ground theme to the Ground object. "
            "Broader terrain realism or mixed art-direction requests are blocked. Try 'make the ground grassy', 'change the ground to dirt', 'change the ground to gravel', or 'make the ground look damaged'."
        )
    if {"move", "zombie", "backward"}.issubset(tokens):
        return (
            "Backward zombie movement is not a supported deterministic action yet. "
            "Try something like: 'move zombie forward'."
        )
    if {"move", "forward"}.issubset(tokens) and "zombie" not in tokens:
        return (
            "AI-E currently supports this deterministic movement request only for the zombie system in BABYLON. "
            "Try something like: 'move zombie forward'."
        )
    if {"make", "faster"}.issubset(tokens) and "zombie" not in tokens and "runner" not in tokens:
        if generalized_entity:
            return (
                f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                "Name the supported target explicitly. Try something like: "
                f"{supported_entity_examples_for_family('speed_fast')}."
            )
        return (
            "AI-E currently supports this deterministic speed adjustment only for the zombie or runner systems in BABYLON. "
            f"Try something like: {supported_entity_examples_for_family('speed_fast')}."
        )
    if {"make", "slower"}.issubset(tokens) and "zombie" not in tokens and "runner" not in tokens:
        if generalized_entity:
            return (
                f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                "Name the supported target explicitly. Try something like: "
                f"{supported_entity_examples_for_family('speed_slow')}."
            )
        return (
            "AI-E currently supports this deterministic speed adjustment only for the zombie or runner systems in BABYLON. "
            f"Try something like: {supported_entity_examples_for_family('speed_slow')}."
        )
    if {"make", "aggressive"}.issubset(tokens) and "zombie" not in tokens and "runner" not in tokens:
        if generalized_entity:
            return (
                f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                "Name the supported target explicitly. Try something like: "
                f"{supported_entity_examples_for_family('aggression')}."
            )
        return (
            "AI-E currently supports this deterministic aggression adjustment only for the zombie or runner systems in BABYLON. "
            f"Try something like: {supported_entity_examples_for_family('aggression')}."
        )
    if {"encounter", "count"}.issubset(tokens):
        if "increase" in tokens:
            return (
                "AI-E currently supports deterministic encounter count tuning only through the supported encounter profile in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('count_high')}."
            )
        if "decrease" in tokens:
            return (
                "AI-E currently supports deterministic encounter count tuning only through the supported encounter profile in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('count_low')}."
            )
        if "restore" in tokens or "standard" in tokens:
            return (
                "AI-E currently supports restoring the bounded encounter count profile only through the supported encounter route in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('restore_plan')}."
            )
    if {"spawn", "pressure"}.issubset(tokens):
        if "increase" in tokens:
            return (
                "AI-E currently supports deterministic spawn pressure tuning only through the supported encounter profile in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('pressure_high')}."
            )
        if "decrease" in tokens:
            return (
                "AI-E currently supports deterministic spawn pressure tuning only through the supported encounter profile in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('pressure_low')}."
            )
        if "restore" in tokens or "standard" in tokens:
            return (
                "AI-E currently supports restoring the bounded spawn pressure profile only through the supported encounter route in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('restore_plan')}."
            )
    return None


def _generalized_entity_label(tokens: set[str]) -> str:
    for candidate in ("enemy", "character"):
        if candidate in tokens:
            return candidate
    return ""


def _resolve_route(route_table: Dict[str, Any], translated_command: str) -> Dict[str, Any] | None:
    routes = route_table.get("routes")
    if not isinstance(routes, list):
        return None
    for entry in routes:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("normalized_command") or "").strip() == translated_command:
            return entry
    return None


def _slugify_task_id(task_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", task_id).strip("_") or "entity_transform_task"


def _load_supporting_artifacts(
    translator_payload: Any,
) -> Tuple[Dict[str, Any], str | None, Dict[str, Any], str | None]:
    if not isinstance(translator_payload, dict):
        return {}, "Translator artifact is missing or unreadable.", {}, "Probe artifact is unavailable."

    router_artifact_path = str(translator_payload.get("router_artifact_path") or "").strip()
    router_payload: Dict[str, Any] = {}
    router_issue: str | None = "Router artifact is unavailable."
    if router_artifact_path:
        raw_router, router_issue = read_json_with_status(Path(router_artifact_path), default={})
        if isinstance(raw_router, dict):
            router_payload = raw_router

    probe_artifact_path = str(router_payload.get("delegated_probe_artifact_path") or "").strip()
    probe_payload: Dict[str, Any] = {}
    probe_issue: str | None = "Delegated probe artifact is unavailable."
    if probe_artifact_path:
        raw_probe, probe_issue = read_json_with_status(Path(probe_artifact_path), default={})
        if isinstance(raw_probe, dict):
            probe_payload = raw_probe

    return router_payload, router_issue, probe_payload, probe_issue


def _validate_execution_artifacts(
    *,
    completed_returncode: int,
    translator_payload: Any,
    translator_issue: str | None,
    router_payload: Dict[str, Any],
    router_issue: str | None,
    probe_payload: Dict[str, Any],
    probe_issue: str | None,
    expected_command: str,
    expected_probe: str,
    expected_action_type: str,
    result_kind: str,
) -> str | None:
    if translator_issue is not None or not isinstance(translator_payload, dict):
        return translator_issue or "Translator artifact is missing or unreadable."
    if completed_returncode != 0:
        return str(translator_payload.get("message") or f"Translator sidecar exited with code {completed_returncode}.")
    if str(translator_payload.get("status") or "") != "success":
        return str(translator_payload.get("message") or "Translator sidecar did not report success.")
    if str(translator_payload.get("translated_command") or "") != expected_command:
        return (
            f"Translator resolved unexpected command "
            f"'{translator_payload.get('translated_command') or 'unknown'}'."
        )
    if router_issue is not None:
        return router_issue
    if str(router_payload.get("status") or "") != "success":
        return str(router_payload.get("message") or "Intent router did not report success.")
    if str(router_payload.get("executed_probe") or "") != expected_probe:
        return f"Intent router resolved unexpected probe '{router_payload.get('executed_probe') or 'unknown'}'."
    if str(router_payload.get("delegated_probe_action_type") or "") != expected_action_type:
        return (
            f"Intent router resolved unexpected action type "
            f"'{router_payload.get('delegated_probe_action_type') or 'unknown'}'."
        )
    if probe_issue is not None:
        return probe_issue
    if str(probe_payload.get("status") or "") != "success":
        return str(probe_payload.get("message") or "Delegated probe did not report success.")
    if str(probe_payload.get("action_type") or "") != expected_action_type:
        return f"Delegated probe reported unexpected action type '{probe_payload.get('action_type') or 'unknown'}'."
    execution_applied = _probe_execution_applied(probe_payload)
    result_reason = _probe_result_reason(probe_payload)
    action_name = str(router_payload.get("action_name") or probe_payload.get("action_name") or "").strip().lower()
    if result_kind == "transform":
        previous_position = probe_payload.get("previous_position")
        new_position = probe_payload.get("new_position")
        if not isinstance(previous_position, list) or len(previous_position) != 3:
            return "Delegated probe did not report a valid previous_position."
        if not isinstance(new_position, list) or len(new_position) != 3:
            return "Delegated probe did not report a valid new_position."
    elif result_kind == "speed":
        previous_speed = _float_or_none(probe_payload.get("previous_speed"))
        new_speed = _float_or_none(probe_payload.get("new_speed"))
        baseline_speed = _float_or_none(probe_payload.get("baseline_speed"))
        minimum_speed = _float_or_none(probe_payload.get("minimum_speed"))
        maximum_speed = _float_or_none(probe_payload.get("maximum_speed"))
        requested_speed = _float_or_none(probe_payload.get("requested_speed"))
        if previous_speed is None:
            return "Delegated probe did not report a valid previous_speed."
        if new_speed is None:
            return "Delegated probe did not report a valid new_speed."
        if minimum_speed is not None and new_speed < minimum_speed:
            return "Delegated probe reported a new_speed below the approved minimum bound."
        if maximum_speed is not None and new_speed > maximum_speed:
            return "Delegated probe reported a new_speed above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_speed is not None and not _speed_skip_satisfies_request(
                action_name=action_name,
                baseline_speed=baseline_speed,
                requested_speed=requested_speed,
                current_speed=new_speed,
            ):
                return "Delegated probe skipped the speed change before the requested deterministic state was satisfied."
        elif requested_speed is not None and abs(new_speed - requested_speed) > 0.0001:
            return "Delegated probe did not apply the requested deterministic speed value."
    elif result_kind == "aggression":
        previous_attack_cooldown = _float_or_none(probe_payload.get("previous_attack_cooldown"))
        new_attack_cooldown = _float_or_none(probe_payload.get("new_attack_cooldown"))
        baseline_attack_cooldown = _float_or_none(probe_payload.get("baseline_attack_cooldown"))
        minimum_attack_cooldown = _float_or_none(probe_payload.get("minimum_attack_cooldown"))
        maximum_attack_cooldown = _float_or_none(probe_payload.get("maximum_attack_cooldown"))
        requested_attack_cooldown = _float_or_none(probe_payload.get("requested_attack_cooldown"))
        if previous_attack_cooldown is None:
            return "Delegated probe did not report a valid previous_attack_cooldown."
        if new_attack_cooldown is None:
            return "Delegated probe did not report a valid new_attack_cooldown."
        if minimum_attack_cooldown is not None and new_attack_cooldown < minimum_attack_cooldown:
            return "Delegated probe reported a new_attack_cooldown below the approved minimum bound."
        if maximum_attack_cooldown is not None and new_attack_cooldown > maximum_attack_cooldown:
            return "Delegated probe reported a new_attack_cooldown above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_attack_cooldown is not None and not _aggression_skip_satisfies_request(
                action_name=action_name,
                baseline_attack_cooldown=baseline_attack_cooldown,
                requested_attack_cooldown=requested_attack_cooldown,
                current_attack_cooldown=new_attack_cooldown,
            ):
                return "Delegated probe skipped the aggression change before the requested deterministic state was satisfied."
        elif requested_attack_cooldown is not None and abs(new_attack_cooldown - requested_attack_cooldown) > 0.0001:
            return "Delegated probe did not apply the requested deterministic aggression value."
    elif result_kind == "encounter_count":
        previous_encounter_count = _float_or_none(probe_payload.get("previous_encounter_count"))
        new_encounter_count = _float_or_none(probe_payload.get("new_encounter_count"))
        baseline_encounter_count = _float_or_none(probe_payload.get("baseline_encounter_count"))
        minimum_encounter_count = _float_or_none(probe_payload.get("minimum_encounter_count"))
        maximum_encounter_count = _float_or_none(probe_payload.get("maximum_encounter_count"))
        requested_encounter_count = _float_or_none(probe_payload.get("requested_encounter_count"))
        if previous_encounter_count is None:
            return "Delegated probe did not report a valid previous_encounter_count."
        if new_encounter_count is None:
            return "Delegated probe did not report a valid new_encounter_count."
        if minimum_encounter_count is not None and new_encounter_count < minimum_encounter_count:
            return "Delegated probe reported a new_encounter_count below the approved minimum bound."
        if maximum_encounter_count is not None and new_encounter_count > maximum_encounter_count:
            return "Delegated probe reported a new_encounter_count above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_encounter_count is not None and not _encounter_count_skip_satisfies_request(
                action_name=action_name,
                baseline_encounter_count=baseline_encounter_count,
                requested_encounter_count=requested_encounter_count,
                current_encounter_count=new_encounter_count,
            ):
                return "Delegated probe skipped the encounter count change before the requested deterministic state was satisfied."
        elif requested_encounter_count is not None and abs(new_encounter_count - requested_encounter_count) > 0.0001:
            return "Delegated probe did not apply the requested deterministic encounter count value."
    elif result_kind == "spawn_pressure":
        previous_spawn_interval = _float_or_none(probe_payload.get("previous_spawn_interval"))
        new_spawn_interval = _float_or_none(probe_payload.get("new_spawn_interval"))
        baseline_spawn_interval = _float_or_none(probe_payload.get("baseline_spawn_interval"))
        minimum_spawn_interval = _float_or_none(probe_payload.get("minimum_spawn_interval"))
        maximum_spawn_interval = _float_or_none(probe_payload.get("maximum_spawn_interval"))
        requested_spawn_interval = _float_or_none(probe_payload.get("requested_spawn_interval"))
        if previous_spawn_interval is None:
            return "Delegated probe did not report a valid previous_spawn_interval."
        if new_spawn_interval is None:
            return "Delegated probe did not report a valid new_spawn_interval."
        if minimum_spawn_interval is not None and new_spawn_interval < minimum_spawn_interval:
            return "Delegated probe reported a new_spawn_interval below the approved minimum bound."
        if maximum_spawn_interval is not None and new_spawn_interval > maximum_spawn_interval:
            return "Delegated probe reported a new_spawn_interval above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_spawn_interval is not None and not _spawn_pressure_skip_satisfies_request(
                action_name=action_name,
                baseline_spawn_interval=baseline_spawn_interval,
                requested_spawn_interval=requested_spawn_interval,
                current_spawn_interval=new_spawn_interval,
            ):
                return "Delegated probe skipped the spawn pressure change before the requested deterministic state was satisfied."
        elif requested_spawn_interval is not None and abs(new_spawn_interval - requested_spawn_interval) > 0.0001:
            return "Delegated probe did not apply the requested deterministic spawn pressure value."
    elif result_kind == "jump_height":
        previous_jump_height = _float_or_none(probe_payload.get("previous_jump_height"))
        new_jump_height = _float_or_none(probe_payload.get("new_jump_height"))
        baseline_jump_height = _float_or_none(probe_payload.get("baseline_jump_height"))
        minimum_jump_height = _float_or_none(probe_payload.get("minimum_jump_height"))
        maximum_jump_height = _float_or_none(probe_payload.get("maximum_jump_height"))
        requested_jump_height = _float_or_none(probe_payload.get("requested_jump_height"))
        if previous_jump_height is None:
            return "Delegated probe did not report a valid previous_jump_height."
        if new_jump_height is None:
            return "Delegated probe did not report a valid new_jump_height."
        if minimum_jump_height is not None and new_jump_height < minimum_jump_height:
            return "Delegated probe reported a new_jump_height below the approved minimum bound."
        if maximum_jump_height is not None and new_jump_height > maximum_jump_height:
            return "Delegated probe reported a new_jump_height above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_jump_height is not None and not _numeric_skip_satisfies_request(
                action_name=action_name,
                baseline_value=baseline_jump_height,
                requested_value=requested_jump_height,
                current_value=new_jump_height,
            ):
                return "Delegated probe skipped the jump-height change before the requested deterministic state was satisfied."
        elif requested_jump_height is not None and abs(new_jump_height - requested_jump_height) > 0.0001:
            return "Delegated probe did not apply the requested deterministic jump-height value."
    elif result_kind == "gravity":
        previous_gravity = _float_or_none(probe_payload.get("previous_gravity"))
        new_gravity = _float_or_none(probe_payload.get("new_gravity"))
        baseline_gravity = _float_or_none(probe_payload.get("baseline_gravity"))
        minimum_gravity = _float_or_none(probe_payload.get("minimum_gravity"))
        maximum_gravity = _float_or_none(probe_payload.get("maximum_gravity"))
        requested_gravity = _float_or_none(probe_payload.get("requested_gravity"))
        if previous_gravity is None:
            return "Delegated probe did not report a valid previous_gravity."
        if new_gravity is None:
            return "Delegated probe did not report a valid new_gravity."
        if minimum_gravity is not None and new_gravity < minimum_gravity:
            return "Delegated probe reported a new_gravity below the approved minimum bound."
        if maximum_gravity is not None and new_gravity > maximum_gravity:
            return "Delegated probe reported a new_gravity above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_gravity is not None and not _numeric_skip_satisfies_request(
                action_name=action_name,
                baseline_value=baseline_gravity,
                requested_value=requested_gravity,
                current_value=new_gravity,
            ):
                return "Delegated probe skipped the gravity change before the requested deterministic state was satisfied."
        elif requested_gravity is not None and abs(new_gravity - requested_gravity) > 0.0001:
            return "Delegated probe did not apply the requested deterministic gravity value."
    elif result_kind == "gap_size":
        previous_gap_size = _float_or_none(probe_payload.get("previous_gap_size"))
        new_gap_size = _float_or_none(probe_payload.get("new_gap_size"))
        baseline_gap_size = _float_or_none(probe_payload.get("baseline_gap_size"))
        minimum_gap_size = _float_or_none(probe_payload.get("minimum_gap_size"))
        maximum_gap_size = _float_or_none(probe_payload.get("maximum_gap_size"))
        requested_gap_size = _float_or_none(probe_payload.get("requested_gap_size"))
        if previous_gap_size is None:
            return "Delegated probe did not report a valid previous_gap_size."
        if new_gap_size is None:
            return "Delegated probe did not report a valid new_gap_size."
        if minimum_gap_size is not None and new_gap_size < minimum_gap_size:
            return "Delegated probe reported a new_gap_size below the approved minimum bound."
        if maximum_gap_size is not None and new_gap_size > maximum_gap_size:
            return "Delegated probe reported a new_gap_size above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_gap_size is not None and not _numeric_skip_satisfies_request(
                action_name=action_name,
                baseline_value=baseline_gap_size,
                requested_value=requested_gap_size,
                current_value=new_gap_size,
            ):
                return "Delegated probe skipped the gap-size change before the requested deterministic state was satisfied."
        elif requested_gap_size is not None and abs(new_gap_size - requested_gap_size) > 0.0001:
            return "Delegated probe did not apply the requested deterministic gap-size value."
    elif result_kind == "obstacle_density":
        previous_obstacle_density = _float_or_none(probe_payload.get("previous_obstacle_density"))
        new_obstacle_density = _float_or_none(probe_payload.get("new_obstacle_density"))
        baseline_obstacle_density = _float_or_none(probe_payload.get("baseline_obstacle_density"))
        minimum_obstacle_density = _float_or_none(probe_payload.get("minimum_obstacle_density"))
        maximum_obstacle_density = _float_or_none(probe_payload.get("maximum_obstacle_density"))
        requested_obstacle_density = _float_or_none(probe_payload.get("requested_obstacle_density"))
        if previous_obstacle_density is None:
            return "Delegated probe did not report a valid previous_obstacle_density."
        if new_obstacle_density is None:
            return "Delegated probe did not report a valid new_obstacle_density."
        if minimum_obstacle_density is not None and new_obstacle_density < minimum_obstacle_density:
            return "Delegated probe reported a new_obstacle_density below the approved minimum bound."
        if maximum_obstacle_density is not None and new_obstacle_density > maximum_obstacle_density:
            return "Delegated probe reported a new_obstacle_density above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_obstacle_density is not None and not _numeric_skip_satisfies_request(
                action_name=action_name,
                baseline_value=baseline_obstacle_density,
                requested_value=requested_obstacle_density,
                current_value=new_obstacle_density,
            ):
                return "Delegated probe skipped the obstacle-density change before the requested deterministic state was satisfied."
        elif requested_obstacle_density is not None and abs(new_obstacle_density - requested_obstacle_density) > 0.0001:
            return "Delegated probe did not apply the requested deterministic obstacle-density value."
    elif result_kind == "enemy_density":
        previous_enemy_density = _float_or_none(probe_payload.get("previous_enemy_density"))
        new_enemy_density = _float_or_none(probe_payload.get("new_enemy_density"))
        baseline_enemy_density = _float_or_none(probe_payload.get("baseline_enemy_density"))
        minimum_enemy_density = _float_or_none(probe_payload.get("minimum_enemy_density"))
        maximum_enemy_density = _float_or_none(probe_payload.get("maximum_enemy_density"))
        requested_enemy_density = _float_or_none(probe_payload.get("requested_enemy_density"))
        previous_enemy_count = _float_or_none(probe_payload.get("previous_enemy_count"))
        new_enemy_count = _float_or_none(probe_payload.get("new_enemy_count"))
        baseline_enemy_count = _float_or_none(probe_payload.get("baseline_enemy_count"))
        minimum_enemy_count = _float_or_none(probe_payload.get("minimum_enemy_count"))
        maximum_enemy_count = _float_or_none(probe_payload.get("maximum_enemy_count"))
        requested_enemy_count = _float_or_none(probe_payload.get("requested_enemy_count"))
        if previous_enemy_density is None:
            return "Delegated probe did not report a valid previous_enemy_density."
        if new_enemy_density is None:
            return "Delegated probe did not report a valid new_enemy_density."
        count_validation_available = any(
            value is not None
            for value in (
                previous_enemy_count,
                new_enemy_count,
                minimum_enemy_count,
                maximum_enemy_count,
                requested_enemy_count,
            )
        )
        if count_validation_available:
            if previous_enemy_count is None:
                return "Delegated probe did not report a valid previous_enemy_count."
            if new_enemy_count is None:
                return "Delegated probe did not report a valid new_enemy_count."
            if minimum_enemy_count is not None and new_enemy_count < minimum_enemy_count:
                return "Delegated probe reported a new_enemy_count below the approved minimum bound."
            if maximum_enemy_count is not None and new_enemy_count > maximum_enemy_count:
                return "Delegated probe reported a new_enemy_count above the approved maximum bound."
            if not execution_applied and result_reason == "skipped_already_satisfied":
                if requested_enemy_count is not None and not _numeric_skip_satisfies_request(
                    action_name=action_name,
                    baseline_value=baseline_enemy_count,
                    requested_value=requested_enemy_count,
                    current_value=new_enemy_count,
                ):
                    return "Delegated probe skipped the enemy-density change before the requested deterministic state was satisfied."
            elif requested_enemy_count is not None and abs(new_enemy_count - requested_enemy_count) > 0.0001:
                return "Delegated probe did not apply the requested deterministic enemy-count value."
        else:
            if minimum_enemy_density is not None and new_enemy_density < minimum_enemy_density:
                return "Delegated probe reported a new_enemy_density below the approved minimum bound."
            if maximum_enemy_density is not None and new_enemy_density > maximum_enemy_density:
                return "Delegated probe reported a new_enemy_density above the approved maximum bound."
            if not execution_applied and result_reason == "skipped_already_satisfied":
                if requested_enemy_density is not None and not _numeric_skip_satisfies_request(
                    action_name=action_name,
                    baseline_value=baseline_enemy_density,
                    requested_value=requested_enemy_density,
                    current_value=new_enemy_density,
                ):
                    return "Delegated probe skipped the enemy-density change before the requested deterministic state was satisfied."
            elif requested_enemy_density is not None and abs(new_enemy_density - requested_enemy_density) > 0.0001:
                return "Delegated probe did not apply the requested deterministic enemy-density value."
    elif result_kind == "segment_count":
        previous_segment_count = _float_or_none(probe_payload.get("previous_segment_count"))
        new_segment_count = _float_or_none(probe_payload.get("new_segment_count"))
        baseline_segment_count = _float_or_none(probe_payload.get("baseline_segment_count"))
        minimum_segment_count = _float_or_none(probe_payload.get("minimum_segment_count"))
        maximum_segment_count = _float_or_none(probe_payload.get("maximum_segment_count"))
        requested_segment_count = _float_or_none(probe_payload.get("requested_segment_count"))
        if previous_segment_count is None:
            return "Delegated probe did not report a valid previous_segment_count."
        if new_segment_count is None:
            return "Delegated probe did not report a valid new_segment_count."
        if minimum_segment_count is not None and new_segment_count < minimum_segment_count:
            return "Delegated probe reported a new_segment_count below the approved minimum bound."
        if maximum_segment_count is not None and new_segment_count > maximum_segment_count:
            return "Delegated probe reported a new_segment_count above the approved maximum bound."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_segment_count is not None and not _numeric_skip_satisfies_request(
                action_name=action_name,
                baseline_value=baseline_segment_count,
                requested_value=requested_segment_count,
                current_value=new_segment_count,
            ):
                return "Delegated probe skipped the segment-count change before the requested deterministic state was satisfied."
        elif requested_segment_count is not None and abs(new_segment_count - requested_segment_count) > 0.0001:
            return "Delegated probe did not apply the requested deterministic segment-count value."
    elif result_kind == "ground_theme":
        previous_material_guid = str(probe_payload.get("previous_material_guid") or "").strip()
        new_material_guid = str(probe_payload.get("new_material_guid") or "").strip()
        requested_material_guid = str(probe_payload.get("requested_material_guid") or "").strip()
        requested_material_path = str(probe_payload.get("requested_material_path") or "").strip()
        new_material_path = str(probe_payload.get("new_material_path") or "").strip()
        if not previous_material_guid:
            return "Delegated probe did not report a valid previous_material_guid."
        if not new_material_guid:
            return "Delegated probe did not report a valid new_material_guid."
        if not requested_material_guid and not requested_material_path:
            return "Delegated probe did not report the requested ground-theme material."
        if not execution_applied and result_reason == "skipped_already_satisfied":
            if requested_material_guid and new_material_guid != requested_material_guid:
                return "Delegated probe skipped the ground-theme change before the requested theme was already satisfied."
            if requested_material_path and new_material_path != requested_material_path:
                return "Delegated probe skipped the ground-theme change before the requested theme was already satisfied."
        else:
            if requested_material_guid and new_material_guid != requested_material_guid:
                return "Delegated probe did not apply the requested deterministic ground-theme material."
            if requested_material_path and new_material_path != requested_material_path:
                return "Delegated probe did not apply the requested deterministic ground-theme material path."
    return None


def _validation_check_name(result_kind: str) -> str:
    if result_kind == "speed":
        return "mutate_enemy_move_speed_artifact_confirmed"
    if result_kind == "aggression":
        return "mutate_enemy_aggression_artifact_confirmed"
    if result_kind == "encounter_count":
        return "mutate_encounter_count_artifact_confirmed"
    if result_kind == "spawn_pressure":
        return "mutate_spawn_pressure_artifact_confirmed"
    if result_kind == "jump_height":
        return "mutate_platformer_jump_height_artifact_confirmed"
    if result_kind == "gravity":
        return "mutate_platformer_gravity_artifact_confirmed"
    if result_kind == "gap_size":
        return "mutate_platformer_gap_size_artifact_confirmed"
    if result_kind == "obstacle_density":
        return "mutate_platformer_obstacle_density_artifact_confirmed"
    if result_kind == "enemy_density":
        return "mutate_platformer_enemy_density_artifact_confirmed"
    if result_kind == "segment_count":
        return "mutate_platformer_segment_count_artifact_confirmed"
    if result_kind == "ground_theme":
        return "mutate_ground_theme_artifact_confirmed"
    return "mutate_entity_transform_artifact_confirmed"


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _probe_execution_applied(probe_payload: Dict[str, Any]) -> bool:
    executed = probe_payload.get("executed")
    if isinstance(executed, bool):
        return executed
    return True


def _probe_result_reason(probe_payload: Dict[str, Any]) -> str:
    raw_reason = str(probe_payload.get("result_reason") or "").strip().lower()
    if raw_reason:
        return raw_reason
    return "applied" if _probe_execution_applied(probe_payload) else "skipped_already_satisfied"


def _speed_skip_satisfies_request(
    *,
    action_name: str,
    baseline_speed: float | None,
    requested_speed: float,
    current_speed: float,
) -> bool:
    if "increase" in action_name:
        return current_speed >= requested_speed - 0.0001
    if "decrease" in action_name:
        return current_speed <= requested_speed + 0.0001
    if baseline_speed is not None:
        if requested_speed >= baseline_speed:
            return current_speed >= requested_speed - 0.0001
        return current_speed <= requested_speed + 0.0001
    return abs(current_speed - requested_speed) <= 0.0001


def _aggression_skip_satisfies_request(
    *,
    action_name: str,
    baseline_attack_cooldown: float | None,
    requested_attack_cooldown: float,
    current_attack_cooldown: float,
) -> bool:
    if "increase" in action_name:
        return current_attack_cooldown <= requested_attack_cooldown + 0.0001
    if "decrease" in action_name:
        return current_attack_cooldown >= requested_attack_cooldown - 0.0001
    if baseline_attack_cooldown is not None:
        if requested_attack_cooldown <= baseline_attack_cooldown:
            return current_attack_cooldown <= requested_attack_cooldown + 0.0001
        return current_attack_cooldown >= requested_attack_cooldown - 0.0001
    return abs(current_attack_cooldown - requested_attack_cooldown) <= 0.0001


def _encounter_count_skip_satisfies_request(
    *,
    action_name: str,
    baseline_encounter_count: float | None,
    requested_encounter_count: float,
    current_encounter_count: float,
) -> bool:
    if "increase" in action_name:
        return current_encounter_count >= requested_encounter_count - 0.0001
    if "decrease" in action_name:
        return current_encounter_count <= requested_encounter_count + 0.0001
    if baseline_encounter_count is not None:
        if requested_encounter_count >= baseline_encounter_count:
            return current_encounter_count >= requested_encounter_count - 0.0001
        return current_encounter_count <= requested_encounter_count + 0.0001
    return abs(current_encounter_count - requested_encounter_count) <= 0.0001


def _spawn_pressure_skip_satisfies_request(
    *,
    action_name: str,
    baseline_spawn_interval: float | None,
    requested_spawn_interval: float,
    current_spawn_interval: float,
) -> bool:
    if "increase" in action_name:
        return current_spawn_interval <= requested_spawn_interval + 0.0001
    if "decrease" in action_name:
        return current_spawn_interval >= requested_spawn_interval - 0.0001
    if baseline_spawn_interval is not None:
        if requested_spawn_interval <= baseline_spawn_interval:
            return current_spawn_interval <= requested_spawn_interval + 0.0001
        return current_spawn_interval >= requested_spawn_interval - 0.0001
    return abs(current_spawn_interval - requested_spawn_interval) <= 0.0001


def _numeric_skip_satisfies_request(
    *,
    action_name: str,
    baseline_value: float | None,
    requested_value: float,
    current_value: float,
) -> bool:
    if any(token in action_name for token in ("increase", "higher", "raise")):
        return current_value >= requested_value - 0.0001
    if any(token in action_name for token in ("decrease", "lower", "reduce")):
        return current_value <= requested_value + 0.0001
    if baseline_value is not None:
        if requested_value >= baseline_value:
            return current_value >= requested_value - 0.0001
        return current_value <= requested_value + 0.0001
    return abs(current_value - requested_value) <= 0.0001


def _supporting_artifacts(translator_payload: Any, router_payload: Dict[str, Any]) -> list[str]:
    artifacts: list[str] = []
    if isinstance(translator_payload, dict):
        for key in ("router_artifact_path", "router_log_path"):
            value = str(translator_payload.get(key) or "").strip()
            if value:
                artifacts.append(value)
    delegated_probe_artifact = str(router_payload.get("delegated_probe_artifact_path") or "").strip()
    delegated_probe_log = str(router_payload.get("delegated_probe_log_path") or "").strip()
    if delegated_probe_artifact:
        artifacts.append(delegated_probe_artifact)
    if delegated_probe_log:
        artifacts.append(delegated_probe_log)
    return artifacts


__all__ = [
    "EntityTransformRouteResolution",
    "resolve_entity_transform_route",
    "run_level_0001_entity_transform_mutation",
    "unsupported_entity_transform_prompt_message",
]
