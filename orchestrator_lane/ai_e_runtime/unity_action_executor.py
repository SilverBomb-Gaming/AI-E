from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from orchestrator.utils import read_json_with_status, slugify, utc_timestamp, write_json


DEFAULT_UNITY_ACTION_TYPE = "create_debug_cube"
MUTATE_EXISTING_OBJECT_ACTION_TYPE = "mutate_existing_object"
DEFAULT_MUTATION_TYPE = "scale"
DEFAULT_UNITY_SCENE_NAME = "MainMenu"
DEFAULT_UNITY_OBJECT_NAME = "AIE_DebugCube_001"
DEFAULT_MUTATION_TARGET_OBJECT_NAME = "AIE_DebugCube_001"
DEFAULT_MUTATION_PROPERTY_CHANGED = "localScale"
DEFAULT_UNITY_TIMEOUT_SECONDS = 240
_DEFAULT_TARGET_REPO_ENV_VAR = "AI_E_DEFAULT_TARGET_REPO"
DEFAULT_UNITY_EXECUTION_ROOT = Path("runs") / "sample_clip_analysis" / "unity_action"
_POWERSHELL_PREFIX = [
    "powershell.exe",
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
]
_SUPPORTED_MUTATION_TYPES = {"scale", "position", "rotation", "active_state"}
_SUPPORTED_ACTION_MODES = {
    "scale": {"absolute", "offset"},
    "position": {"absolute", "offset"},
    "rotation": {"absolute", "offset"},
    "active_state": {"set"},
}
_DEFAULT_ACTION_MODE_BY_MUTATION = {
    "scale": "absolute",
    "position": "absolute",
    "rotation": "absolute",
    "active_state": "set",
}
_MUTATION_TYPE_TO_PROPERTY = {
    "scale": "localScale",
    "position": "localPosition",
    "rotation": "localEulerAngles",
    "active_state": "activeSelf",
}
_MUTATION_TYPE_TO_LAUNCHER = {
    "scale": "run_unity_mutate_debug_cube_001_transform_phase1.ps1",
    "position": "run_unity_mutate_debug_cube_001_transform_phase1.ps1",
    "rotation": "run_unity_mutate_debug_cube_001_transform_phase1.ps1",
    "active_state": "run_unity_mutate_debug_cube_001_transform_phase1.ps1",
}


