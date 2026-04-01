from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

from orchestrator.utils import ensure_dir, read_json_with_status

from .capability_registry import CapabilityEvidenceStore, RuntimeCapability
from .intent_normalizer import fuzzy_match, normalize_prompt, resolve_prompt


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
_EXPECTED_ROUTE_COMMAND = "move zombie forward"
_EXPECTED_PROBE_NAME = "MutateEntityTransform"
_EXPECTED_ACTION_TYPE = "mutate_entity_transform"
_DEFAULT_TARGET_OBJECT_NAME = "AIE_Zombie_001_Instance"
_DEFAULT_ROUTE_SCENE = "entity_test"


@dataclass(frozen=True)
class EntityTransformRouteResolution:
    normalized_prompt: str
    translated_command: str
    action_name: str
    scene_name: str
    probe_name: str
    wrapper_path: Path
    target_object_name: str


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
        return (
            None,
            _unmatched_prompt_message(),
        )

    route = _resolve_route(route_table, translated_command)
    if route is None:
        return (
            None,
            "No deterministic entity-transform route matched the prompt. "
            f"Translated command '{translated_command}' is not present in the Babylon route table.",
        )

    probe_name = str(route.get("probe_name") or "").strip()
    if probe_name != _EXPECTED_PROBE_NAME:
        return (
            None,
            f"Deterministic route '{translated_command}' resolved to unexpected probe '{probe_name or 'unknown'}'.",
        )

    wrapper_relative = str(route.get("wrapper_path") or "").strip()
    if not wrapper_relative:
        return None, f"Deterministic route '{translated_command}' does not define a wrapper path."

    wrapper_path = (project_path / Path(wrapper_relative)).resolve()
    if not wrapper_path.exists():
        return None, f"Deterministic route '{translated_command}' points to missing wrapper {wrapper_path}"

    wrapper_arguments = route.get("wrapper_arguments") if isinstance(route.get("wrapper_arguments"), dict) else {}
    target_object_name = str(wrapper_arguments.get("TargetObjectName") or _DEFAULT_TARGET_OBJECT_NAME).strip()
    scene_name = str(route.get("scene_name") or wrapper_arguments.get("SceneName") or route_table.get("scene_name") or _DEFAULT_ROUTE_SCENE).strip()
    action_name = str(route.get("action_name") or "").strip()
    if not action_name:
        return None, f"Deterministic route '{translated_command}' does not define an action_name."

    return EntityTransformRouteResolution(
        normalized_prompt=lookup_prompt,
        translated_command=translated_command,
        action_name=action_name,
        scene_name=scene_name,
        probe_name=probe_name,
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
        "action_type": str(probe_payload.get("action_type") or _EXPECTED_ACTION_TYPE),
        "object_name": str(probe_payload.get("object_name") or route_resolution.target_object_name),
        "previous_position": list(probe_payload.get("previous_position") or []),
        "new_position": list(probe_payload.get("new_position") or []),
        "observed_position_before_reset": list(probe_payload.get("observed_position_before_reset") or []),
        "scene_name": str(probe_payload.get("scene_name") or route_resolution.scene_name),
        "scene_path": scene_path,
        "files_changed": [scene_path] if scene_path else [],
        "validation": {
            "status": "passed",
            "check": "mutate_entity_transform_artifact_confirmed",
        },
        "evidence": evidence_snapshot,
    }
    return {
        "status": "completed",
        "summary": (
            f"{capability.handler_name} executed {route_resolution.translated_command} "
            f"via {_EXPECTED_ACTION_TYPE}"
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
        "Try something like: 'move zombie forward'."
    )


def unsupported_entity_transform_prompt_message(prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
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
    return None


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
    if str(router_payload.get("delegated_probe_action_type") or "") != _EXPECTED_ACTION_TYPE:
        return (
            f"Intent router resolved unexpected action type "
            f"'{router_payload.get('delegated_probe_action_type') or 'unknown'}'."
        )
    if probe_issue is not None:
        return probe_issue
    if str(probe_payload.get("status") or "") != "success":
        return str(probe_payload.get("message") or "Delegated probe did not report success.")
    if str(probe_payload.get("action_type") or "") != _EXPECTED_ACTION_TYPE:
        return f"Delegated probe reported unexpected action type '{probe_payload.get('action_type') or 'unknown'}'."
    previous_position = probe_payload.get("previous_position")
    new_position = probe_payload.get("new_position")
    if not isinstance(previous_position, list) or len(previous_position) != 3:
        return "Delegated probe did not report a valid previous_position."
    if not isinstance(new_position, list) or len(new_position) != 3:
        return "Delegated probe did not report a valid new_position."
    return None


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
