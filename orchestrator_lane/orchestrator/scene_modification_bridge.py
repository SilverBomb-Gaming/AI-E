from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()


SUPPORTED_ACTION_TYPES = (
    "adjust_platform_height",
    "move_platform",
    "add_step_platform",
    "add_ramp",
    "align_gap_distance",
    "mark_unresolved_target",
)
MAX_SCENE_ACTIONS = 24
REQUIRED_CANONICAL_TASK_KEYS = {
    "task_id",
    "title",
    "description",
    "domain",
    "subdomain",
    "intent",
    "priority",
    "reason",
    "target_objects",
    "proposed_actions",
    "constraints",
    "expected_outcome",
    "source",
}
REQUIRED_SCENE_ACTION_KEYS = {
    "action_id",
    "task_id",
    "action_type",
    "target_objects",
    "parameters",
    "constraints",
    "expected_outcome",
    "source",
}


def translate_redesign_tasks_to_scene_actions(redesign_tasks: list[dict]) -> list[dict]:
    normalized_tasks = [dict(task) for task in redesign_tasks if isinstance(task, dict)]
    ordered_tasks = sorted(normalized_tasks, key=lambda task: (int(task.get("priority", 0) or 0), str(task.get("task_id") or "")))
    actions: list[dict] = []

    for task in ordered_tasks:
        task_actions = _translate_single_task(task)
        if len(actions) + len(task_actions) > MAX_SCENE_ACTIONS:
            raise ValueError(f"scene action count exceeds bounded limit of {MAX_SCENE_ACTIONS}")
        actions.extend(task_actions)

    return actions


def validate_scene_actions(actions: list[dict]) -> dict:
    errors: list[str] = []
    unsupported_task_ids: list[str] = []
    unresolved_action_count = 0

    if not isinstance(actions, list):
        return {
            "valid": False,
            "errors": ["actions must be a list."],
            "total_actions": 0,
            "supported_action_count": 0,
            "unresolved_action_count": 0,
            "unsupported_task_ids": [],
        }

    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            errors.append(f"action[{index}] must be a dict.")
            continue
        missing_keys = REQUIRED_SCENE_ACTION_KEYS.difference(action.keys())
        if missing_keys:
            errors.append(f"action[{index}] missing keys: {sorted(missing_keys)}")
        action_type = str(action.get("action_type") or "").strip()
        if action_type not in SUPPORTED_ACTION_TYPES:
            errors.append(f"action[{index}] has unsupported action_type: {action_type}")
        if not isinstance(action.get("target_objects"), list):
            errors.append(f"action[{index}] target_objects must be a list.")
        if not isinstance(action.get("parameters"), dict):
            errors.append(f"action[{index}] parameters must be a dict.")
        if not isinstance(action.get("constraints"), dict):
            errors.append(f"action[{index}] constraints must be a dict.")
        if not isinstance(action.get("expected_outcome"), list):
            errors.append(f"action[{index}] expected_outcome must be a list.")
        if str(action.get("source") or "") != "scene_modification_bridge":
            errors.append(f"action[{index}] source must be scene_modification_bridge.")

        if action_type == "mark_unresolved_target":
            unresolved_action_count += 1
            task_id = str(action.get("task_id") or "").strip()
            if task_id:
                unsupported_task_ids.append(task_id)

    return {
        "valid": not errors,
        "errors": errors,
        "total_actions": len(actions),
        "supported_action_count": len(actions) - unresolved_action_count,
        "unresolved_action_count": unresolved_action_count,
        "unsupported_task_ids": sorted(set(unsupported_task_ids)),
    }


def build_scene_action_plan(report: dict) -> dict:
    redesign = dict(report.get("redesign") or {}) if isinstance(report, dict) else {}
    redesign_tasks = redesign.get("tasks")
    if not isinstance(redesign_tasks, list):
        redesign_tasks = []

    actions = translate_redesign_tasks_to_scene_actions([dict(task) for task in redesign_tasks if isinstance(task, dict)])
    validation = validate_scene_actions(actions)
    return {
        "source": "scene_modification_bridge",
        "playability_status": str(report.get("playability_status") or "") if isinstance(report, dict) else "",
        "redesign_task_count": len(redesign_tasks),
        "action_count": len(actions),
        "actions": actions,
        "validation": validation,
    }


def _translate_single_task(task: dict) -> list[dict]:
    canonical_errors = _canonical_task_errors(task)
    if canonical_errors:
        return [_mark_unresolved_target(task, reason_code="invalid_canonical_task", notes=canonical_errors)]

    intent = str(task.get("intent") or "").strip().lower()
    subdomain = str(task.get("subdomain") or "").strip().lower()
    metadata = _primary_action_metadata(task)
    scene_targets = _scene_targets(task)

    if intent == "design_traversal" or subdomain == "traversal_design":
        return [_build_traversal_action(task, scene_targets, metadata)]
    if intent == "extend_map" or subdomain == "level_layout":
        return [_build_layout_action(task, scene_targets, metadata)]
    if intent == "refine_flow" or subdomain == "gameplay_flow":
        return [_mark_unresolved_target(task, reason_code="non_structural_redesign_intent")]
    return [_mark_unresolved_target(task, reason_code="unsupported_redesign_intent")]