def execute_unity_action(request: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    """Execute one approved Unity scene action against the Babylon project.

    The executor only supports a single visible, reversible Babylon scene
    action at a time.
    """

    payload = _coerce_request(request)
    normalized = _normalize_request(payload)
    print(f"[unity_action_executor] Request loaded: {normalized['request_source']}")
    print(f"[unity_action_executor] Action type: {normalized['action_type']}")
    print(f"[unity_action_executor] Scene: {normalized['scene_name']}")

    execution_dir = _resolve_execution_dir(normalized.get("output_dir"))
    execution_id = normalized.get("execution_id") or f"unity_action_{utc_timestamp()}"
    slug = slugify(str(normalized.get("task_id") or execution_id))
    artifact_path = execution_dir / f"{slug}_unity_artifact.json"
    log_path = execution_dir / f"{slug}_unity.log"
    result_path = execution_dir / f"{slug}_execution_result.json"

    validation_issue = _validate_request(normalized)
    if validation_issue is not None:
        result = _build_result(
            execution_id=execution_id,
            task_id=normalized["task_id"],
            action_type=normalized["action_type"],
            status="blocked",
            scene_name=normalized["scene_name"],
            notes=[validation_issue, "No Unity scene changes were applied."],
            output_path=result_path,
            artifact_path=artifact_path,
            log_path=log_path,
            mutation_type=normalized.get("expected_mutation_type"),
            action_mode=normalized.get("expected_action_mode"),
            created_object_name=normalized.get("expected_created_object_name"),
            target_object_name=normalized.get("expected_target_object_name"),
            property_changed=normalized.get("expected_property_changed"),
        )
        write_json(result_path, result)
        print(f"[unity_action_executor] Final status: {result['status']}")
        return result

    project_path = Path(str(normalized["project_path"]))
    launcher_path = Path(str(normalized["launcher_path"]))
    command = _build_command(
        launcher_path=launcher_path,
        project_path=project_path,
        scene_name=normalized["scene_name"],
        mutation_type=normalized.get("mutation_type", ""),
        action_mode=normalized.get("action_mode", ""),
        action_value=normalized.get("action_value"),
        rollback_enabled=bool(normalized.get("rollback_enabled")),
        artifact_path=artifact_path,
        log_path=log_path,
        timeout_seconds=int(normalized["timeout_seconds"]),
        unity_editor_path=normalized.get("unity_editor_path"),
        target_name=normalized.get("target_name"),
        target_hierarchy_path=normalized.get("target_hierarchy_path"),
        target_file_id=normalized.get("target_file_id"),
        expected_transform_file_id=normalized.get("expected_transform_file_id"),
        required_resolution_mode=normalized.get("required_resolution_mode"),
        allow_exact_name_fallback=normalized.get("allow_exact_name_fallback"),
        fail_if_inactive=normalized.get("fail_if_inactive"),
        require_root_object=normalized.get("require_root_object"),
        expected_scene_path=normalized.get("expected_scene_path"),
        required_component_types=normalized.get("required_component_types", []),
        force_temporary_duplicate=normalized.get("force_temporary_duplicate"),
        force_target_inactive=normalized.get("force_target_inactive"),
    )
    print(f"[unity_action_executor] Launcher: {launcher_path}")

    running_result = _build_result(
        execution_id=execution_id,
        task_id=normalized["task_id"],
        action_type=normalized["action_type"],
        status="running",
        scene_name=normalized["scene_name"],
        notes=["Unity launcher started; awaiting action artifact confirmation."],
        output_path=result_path,
        artifact_path=artifact_path,
        log_path=log_path,
        command=command,
        mutation_type=normalized.get("expected_mutation_type"),
        action_mode=normalized.get("expected_action_mode"),
        created_object_name=normalized.get("expected_created_object_name"),
        target_object_name=normalized.get("expected_target_object_name"),
        property_changed=normalized.get("expected_property_changed"),
    )
    write_json(result_path, running_result)

    try:
        completed = subprocess.run(
            command,
            cwd=str(project_path),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        result = _build_result(
            execution_id=execution_id,
            task_id=normalized["task_id"],
            action_type=normalized["action_type"],
            status="failed",
            scene_name=normalized["scene_name"],
            notes=[f"Failed to start Unity launcher: {exc}", "No Unity scene changes were applied."],
            output_path=result_path,
            artifact_path=artifact_path,
            log_path=log_path,
            command=command,
            returncode=None,
            unity_exit_code="UNKNOWN",
            unity_exit_reason="launcher failed to start",
            mutation_type=normalized.get("expected_mutation_type"),
            action_mode=normalized.get("expected_action_mode"),
            created_object_name=normalized.get("expected_created_object_name"),
            target_object_name=normalized.get("expected_target_object_name"),
            property_changed=normalized.get("expected_property_changed"),
        )
        write_json(result_path, result)
        print(f"[unity_action_executor] Final status: {result['status']}")
        return result

    unity_exit_code, unity_exit_reason = _extract_unity_exit_code(completed.stdout, completed.stderr)
    artifact_payload, artifact_issue = read_json_with_status(artifact_path, default={})

    if completed.returncode != 0 or unity_exit_code != "0":
        blocked_result = _build_blocked_result_from_artifact(
            payload=artifact_payload,
            issue=artifact_issue,
            normalized=normalized,
            execution_id=execution_id,
            result_path=result_path,
            artifact_path=artifact_path,
            log_path=log_path,
            command=command,
            returncode=completed.returncode,
            unity_exit_code=unity_exit_code,
            unity_exit_reason=unity_exit_reason,
        )
        if blocked_result is not None:
            write_json(result_path, blocked_result)
            print(f"[unity_action_executor] Final status: {blocked_result['status']}")
            return blocked_result

    artifact_validation = _validate_artifact(
        artifact_payload,
        artifact_issue,
        action_type=normalized["action_type"],
        expected_created_object_name=normalized.get("expected_created_object_name", ""),
        expected_target_object_name=normalized.get("expected_target_object_name", ""),
        expected_property_changed=normalized.get("expected_property_changed", ""),
        expected_mutation_type=normalized.get("expected_mutation_type", ""),
        expected_action_mode=normalized.get("expected_action_mode", ""),
        expected_rollback_enabled=bool(normalized.get("rollback_enabled")),
    )

    if artifact_validation is None:
        artifact_notes = [note for note in artifact_payload.get("notes", []) if isinstance(note, str) and note.strip()]
        result = _build_result(
            execution_id=execution_id,
            task_id=normalized["task_id"],
            action_type=normalized["action_type"],
            status="completed",
            scene_name=str(artifact_payload.get("scene_name") or artifact_payload.get("scene") or normalized["scene_name"]),
            notes=artifact_notes or ["Debug cube action completed."],
            output_path=result_path,
            artifact_path=artifact_path,
            log_path=log_path,
            command=command,
            returncode=completed.returncode,
            unity_exit_code=unity_exit_code,
            unity_exit_reason=unity_exit_reason,
            mutation_type=_resolve_mutation_type(artifact_payload, normalized),
            action_mode=_resolve_action_mode(artifact_payload, normalized),
            created_object_name=_resolve_created_object_name(artifact_payload, normalized),
            target_object_name=_resolve_target_object_name(artifact_payload, normalized),
            property_changed=str(artifact_payload.get("property_changed") or normalized.get("expected_property_changed") or ""),
            before_value=artifact_payload.get("before_value"),
            after_value=artifact_payload.get("after_value"),
            baseline_value=artifact_payload.get("baseline_value"),
            mutated_value=artifact_payload.get("mutated_value"),
            restored_value=artifact_payload.get("restored_value"),
            rollback_status=artifact_payload.get("rollback_status"),
            resolved_file_id=artifact_payload.get("resolved_fileID"),
            resolved_transform_file_id=artifact_payload.get("resolved_transform_fileID"),
            resolution_mode_used=artifact_payload.get("resolution_mode_used"),
            policy_decision=artifact_payload.get("policy_decision"),
            mutation_allowed=artifact_payload.get("mutation_allowed"),
        )
        write_json(result_path, result)
        print(f"[unity_action_executor] Final status: {result['status']}")
        return result

    if completed.returncode != 0 or unity_exit_code != "0":
        result = _build_result(
            execution_id=execution_id,
            task_id=normalized["task_id"],
            action_type=normalized["action_type"],
            status="failed",
            scene_name=normalized["scene_name"],
            notes=[
                unity_exit_reason or f"Unity launcher returned code {completed.returncode}.",
                "No additional queue or gameplay systems were modified.",
            ],
            output_path=result_path,
            artifact_path=artifact_path,
            log_path=log_path,
            command=command,
            returncode=completed.returncode,
            unity_exit_code=unity_exit_code,
            unity_exit_reason=unity_exit_reason,
            mutation_type=normalized.get("expected_mutation_type"),
            action_mode=normalized.get("expected_action_mode"),
            created_object_name=normalized.get("expected_created_object_name"),
            target_object_name=normalized.get("expected_target_object_name"),
            property_changed=normalized.get("expected_property_changed"),
        )
        write_json(result_path, result)
        print(f"[unity_action_executor] Final status: {result['status']}")
        return result

    if artifact_validation is not None:
        result = _build_result(
            execution_id=execution_id,
            task_id=normalized["task_id"],
            action_type=normalized["action_type"],
            status="failed",
            scene_name=normalized["scene_name"],
            notes=[artifact_validation, "Unity exited without a valid action confirmation artifact."],
            output_path=result_path,
            artifact_path=artifact_path,
            log_path=log_path,
            command=command,
            returncode=completed.returncode,
            unity_exit_code=unity_exit_code,
            unity_exit_reason=unity_exit_reason,
            mutation_type=normalized.get("expected_mutation_type"),
            action_mode=normalized.get("expected_action_mode"),
            created_object_name=normalized.get("expected_created_object_name"),
            target_object_name=normalized.get("expected_target_object_name"),
            property_changed=normalized.get("expected_property_changed"),
        )
        write_json(result_path, result)
        print(f"[unity_action_executor] Final status: {result['status']}")
        return result


def _coerce_request(value: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)

    path = Path(value)
    payload, issue = read_json_with_status(path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        return {}
    return payload


def _normalize_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    queue_tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else None
    request_source = "explicit_request"
    queue_status = ""
    queue_source = ""
    base = payload

    if queue_tasks is not None:
        request_source = "sandbox_queue"
        queue_status = str(payload.get("status") or "").strip()
        queue_source = str(payload.get("source") or "").strip()
        if len(queue_tasks) == 1 and isinstance(queue_tasks[0], dict):
            base = dict(queue_tasks[0])
        else:
            base = {"tasks": queue_tasks}
    elif isinstance(payload.get("task"), dict):
        request_source = "task_wrapper"
        base = dict(payload["task"])
    elif isinstance(payload.get("execution_request"), dict):
        request_source = "execution_request"
        base = dict(payload["execution_request"])

    metadata = base.get("metadata") if isinstance(base.get("metadata"), dict) else {}
    parameters = base.get("parameters") if isinstance(base.get("parameters"), dict) else {}
    requested_action = base.get("requested_action") if isinstance(base.get("requested_action"), dict) else {}

    action_type = _first_string(
        base.get("action_type"),
        requested_action.get("action_type"),
        parameters.get("action_type"),
        metadata.get("action_type"),
    ) or str(base.get("task_type") or "").strip().lower()
    mutation_type = _normalize_mutation_type(
        _first_string(
            base.get("mutation_type"),
            requested_action.get("mutation_type"),
            parameters.get("mutation_type"),
            metadata.get("mutation_type"),
        ),
        action_type=action_type,
    )
    action_mode = _normalize_action_mode(
        _first_string(
            base.get("action_mode"),
            requested_action.get("action_mode"),
            parameters.get("action_mode"),
            metadata.get("action_mode"),
        ),
        action_type=action_type,
        mutation_type=mutation_type,
    )
    action_value, action_value_issue = _resolve_action_value(
        mutation_type=mutation_type,
        action_mode=action_mode,
        base=base,
        requested_action=requested_action,
        parameters=parameters,
        metadata=metadata,
    )

    project_path = _first_string(
        base.get("project_path"),
        parameters.get("project_path"),
        metadata.get("project_path"),
    ) or _resolve_default_project_path(base=base, parameters=parameters, metadata=metadata)

    launcher_path = _first_string(
        base.get("launcher_path"),
        parameters.get("launcher_path"),
        metadata.get("launcher_path"),
    )

    timeout_value = _first_string(
        base.get("timeout_seconds"),
        parameters.get("timeout_seconds"),
        metadata.get("timeout_seconds"),
    )
    try:
        timeout_seconds = int(timeout_value or DEFAULT_UNITY_TIMEOUT_SECONDS)
    except ValueError:
        timeout_seconds = DEFAULT_UNITY_TIMEOUT_SECONDS

    approved = _is_approved(base, request_source=request_source, queue_source=queue_source, queue_status=queue_status)

    normalized = {
        "request_source": request_source,
        "task_id": _first_string(base.get("task_id"), base.get("request_id"), base.get("id")) or "unity_action_task_001",
        "execution_id": _first_string(base.get("execution_id"), base.get("request_id")),
        "action_type": action_type,
        "mutation_type": mutation_type,
        "scene_name": _first_string(
            base.get("scene_name"),
            base.get("target_scene"),
            base.get("scene"),
            parameters.get("scene_name"),
            metadata.get("scene_name"),
        ) or DEFAULT_UNITY_SCENE_NAME,
        "project_path": project_path,
        "launcher_path": launcher_path or (_default_launcher_path(project_path, action_type, mutation_type) if project_path else ""),
        "timeout_seconds": max(30, timeout_seconds),
        "expected_created_object_name": _first_string(
            base.get("expected_created_object_name"),
            parameters.get("expected_created_object_name"),
            metadata.get("expected_created_object_name"),
        ) or (DEFAULT_UNITY_OBJECT_NAME if action_type == DEFAULT_UNITY_ACTION_TYPE else ""),
        "expected_target_object_name": _first_string(
            base.get("expected_target_object_name"),
            parameters.get("expected_target_object_name"),
            metadata.get("expected_target_object_name"),
        ) or (DEFAULT_MUTATION_TARGET_OBJECT_NAME if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else ""),
        "expected_mutation_type": mutation_type if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else "",
        "expected_action_mode": action_mode if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else "",
        "rollback_enabled": bool(
            _normalize_optional_bool(
                base.get("rollback_enabled"),
                base.get("enable_rollback"),
                base.get("rollback_requested"),
                requested_action.get("rollback_enabled"),
                requested_action.get("enable_rollback"),
                parameters.get("rollback_enabled"),
                parameters.get("enable_rollback"),
                metadata.get("rollback_enabled"),
                metadata.get("enable_rollback"),
            )
            or False
        )
        if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE
        else False,
        "expected_property_changed": _first_string(
            base.get("expected_property_changed"),
            parameters.get("expected_property_changed"),
            metadata.get("expected_property_changed"),
        ) or (_expected_property_for_mutation_type(mutation_type) if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else ""),
        "action_mode": action_mode if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else "",
        "action_value": action_value if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else None,
        "action_value_issue": action_value_issue if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else "",
        "unity_editor_path": _first_string(
            base.get("unity_editor_path"),
            parameters.get("unity_editor_path"),
            metadata.get("unity_editor_path"),
        ),
        "output_dir": _first_string(base.get("output_dir"), parameters.get("output_dir"), metadata.get("output_dir")),
        "target_name": _first_string(
            base.get("target_name"),
            parameters.get("target_name"),
            metadata.get("target_name"),
            DEFAULT_MUTATION_TARGET_OBJECT_NAME if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE else "",
        ),
        "target_hierarchy_path": _first_string(
            base.get("target_hierarchy_path"),
            parameters.get("target_hierarchy_path"),
            metadata.get("target_hierarchy_path"),
        ),
        "target_file_id": _normalize_positive_int(
            base.get("target_file_id"),
            parameters.get("target_file_id"),
            metadata.get("target_file_id"),
        ),
        "expected_transform_file_id": _normalize_positive_int(
            base.get("expected_transform_file_id"),
            parameters.get("expected_transform_file_id"),
            metadata.get("expected_transform_file_id"),
        ),
        "required_resolution_mode": _first_string(
            base.get("required_resolution_mode"),
            parameters.get("required_resolution_mode"),
            metadata.get("required_resolution_mode"),
        ),
        "allow_exact_name_fallback": _normalize_optional_bool(
            base.get("allow_exact_name_fallback"),
            parameters.get("allow_exact_name_fallback"),
            metadata.get("allow_exact_name_fallback"),
        ),
        "fail_if_inactive": _normalize_optional_bool(
            base.get("fail_if_inactive"),
            parameters.get("fail_if_inactive"),
            metadata.get("fail_if_inactive"),
        ),
        "require_root_object": _normalize_optional_bool(
            base.get("require_root_object"),
            parameters.get("require_root_object"),
            metadata.get("require_root_object"),
        ),
        "expected_scene_path": _first_string(
            base.get("expected_scene_path"),
            parameters.get("expected_scene_path"),
            metadata.get("expected_scene_path"),
        ),
        "required_component_types": _normalize_string_list(
            base.get("required_component_types"),
            parameters.get("required_component_types"),
            metadata.get("required_component_types"),
        ),
        "force_temporary_duplicate": _normalize_optional_bool(
            base.get("force_temporary_duplicate"),
            parameters.get("force_temporary_duplicate"),
            metadata.get("force_temporary_duplicate"),
        ),
        "force_target_inactive": _normalize_optional_bool(
            base.get("force_target_inactive"),
            parameters.get("force_target_inactive"),
            metadata.get("force_target_inactive"),
        ),
        "approved": approved,
        "task_count": len(queue_tasks) if queue_tasks is not None else 1,
    }
    return normalized


def _validate_request(normalized: Dict[str, Any]) -> str | None:
    if normalized.get("task_count", 0) != 1:
        return "Unity action executor only accepts exactly one task at a time."

    if normalized["action_type"] not in {DEFAULT_UNITY_ACTION_TYPE, MUTATE_EXISTING_OBJECT_ACTION_TYPE}:
        return f"Unsupported Unity action type: {normalized['action_type'] or 'unknown'}"

    if normalized["action_type"] == MUTATE_EXISTING_OBJECT_ACTION_TYPE and normalized.get("mutation_type") not in _SUPPORTED_MUTATION_TYPES:
        return f"Unsupported mutation_type for existing-object mutation: {normalized.get('mutation_type') or 'unknown'}"

    if normalized["action_type"] == MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        supported_modes = _SUPPORTED_ACTION_MODES.get(normalized.get("mutation_type") or "", set())
        if normalized.get("action_mode") not in supported_modes:
            return (
                f"Unsupported action_mode '{normalized.get('action_mode') or 'unknown'}' for mutation_type "
                f"'{normalized.get('mutation_type') or 'unknown'}'."
            )
        if normalized.get("action_value_issue"):
            return str(normalized["action_value_issue"])

    if not normalized.get("approved"):
        return "Unity action executor requires one approved sandbox task or an explicit execution request."

    if not str(normalized.get("project_path") or "").strip():
        return (
            "Unity project path not configured. Provide project_path explicitly or set "
            f"{_DEFAULT_TARGET_REPO_ENV_VAR}."
        )

    project_path = Path(str(normalized["project_path"]))
    if not project_path.exists():
        return f"Unity project path not found: {project_path}"

    launcher_path = Path(str(normalized["launcher_path"]))
    if not launcher_path.exists():
        return f"Unity launcher not found: {launcher_path}"

    return None


def _resolve_execution_dir(candidate: str | None) -> Path:
    if candidate:
        path = Path(candidate)
    else:
        path = Path(__file__).resolve().parents[1] / DEFAULT_UNITY_EXECUTION_ROOT
    path.mkdir(parents=True, exist_ok=True)
    return path


def _build_command(
    *,
    launcher_path: Path,
    project_path: Path,
    scene_name: str,
    mutation_type: str,
    action_mode: str,
    action_value: Any | None,
    rollback_enabled: bool,
    artifact_path: Path,
    log_path: Path,
    timeout_seconds: int,
    unity_editor_path: str | None,
    target_name: str | None,
    target_hierarchy_path: str | None,
    target_file_id: int | None,
    expected_transform_file_id: int | None,
    required_resolution_mode: str | None,
    allow_exact_name_fallback: bool | None,
    fail_if_inactive: bool | None,
    require_root_object: bool | None,
    expected_scene_path: str | None,
    required_component_types: list[str],
    force_temporary_duplicate: bool | None,
    force_target_inactive: bool | None,
) -> List[str]:
    launcher_name = Path(str(launcher_path)).name
    command = [
        *_POWERSHELL_PREFIX,
        "-File",
        str(launcher_path),
        "-ProjectPath",
        str(project_path),
        "-SceneName",
        scene_name,
    ]
    if launcher_name == "run_unity_mutate_debug_cube_001_transform_phase1.ps1":
        command.extend(["-MutationType", mutation_type])
        command.extend(["-ActionMode", action_mode])
        if action_value is not None:
            command.extend(["-ActionValue", json.dumps(action_value, separators=(",", ":"))])
        if rollback_enabled:
            command.extend(["-EnableRollback", "true"])
    command.extend(
        [
            "-ArtifactPath",
            str(artifact_path),
            "-LogPath",
            str(log_path),
            "-TimeoutSec",
            str(timeout_seconds),
        ]
    )
    if unity_editor_path:
        command.extend(["-UnityEditorPath", unity_editor_path])
    if target_name:
        command.extend(["-TargetName", str(target_name)])
    if target_hierarchy_path:
        command.extend(["-TargetHierarchyPath", str(target_hierarchy_path)])
    if target_file_id:
        command.extend(["-TargetFileId", str(target_file_id)])
    if expected_transform_file_id:
        command.extend(["-ExpectedTransformFileId", str(expected_transform_file_id)])
    if required_resolution_mode:
        command.extend(["-RequiredResolutionMode", str(required_resolution_mode)])
    if allow_exact_name_fallback is not None:
        command.extend(["-AllowExactNameFallback", _bool_cli_value(allow_exact_name_fallback)])
    if fail_if_inactive is not None:
        command.extend(["-FailIfInactive", _bool_cli_value(fail_if_inactive)])
    if require_root_object is not None:
        command.extend(["-RequireRootObject", _bool_cli_value(require_root_object)])
    if expected_scene_path:
        command.extend(["-ExpectedScenePath", str(expected_scene_path)])
    for required_component_type in required_component_types:
        command.extend(["-RequiredComponentTypes", required_component_type])
    if force_temporary_duplicate is not None:
        command.extend(["-ForceTemporaryDuplicate", _bool_cli_value(force_temporary_duplicate)])
    if force_target_inactive is not None:
        command.extend(["-ForceTargetInactive", _bool_cli_value(force_target_inactive)])
    return command


def _extract_unity_exit_code(stdout_text: str, stderr_text: str) -> tuple[str, str]:
    exit_code = ""
    reason = ""
    for text in (stdout_text or "", stderr_text or ""):
        for line in text.splitlines():
            if line.startswith("UNITY_EXIT_CODE="):
                value = line.partition("=")[2].strip()
                if value:
                    exit_code = value
                elif not reason:
                    reason = "wrapper emitted blank UNITY_EXIT_CODE"
            elif line.startswith("UNITY_EXIT_REASON=") and not reason:
                reason = line.partition("=")[2].strip()
    if exit_code:
        return exit_code, reason
    if not reason:
        reason = "wrapper did not emit UNITY_EXIT_CODE"
    return "UNKNOWN", reason


def _validate_artifact(
    payload: Dict[str, Any],
    issue: str | None,
    *,
    action_type: str,
    expected_created_object_name: str,
    expected_target_object_name: str,
    expected_property_changed: str,
    expected_mutation_type: str,
    expected_action_mode: str,
    expected_rollback_enabled: bool,
) -> str | None:
    if issue is not None:
        return f"Unity action artifact was {issue}."

    if not isinstance(payload, dict) or not payload:
        return "Unity action artifact was missing or invalid."

    required_keys = ["status", "scene_name", "action_type", "notes"]
    if action_type == DEFAULT_UNITY_ACTION_TYPE:
        required_keys.append("created_object_name")
    elif action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        required_keys.extend(
            [
                "target_object_name",
                "property_changed",
                "action_mode",
                "before_value",
                "after_value",
                "resolved_fileID",
                "resolved_transform_fileID",
                "resolution_mode_used",
                "policy_decision",
                "mutation_allowed",
                "scene_path",
                "timestamp",
            ]
        )
        if expected_rollback_enabled:
            required_keys.extend(["baseline_value", "mutated_value", "restored_value", "rollback_status"])
    for key in required_keys:
        if key not in payload:
            return f"Unity action artifact missing required field '{key}'."

    if str(payload.get("status") or "").strip().lower() != "success":
        return f"Unity action artifact reported status '{payload.get('status')}'."

    if str(payload.get("action_type") or "").strip() != action_type:
        return f"Unity action artifact reported unsupported action '{payload.get('action_type')}'."

    if action_type == DEFAULT_UNITY_ACTION_TYPE:
        if str(payload.get("created_object_name") or "").strip() != expected_created_object_name:
            return f"Unity action artifact reported unexpected object '{payload.get('created_object_name')}'."
    elif action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        if str(payload.get("target_object_name") or "").strip() != expected_target_object_name:
            return f"Unity action artifact reported unexpected object '{payload.get('target_object_name')}'."
        if str(payload.get("property_changed") or "").strip() != expected_property_changed:
            return f"Unity action artifact reported unexpected property '{payload.get('property_changed')}'."
        payload_mutation_type = _normalize_mutation_type(payload.get("mutation_type"), action_type=action_type)
        if expected_mutation_type and payload_mutation_type != expected_mutation_type:
            return f"Unity action artifact reported unexpected mutation type '{payload.get('mutation_type')}'."
        payload_action_mode = _normalize_action_mode(
            payload.get("action_mode"),
            action_type=action_type,
            mutation_type=payload_mutation_type,
        )
        if expected_action_mode and payload_action_mode != expected_action_mode:
            return f"Unity action artifact reported unexpected action mode '{payload.get('action_mode')}'."
        if payload.get("policy_decision") != "allow":
            return f"Unity action artifact reported policy decision '{payload.get('policy_decision')}'."
        if payload.get("mutation_allowed") is not True:
            return "Unity action artifact reported mutation_allowed=false for a success artifact."
        try:
            if int(payload.get("resolved_fileID") or 0) <= 0:
                return f"Unity action artifact reported invalid resolved_fileID '{payload.get('resolved_fileID')}'."
            if int(payload.get("resolved_transform_fileID") or 0) <= 0:
                return f"Unity action artifact reported invalid resolved_transform_fileID '{payload.get('resolved_transform_fileID')}'."
        except (TypeError, ValueError):
            return "Unity action artifact reported non-numeric resolved file identifiers."
        if expected_mutation_type == "active_state":
            if not isinstance(payload.get("before_value"), bool):
                return "Unity action artifact before_value field was not a bool for active_state."
            if not isinstance(payload.get("after_value"), bool):
                return "Unity action artifact after_value field was not a bool for active_state."
            if expected_rollback_enabled:
                if not isinstance(payload.get("baseline_value"), bool):
                    return "Unity rollback artifact baseline_value field was not a bool for active_state."
                if not isinstance(payload.get("mutated_value"), bool):
                    return "Unity rollback artifact mutated_value field was not a bool for active_state."
                if not isinstance(payload.get("restored_value"), bool):
                    return "Unity rollback artifact restored_value field was not a bool for active_state."
        else:
            if not isinstance(payload.get("before_value"), list):
                return "Unity action artifact before_value field was not a list."
            if not isinstance(payload.get("after_value"), list):
                return "Unity action artifact after_value field was not a list."
            if expected_rollback_enabled:
                if not isinstance(payload.get("baseline_value"), list):
                    return "Unity rollback artifact baseline_value field was not a list."
                if not isinstance(payload.get("mutated_value"), list):
                    return "Unity rollback artifact mutated_value field was not a list."
                if not isinstance(payload.get("restored_value"), list):
                    return "Unity rollback artifact restored_value field was not a list."
        if expected_rollback_enabled and str(payload.get("rollback_status") or "").strip().lower() != "restored":
            return f"Unity rollback artifact reported rollback_status '{payload.get('rollback_status')}'."

    if not isinstance(payload.get("notes"), list):
        return "Unity action artifact notes field was not a list."

    return None


def _build_result(
    *,
    execution_id: str,
    task_id: str,
    action_type: str,
    status: str,
    scene_name: str,
    notes: List[str],
    output_path: Path,
    artifact_path: Path,
    log_path: Path,
    created_object_name: str | None = None,
    target_object_name: str | None = None,
    property_changed: str | None = None,
    mutation_type: str | None = None,
    action_mode: str | None = None,
    before_value: Any | None = None,
    after_value: Any | None = None,
    baseline_value: Any | None = None,
    mutated_value: Any | None = None,
    restored_value: Any | None = None,
    rollback_status: str | None = None,
    resolved_file_id: Any | None = None,
    resolved_transform_file_id: Any | None = None,
    resolution_mode_used: Any | None = None,
    policy_decision: Any | None = None,
    mutation_allowed: Any | None = None,
    command: List[str] | None = None,
    returncode: int | None = None,
    unity_exit_code: str = "",
    unity_exit_reason: str = "",
) -> Dict[str, Any]:
    payload = {
        "execution_id": execution_id,
        "task_id": task_id,
        "action_type": action_type,
        "status": status,
        "scene_name": scene_name,
        "notes": list(notes),
        "output_path": str(output_path),
        "artifact_path": str(artifact_path),
        "log_path": str(log_path),
    }
    if created_object_name:
        payload["created_object_name"] = created_object_name
    if target_object_name:
        payload["target_object_name"] = target_object_name
    if property_changed:
        payload["property_changed"] = property_changed
    if mutation_type:
        payload["mutation_type"] = mutation_type
    if action_mode:
        payload["action_mode"] = action_mode
    if before_value is not None:
        payload["before_value"] = before_value
    if after_value is not None:
        payload["after_value"] = after_value
    if baseline_value is not None:
        payload["baseline_value"] = baseline_value
    if mutated_value is not None:
        payload["mutated_value"] = mutated_value
    if restored_value is not None:
        payload["restored_value"] = restored_value
    if rollback_status:
        payload["rollback_status"] = rollback_status
    if resolved_file_id is not None:
        payload["resolved_fileID"] = resolved_file_id
    if resolved_transform_file_id is not None:
        payload["resolved_transform_fileID"] = resolved_transform_file_id
    if resolution_mode_used is not None:
        payload["resolution_mode_used"] = resolution_mode_used
    if policy_decision is not None:
        payload["policy_decision"] = policy_decision
    if mutation_allowed is not None:
        payload["mutation_allowed"] = mutation_allowed
    if command is not None:
        payload["command"] = list(command)
    if returncode is not None:
        payload["returncode"] = returncode
    if unity_exit_code:
        payload["unity_exit_code"] = unity_exit_code
    if unity_exit_reason:
        payload["unity_exit_reason"] = unity_exit_reason
    return payload


def _is_approved(
    payload: Dict[str, Any],
    *,
    request_source: str,
    queue_source: str,
    queue_status: str,
) -> bool:
    for key in ("approval_status", "decision"):
        value = str(payload.get(key) or "").strip().lower()
        if value in {"approved", "allow", "allowed"}:
            return True

    if request_source == "explicit_request":
        return True

    if queue_source == "sandbox_execution" and queue_status == "ready_for_execution":
        return True

    return False


def _first_string(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _default_launcher_path(project_path: str, action_type: str, mutation_type: str) -> str:
    tools_dir = Path(project_path) / "Tools"
    if action_type == MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        launcher_name = _MUTATION_TYPE_TO_LAUNCHER.get(mutation_type or DEFAULT_MUTATION_TYPE, _MUTATION_TYPE_TO_LAUNCHER[DEFAULT_MUTATION_TYPE])
        return str(tools_dir / launcher_name)
    return str(tools_dir / "run_unity_create_debug_cube.ps1")


def _resolve_default_project_path(*, base: Dict[str, Any], parameters: Dict[str, Any], metadata: Dict[str, Any]) -> str:
    configured_target_repo = _first_string(
        base.get("target_repo"),
        parameters.get("target_repo"),
        metadata.get("target_repo"),
        os.getenv(_DEFAULT_TARGET_REPO_ENV_VAR, ""),
    )
    if not configured_target_repo:
        return ""
    return str(Path(configured_target_repo))


def _resolve_created_object_name(payload: Dict[str, Any], normalized: Dict[str, Any]) -> str:
    if normalized["action_type"] != DEFAULT_UNITY_ACTION_TYPE:
        return ""
    return str(payload.get("created_object_name") or normalized.get("expected_created_object_name") or DEFAULT_UNITY_OBJECT_NAME)


def _resolve_target_object_name(payload: Dict[str, Any], normalized: Dict[str, Any]) -> str:
    if normalized["action_type"] != MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        return ""
    return str(payload.get("target_object_name") or normalized.get("expected_target_object_name") or DEFAULT_MUTATION_TARGET_OBJECT_NAME)


def _resolve_mutation_type(payload: Dict[str, Any], normalized: Dict[str, Any]) -> str:
    mutation_type = _normalize_mutation_type(payload.get("mutation_type"), action_type=normalized.get("action_type", ""))
    if mutation_type:
        return mutation_type
    return _normalize_mutation_type(normalized.get("expected_mutation_type"), action_type=normalized.get("action_type", ""))


def _resolve_action_mode(payload: Dict[str, Any], normalized: Dict[str, Any]) -> str:
    mutation_type = _resolve_mutation_type(payload, normalized)
    action_mode = _normalize_action_mode(
        payload.get("action_mode"),
        action_type=normalized.get("action_type", ""),
        mutation_type=mutation_type,
    )
    if action_mode:
        return action_mode
    return _normalize_action_mode(
        normalized.get("expected_action_mode"),
        action_type=normalized.get("action_type", ""),
        mutation_type=mutation_type,
    )


def _normalize_mutation_type(value: Any, *, action_type: str) -> str:
    if action_type != MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        return ""
    text = str(value or "").strip().lower()
    if not text:
        return DEFAULT_MUTATION_TYPE
    return text


def _normalize_action_mode(value: Any, *, action_type: str, mutation_type: str) -> str:
    if action_type != MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        return ""
    text = str(value or "").strip().lower()
    if text:
        return text
    return _DEFAULT_ACTION_MODE_BY_MUTATION.get(mutation_type or DEFAULT_MUTATION_TYPE, "")


def _resolve_action_value(
    *,
    mutation_type: str,
    action_mode: str,
    base: Dict[str, Any],
    requested_action: Dict[str, Any],
    parameters: Dict[str, Any],
    metadata: Dict[str, Any],
) -> tuple[Any | None, str | None]:
    if mutation_type not in _SUPPORTED_MUTATION_TYPES:
        return None, None

    raw_value = _first_present_value(
        _action_value_keys_for(mutation_type=mutation_type, action_mode=action_mode),
        base,
        requested_action,
        parameters,
        metadata,
    )
    if raw_value is None:
        return None, None

    if mutation_type == "active_state":
        normalized_bool = _normalize_optional_bool(raw_value)
        if normalized_bool is None:
            return None, "active_state action_value must be a boolean-compatible value."
        return normalized_bool, None

    normalized_vector = _normalize_vector3_value(raw_value)
    if normalized_vector is None:
        return None, f"{mutation_type} action_value must resolve to exactly three numeric components."
    return normalized_vector, None


def _action_value_keys_for(*, mutation_type: str, action_mode: str) -> list[str]:
    if mutation_type == "active_state":
        return ["set_value", "action_value", "requested_value", "value", "target_value"]
    if action_mode == "offset":
        return ["offset_value", "action_value", "requested_value", "value", "target_value"]
    return ["absolute_value", "target_value", "action_value", "requested_value", "value"]


def _first_present_value(keys: list[str], *sources: Dict[str, Any]) -> Any | None:
    for key in keys:
        for source in sources:
            if key in source:
                return source.get(key)
    return None


def _normalize_vector3_value(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)):
        items = list(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = [part.strip() for part in text.split(",") if part.strip()]
        items = list(parsed) if isinstance(parsed, (list, tuple)) else []
    else:
        return None

    if len(items) != 3:
        return None

    normalized: list[float] = []
    for item in items:
        try:
            normalized.append(float(item))
        except (TypeError, ValueError):
            return None
    return normalized


def _expected_property_for_mutation_type(mutation_type: str) -> str:
    return _MUTATION_TYPE_TO_PROPERTY.get(mutation_type or DEFAULT_MUTATION_TYPE, DEFAULT_MUTATION_PROPERTY_CHANGED)


def _normalize_positive_int(*values: Any) -> int | None:
    for value in values:
        if value is None or value == "":
            continue
        try:
            parsed = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return None


def _normalize_optional_bool(*values: Any) -> bool | None:
    for value in values:
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            return value
        normalized = str(value).strip().lower()
        if normalized in {"true", "1", "yes", "y", "on"}:
            return True
        if normalized in {"false", "0", "no", "n", "off"}:
            return False
    return None


def _normalize_string_list(*values: Any) -> list[str]:
    for value in values:
        if value is None or value == "":
            continue
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        text = str(value).strip()
        if text:
            return [item.strip() for item in text.split(",") if item.strip()]
    return []


def _bool_cli_value(value: bool) -> str:
    return "true" if value else "false"


def _build_blocked_result_from_artifact(
    *,
    payload: Dict[str, Any],
    issue: str | None,
    normalized: Dict[str, Any],
    execution_id: str,
    result_path: Path,
    artifact_path: Path,
    log_path: Path,
    command: List[str],
    returncode: int | None,
    unity_exit_code: str,
    unity_exit_reason: str,
) -> Dict[str, Any] | None:
    if issue is not None or not isinstance(payload, dict) or not payload:
        return None

    action_type = str(payload.get("action_type") or normalized.get("action_type") or "")
    if action_type != MUTATE_EXISTING_OBJECT_ACTION_TYPE:
        return None

    policy_decision = str(payload.get("policy_decision") or "").strip().lower()
    mutation_allowed = payload.get("mutation_allowed")
    target_resolution_status = str(payload.get("target_resolution_status") or "").strip().lower()
    if policy_decision != "deny" and mutation_allowed is not False and target_resolution_status not in {"ambiguous", "invalid_request", "policy_blocked", "not_found"}:
        return None

    notes = [str(note).strip() for note in payload.get("notes", []) if isinstance(note, str) and str(note).strip()]
    if not notes:
        notes = [
            payload.get("message") or unity_exit_reason or "Mutation was blocked by preflight policy.",
            "No Unity scene mutation was applied.",
        ]

    scene_name = str(payload.get("scene_name") or payload.get("scene") or normalized.get("scene_name") or "")
    return _build_result(
        execution_id=execution_id,
        task_id=normalized["task_id"],
        action_type=normalized["action_type"],
        status="blocked",
        scene_name=scene_name,
        notes=notes,
        output_path=result_path,
        artifact_path=artifact_path,
        log_path=log_path,
        command=command,
        returncode=returncode,
        unity_exit_code=unity_exit_code,
        unity_exit_reason=unity_exit_reason,
        mutation_type=_resolve_mutation_type(payload, normalized),
        action_mode=_resolve_action_mode(payload, normalized),
        target_object_name=str(payload.get("target_object_name") or normalized.get("expected_target_object_name") or ""),
        property_changed=str(payload.get("property_changed") or normalized.get("expected_property_changed") or ""),
        before_value=payload.get("before_value"),
        after_value=payload.get("after_value"),
        baseline_value=payload.get("baseline_value"),
        mutated_value=payload.get("mutated_value"),
        restored_value=payload.get("restored_value"),
        rollback_status=payload.get("rollback_status"),
        resolved_file_id=payload.get("resolved_fileID"),
        resolved_transform_file_id=payload.get("resolved_transform_fileID"),
        resolution_mode_used=payload.get("resolution_mode_used"),
        policy_decision=payload.get("policy_decision"),
        mutation_allowed=payload.get("mutation_allowed"),
    )


__all__ = [
    "DEFAULT_UNITY_ACTION_TYPE",
    "DEFAULT_UNITY_EXECUTION_ROOT",
    "DEFAULT_MUTATION_PROPERTY_CHANGED",
    "DEFAULT_MUTATION_TARGET_OBJECT_NAME",
    "DEFAULT_MUTATION_TYPE",
    "DEFAULT_UNITY_OBJECT_NAME",
    "DEFAULT_UNITY_SCENE_NAME",
    "DEFAULT_UNITY_TIMEOUT_SECONDS",
    "MUTATE_EXISTING_OBJECT_ACTION_TYPE",
    "execute_unity_action",
]