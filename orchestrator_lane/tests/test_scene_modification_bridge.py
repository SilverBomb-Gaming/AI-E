import json
from pathlib import Path

import pytest

from orchestrator.scene_modification_bridge import (
    SUPPORTED_ACTION_TYPES,
    build_scene_action_plan,
    translate_redesign_tasks_to_scene_actions,
    validate_scene_actions,
)


pytestmark = pytest.mark.fast


REQUIRED_ACTION_KEYS = {
    "action_id",
    "task_id",
    "action_type",
    "target_objects",
    "parameters",
    "constraints",
    "expected_outcome",
    "source",
}


def test_translate_redesign_tasks_to_scene_actions_from_canonical_snapshot():
    report = _load_snapshot_report()

    actions = translate_redesign_tasks_to_scene_actions(report["redesign"]["tasks"])

    assert actions
    assert len(actions) == len(report["redesign"]["tasks"])
    for action in actions:
        assert REQUIRED_ACTION_KEYS.issubset(action.keys())
        assert action["action_type"] in SUPPORTED_ACTION_TYPES
        assert action["source"] == "scene_modification_bridge"


def test_translate_redesign_tasks_to_scene_actions_marks_unsupported_intent_explicitly():
    actions = translate_redesign_tasks_to_scene_actions(
        [
            {
                "task_id": "custom_theme_task",
                "title": "Theme variation",
                "description": "vary theme accents",
                "domain": "game_design",
                "subdomain": "theme_design",
                "intent": "vary_theme",
                "priority": 5,
                "reason": ["Theme request is not a structural scene modification task."],
                "target_objects": ["arena_theme"],
                "proposed_actions": [],
                "constraints": {"safety": "read_only"},
                "expected_outcome": ["Preserve deterministic handling."],
                "source": "playability_report.redesign",
            }
        ]
    )

    assert len(actions) == 1
    assert actions[0]["action_type"] == "mark_unresolved_target"
    assert actions[0]["parameters"]["reason_code"] == "unsupported_redesign_intent"


def test_translate_redesign_tasks_to_scene_actions_is_deterministic_for_ordering():
    report = _load_snapshot_report()
    redesign_tasks = report["redesign"]["tasks"]

    original_actions = translate_redesign_tasks_to_scene_actions(redesign_tasks)
    reversed_actions = translate_redesign_tasks_to_scene_actions(list(reversed(redesign_tasks)))

    assert original_actions == reversed_actions


def test_validate_scene_actions_and_plan_are_schema_valid():
    report = _load_snapshot_report()

    plan = build_scene_action_plan(report)
    validation = validate_scene_actions(plan["actions"])

    assert plan["source"] == "scene_modification_bridge"
    assert plan["playability_status"] == report["playability_status"]
    assert validation["valid"] is True
    assert validation["total_actions"] == len(plan["actions"])
    assert "gameplay_flow_refine_flow_broken_arena" in validation["unsupported_task_ids"]


def _load_snapshot_report() -> dict:
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "playability_report_snapshot.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))