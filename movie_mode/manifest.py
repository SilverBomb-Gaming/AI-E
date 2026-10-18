"""Pure, offline project manifest validation for SilverBomb Video Autopilot.

No subprocesses, model inference, filesystem writes, or network operations.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

CATEGORIES = frozenset({"movie", "tv_show", "music_video"})
SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ManifestError:
    field: str
    message: str


def validate_manifest(payload: Any) -> tuple[ManifestError, ...]:
    """Validate the minimum safe planning contract without executing any jobs."""
    errors: list[ManifestError] = []
    if not isinstance(payload, Mapping):
        return (ManifestError("$", "Manifest must be an object"),)

    if type(payload.get("schema_version")) is not int or payload["schema_version"] != SCHEMA_VERSION:
        errors.append(ManifestError("schema_version", "Expected integer schema version 1"))

    for field in ("project_id", "title"):
        value = payload.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(ManifestError(field, "Required non-empty string"))

    category = payload.get("category")
    if not isinstance(category, str) or category not in CATEGORIES:
        errors.append(ManifestError("category", "Expected movie, tv_show, or music_video"))

    scenes = payload.get("scenes")
    if not isinstance(scenes, list):
        errors.append(ManifestError("scenes", "Expected an array"))
        return tuple(errors)

    scene_ids: set[str] = set()
    shot_ids: set[str] = set()
    for i, scene in enumerate(scenes):
        prefix = f"scenes[{i}]"
        if not isinstance(scene, Mapping):
            errors.append(ManifestError(prefix, "Expected an object"))
            continue
        scene_id = scene.get("scene_id")
        if not isinstance(scene_id, str) or not scene_id.strip():
            errors.append(ManifestError(f"{prefix}.scene_id", "Required non-empty string"))
        elif scene_id in scene_ids:
            errors.append(ManifestError(f"{prefix}.scene_id", "Duplicate scene ID"))
        else:
            scene_ids.add(scene_id)
        shots = scene.get("shots")
        if not isinstance(shots, list):
            errors.append(ManifestError(f"{prefix}.shots", "Expected an array"))
            continue
        for j, shot in enumerate(shots):
            shot_path = f"{prefix}.shots[{j}]"
            if not isinstance(shot, Mapping):
                errors.append(ManifestError(shot_path, "Expected an object"))
                continue
            shot_id = shot.get("shot_id")
            if not isinstance(shot_id, str) or not shot_id.strip():
                errors.append(ManifestError(f"{shot_path}.shot_id", "Required non-empty string"))
            elif shot_id in shot_ids:
                errors.append(ManifestError(f"{shot_path}.shot_id", "Duplicate shot ID"))
            else:
                shot_ids.add(shot_id)
            duration = shot.get("duration_seconds")
            if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 < duration <= 600:
                errors.append(ManifestError(f"{shot_path}.duration_seconds", "Expected duration > 0 and <= 600 seconds"))
    return tuple(errors)
