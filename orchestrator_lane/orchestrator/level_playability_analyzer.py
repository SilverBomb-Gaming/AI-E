from __future__ import annotations

import json
import math
import re
from pathlib import Path

from .game_design_task_pack import build_game_design_tasks
from .utils import read_json


def analyze_level_playability(level_data: dict, player_capabilities: dict) -> dict:
    normalized_level = _normalize_level_data(level_data)
    normalized_player = _normalize_player_capabilities(player_capabilities)
    movement_profile = _movement_profile(normalized_player)
    issues_found: list[str] = []
    unreachable_areas: list[dict] = []
    jump_failures: list[dict] = []
    recommendations: list[str] = []
    reachable_platforms: list[str] = []

    ground = normalized_level.get("ground") or {}
    spawn = normalized_level.get("player_spawn") or {}
    walls = normalized_level.get("walls") or []
    platforms = normalized_level.get("platforms") or []

    spawn_on_ground = _point_within_surface(spawn, ground)
    if not spawn_on_ground:
        issues_found.append("Player spawn is not positioned on a traversable ground surface.")

    wall_clearance_issue = _wall_clearance_issue(spawn, walls, normalized_player)
    if wall_clearance_issue:
        issues_found.append(wall_clearance_issue)

    for platform in platforms:
        reachability = _analyze_platform_reachability(platform, ground, movement_profile)
        if reachability["reachable"]:
            reachable_platforms.append(str(platform.get("name") or "platform"))
            continue

        unreachable_areas.append(
            {
                "area_id": str(platform.get("name") or "platform"),
                "reason": reachability["reason"],
                "height_delta": round(reachability["height_delta"], 3),
                "horizontal_gap": round(reachability["horizontal_gap"], 3),
            }
        )
        jump_failures.append(
            {
                "from": "ground",
                "to": str(platform.get("name") or "platform"),
                "required_height": round(reachability["height_delta"], 3),
                "max_jump_height": round(movement_profile["max_jump_height"], 3),
                "required_gap": round(reachability["horizontal_gap"], 3),
                "max_jump_distance": round(movement_profile["max_jump_distance"], 3),
            }
        )
        issues_found.append(f"{platform.get('name')}: {reachability['reason']}")

    traversal_continuity = spawn_on_ground and not unreachable_areas
    progression_breaks = [] if traversal_continuity else ["Required traversal chain is broken by unreachable layout elements."]
    movement_mismatch = []
    if unreachable_areas:
        movement_mismatch.append("Layout demands exceed the current jump or traversal envelope.")
    if wall_clearance_issue:
        movement_mismatch.append("Spawn clearance is too tight for reliable player navigation.")
    issues_found.extend(progression_breaks)
    issues_found.extend(movement_mismatch)

    if spawn_on_ground and not unreachable_areas:
        recommendations.extend(
            [
                "Preserve the current arena ground continuity and spawn placement.",
                "Retain platform height within the current jump envelope when extending the level.",
                "Run one manual play-mode traversal pass to confirm the heuristic result.",
            ]
        )
    else:
        recommendations.extend(
            [
                "Reduce traversal gaps or lower target surfaces to fit the current jump envelope.",
                "Keep the player spawn fully inside clear navigable space with margin from walls.",
                "Prefer structural traversal fixes before encounter or theme iteration.",
            ]
        )

    playable = spawn_on_ground and not unreachable_areas and not progression_breaks and not wall_clearance_issue
    redesign_required = not playable
    redesign_output = _redesign_output(unreachable_areas, jump_failures, movement_mismatch) if redesign_required else {}

    return {
        "playable": playable,
        "playability_status": _playability_status(playable=playable, unreachable_areas=unreachable_areas, progression_breaks=progression_breaks),
        "issues_found": issues_found,
        "reachable_platforms": reachable_platforms,
        "unreachable_areas": unreachable_areas,
        "jump_failures": jump_failures,
        "traversal_continuity": traversal_continuity,
        "progression_breaks": progression_breaks,
        "movement_mismatch": movement_mismatch,
        "redesign_required": redesign_required,
        "recommendations": recommendations,
        **redesign_output,
    }


def analyze_first_validation_target() -> dict:
    workspace_root = Path(__file__).resolve().parents[3]
    scene_path = workspace_root / "BABYLON VER 2" / "Assets" / "AI_E_TestScenes" / "MinimalPlayableArena.unity"
    player_controller_path = workspace_root / "BABYLON VER 2" / "Assets" / "_LEGACY_DO_NOT_TOUCH" / "Scripts" / "PlayerController.cs"
    stabilization_report_path = workspace_root / "BABYLON VER 2" / "docs" / "LEVEL_0001_STABILIZATION_REPORT_2026-03-16.json"

    level_data = extract_level_data_from_unity_scene(scene_path)
    player_capabilities = extract_player_capabilities_from_controller(player_controller_path)
    analysis = analyze_level_playability(level_data, player_capabilities)

    return {
        "validation_target": {
            "scene_path": str(scene_path),
            "player_controller_path": str(player_controller_path),
            "stabilization_report_path": str(stabilization_report_path),
        },
        "level_data": level_data,
        "player_capabilities": player_capabilities,
        "stabilization_report_summary": _stabilization_report_summary(stabilization_report_path),
        "analysis": analysis,
    }


