from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from orchestrator.utils import ensure_dir, read_json, write_json


SUPPORTED_PLATFORMER_LAYOUT_OBJECT_TYPES = {
    "platform",
    "ladder",
    "elevator",
    "obstacle_cluster",
    "enemy_spawn_anchor",
    "collectible_anchor",
}

SUPPORTED_PLATFORMER_LAYOUT_EDIT_ACTIONS = {
    "move",
    "nudge",
    "reposition",
}

_PROJECT_LOCAL_ROOT = "AIE_Local"
_CORRECTIONS_ROOT = "platformer_corrections"


def extract_platformer_layout_correction_metadata(details: Dict[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(details, dict):
        return {}

    target_context = str(details.get("target_context") or details.get("target_entity") or "").strip().lower()
    corrections = _normalized_corrections(details.get("layout_corrections") or details.get("corrections"))
    corrected_layout = details.get("corrected_layout") if isinstance(details.get("corrected_layout"), dict) else {}
    derived_from_corrected_layout = bool(details.get("derived_from_corrected_layout"))
    if target_context != "platformer":
        return {}
    if not corrections and not corrected_layout and not derived_from_corrected_layout:
        return {}

    manual_edit_mode = _manual_edit_mode(details.get("manual_edit_mode") or details.get("input_method") or "")
    layout_id = _slug(str(details.get("layout_id") or "platformer_layout")) or "platformer_layout"
    layout_name = str(details.get("layout_name") or layout_id.replace("_", " ")).strip() or "platformer layout"
    correction_count = len(corrections)
    editable_object_types = sorted(
        {
            str(item.get("object_type") or "").strip()
            for item in corrections
            if str(item.get("object_type") or "").strip()
        }
    )
    correction_summary = _correction_summary(
        layout_name=layout_name,
        correction_count=correction_count,
        manual_edit_mode=manual_edit_mode,
        derived_from_corrected_layout=derived_from_corrected_layout,
    )

    return {
        "layout_id": layout_id,
        "layout_name": layout_name,
        "manual_edit_mode": manual_edit_mode,
        "layout_correction_count": correction_count,
        "layout_correction_summary": correction_summary,
        "editable_object_types": editable_object_types,
        "layout_corrections": corrections,
        "corrected_layout": dict(corrected_layout),
        "corrected_layout_available": bool(corrected_layout),
        "derived_from_corrected_layout": derived_from_corrected_layout,
        "derived_from_correction_artifact_path": str(details.get("derived_from_correction_artifact_path") or "").strip(),
        "correction_notes": str(details.get("correction_notes") or details.get("edit_summary") or "").strip(),
        "layout_correction_artifact_path": str(details.get("layout_correction_artifact_path") or "").strip(),
        "layout_correction_history_path": str(details.get("layout_correction_history_path") or "").strip(),
        "corrected_layout_artifact_path": str(details.get("corrected_layout_artifact_path") or "").strip(),
    }


def persist_platformer_layout_correction_result(
    *,
    task: Dict[str, Any],
    result: Dict[str, Any],
    timestamp: str,
) -> Dict[str, Any]:
    if not isinstance(result, dict):
        return result

    details = result.get("details") if isinstance(result.get("details"), dict) else {}
    metadata = extract_platformer_layout_correction_metadata(details)
    if not metadata:
        return result

    target_repo_text = str(task.get("target_repo") or "").strip()
    target_repo = Path(target_repo_text) if target_repo_text else None
    if target_repo is None or not target_repo.exists():
        return result

    correction_paths = _persist_project_local_artifacts(
        target_repo=target_repo,
        task=task,
        metadata=metadata,
        timestamp=timestamp,
    )

    updated_details = dict(details)
    updated_details["timestamp"] = str(details.get("timestamp") or timestamp).strip()
    updated_details["target_context"] = "platformer"
    updated_details["manual_edit_mode"] = metadata["manual_edit_mode"]
    updated_details["layout_id"] = metadata["layout_id"]
    updated_details["layout_name"] = metadata["layout_name"]
    updated_details["layout_correction_count"] = metadata["layout_correction_count"]
    updated_details["layout_correction_summary"] = metadata["layout_correction_summary"]
    updated_details["editable_object_types"] = list(metadata["editable_object_types"])
    updated_details["layout_corrections"] = [dict(item) for item in metadata["layout_corrections"]]
    updated_details["corrected_layout"] = dict(metadata["corrected_layout"])
    updated_details["corrected_layout_available"] = bool(metadata["corrected_layout_available"])
    updated_details["derived_from_corrected_layout"] = bool(metadata["derived_from_corrected_layout"])
    updated_details["derived_from_correction_artifact_path"] = metadata["derived_from_correction_artifact_path"]
    updated_details["layout_correction_artifact_path"] = correction_paths["layout_correction_artifact_path"]
    updated_details["layout_correction_history_path"] = correction_paths["layout_correction_history_path"]
    updated_details["corrected_layout_artifact_path"] = correction_paths["corrected_layout_artifact_path"]

    updated_result = dict(result)
    updated_result["details"] = updated_details
    return updated_result


def merge_platformer_layout_correction_payload(
    details: Dict[str, Any] | None,
    *,
    payload_path_value: str | Path | None,
    base_dir: str | Path | None = None,
) -> tuple[Dict[str, Any], str]:
    merged_details = dict(details or {})
    payload_path = _resolve_payload_path(payload_path_value, base_dir=base_dir)
    if payload_path is None:
        return merged_details, "platformer layout correction payload path was not provided"
    merged_details["unity_layout_correction_payload_path"] = str(payload_path)
    if not payload_path.exists():
        return merged_details, f"platformer layout correction payload does not exist: {payload_path}"

    raw_payload = read_json(payload_path, default={})
    if not isinstance(raw_payload, dict) or not raw_payload:
        return merged_details, f"platformer layout correction payload is unreadable: {payload_path}"

    payload = dict(raw_payload.get("platformer_layout_correction") or raw_payload)
    if str(payload.get("target_context") or "").strip().lower() != "platformer":
        return merged_details, f"platformer layout correction payload target_context must be 'platformer': {payload_path}"

    corrections = payload.get("layout_corrections")
    if not isinstance(corrections, list):
        corrections = payload.get("corrections") if isinstance(payload.get("corrections"), list) else []

    corrected_layout = payload.get("corrected_layout") if isinstance(payload.get("corrected_layout"), dict) else {}
    payload["target_context"] = "platformer"
    payload["layout_corrections"] = list(corrections)
    payload["corrections"] = list(corrections)
    payload["corrected_layout"] = dict(corrected_layout)
    payload["manual_edit_mode"] = str(payload.get("manual_edit_mode") or "keyboard_mouse").strip() or "keyboard_mouse"
    payload["unity_layout_correction_payload_path"] = str(payload_path)

    merged_details.update(payload)
    return merged_details, ""


def apply_platformer_layout_correction_record(
    state: Dict[str, Any],
    *,
    task: Dict[str, Any],
    details: Dict[str, Any],
    timestamp: str,
) -> Dict[str, Any]:
    metadata = extract_platformer_layout_correction_metadata(details)
    if not metadata:
        return state

    entry = {
        "timestamp": str(timestamp or details.get("timestamp") or "").strip(),
        "task_id": str(task.get("task_id") or "").strip(),
        "request_id": str(task.get("request_id") or "").strip(),
        "plan_id": str(task.get("plan_id") or "").strip(),
        "target_repo": str(task.get("target_repo") or "").strip(),
        "layout_id": metadata["layout_id"],
        "layout_name": metadata["layout_name"],
        "manual_edit_mode": metadata["manual_edit_mode"],
        "layout_correction_count": metadata["layout_correction_count"],
        "layout_correction_summary": metadata["layout_correction_summary"],
        "editable_object_types": list(metadata["editable_object_types"]),
        "derived_from_corrected_layout": bool(metadata["derived_from_corrected_layout"]),
        "layout_correction_artifact_path": metadata["layout_correction_artifact_path"],
        "layout_correction_history_path": metadata["layout_correction_history_path"],
        "corrected_layout_artifact_path": metadata["corrected_layout_artifact_path"],
        "derived_from_correction_artifact_path": metadata["derived_from_correction_artifact_path"],
    }
    history = list(state.get("platformer_layout_correction_history", []))
    history.append(entry)
    state["platformer_layout_correction_history"] = history
    state["latest_platformer_layout_correction"] = dict(entry)
    return state


def _persist_project_local_artifacts(
    *,
    target_repo: Path,
    task: Dict[str, Any],
    metadata: Dict[str, Any],
    timestamp: str,
) -> Dict[str, str]:
    correction_root = ensure_dir(target_repo / _PROJECT_LOCAL_ROOT / _CORRECTIONS_ROOT)
    layout_slug = _slug(str(metadata.get("layout_id") or "platformer_layout")) or "platformer_layout"
    records_dir = ensure_dir(correction_root / "records" / layout_slug)
    layouts_dir = ensure_dir(correction_root / "layouts" / layout_slug)
    history_path = correction_root / "history.json"
    record_id = "_".join(
        filter(
            None,
            [
                _timestamp_slug(timestamp),
                _short_token(str(task.get("task_id") or "")),
            ],
        )
    ) or _timestamp_slug(timestamp)
    correction_record_path = records_dir / f"{record_id}.json"

    corrected_layout_artifact_path = ""
    corrected_layout = metadata.get("corrected_layout") if isinstance(metadata.get("corrected_layout"), dict) else {}
    if corrected_layout:
        corrected_layout_path = layouts_dir / f"{record_id}.json"
        corrected_layout_latest_path = layouts_dir / "latest.json"
        corrected_layout_payload = {
            "schema_version": 1,
            "timestamp": str(timestamp or "").strip(),
            "layout_id": metadata["layout_id"],
            "layout_name": metadata["layout_name"],
            "task_id": str(task.get("task_id") or "").strip(),
            "request_id": str(task.get("request_id") or "").strip(),
            "corrected_layout": dict(corrected_layout),
        }
        write_json(corrected_layout_path, corrected_layout_payload)
        write_json(corrected_layout_latest_path, corrected_layout_payload)
        corrected_layout_artifact_path = str(corrected_layout_path.resolve())

    correction_payload = {
        "schema_version": 1,
        "timestamp": str(timestamp or "").strip(),
        "task_id": str(task.get("task_id") or "").strip(),
        "request_id": str(task.get("request_id") or "").strip(),
        "plan_id": str(task.get("plan_id") or "").strip(),
        "target_context": "platformer",
        "manual_edit_mode": metadata["manual_edit_mode"],
        "manual_only": True,
        "autonomous_geometry_edits_allowed": False,
        "layout_id": metadata["layout_id"],
        "layout_name": metadata["layout_name"],
        "layout_correction_count": metadata["layout_correction_count"],
        "editable_object_types": list(metadata["editable_object_types"]),
        "layout_corrections": [dict(item) for item in metadata["layout_corrections"]],
        "correction_notes": str(metadata.get("correction_notes") or "").strip(),
        "derived_from_corrected_layout": bool(metadata["derived_from_corrected_layout"]),
        "derived_from_correction_artifact_path": str(metadata.get("derived_from_correction_artifact_path") or "").strip(),
        "corrected_layout_artifact_path": corrected_layout_artifact_path,
    }
    write_json(correction_record_path, correction_payload)

    history_payload = read_json(history_path, default={})
    if not isinstance(history_payload, dict):
        history_payload = {}
    history_entries = history_payload.get("corrections") if isinstance(history_payload.get("corrections"), list) else []
    history_entries = [dict(item) for item in history_entries if isinstance(item, dict)]
    history_entry = {
        "timestamp": str(timestamp or "").strip(),
        "task_id": str(task.get("task_id") or "").strip(),
        "request_id": str(task.get("request_id") or "").strip(),
        "layout_id": metadata["layout_id"],
        "layout_name": metadata["layout_name"],
        "manual_edit_mode": metadata["manual_edit_mode"],
        "layout_correction_count": metadata["layout_correction_count"],
        "layout_correction_summary": metadata["layout_correction_summary"],
        "editable_object_types": list(metadata["editable_object_types"]),
        "derived_from_corrected_layout": bool(metadata["derived_from_corrected_layout"]),
        "layout_correction_artifact_path": str(correction_record_path.resolve()),
        "corrected_layout_artifact_path": corrected_layout_artifact_path,
    }
    history_entries.append(history_entry)
    history_payload["schema_version"] = 1
    history_payload["updated_at"] = str(timestamp or "").strip()
    history_payload["corrections"] = history_entries
    history_payload["latest"] = dict(history_entry)
    write_json(history_path, history_payload)

    return {
        "layout_correction_artifact_path": str(correction_record_path.resolve()),
        "layout_correction_history_path": str(history_path.resolve()),
        "corrected_layout_artifact_path": corrected_layout_artifact_path,
    }


def _normalized_corrections(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        object_id = str(item.get("object_id") or "").strip()
        object_type = _slug(str(item.get("object_type") or ""))
        if not object_id or object_type not in SUPPORTED_PLATFORMER_LAYOUT_OBJECT_TYPES:
            continue
        action = _slug(str(item.get("action") or item.get("edit_action") or "move")) or "move"
        if action not in SUPPORTED_PLATFORMER_LAYOUT_EDIT_ACTIONS:
            continue
        original_position = _vector3(item.get("original_position") or item.get("previous_position"))
        corrected_position = _vector3(item.get("corrected_position") or item.get("new_position"))
        if original_position is None or corrected_position is None:
            continue
        normalized.append(
            {
                "object_id": object_id,
                "object_type": object_type,
                "action": action,
                "original_position": original_position,
                "corrected_position": corrected_position,
                "delta": _vector_delta(original_position, corrected_position),
                "note": str(item.get("note") or item.get("correction_note") or "").strip(),
            }
        )
    return normalized


def _vector3(value: Any) -> List[float] | None:
    if not isinstance(value, list) or len(value) < 3:
        return None
    vector: List[float] = []
    for item in value[:3]:
        try:
            vector.append(float(item))
        except (TypeError, ValueError):
            return None
    return vector


def _vector_delta(left: List[float], right: List[float]) -> List[float]:
    return [round(float(right[index]) - float(left[index]), 4) for index in range(3)]


def _manual_edit_mode(value: Any) -> str:
    normalized = _slug(str(value or ""))
    if normalized in {"keyboard_mouse", "kbm", "mouse_keyboard"}:
        return "keyboard_mouse"
    return "keyboard_mouse"


def _manual_edit_mode_display(value: str) -> str:
    if value == "keyboard_mouse":
        return "keyboard/mouse"
    return value.replace("_", "/")


def _correction_summary(
    *,
    layout_name: str,
    correction_count: int,
    manual_edit_mode: str,
    derived_from_corrected_layout: bool,
) -> str:
    mode_display = _manual_edit_mode_display(manual_edit_mode)
    if correction_count > 0:
        return f"{correction_count} manual {mode_display} correction(s) saved for {layout_name}."
    if derived_from_corrected_layout:
        return f"{layout_name} remains derived from a previously corrected layout."
    return f"Corrected layout snapshot saved for {layout_name}."


def _slug(value: str) -> str:
    chars: List[str] = []
    previous_was_separator = False
    for raw_char in str(value or "").strip().lower():
        if raw_char.isalnum():
            chars.append(raw_char)
            previous_was_separator = False
            continue
        if previous_was_separator:
            continue
        chars.append("_")
        previous_was_separator = True
    return "".join(chars).strip("_")


def _timestamp_slug(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "timestamp"
    digits = "".join(character for character in text if character.isdigit())
    if len(digits) >= 14:
        return digits[:14]
    slug = _slug(text)
    if not slug:
        return "timestamp"
    return slug[:14]


def _short_token(value: str) -> str:
    token = _slug(value)
    if not token:
        return "task"
    return token[:12]


def _resolve_payload_path(value: str | Path | None, base_dir: str | Path | None = None) -> Path | None:
    if not value:
        return None
    path = Path(str(value))
    if path.is_absolute():
        return path
    if base_dir:
        return (Path(str(base_dir)) / path).resolve()
    return path.resolve()


__all__ = [
    "SUPPORTED_PLATFORMER_LAYOUT_EDIT_ACTIONS",
    "SUPPORTED_PLATFORMER_LAYOUT_OBJECT_TYPES",
    "apply_platformer_layout_correction_record",
    "extract_platformer_layout_correction_metadata",
    "merge_platformer_layout_correction_payload",
    "persist_platformer_layout_correction_result",
]