def _build_traversal_action(task: dict, scene_targets: list[str], metadata: dict) -> dict:
    variant_index = int(metadata["variant_index"] or 0)
    if variant_index == 2:
        action_type = "add_ramp"
        parameters = {
            "anchor_mode": "adjacent_to_targets",
            "ramp_length": 2.5,
            "ramp_slope_ratio": 0.5,
            "variant_index": variant_index,
        }
    elif variant_index == 3:
        action_type = "align_gap_distance"
        parameters = {
            "alignment_mode": "shorten_gap",
            "gap_delta": -0.5,
            "variant_index": variant_index,
        }
    else:
        action_type = "add_step_platform"
        parameters = {
            "anchor_mode": "adjacent_to_targets",
            "step_count": 2,
            "step_height": 0.6,
            "variant_index": variant_index,
        }

    return _build_scene_action(
        task=task,
        action_type=action_type,
        target_objects=scene_targets,
        parameters=parameters,
    )


def _build_layout_action(task: dict, scene_targets: list[str], metadata: dict) -> dict:
    variant_index = int(metadata["variant_index"] or 0)
    if variant_index == 2:
        action_type = "move_platform"
        parameters = {
            "translation": {"x": 0.0, "y": 0.0, "z": -0.5},
            "movement_mode": "incremental",
            "variant_index": variant_index,
        }
    elif variant_index == 3:
        action_type = "align_gap_distance"
        parameters = {
            "alignment_mode": "close_horizontal_gap",
            "gap_delta": -0.5,
            "variant_index": variant_index,
        }
    else:
        action_type = "adjust_platform_height"
        parameters = {
            "delta_y": -0.8,
            "height_mode": "lower_surface",
            "variant_index": variant_index,
        }

    return _build_scene_action(
        task=task,
        action_type=action_type,
        target_objects=scene_targets,
        parameters=parameters,
    )


def _build_scene_action(task: dict, action_type: str, target_objects: list[str], parameters: dict) -> dict:
    return {
        "action_id": _scene_action_id(str(task.get("task_id") or ""), action_type),
        "task_id": str(task.get("task_id") or ""),
        "action_type": action_type,
        "target_objects": list(target_objects),
        "parameters": dict(parameters),
        "constraints": dict(task.get("constraints") or {}),
        "expected_outcome": [str(item).strip() for item in task.get("expected_outcome", []) if str(item).strip()],
        "source": "scene_modification_bridge",
    }


def _mark_unresolved_target(task: dict, reason_code: str, notes: list[str] | None = None) -> dict:
    unresolved_notes = [str(note).strip() for note in (notes or []) if str(note).strip()]
    parameters = {
        "reason_code": reason_code,
        "notes": unresolved_notes,
        "requested_intent": str(task.get("intent") or ""),
        "requested_subdomain": str(task.get("subdomain") or ""),
    }
    return _build_scene_action(
        task=task,
        action_type="mark_unresolved_target",
        target_objects=_scene_targets(task),
        parameters=parameters,
    )


def _scene_targets(task: dict) -> list[str]:
    raw_targets = task.get("target_objects")
    if not isinstance(raw_targets, list):
        return ["level_layout"]
    scene_targets = [str(target).strip() for target in raw_targets if str(target).strip().startswith("Arena_")]
    if scene_targets:
        return scene_targets
    fallback_targets = [str(target).strip() for target in raw_targets if str(target).strip()]
    return fallback_targets or ["level_layout"]


def _primary_action_metadata(task: dict) -> dict:
    proposed_actions = task.get("proposed_actions")
    if not isinstance(proposed_actions, list):
        return {
            "compare_group": "",
            "selection_required": False,
            "variant_index": 0,
            "total_variations": 0,
        }
    for action in proposed_actions:
        if not isinstance(action, dict):
            continue
        return {
            "compare_group": str(action.get("compare_group") or "").strip(),
            "selection_required": bool(action.get("selection_required", False)),
            "variant_index": int(action.get("variant_index", 0) or 0),
            "total_variations": int(action.get("total_variations", 0) or 0),
        }
    return {
        "compare_group": "",
        "selection_required": False,
        "variant_index": 0,
        "total_variations": 0,
    }


def _canonical_task_errors(task: dict) -> list[str]:
    if not isinstance(task, dict):
        return ["canonical redesign task must be a dict."]

    errors: list[str] = []
    missing_keys = REQUIRED_CANONICAL_TASK_KEYS.difference(task.keys())
    if missing_keys:
        errors.append(f"missing keys: {sorted(missing_keys)}")
    if str(task.get("domain") or "") != "game_design":
        errors.append("domain must equal game_design")
    if str(task.get("source") or "") != "playability_report.redesign":
        errors.append("source must equal playability_report.redesign")
    if not isinstance(task.get("reason"), list):
        errors.append("reason must be a list")
    if not isinstance(task.get("target_objects"), list):
        errors.append("target_objects must be a list")
    if not isinstance(task.get("proposed_actions"), list):
        errors.append("proposed_actions must be a list")
    if not isinstance(task.get("constraints"), dict):
        errors.append("constraints must be a dict")
    if not isinstance(task.get("expected_outcome"), list):
        errors.append("expected_outcome must be a list")
    return errors


def _scene_action_id(task_id: str, action_type: str) -> str:
    return f"{task_id}__{action_type}"