def extract_level_data_from_unity_scene(scene_path: Path) -> dict:
    scene_text = scene_path.read_text(encoding="utf-8")
    game_objects, transforms = _parse_scene_objects(scene_text)

    named_objects: dict[str, dict] = {}
    for game_object_id, name in game_objects.items():
        transform = transforms.get(game_object_id)
        if transform is None:
            continue
        named_objects[name] = {
            "name": name,
            "position": dict(transform["position"]),
            "scale": dict(transform["scale"]),
        }

    ground = _build_ground_surface(named_objects.get("Arena_Ground"))
    return {
        "player_spawn": dict(named_objects.get("PlayerSpawn", {}).get("position", {})),
        "ground": ground,
        "platforms": [
            _build_platform_surface(named_objects[name])
            for name in sorted(named_objects)
            if name.startswith("Arena_Cover_Block_")
        ],
        "walls": [
            _build_wall_surface(named_objects[name])
            for name in sorted(named_objects)
            if name.endswith("Wall")
        ],
    }


def extract_player_capabilities_from_controller(controller_path: Path) -> dict:
    controller_text = controller_path.read_text(encoding="utf-8")
    return {
        "move_speed": _extract_float(controller_text, r"public float moveSpeed = ([0-9.]+)f;", default=5.0),
        "sprint_multiplier": _extract_float(controller_text, r"public float sprintMultiplier = ([0-9.]+)f;", default=1.5),
        "jump_height": _extract_float(controller_text, r"public float jumpHeight = ([0-9.]+)f;", default=1.2),
        "gravity": _extract_float(controller_text, r"public float gravity = (-?[0-9.]+)f;", default=-9.81),
        "controller_radius": 0.35,
        "max_step_height": 0.3,
        "movement_model": "character_controller_heuristic_v1",
    }


def _normalize_level_data(level_data: dict) -> dict:
    return {
        "player_spawn": dict(level_data.get("player_spawn") or {}),
        "ground": dict(level_data.get("ground") or {}),
        "platforms": [dict(item) for item in level_data.get("platforms", []) if isinstance(item, dict)],
        "walls": [dict(item) for item in level_data.get("walls", []) if isinstance(item, dict)],
    }


def _normalize_player_capabilities(player_capabilities: dict) -> dict:
    return {
        "move_speed": float(player_capabilities.get("move_speed", 5.0) or 5.0),
        "sprint_multiplier": float(player_capabilities.get("sprint_multiplier", 1.5) or 1.5),
        "jump_height": float(player_capabilities.get("jump_height", 1.2) or 1.2),
        "gravity": float(player_capabilities.get("gravity", -9.81) or -9.81),
        "controller_radius": float(player_capabilities.get("controller_radius", 0.35) or 0.35),
        "max_step_height": float(player_capabilities.get("max_step_height", 0.3) or 0.3),
    }


def _movement_profile(player_capabilities: dict) -> dict:
    jump_height = max(0.0, float(player_capabilities["jump_height"]))
    gravity = abs(float(player_capabilities["gravity"])) or 9.81
    vertical_velocity = math.sqrt(max(0.0, 2.0 * gravity * jump_height))
    air_time = 0.0 if gravity == 0 else (2.0 * vertical_velocity) / gravity
    max_horizontal_speed = float(player_capabilities["move_speed"]) * float(player_capabilities["sprint_multiplier"])
    return {
        "max_jump_height": jump_height,
        "max_jump_distance": max_horizontal_speed * air_time,
        "max_step_height": float(player_capabilities["max_step_height"]),
    }


def _point_within_surface(point: dict, surface: dict) -> bool:
    if not point or not surface:
        return False
    half_width = float(surface.get("width", 0.0)) / 2.0
    half_depth = float(surface.get("depth", 0.0)) / 2.0
    surface_top = float(surface.get("top_y", 0.0))
    return (
        abs(float(point.get("x", 0.0)) - float(surface.get("center_x", 0.0))) <= half_width
        and abs(float(point.get("z", 0.0)) - float(surface.get("center_z", 0.0))) <= half_depth
        and abs(float(point.get("y", 0.0)) - surface_top) <= 1.5
    )


def _wall_clearance_issue(spawn: dict, walls: list[dict], player_capabilities: dict) -> str:
    if not spawn:
        return "Player spawn is missing from the level data."
    if not walls:
        return ""

    required_clearance = float(player_capabilities.get("controller_radius", 0.35)) + 0.25
    x = float(spawn.get("x", 0.0))
    z = float(spawn.get("z", 0.0))
    closest_clearance = None

    for wall in walls:
        clearance = _distance_to_wall(x=x, z=z, wall=wall)
        if closest_clearance is None or clearance < closest_clearance:
            closest_clearance = clearance

    if closest_clearance is not None and closest_clearance < required_clearance:
        return f"Player spawn clearance is too close to a wall for stable traversal: {closest_clearance:.3f}m."
    return ""


def _analyze_platform_reachability(platform: dict, ground: dict, movement_profile: dict) -> dict:
    platform_top = float(platform.get("top_y", 0.0))
    ground_top = float(ground.get("top_y", 0.0))
    height_delta = max(0.0, platform_top - ground_top)
    horizontal_gap = 0.0 if _surface_overlaps_ground(platform, ground) else _gap_from_ground(platform, ground)

    if height_delta <= float(movement_profile["max_step_height"]) and horizontal_gap <= 0.5:
        return {"reachable": True, "reason": "walkable_step", "height_delta": height_delta, "horizontal_gap": horizontal_gap}
    if height_delta <= float(movement_profile["max_jump_height"]) and horizontal_gap <= float(movement_profile["max_jump_distance"]):
        return {"reachable": True, "reason": "jump_reachable", "height_delta": height_delta, "horizontal_gap": horizontal_gap}
    if not _surface_overlaps_ground(platform, ground):
        return {"reachable": False, "reason": "platform is isolated from the main traversable floor.", "height_delta": height_delta, "horizontal_gap": horizontal_gap}
    return {"reachable": False, "reason": "platform top exceeds the current movement envelope.", "height_delta": height_delta, "horizontal_gap": horizontal_gap}


def _surface_overlaps_ground(surface: dict, ground: dict) -> bool:
    if not surface or not ground:
        return False
    return _surface_within_ground_bounds(surface, ground)


def _surface_within_ground_bounds(surface: dict, ground: dict) -> bool:
    half_width = float(ground.get("width", 0.0)) / 2.0
    half_depth = float(ground.get("depth", 0.0)) / 2.0
    surface_half_width = float(surface.get("width", 0.0)) / 2.0
    surface_half_depth = float(surface.get("depth", 0.0)) / 2.0
    center_x = float(surface.get("center_x", 0.0))
    center_z = float(surface.get("center_z", 0.0))
    return (
        center_x - surface_half_width >= float(ground.get("center_x", 0.0)) - half_width
        and center_x + surface_half_width <= float(ground.get("center_x", 0.0)) + half_width
        and center_z - surface_half_depth >= float(ground.get("center_z", 0.0)) - half_depth
        and center_z + surface_half_depth <= float(ground.get("center_z", 0.0)) + half_depth
    )


def _gap_from_ground(surface: dict, ground: dict) -> float:
    if _surface_within_ground_bounds(surface, ground):
        return 0.0
    half_width = float(ground.get("width", 0.0)) / 2.0
    half_depth = float(ground.get("depth", 0.0)) / 2.0
    dx = max(0.0, abs(float(surface.get("center_x", 0.0)) - float(ground.get("center_x", 0.0))) - half_width)
    dz = max(0.0, abs(float(surface.get("center_z", 0.0)) - float(ground.get("center_z", 0.0))) - half_depth)
    return math.hypot(dx, dz)


def _playability_status(*, playable: bool, unreachable_areas: list[dict], progression_breaks: list[str]) -> str:
    if playable:
        return "structurally_valid"
    if unreachable_areas or progression_breaks:
        return "partially_broken"
    return "not_realistically_playable"


def _redesign_output(unreachable_areas: list[dict], jump_failures: list[dict], movement_mismatch: list[str]) -> dict:
    redesign_tasks: list[dict] = []
    for prompt in _redesign_prompts(unreachable_areas, jump_failures, movement_mismatch):
        redesign_tasks.extend(build_game_design_tasks(prompt))
    return {
        "redesigned_layout_tasks": redesign_tasks,
        "redesign_rationale": _redesign_rationale(unreachable_areas, jump_failures, movement_mismatch),
        "expected_improvement": "Restores coherent traversal, reachable critical space, and tester-ready navigation flow.",
    }


def _redesign_prompts(unreachable_areas: list[dict], jump_failures: list[dict], movement_mismatch: list[str]) -> list[str]:
    prompts: list[str] = []
    if jump_failures:
        prompts.append("generate 3 map variations for broken arena traversal")
        prompts.append("refine gameplay flow for broken arena traversal")
    if unreachable_areas:
        prompts.append("design traversal pathing concept for unreachable arena areas")
    if movement_mismatch:
        prompts.append("refine gameplay flow for movement mismatch in arena layout")
    if not prompts:
        prompts.append("repair level layout for structural playability")
    return prompts


def _redesign_rationale(unreachable_areas: list[dict], jump_failures: list[dict], movement_mismatch: list[str]) -> list[str]:
    rationale: list[str] = []
    if unreachable_areas:
        rationale.append("Unreachable surfaces create traversal dead zones that will produce player-facing complaints.")
    if jump_failures:
        rationale.append("Current jump or spacing demands exceed the character's movement envelope.")
    if movement_mismatch:
        rationale.append("Layout geometry does not align cleanly with the available movement rules.")
    return rationale or ["Redesign is required to restore structural playability."]


def _build_ground_surface(ground_object: dict | None) -> dict:
    if not ground_object:
        return {}
    scale = ground_object["scale"]
    position = ground_object["position"]
    return {
        "name": ground_object["name"],
        "center_x": float(position["x"]),
        "center_z": float(position["z"]),
        "top_y": float(position["y"]),
        "width": float(scale["x"]) * 10.0,
        "depth": float(scale["z"]) * 10.0,
    }


def _build_platform_surface(platform_object: dict) -> dict:
    position = platform_object["position"]
    scale = platform_object["scale"]
    return {
        "name": platform_object["name"],
        "center_x": float(position["x"]),
        "center_z": float(position["z"]),
        "top_y": float(position["y"]) + (float(scale["y"]) / 2.0),
        "width": float(scale["x"]),
        "depth": float(scale["z"]),
    }


def _build_wall_surface(wall_object: dict) -> dict:
    position = wall_object["position"]
    scale = wall_object["scale"]
    return {
        "name": wall_object["name"],
        "center_x": float(position["x"]),
        "center_z": float(position["z"]),
        "width": float(scale["x"]),
        "depth": float(scale["z"]),
    }


def _distance_to_wall(*, x: float, z: float, wall: dict) -> float:
    half_width = float(wall.get("width", 0.0)) / 2.0
    half_depth = float(wall.get("depth", 0.0)) / 2.0
    dx = max(0.0, abs(x - float(wall.get("center_x", 0.0))) - half_width)
    dz = max(0.0, abs(z - float(wall.get("center_z", 0.0))) - half_depth)
    return math.hypot(dx, dz)


def _parse_scene_objects(scene_text: str) -> tuple[dict[int, str], dict[int, dict]]:
    game_objects: dict[int, str] = {}
    transforms: dict[int, dict] = {}
    blocks = re.split(r"(?=^--- !u!\d+ &\d+)", scene_text, flags=re.MULTILINE)

    for block in blocks:
        header = re.match(r"^--- !u!(\d+) &(\d+)", block)
        if header is None:
            continue
        object_type = int(header.group(1))
        block_id = int(header.group(2))

        if object_type == 1:
            name_match = re.search(r"^  m_Name: (.+)$", block, flags=re.MULTILINE)
            if name_match is not None:
                game_objects[block_id] = name_match.group(1).strip()
        elif object_type == 4:
            game_object_match = re.search(r"^  m_GameObject: \{fileID: (\d+)\}$", block, flags=re.MULTILINE)
            position_match = re.search(r"^  m_LocalPosition: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)\}$", block, flags=re.MULTILINE)
            scale_match = re.search(r"^  m_LocalScale: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)\}$", block, flags=re.MULTILINE)
            if game_object_match is None or position_match is None or scale_match is None:
                continue
            transforms[int(game_object_match.group(1))] = {
                "position": {
                    "x": float(position_match.group(1)),
                    "y": float(position_match.group(2)),
                    "z": float(position_match.group(3)),
                },
                "scale": {
                    "x": float(scale_match.group(1)),
                    "y": float(scale_match.group(2)),
                    "z": float(scale_match.group(3)),
                },
            }

    return game_objects, transforms


def _extract_float(text: str, pattern: str, *, default: float) -> float:
    match = re.search(pattern, text)
    if match is None:
        return default
    return float(match.group(1))


def _stabilization_report_summary(report_path: Path) -> dict:
    report = read_json(report_path, default={})
    summary = report.get("summary")
    if not isinstance(summary, dict):
        return {}
    return {
        "level_id": summary.get("level_id"),
        "manual_follow_up_needed": bool(summary.get("manual_follow_up_needed", False)),
        "scene_blockers_cleaned": bool(summary.get("scene_blockers_cleaned", False)),
    }


if __name__ == "__main__":
    print(json.dumps(analyze_first_validation_target(), indent=2))