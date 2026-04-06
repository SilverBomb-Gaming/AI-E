import json
from pathlib import Path

import pytest

from app import home_surface
from ai_e_runtime.experiment_tracking import apply_experiment_navigation, apply_experiment_tracking
from ai_e_runtime.outcome_evaluation import apply_result_evaluation
from ai_e_runtime.experiment_tracking import apply_experiment_decision
from ai_e_runtime.barrel_action_normalization import canonicalize_barrel_action_prompt
from ai_e_runtime.environment_theme_action_normalization import canonicalize_environment_theme_action_prompt
from ai_e_runtime.generic_capabilities import (
    build_generic_capability_state,
    generic_capability_definition,
    generic_capability_definition_for_capability_id,
    supported_generic_capability_mappings,
)
from ai_e_runtime.intent_normalizer import normalize_prompt
from ai_e_runtime.level_0001_entity_transform_mutation import resolve_entity_transform_route
from ai_e_runtime.mutation_approval import approve_mutation_task
from ai_e_runtime.platformer_action_normalization import (
    canonicalize_platformer_action_prompt,
    extract_platformer_action_matches,
    normalize_platformer_action,
)
from ai_e_runtime.platformer_layout_corrections import (
    apply_platformer_layout_correction_record,
    merge_platformer_layout_correction_payload,
    persist_platformer_layout_correction_result,
)
from ai_e_runtime.platformer_layout_validation import extract_platformer_layout_validation_metadata
from ai_e_runtime.request_review_bundle import build_review_bundle
from ai_e_runtime.state_store import StateStore
from ai_e_runtime.task_intake import ConversationalTaskIntake
from orchestrator.config import OrchestratorConfig


pytestmark = pytest.mark.fast


def test_task_intake_creates_deterministic_runtime_payload_and_pending_queue_entry(tmp_path):
    config = _make_config(tmp_path / "intake")
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "expand LEVEL_0001 a bit and make the zombie move and damage the player",
        session_id="operator-session-a",
    )

    assert result.task_id.startswith("INTAKE_")
    assert result.request_id.startswith("REQ_")
    assert result.task_type == "mutation_request"
    assert result.target_repo == str(config.root_dir).replace("\\", "/")
    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["agent_type"] == "read_only_inspector_agent"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.requested_execution_lane == "approval_required_mutation"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.downgraded is False
    assert result.routing.mutation_capable is False
    assert result.routing.decision == "block"
    assert result.routing.capability_supported is False
    assert result.routing.fail_closed_reason == "No supported write-capable capability matched the request."

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    assert len(queue) == 1
    assert queue[0]["task_id"] == result.task_id
    assert queue[0]["contract_path"] == f"contracts/intake/runtime_tasks/{result.task_id}.json"
    assert queue[0]["requested_intent"] == "mutate"
    assert queue[0]["execution_lane"] == "approval_required_mutation"
    assert queue[0]["downgraded"] is False
    assert queue[0]["decision"] == "block"

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    task_graph = json.loads(result.artifacts.task_graph_path.read_text(encoding="utf-8"))
    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert request_payload["conversational_request"]["operator_prompt"] == normalize_prompt(
        "expand LEVEL_0001 a bit and make the zombie move and damage the player"
    )
    assert task_graph["task_graph"]["request_id"] == result.request_id
    assert task_graph["task_graph"]["nodes"][0]["task_id"] == result.task_id
    assert runtime_payload["runtime_task"]["task_id"] == result.task_id
    assert runtime_payload["runtime_task"]["execution_mode"] == "approval_required_mutation"
    assert request_payload["conversational_request"]["context"]["routing"]["requested_execution_lane"] == "approval_required_mutation"
    assert runtime_payload["runtime_task"]["execution_lane"] == "approval_required_mutation"
    assert runtime_payload["runtime_task"]["downgraded"] is False
    assert runtime_payload["runtime_task"]["decision"] == "block"


def test_task_intake_supports_real_stabilization_request(tmp_path):
    config = _make_config(tmp_path / "real_request")
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Stabilize LEVEL_0001 zombie animation.",
        session_id="operator-session-b",
    )

    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["task_type"] == "mutation_request"
    assert result.queue_entry["target_repo"] == str(config.root_dir).replace("\\", "/")
    assert result.queue_entry["contract_path"].startswith("contracts/intake/runtime_tasks/")
    assert result.routing.requested_intent == "mutate"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.downgraded is False
    assert result.routing.decision == "block"
    assert result.routing.capability_supported is False


def test_task_intake_expands_composite_request_into_multiple_queue_tasks(tmp_path):
    config = _make_config(tmp_path / "composite_request")
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Fix LEVEL_0001 zombie animation, weapon bootstrap, and KBM controls",
        session_id="operator-session-c",
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]

    assert result.is_multi_step is True
    assert result.plan_id == f"PLAN_{result.request_id.split('_', 1)[1]}"
    assert result.plan_step_titles == [
        "Inspect zombie animation pipeline",
        "Inspect weapon bootstrap",
        "Inspect KBM controls",
        "Validate integrated result",
        "Generate summary artifact",
    ]
    assert len(queue) == 5
    assert queue[0]["dependencies"] == []
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]
    assert queue[4]["dependencies"] == [queue[3]["task_id"]]
    assert all(task["plan_id"] == result.plan_id for task in queue)


def test_task_intake_routes_freeform_grass_request_into_approval_required_mutation_lane(tmp_path):
    config = _make_config(tmp_path / "freeform_mutation_request")
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make grass for level_0001",
        session_id="operator-session-d",
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolved_intent == "mutate"
    assert result.routing.requested_execution_lane == "approval_required_mutation"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.downgraded is False
    assert result.routing.downgrade_reason is None
    assert result.routing.approval_required is True
    assert result.routing.mutation_capable is True
    assert result.routing.capability_id == "level_0001_add_grass"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["requested_execution_lane"] == "approval_required_mutation"
    assert runtime_payload["runtime_task"]["execution_lane"] == "approval_required_mutation"
    assert runtime_payload["runtime_task"]["approval_state"] == "awaiting_approval"
    assert runtime_payload["runtime_task"]["decision"] == "sandbox_first"


def test_task_intake_routes_supported_grass_mutation_into_approval_required_lane(tmp_path):
    config = _make_config(tmp_path / "supported_grass_mutation")
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make grass for level_0001",
        session_id="operator-session-e",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.queue_entry["agent_type"] == "level_0001_grass_mutation_agent"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolved_intent == "mutate"
    assert result.routing.requested_execution_lane == "approval_required_mutation"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.downgraded is False
    assert result.routing.approval_required is True
    assert result.routing.mutation_capable is True
    assert result.routing.capability_id == "level_0001_add_grass"
    assert result.routing.evidence_state == "experimental"
    assert result.routing.trust_score == 0
    assert result.routing.policy_state == "test_only"
    assert result.routing.execution_decision == "sandbox_first"
    assert result.routing.recommended_action == "sandbox_first"
    assert result.routing.sandbox_first_required is True
    assert result.routing.rating_system == "ESRB"
    assert result.routing.rating_target == "M"
    assert result.routing.content_policy_match == "fits_rating"
    assert result.routing.content_policy_decision == "allowed"
    assert result.routing.required_rating_upgrade is None
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["approval_state"] == "awaiting_approval"
    assert runtime_payload["runtime_task"]["target_scene"] == "Assets/AI_E_TestScenes/MinimalPlayableArena.unity"


def test_task_intake_routes_supported_remove_grass_mutation_into_approval_required_lane(tmp_path):
    config = _make_config(tmp_path / "supported_remove_grass_mutation")
    _write_grass_capability_contracts(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "remove grass for level_0001",
        session_id="operator-session-f",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.queue_entry["agent_type"] == "level_0001_grass_mutation_agent"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolved_intent == "mutate"
    assert result.routing.requested_execution_lane == "approval_required_mutation"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.downgraded is False
    assert result.routing.approval_required is True
    assert result.routing.mutation_capable is True
    assert result.routing.capability_id == "level_0001_remove_grass"
    assert result.routing.handler_name == "level_0001_remove_grass_handler"
    assert result.routing.target_level == "LEVEL_0001"
    assert result.routing.target_scene == "Assets/AI_E_TestScenes/MinimalPlayableArena.unity"
    assert result.routing.trust_score == 0
    assert result.routing.policy_state == "test_only"
    assert result.routing.execution_decision == "sandbox_first"
    assert result.routing.recommended_action == "sandbox_first"
    assert result.routing.sandbox_first_required is True
    assert result.routing.rating_system == "ESRB"
    assert result.routing.rating_target == "M"
    assert result.routing.content_policy_match == "fits_rating"
    assert result.routing.content_policy_decision == "allowed"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["approval_state"] == "awaiting_approval"
    assert runtime_payload["runtime_task"]["target_level"] == "LEVEL_0001"
    assert runtime_payload["runtime_task"]["target_scene"] == "Assets/AI_E_TestScenes/MinimalPlayableArena.unity"


def test_task_intake_routes_move_zombie_request_into_mutation_lane(tmp_path):
    config = _make_config(tmp_path / "move_zombie_mutation_request")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "move zombie forward",
        session_id="operator-session-move-zombie",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert intake.classify_message("move zombie forward") == "task_request"
    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.queue_entry["agent_type"] == "level_0001_entity_transform_mutation_agent"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolved_intent == "mutate"
    assert result.routing.requested_execution_lane == "approval_required_mutation"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.mutation_capable is True
    assert result.routing.capability_id == "level_0001_move_zombie_forward"
    assert result.routing.agent_type == "level_0001_entity_transform_mutation_agent"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["requested_intent"] == "mutate"
    assert runtime_payload["runtime_task"]["agent_type"] == "level_0001_entity_transform_mutation_agent"
    assert runtime_payload["runtime_task"]["execution_lane"] == "approval_required_mutation"
    assert runtime_payload["runtime_task"]["decision"] == "sandbox_first"


@pytest.mark.parametrize(
    "prompt_text",
    [
        "move zombie forward",
        "move zombie forward again",
        "move zombie slightly forward",
        "please move zombie forward",
    ],
)
def test_task_intake_normalizes_move_zombie_prompt_variants(tmp_path, prompt_text):
    config = _make_config(tmp_path / "move_zombie_prompt_variants")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-move-zombie-variant",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.routing.capability_id == "level_0001_move_zombie_forward"
    assert result.routing.agent_type == "level_0001_entity_transform_mutation_agent"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["operator_prompt"] == "move zombie forward"


@pytest.mark.parametrize(
    ("prompt_text", "expected_capability", "expected_canonical_prompt"),
    [
        ("make zombie faster", "level_0001_increase_zombie_speed", "make zombie faster"),
        ("speed up the zombie", "level_0001_increase_zombie_speed", "make zombie faster"),
        ("make zombie slower", "level_0001_decrease_zombie_speed", "make zombie slower"),
    ],
)
def test_task_intake_normalizes_zombie_speed_prompt_variants(
    tmp_path,
    prompt_text,
    expected_capability,
    expected_canonical_prompt,
):
    config = _make_config(tmp_path / "zombie_speed_prompt_variants")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-zombie-speed-variant",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.routing.capability_id == expected_capability
    assert result.routing.agent_type == "level_0001_entity_transform_mutation_agent"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["operator_prompt"] == expected_canonical_prompt


def test_task_intake_routes_direct_zombie_aggression_prompt_to_single_capability(tmp_path):
    config = _make_config(tmp_path / "zombie_aggression_capability")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie more aggressive",
        session_id="operator-session-zombie-aggression",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))["runtime_task"]

    assert result.task_type == "mutation_request"
    assert result.is_multi_step is False
    assert result.queue_entry["status"] == "needs_approval"
    assert result.routing.capability_id == "level_0001_increase_zombie_aggression"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["operator_prompt"] == "make zombie more aggressive"


def test_task_intake_builds_predefined_zombie_combat_variation_plan_into_multiple_queue_tasks(tmp_path):
    config = _make_config(tmp_path / "zombie_combat_variation_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "test combat variation",
        session_id="operator-session-zombie-combat-variation",
        target_repo=target_repo,
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.is_multi_step is True
    assert result.plan_step_titles == [
        "Increase zombie speed",
        "Increase zombie aggression",
    ]
    assert len(result.task_ids) == 2
    assert len(queue) == 2
    assert queue[0]["status"] == "needs_approval"
    assert queue[1]["status"] == "needs_approval"
    assert queue[0]["capability_id"] == "level_0001_increase_zombie_speed"
    assert queue[1]["capability_id"] == "level_0001_increase_zombie_aggression"
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]
    assert runtime_payloads[0]["operator_prompt"] == "make zombie faster"
    assert runtime_payloads[1]["operator_prompt"] == "make zombie more aggressive"
    assert runtime_payloads[0]["plan_title"] == "Test zombie combat variation"
    assert runtime_payloads[1]["plan_expected_outcome"].startswith("AI-E increases zombie speed")


@pytest.mark.parametrize(
    ("prompt_text", "expected_note"),
    [
        (
            "make zombie more dangerous",
            'AI-E mapped the gameplay goal "make zombie more dangerous" to the bounded plan "make zombie faster and more aggressive".',
        ),
        (
            "make zombie more intense",
            'AI-E mapped the gameplay goal "make zombie more intense" to the bounded plan "make zombie faster and more aggressive".',
        ),
    ],
)
def test_task_intake_resolves_goal_intent_prompts_to_predefined_combat_variation_plan(
    tmp_path,
    prompt_text,
    expected_note,
):
    config = _make_config(tmp_path / "goal_intent_combat_variation_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-goal-intent-combat-variation",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.session_resolution_note == expected_note
    assert result.routing.mapped_prompt == "make zombie faster and more aggressive"
    assert result.routing.decision == "sandbox_first"
    assert result.plan_step_titles == [
        "Increase zombie speed",
        "Increase zombie aggression",
    ]
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "make zombie faster and more aggressive"
    assert runtime_payloads[0]["operator_prompt"] == "make zombie faster"
    assert runtime_payloads[1]["operator_prompt"] == "make zombie more aggressive"


def test_task_intake_builds_predefined_zombie_safety_plan_into_multiple_queue_tasks(tmp_path):
    config = _make_config(tmp_path / "zombie_safety_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie safer",
        session_id="operator-session-zombie-safety",
        target_repo=target_repo,
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.is_multi_step is True
    assert result.plan_step_titles == [
        "Decrease zombie movement speed",
        "Move zombie forward to validate the calmer behavior",
    ]
    assert len(result.task_ids) == 2
    assert len(queue) == 2
    assert queue[0]["status"] == "needs_approval"
    assert queue[1]["status"] == "needs_approval"
    assert queue[0]["capability_id"] == "level_0001_decrease_zombie_speed"
    assert queue[1]["capability_id"] == "level_0001_move_zombie_forward"
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]
    assert runtime_payloads[0]["operator_prompt"] == "make zombie slower"
    assert runtime_payloads[1]["operator_prompt"] == "move zombie forward"
    assert runtime_payloads[0]["plan_title"] == "Reduce zombie aggression"
    assert runtime_payloads[1]["plan_expected_outcome"].startswith("Zombie movement becomes slower")


@pytest.mark.parametrize(
    ("prompt_text", "expected_note"),
    [
        (
            "make zombie less dangerous",
            'AI-E mapped the gameplay goal "make zombie less dangerous" to the bounded plan "restore zombie danger to standard".',
        ),
        (
            "make zombie easier",
            'AI-E mapped the gameplay goal "make zombie easier" to the bounded plan "restore zombie danger to standard".',
        ),
    ],
)
def test_task_intake_resolves_lower_danger_goal_intents_to_restore_standard_plan(
    tmp_path,
    prompt_text,
    expected_note,
):
    config = _make_config(tmp_path / "goal_intent_restore_standard_danger_plan")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-goal-intent-restore-standard-danger",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.session_resolution_note == expected_note
    assert result.routing.mapped_prompt == "restore zombie danger to standard"
    assert result.routing.decision == "require_approval"
    assert result.routing.plan_title != "Clarify target"
    assert result.routing.clarification_options in (None, [])
    assert result.plan_step_titles == [
        "Restore zombie movement speed to standard",
        "Restore zombie aggression to standard",
    ]
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "restore zombie danger to standard"
    assert runtime_payloads[0]["operator_prompt"] == "restore zombie speed to standard"
    assert runtime_payloads[1]["operator_prompt"] == "restore zombie aggression to standard"


def test_task_intake_resolves_supported_goal_composition_to_existing_combat_plan(tmp_path):
    config = _make_config(tmp_path / "goal_composition_combat_variation_plan")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie faster and more aggressive",
        session_id="operator-session-goal-composition-combat-variation",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_composition"
    assert result.routing.resolved_from_prompt == "make zombie faster and more aggressive"
    assert result.routing.goal_components == [
        "increase zombie speed",
        "increase zombie aggression",
    ]
    assert result.routing.mapped_prompt == "make zombie faster and more aggressive"
    assert result.routing.plan_title == "Test zombie combat variation"
    assert result.routing.decision == "sandbox_first"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "make zombie faster and more aggressive"
    assert request_payload["conversational_request"]["context"]["routing"]["goal_components"] == [
        "increase zombie speed",
        "increase zombie aggression",
    ]
    assert runtime_payloads[0]["operator_prompt"] == "make zombie faster"
    assert runtime_payloads[1]["operator_prompt"] == "make zombie more aggressive"


def test_task_intake_resolves_mixed_direction_goal_composition_to_bounded_plan(tmp_path):
    config = _make_config(tmp_path / "goal_composition_fast_less_aggressive_plan")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie faster but less aggressive",
        session_id="operator-session-goal-composition-fast-less-aggressive",
        target_repo=target_repo,
    )

    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_composition"
    assert result.routing.goal_components == [
        "increase zombie speed",
        "decrease zombie aggression",
    ]
    assert result.routing.mapped_prompt == "make zombie faster but less aggressive"
    assert result.routing.plan_title == "Test fast low-aggression zombie variation"
    assert result.plan_step_titles == [
        "Increase zombie speed",
        "Restore zombie aggression to standard",
    ]
    assert runtime_payloads[0]["operator_prompt"] == "make zombie faster"
    assert runtime_payloads[1]["operator_prompt"] == "restore zombie aggression to standard"


def test_task_intake_resolves_safe_goal_composition_to_bounded_plan(tmp_path):
    config = _make_config(tmp_path / "goal_composition_safe_slower_plan")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie less dangerous and slower",
        session_id="operator-session-goal-composition-safe-slower",
        target_repo=target_repo,
    )

    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_composition"
    assert result.routing.goal_components == [
        "restore zombie aggression to standard",
        "decrease zombie speed",
    ]
    assert result.routing.mapped_prompt == "make zombie less dangerous and slower"
    assert result.routing.plan_title == "Make zombie less dangerous and slower"
    assert result.plan_step_titles == [
        "Restore zombie aggression to standard",
        "Decrease zombie movement speed",
    ]
    assert runtime_payloads[0]["operator_prompt"] == "restore zombie aggression to standard"
    assert runtime_payloads[1]["operator_prompt"] == "make zombie slower"


def test_task_intake_builds_predefined_zombie_variation_plan_into_multiple_queue_tasks(tmp_path):
    config = _make_config(tmp_path / "zombie_variation_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "try a variation",
        session_id="operator-session-zombie-variation",
        target_repo=target_repo,
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert intake.classify_message("try a variation") == "task_request"
    assert result.task_type == "mutation_plan_request"
    assert result.is_multi_step is True
    assert result.plan_step_titles == [
        "Move zombie farther forward for variation testing",
        "Move zombie forward to compare against the standard path",
    ]
    assert len(result.task_ids) == 2
    assert len(queue) == 2
    assert queue[0]["status"] == "needs_approval"
    assert queue[1]["status"] == "needs_approval"
    assert queue[0]["capability_id"] == "level_0001_move_zombie_farther_forward"
    assert queue[1]["capability_id"] == "level_0001_move_zombie_forward"
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]
    assert runtime_payloads[0]["operator_prompt"] == "move zombie farther forward"
    assert runtime_payloads[1]["operator_prompt"] == "move zombie forward"
    assert runtime_payloads[0]["plan_title"] == "Try zombie movement variation"
    assert runtime_payloads[1]["plan_expected_outcome"].startswith("AI-E tests a visibly different zombie movement path")


@pytest.mark.parametrize(
    "prompt_text",
    [
        "move enemy forward",
        "move character forward",
    ],
)
def test_task_intake_blocks_ambiguous_generalized_entity_terms_without_guessing(tmp_path, prompt_text):
    config = _make_config(tmp_path / "generalized_entity_confirmation")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-generalized-entity",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert intake.classify_message(prompt_text) == "task_request"
    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["agent_type"] == "read_only_inspector_agent"
    assert result.routing.capability_supported is False
    assert result.routing.entity_mapping_applied is False
    assert result.routing.entity_mapping_sources == []
    assert result.routing.confirmation_required is False
    assert result.routing.mapped_prompt == normalize_prompt(prompt_text)
    assert (
        str(result.routing.fail_closed_reason)
        == "AI-E currently supports this deterministic movement request only for the zombie system in BABYLON. Try something like: 'move zombie forward'."
    )
    assert runtime_payload["runtime_task"]["decision"] == "block"
    assert runtime_payload["runtime_task"]["operator_prompt"] == normalize_prompt(prompt_text)


@pytest.mark.parametrize(
    ("prompt_text", "expected_reason"),
    [
        (
            "make enemy faster",
            'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. Name the supported target explicitly. Try something like: \'make zombie faster\' or \'make runner faster\'.',
        ),
        (
            "slow the enemy down",
            'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. Name the supported target explicitly. Try something like: \'make zombie slower\' or \'make runner slower\'.',
        ),
    ],
)
def test_task_intake_blocks_ambiguous_generalized_speed_terms(
    tmp_path,
    prompt_text,
    expected_reason,
):
    config = _make_config(tmp_path / "generalized_speed_confirmation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-generalized-speed",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert intake.classify_message(prompt_text) == "task_request"
    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["agent_type"] == "read_only_inspector_agent"
    assert result.routing.entity_mapping_applied is False
    assert result.routing.entity_mapping_sources == []
    assert result.routing.confirmation_required is False
    assert result.routing.mapped_prompt == normalize_prompt(prompt_text)
    if "faster" in normalize_prompt(prompt_text):
        assert result.routing.clarification_options == [
            "make zombie faster",
            "make runner faster",
        ]
    else:
        assert result.routing.clarification_options == [
            "make zombie slower",
            "make runner slower",
        ]
    assert str(result.routing.fail_closed_reason) == expected_reason
    assert runtime_payload["runtime_task"]["decision"] == "block"
    assert runtime_payload["runtime_task"]["operator_prompt"] == normalize_prompt(prompt_text)


@pytest.mark.parametrize(
    "prompt_text",
    [
        "move zombie backward",
        "move zombie backwards",
        "move zombie slightly backward",
        "please move zombie backward",
    ],
)
def test_task_intake_blocks_backward_move_zombie_variants_with_supported_example(tmp_path, prompt_text):
    config = _make_config(tmp_path / "move_zombie_backward_variants")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-move-zombie-backward",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["agent_type"] == "read_only_inspector_agent"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolved_intent == "mutate"
    assert result.routing.mutation_capable is False
    assert result.routing.decision == "block"
    assert "Backward zombie movement is not a supported deterministic action yet." in str(result.routing.fail_closed_reason)
    assert "move zombie forward" in str(result.routing.fail_closed_reason)
    assert runtime_payload["runtime_task"]["operator_prompt"] == "move zombie backward"
    assert runtime_payload["runtime_task"]["decision"] == "block"


def test_task_intake_blocks_unsupported_forward_entity_with_supported_example(tmp_path):
    config = _make_config(tmp_path / "unsupported_forward_entity")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "move boss forward",
        session_id="operator-session-unsupported-entity",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert result.routing.entity_mapping_applied is False
    assert (
        str(result.routing.fail_closed_reason)
        == "AI-E currently supports this deterministic movement request only for the zombie system in BABYLON. Try something like: 'move zombie forward'."
    )


@pytest.mark.parametrize(
    ("prompt_text", "expected_example"),
    [
        ("make boss faster", "make zombie faster"),
        ("slow the boss down", "make zombie slower"),
    ],
)
def test_task_intake_blocks_unsupported_speed_entity_with_supported_example(tmp_path, prompt_text, expected_example):
    config = _make_config(tmp_path / "unsupported_speed_entity")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-unsupported-speed-entity",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert result.routing.entity_mapping_applied is False
    assert expected_example in str(result.routing.fail_closed_reason)


def test_task_intake_blocks_translate_zombie_forward_when_no_deterministic_route_exists(tmp_path):
    config = _make_config(tmp_path / "translate_zombie_mutation_request")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "translate zombie forward",
        session_id="operator-session-translate-zombie",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert intake.classify_message("translate zombie forward") == "task_request"
    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["agent_type"] == "read_only_inspector_agent"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolved_intent == "mutate"
    assert result.routing.execution_lane == "approval_required_mutation"
    assert result.routing.mutation_capable is False
    assert result.routing.decision == "block"
    assert "I understood part of your request" in str(result.routing.fail_closed_reason)
    assert "move zombie forward" in str(result.routing.fail_closed_reason)
    assert runtime_payload["runtime_task"]["decision"] == "block"


def test_task_intake_resolves_aggression_followup_and_preserves_session_metadata(tmp_path):
    config = _make_config(tmp_path / "aggression_followup_resolution")
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    _write_session_tuning_state(
        config,
        "aggression-followup-session",
        _session_tuning_record(
            order=1,
            family="aggression",
            capability_id="level_0001_increase_zombie_aggression",
            source_prompt="make zombie more aggressive",
            canonical_prompt="make zombie more aggressive",
            previous_tier="standard",
            requested_tier="aggressive",
            resulting_tier="aggressive",
            requested_target_value=0.6,
            observed_value=0.6,
        ),
    )
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make it less aggressive",
        session_id="aggression-followup-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.routing.mapped_prompt == "restore zombie aggression to standard"
    assert result.routing.resolution_source == "session_followup_resolution"
    assert result.routing.previous_tier == "aggressive"
    assert result.routing.requested_tier == "standard"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["operator_prompt"] == "make it less aggressive"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "restore zombie aggression to standard"
    assert runtime_payload["runtime_task"]["source_prompt"] == "make it less aggressive"
    assert runtime_payload["runtime_task"]["operator_prompt"] == "restore zombie aggression to standard"
    assert runtime_payload["runtime_task"]["resolved_from_prompt"] == "make it less aggressive"
    assert runtime_payload["runtime_task"]["requested_tier"] == "standard"


def test_task_intake_resolves_revert_last_change_to_previous_supported_speed_tier(tmp_path):
    config = _make_config(tmp_path / "speed_revert_resolution")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    _write_session_tuning_state(
        config,
        "speed-revert-session",
        _session_tuning_record(
            order=1,
            family="speed",
            capability_id="level_0001_increase_zombie_speed",
            source_prompt="make zombie faster",
            canonical_prompt="make zombie faster",
            previous_tier="standard",
            requested_tier="fast",
            resulting_tier="fast",
            requested_target_value=4.5,
            observed_value=4.5,
        ),
        _session_tuning_record(
            order=2,
            family="speed",
            capability_id="level_0001_restore_zombie_speed_standard",
            source_prompt="make it slower",
            canonical_prompt="restore zombie speed to standard",
            previous_tier="fast",
            requested_tier="standard",
            resulting_tier="standard",
            requested_target_value=3.5,
            observed_value=3.5,
        ),
    )
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "revert last change",
        session_id="speed-revert-session",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.routing.mapped_prompt == "make zombie faster"
    assert result.routing.resolution_source == "session_followup_resolution"
    assert result.routing.revert_requested is True
    assert result.routing.previous_tier == "standard"
    assert result.routing.requested_tier == "fast"
    assert result.routing.revert_summary == "Revert the last zombie speed change from standard back to fast."
    assert runtime_payload["runtime_task"]["operator_prompt"] == "make zombie faster"
    assert runtime_payload["runtime_task"]["source_prompt"] == "revert last change"
    assert runtime_payload["runtime_task"]["revert_requested"] is True
    assert runtime_payload["runtime_task"]["revert_summary"] == "Revert the last zombie speed change from standard back to fast."


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_entity_prompt(tmp_path):
    config = _make_config(tmp_path / "home_surface_entity_confirmation")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("move enemy forward", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.next_action_label == "Revise request"
    assert preview.detected_action == "Bounded mutation"
    assert preview.decision_reason == (
        "AI-E currently supports this deterministic movement request only for the zombie system in BABYLON. "
        "Try something like: 'move zombie forward'."
    )


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_speed_with_clarification_options(tmp_path):
    config = _make_config(tmp_path / "home_surface_speed_clarification")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_runner_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make enemy faster", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.plan_title == "Clarify target"
    assert preview.plan_steps == [
        "make zombie faster",
        "make runner faster",
    ]
    assert preview.plan_execution_mode == "Clarification required"
    assert "No execution will start" in preview.status_message


def test_home_surface_prepare_prompt_reports_missing_platformer_route_assets_instead_of_unknown_action(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_route_assets_missing")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    _strip_platformer_route_assets(target_repo)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make more obstacles", project)

    assert preview.available is True
    assert preview.classification == "task_request"
    assert preview.decision_state == "Blocked"
    assert preview.mapped_prompt == "increase obstacle density"
    assert "recognized the bounded platformer action 'increase obstacle density'" in preview.decision_reason
    assert "does not expose the deterministic platformer prompt aliases, route entries, and wrapper scripts" in preview.decision_reason
    assert "couldn't match it to a known action" not in preview.decision_reason


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_aggression_capability(tmp_path):
    config = _make_config(tmp_path / "home_surface_aggression_capability_confirmation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make enemy more aggressive", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.next_action_label == "Revise request"
    assert preview.plan_title == "Clarify target"
    assert preview.plan_steps == [
        "make zombie more aggressive",
        "make runner more aggressive",
    ]
    assert preview.plan_execution_mode == "Clarification required"
    assert "No execution will start" in preview.status_message
    assert preview.detected_action == "Clarify target"
    assert preview.decision_reason == (
        'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. '
        "Name the supported target explicitly. Try something like: "
        "'make zombie more aggressive' or 'make runner more aggressive'."
    )


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_safety_plan(tmp_path):
    config = _make_config(tmp_path / "home_surface_safety_plan_confirmation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make enemy less aggressive", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.next_action_label == "Revise request"
    assert preview.plan_title == "Clarify target"
    assert preview.plan_steps == [
        "restore zombie aggression to standard",
        "restore runner aggression to standard",
    ]
    assert preview.plan_execution_mode == "Clarification required"
    assert preview.decision_reason == (
        'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. '
        "Name the supported target explicitly. Try something like: "
        "'make zombie easier', 'make runner easier', or 'restore runner danger to standard'."
    )


def test_home_surface_prepare_prompt_shows_variation_plan_for_direct_prompt(tmp_path):
    config = _make_config(tmp_path / "home_surface_variation_plan_direct")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("try a different movement", project)

    assert preview.available is True
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Run in sandbox"
    assert preview.plan_title == "Try zombie movement variation"
    assert preview.plan_steps == [
        "Move zombie farther forward for variation testing",
        "Move zombie forward to compare against the standard path",
    ]
    assert preview.plan_execution_mode == "Sandbox first"
    assert preview.plan_expected_outcome.startswith("AI-E tests a visibly different zombie movement path")


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_variation_plan(tmp_path):
    config = _make_config(tmp_path / "home_surface_variation_plan_confirmation")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make enemy move differently", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.next_action_label == "Revise request"
    assert preview.plan_title == ""
    assert preview.plan_steps == []
    assert preview.plan_execution_mode == ""
    assert preview.decision_reason == (
        "AI-E currently supports this movement variation plan only for the zombie system in BABYLON. "
        "Try something like: 'make zombie move differently'."
    )


def test_home_surface_blocks_unsupported_aggression_capability_with_supported_example(tmp_path):
    config = _make_config(tmp_path / "home_surface_unsupported_aggression_capability")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make boss more aggressive", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == "AI-E currently supports this deterministic aggression adjustment only for the zombie or runner systems in BABYLON. Try something like: 'make zombie more aggressive' or 'make runner more aggressive'."
    )


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_combat_variation_plan(tmp_path):
    config = _make_config(tmp_path / "home_surface_combat_variation_confirmation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make enemy more dangerous", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.next_action_label == "Revise request"
    assert preview.plan_title == "Clarify target"
    assert preview.plan_steps == [
        "make zombie more dangerous",
        "make runner more dangerous",
    ]
    assert preview.plan_execution_mode == "Clarification required"
    assert preview.decision_reason == (
        'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. '
        "Name the supported target explicitly. Try something like: "
        "'make zombie more dangerous' or 'make runner more dangerous'."
    )


def test_task_intake_blocks_ambiguous_generalized_goal_intent_plan(tmp_path):
    config = _make_config(tmp_path / "generalized_goal_intent_confirmation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make enemy more dangerous",
        session_id="operator-session-generalized-goal-intent",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))["runtime_task"]

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert result.routing.mapped_prompt == "make enemy more dangerous"
    assert result.routing.plan_title == "Clarify target"
    assert result.routing.entity_mapping_applied is False
    assert result.routing.entity_mapping_sources == []
    assert result.routing.clarification_options == [
        "make zombie more dangerous",
        "make runner more dangerous",
    ]
    assert result.routing.fail_closed_reason == (
        'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. '
        "Name the supported target explicitly. Try something like: "
        "'make zombie more dangerous' or 'make runner more dangerous'."
    )
    assert runtime_payload["decision"] == "block"
    assert runtime_payload["source_prompt"] == "make enemy more dangerous"
    assert runtime_payload["operator_prompt"] == "make enemy more dangerous"


@pytest.mark.parametrize(
    ("prompt_text", "expected_reason"),
    [
        (
            "make enemy easier",
            'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. '
            "Name the supported target explicitly. Try something like: "
            "'make zombie easier' or 'make runner easier'.",
        ),
        (
            "make character more dangerous",
            'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "character" means here. '
            "Name the supported target explicitly. Try something like: "
            "'make zombie more dangerous' or 'make runner more dangerous'.",
        ),
    ],
)
def test_task_intake_blocks_ambiguous_generalized_goal_prompts_with_supported_rephrases(
    tmp_path,
    prompt_text,
    expected_reason,
):
    config = _make_config(tmp_path / "generalized_goal_prompt_ambiguity")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    _write_runner_speed_capability_contracts(config)
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-generalized-goal-ambiguity",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert result.routing.entity_mapping_applied is False
    assert result.routing.entity_mapping_sources == []
    normalized = normalize_prompt(prompt_text)
    expected_options = []
    if "easier" in normalized or ("dangerous" in normalized and "less" in normalized):
        expected_options = ["make zombie easier", "make runner easier"]
    elif "dangerous" in normalized:
        expected_options = ["make zombie more dangerous", "make runner more dangerous"]
    if expected_options:
        assert result.routing.clarification_options == expected_options
    assert result.routing.fail_closed_reason == expected_reason


def test_home_surface_prepare_prompt_blocks_ambiguous_generalized_goal_composition_plan(tmp_path):
    config = _make_config(tmp_path / "home_surface_goal_composition_confirmation")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make enemy faster but less aggressive", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.next_action_label == "Revise request"
    assert preview.plan_title == ""
    assert preview.plan_steps == []
    assert preview.decision_reason == (
        'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "enemy" means here. '
        "Name the supported target explicitly. Try something like: "
        "'make zombie faster but less aggressive', 'make zombie faster and more aggressive', "
        "or 'make runner faster and more aggressive'."
    )


def test_home_surface_prepare_prompt_shows_supported_combat_variation_plan(tmp_path):
    config = _make_config(tmp_path / "home_surface_supported_combat_variation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("test combat variation", project)

    assert preview.available is True
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Run in sandbox"
    assert preview.plan_title == "Test zombie combat variation"
    assert preview.plan_steps == [
        "Increase zombie speed",
        "Increase zombie aggression",
    ]
    assert preview.plan_execution_mode == "Sandbox first"
    assert preview.detected_action == "Test zombie combat variation"


def test_home_surface_prepare_prompt_shows_supported_goal_intent_mapping_for_combat_variation(tmp_path):
    config = _make_config(tmp_path / "home_surface_goal_intent_combat_variation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make zombie more dangerous", project)

    assert preview.available is True
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.confirmation_prompt == ""
    assert preview.plan_title == "Test zombie combat variation"
    assert preview.mapped_prompt == "make zombie faster and more aggressive"
    assert 'mapped the gameplay goal "make zombie more dangerous"' in preview.decision_reason.lower()


def test_task_intake_blocks_unsupported_goal_intent_with_explicit_guidance(tmp_path):
    config = _make_config(tmp_path / "unsupported_goal_intent")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie smarter",
        session_id="operator-session-unsupported-goal-intent",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert (
        str(result.routing.fail_closed_reason)
        == "AI-E does not have a supported deterministic enemy intelligence goal yet. Try something like: 'make zombie more dangerous', 'make runner more dangerous', or 'make runner easier'."
    )


def test_task_intake_blocks_conflicting_goal_composition_with_explicit_guidance(tmp_path):
    config = _make_config(tmp_path / "conflicting_goal_composition")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie faster and slower",
        session_id="operator-session-conflicting-goal-composition",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert (
        str(result.routing.fail_closed_reason)
        == "AI-E cannot combine conflicting zombie speed goals in one bounded request. Try either 'make zombie faster' or 'make zombie slower'."
    )


def test_task_intake_blocks_unsupported_goal_composition_with_explicit_guidance(tmp_path):
    config = _make_config(tmp_path / "unsupported_goal_composition")
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie smarter and faster",
        session_id="operator-session-unsupported-goal-composition",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "blocked"
    assert result.routing.confirmation_required is False
    assert (
        str(result.routing.fail_closed_reason)
        == "AI-E does not support combining zombie intelligence goals with bounded combat tuning yet. Try something like: 'make zombie faster and more aggressive'."
    )


def test_home_surface_blocks_speed_followup_without_active_session(tmp_path):
    config = _make_config(tmp_path / "home_surface_speed_followup_blocked")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make it faster", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == 'AI-E can use "make it faster" only after a supported enemy speed change in the current session. Start with something like: \'make zombie faster\' or \'make runner faster\'.'
    )


def test_home_surface_prepare_prompt_resolves_speed_followup_from_active_session(tmp_path):
    config = _make_config(tmp_path / "home_surface_speed_followup_supported")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="speed",
            capability_id="level_0001_increase_zombie_speed",
            source_prompt="make zombie faster",
            canonical_prompt="make zombie faster",
            previous_tier="standard",
            requested_tier="fast",
            resulting_tier="fast",
            requested_target_value=4.5,
            observed_value=4.5,
        ),
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make it slower", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Open review"
    assert preview.detected_action == "LEVEL_0001 restore zombie speed to standard"
    assert preview.decision_reason.startswith('AI-E resolved "make it slower" from the current zombie speed tier fast to standard.')


def test_home_surface_blocks_try_another_version_without_active_session(tmp_path):
    config = _make_config(tmp_path / "home_surface_variation_followup_blocked")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("try another version", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == 'AI-E can use "try another version" only after a supported enemy session is active. Start with something like: \'make zombie move differently\'.'
    )


def test_home_surface_prepare_prompt_resolves_variation_followup_from_active_session(tmp_path):
    config = _make_config(tmp_path / "home_surface_variation_followup_supported")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="movement",
            capability_id="level_0001_move_zombie_forward",
            source_prompt="move zombie forward",
            canonical_prompt="move zombie forward",
            resulting_tier="standard_forward",
            observed_value=[0.0, 0.0, 3.0],
        ),
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("try another version", project)

    assert preview.available is True
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Run in sandbox"
    assert preview.plan_title == "Try zombie movement variation"
    assert preview.plan_steps == [
        "Move zombie farther forward for variation testing",
        "Move zombie forward to compare against the standard path",
    ]
    assert preview.decision_reason.startswith(
        'AI-E resolved "try another version" from the current zombie session into the bounded movement variation route.'
    )


def test_home_surface_prepare_prompt_shows_review_only_current_experiment_summary(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_review")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    experiment_id = "experiment_0001"
    variant_one = _experiment_variant(
        order=1,
        experiment_id=experiment_id,
        variant_id="variant_0001",
        source_prompt="move zombie forward",
        canonical_prompt="move zombie forward",
        variant_kind="baseline",
        movement_tier="standard_forward",
        baseline_marker=True,
        baseline_variant_id="variant_0001",
        outcome_summary="standard forward movement",
        task_id="TASK_VARIANT_0001",
        request_id="REQ_VARIANT_0001",
    )
    variant_two = _experiment_variant(
        order=2,
        experiment_id=experiment_id,
        variant_id="variant_0002",
        parent_variant_id="variant_0001",
        source_prompt="try another version",
        canonical_prompt="make zombie move differently",
        variant_kind="followup_variant",
        movement_tier="movement_variation",
        baseline_variant_id="variant_0001",
        outcome_summary="movement variation",
        decision_status="rejected",
        task_id="TASK_VARIANT_0002",
        request_id="REQ_VARIANT_0002",
        plan_id="PLAN_VARIATION",
    )
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="movement",
            capability_id="level_0001_move_zombie_farther_forward",
            source_prompt="try another version",
            canonical_prompt="make zombie move differently",
            previous_tier="standard_forward",
            requested_tier="movement_variation",
            resulting_tier="movement_variation",
            observed_value=[0.0, 0.0, 6.0],
        ),
        extra_state={
            "experiment_tracking": {
                "active_experiment_id": experiment_id,
                "experiments": [
                    {
                        "experiment_id": experiment_id,
                        "target_entity": "zombie",
                        "created_at": "2026-04-02T01:00:00Z",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0001",
                        "variants": [variant_one, variant_two],
                    }
                ],
            },
            "result_evaluation_history": [
                {
                    "experiment_id": experiment_id,
                    "variant_id": "variant_0002",
                    "experiment_comparison_description": (
                        "What changed\n"
                        "Speed changed.\n\n"
                        "Current variant vs baseline\n"
                        "Speed: standard vs fast\n\n"
                        "Key differences\n"
                        "Speed: fast -> standard\n\n"
                        "Expected gameplay impact\n"
                        "Lower movement speed."
                    ),
                }
            ],
        },
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("show current experiment variants", project)

    assert preview.available is True
    assert preview.decision_state == "Review only"
    assert preview.next_action_label == "Refresh summary"
    assert preview.plan_title == "Current experiment variants"
    assert preview.plan_steps == [
        "variant_0001 | target context: zombie | status: original baseline, preferred baseline, undecided | prompt: move zombie forward | outcome: standard forward movement | deltas from baseline: none.",
        "variant_0002 | target context: zombie | status: current, rejected | prompt: try another version | outcome: movement variation | deltas from baseline: Movement: standard_forward -> movement_variation.",
    ]
    assert preview.plan_execution_mode == "Current session summary"
    assert preview.decision_reason.startswith("Variant review: experiment_0001.")
    assert "Original baseline: variant_0001." in preview.decision_reason
    assert "Preferred baseline: variant_0001 (same as original baseline)." in preview.decision_reason
    assert "Kept variants: none." in preview.decision_reason
    assert "Rejected variants: variant_0002." in preview.decision_reason
    assert "Undecided variants: variant_0001." in preview.decision_reason
    assert "better" not in preview.decision_reason.lower()
    assert "best" not in preview.decision_reason.lower()
    assert preview.status_message == "AI-E prepared a current-session experiment summary locally. No execution will start."


def test_home_surface_blocks_experiment_review_without_active_experiment(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_review_blocked")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("show current experiment variants", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == "AI-E can show current experiment variants only after a supported tuning result exists in the current session. Start with something like: 'make zombie faster', 'make runner faster', or 'increase encounter count'."
    )


def test_home_surface_prepare_prompt_shows_review_only_experiment_decision_update(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_decision_preview")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    experiment_id = "experiment_0001"
    variant_one = _experiment_variant(
        order=1,
        experiment_id=experiment_id,
        variant_id="variant_0001",
        source_prompt="make zombie faster",
        canonical_prompt="make zombie faster",
        variant_kind="baseline",
        speed_tier="fast",
        baseline_marker=True,
        baseline_variant_id="variant_0001",
        outcome_summary="speed fast",
        task_id="TASK_VARIANT_0001",
        request_id="REQ_VARIANT_0001",
    )
    variant_two = _experiment_variant(
        order=2,
        experiment_id=experiment_id,
        variant_id="variant_0002",
        parent_variant_id="variant_0001",
        source_prompt="make it slower",
        canonical_prompt="restore zombie speed to standard",
        variant_kind="followup_variant",
        speed_tier="standard",
        baseline_variant_id="variant_0001",
        outcome_summary="speed standard",
        task_id="TASK_VARIANT_0002",
        request_id="REQ_VARIANT_0002",
    )
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="speed",
            capability_id="level_0001_restore_zombie_speed_standard",
            source_prompt="make it slower",
            canonical_prompt="restore zombie speed to standard",
            previous_tier="fast",
            requested_tier="standard",
            resulting_tier="standard",
            observed_value=3.5,
        ),
        extra_state={
            "experiment_tracking": {
                "active_experiment_id": experiment_id,
                "experiments": [
                    {
                        "experiment_id": experiment_id,
                        "target_entity": "zombie",
                        "created_at": "2026-04-02T01:00:00Z",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [variant_one, variant_two],
                    }
                ],
            },
            "result_evaluation_history": [
                {
                    "experiment_id": experiment_id,
                    "variant_id": "variant_0002",
                    "experiment_comparison_description": (
                        "What changed\n"
                        "Speed changed.\n\n"
                        "Current variant vs baseline\n"
                        "Speed: standard vs fast\n\n"
                        "Key differences\n"
                        "Speed: fast -> standard\n\n"
                        "Expected gameplay impact\n"
                        "Lower movement speed."
                    ),
                }
            ],
        },
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("keep current variant", project)

    assert preview.available is True
    assert preview.decision_state == "Review only"
    assert preview.next_action_label == "Record decision"
    assert preview.plan_title == "Keep current variant"
    assert preview.plan_steps == [
        "Current variant: variant_0002.",
        "Target context: zombie.",
        "Current status: undecided.",
        "Current variant deltas from baseline: Speed: fast -> standard.",
        "Original baseline: variant_0001.",
        "Preferred baseline: not set; comparisons default to variant_0001.",
        "Kept variants: none.",
        "Rejected variants: none.",
        "Decision to record: kept.",
        "Status change: variant_0002 -> kept.",
        "Preferred baseline change: none; comparisons continue to use original baseline variant_0001.",
        "Comparison reference after decision: variant_0001.",
        "Decision outcome: variant_0002 remains available for comparison and history.",
        "Original baseline lineage: remains variant_0001.",
        "Changes relative to baseline:",
        "What changed",
        "Speed changed.",
        "Current variant vs baseline",
        "Speed: standard vs fast",
        "Key differences",
        "Speed: fast -> standard",
        "Expected gameplay impact",
        "Lower movement speed.",
    ]
    assert preview.plan_execution_mode == "Current session decision update"
    assert preview.decision_reason == (
        "Decision preview: experiment_0001.\n"
        "Action: keep current variant.\n"
        "Status change: variant_0002 -> kept.\n"
        "Preferred baseline change: none; comparisons continue to use original baseline variant_0001.\n"
        "Comparison reference after decision: variant_0001.\n"
        "Original baseline lineage: remains variant_0001.\n"
        "Execution: none."
    )
    assert preview.status_message == (
        "AI-E prepared a current-session experiment decision update locally. "
        "Record it to update experiment state. No execution will start."
    )
    assert "recommend" not in " ".join(preview.plan_steps).lower()


def test_home_surface_apply_experiment_decision_records_keep_and_reject_status(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_decision_apply")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    experiment_id = "experiment_0001"
    variant_one = _experiment_variant(
        order=1,
        experiment_id=experiment_id,
        variant_id="variant_0001",
        source_prompt="make zombie faster",
        canonical_prompt="make zombie faster",
        variant_kind="baseline",
        speed_tier="fast",
        baseline_marker=True,
        baseline_variant_id="variant_0001",
        outcome_summary="speed fast",
    )
    variant_two = _experiment_variant(
        order=2,
        experiment_id=experiment_id,
        variant_id="variant_0002",
        parent_variant_id="variant_0001",
        source_prompt="make it slower",
        canonical_prompt="restore zombie speed to standard",
        variant_kind="followup_variant",
        speed_tier="standard",
        baseline_variant_id="variant_0001",
        outcome_summary="speed standard",
    )
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="speed",
            capability_id="level_0001_restore_zombie_speed_standard",
            source_prompt="make it slower",
            canonical_prompt="restore zombie speed to standard",
            previous_tier="fast",
            requested_tier="standard",
            resulting_tier="standard",
            observed_value=3.5,
        ),
        extra_state={
            "experiment_tracking": {
                "active_experiment_id": experiment_id,
                "next_decision_order": 1,
                "experiments": [
                    {
                        "experiment_id": experiment_id,
                        "target_entity": "zombie",
                        "created_at": "2026-04-02T01:00:00Z",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [variant_one, variant_two],
                    }
                ],
            },
            "result_evaluation_history": [
                {
                    "experiment_id": experiment_id,
                    "variant_id": "variant_0002",
                    "experiment_comparison_description": (
                        "What changed\n"
                        "Speed changed.\n\n"
                        "Current variant vs baseline\n"
                        "Speed: standard vs fast\n\n"
                        "Key differences\n"
                        "Speed: fast -> standard\n\n"
                        "Expected gameplay impact\n"
                        "Lower movement speed."
                    ),
                }
            ],
        },
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = type("_ConfigLoader", (), {"load": staticmethod(lambda: config)})
    bridge._state_store_cls = StateStore
    bridge._apply_experiment_decision_fn = apply_experiment_decision
    bridge._get_current_timestamp_fn = lambda: "2026-04-02T07:00:00Z"
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    keep_preview = bridge.prepare_prompt("keep current variant", project)
    keep_result = bridge.apply_experiment_review_prompt(keep_preview)
    assert keep_result.ok is True
    assert keep_result.message == (
        "Recorded: variant_0002 is kept in experiment_0001. "
        "Preferred baseline remains variant_0001. "
        "Original baseline remains variant_0001."
    )

    state = json.loads((config.runs_dir / home_surface.DEFAULT_SUBMIT_SESSION_ID / "session_state.json").read_text(encoding="utf-8"))
    experiment = state["experiment_tracking"]["experiments"][0]
    variants = experiment["variants"]
    assert variants[1]["decision_status"] == "kept"
    assert variants[1]["decision_source"] == "explicit_user_review"
    assert variants[1]["decision_order"] == 1
    assert experiment["latest_decision"]["action"] == "keep_current_variant"

    bridge._get_current_timestamp_fn = lambda: "2026-04-02T07:05:00Z"
    reject_preview = bridge.prepare_prompt("reject current variant", project)
    assert "Status change: variant_0002 -> rejected." in reject_preview.plan_steps
    assert "Decision outcome: variant_0002 remains in experiment history but will not be used." in reject_preview.plan_steps
    assert "Original baseline lineage: remains variant_0001." in reject_preview.plan_steps
    reject_result = bridge.apply_experiment_review_prompt(reject_preview)
    assert reject_result.ok is True
    assert reject_result.message == (
        "Recorded: variant_0002 was rejected in experiment_0001. "
        "variant_0002 remains in experiment history but will not be used."
    )

    updated_state = json.loads((config.runs_dir / home_surface.DEFAULT_SUBMIT_SESSION_ID / "session_state.json").read_text(encoding="utf-8"))
    updated_experiment = updated_state["experiment_tracking"]["experiments"][0]
    updated_variants = updated_experiment["variants"]
    assert updated_variants[1]["decision_status"] == "rejected"
    assert updated_variants[1]["decision_order"] == 2
    assert updated_experiment["latest_decision"]["action"] == "reject_current_variant"


def test_home_surface_apply_experiment_decision_sets_preferred_baseline_without_overwriting_original(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_preferred_baseline")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    experiment_id = "experiment_0001"
    variant_one = _experiment_variant(
        order=1,
        experiment_id=experiment_id,
        variant_id="variant_0001",
        source_prompt="make zombie faster",
        canonical_prompt="make zombie faster",
        variant_kind="baseline",
        speed_tier="fast",
        baseline_marker=True,
        baseline_variant_id="variant_0001",
        outcome_summary="speed fast",
    )
    variant_two = _experiment_variant(
        order=2,
        experiment_id=experiment_id,
        variant_id="variant_0002",
        parent_variant_id="variant_0001",
        source_prompt="make it slower",
        canonical_prompt="restore zombie speed to standard",
        variant_kind="followup_variant",
        speed_tier="standard",
        baseline_variant_id="variant_0001",
        outcome_summary="speed standard",
    )
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="speed",
            capability_id="level_0001_restore_zombie_speed_standard",
            source_prompt="make it slower",
            canonical_prompt="restore zombie speed to standard",
            previous_tier="fast",
            requested_tier="standard",
            resulting_tier="standard",
            observed_value=3.5,
        ),
        extra_state={
            "experiment_tracking": {
                "active_experiment_id": experiment_id,
                "next_decision_order": 1,
                "experiments": [
                    {
                        "experiment_id": experiment_id,
                        "target_entity": "zombie",
                        "created_at": "2026-04-02T01:00:00Z",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [variant_one, variant_two],
                    }
                ],
            },
            "result_evaluation_history": [
                {
                    "experiment_id": experiment_id,
                    "variant_id": "variant_0002",
                    "experiment_comparison_description": (
                        "What changed\n"
                        "Speed changed.\n\n"
                        "Current variant vs baseline\n"
                        "Speed: standard vs fast\n\n"
                        "Key differences\n"
                        "Speed: fast -> standard\n\n"
                        "Expected gameplay impact\n"
                        "Lower movement speed."
                    ),
                }
            ],
        },
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = type("_ConfigLoader", (), {"load": staticmethod(lambda: config)})
    bridge._state_store_cls = StateStore
    bridge._apply_experiment_decision_fn = apply_experiment_decision
    bridge._get_current_timestamp_fn = lambda: "2026-04-02T07:10:00Z"
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("set current variant as baseline", project)
    assert preview.plan_steps == [
        "Current variant: variant_0002.",
        "Target context: zombie.",
        "Current status: undecided.",
        "Current variant deltas from baseline: Speed: fast -> standard.",
        "Original baseline: variant_0001.",
        "Preferred baseline: not set; comparisons default to variant_0001.",
        "Kept variants: none.",
        "Rejected variants: none.",
        "Decision to record: preferred baseline.",
        "Status change: none; the current decision status stays recorded as-is.",
        "Preferred baseline change: variant_0001 -> variant_0002.",
        "Comparison reference after decision: variant_0002.",
        "Decision outcome: variant_0002 becomes the preferred baseline for later comparisons.",
        "Original baseline lineage: remains variant_0001.",
        "Changes relative to baseline:",
        "What changed",
        "Speed changed.",
        "Current variant vs baseline",
        "Speed: standard vs fast",
        "Key differences",
        "Speed: fast -> standard",
        "Expected gameplay impact",
        "Lower movement speed.",
    ]
    assert preview.decision_reason == (
        "Decision preview: experiment_0001.\n"
        "Action: set current variant as baseline.\n"
        "Status change: none; current variant status stays recorded as-is.\n"
        "Preferred baseline change: variant_0001 -> variant_0002.\n"
        "Comparison reference after decision: variant_0002.\n"
        "Original baseline lineage: remains variant_0001.\n"
        "Execution: none."
    )
    result = bridge.apply_experiment_review_prompt(preview)

    assert result.ok is True
    assert result.message == (
        "Recorded: variant_0002 is now the preferred baseline in experiment_0001. "
        "Later baseline comparisons will reference variant_0002. "
        "Original baseline remains variant_0001."
    )

    state = json.loads((config.runs_dir / home_surface.DEFAULT_SUBMIT_SESSION_ID / "session_state.json").read_text(encoding="utf-8"))
    experiment = state["experiment_tracking"]["experiments"][0]
    assert experiment["baseline_variant_id"] == "variant_0001"
    assert experiment["preferred_baseline_variant_id"] == "variant_0002"
    assert experiment["latest_decision"]["action"] == "set_current_variant_as_baseline"


def test_home_surface_prepare_prompt_shows_current_experiment_decisions_summary(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_decisions_summary")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    experiment_id = "experiment_0001"
    variant_one = _experiment_variant(
        order=1,
        experiment_id=experiment_id,
        variant_id="variant_0001",
        source_prompt="make zombie faster",
        canonical_prompt="make zombie faster",
        variant_kind="baseline",
        speed_tier="fast",
        baseline_marker=True,
        baseline_variant_id="variant_0001",
        outcome_summary="speed fast",
        decision_status="kept",
        decision_order=1,
        decision_timestamp="2026-04-02T07:00:00Z",
        decision_source="explicit_user_review",
    )
    variant_two = _experiment_variant(
        order=2,
        experiment_id=experiment_id,
        variant_id="variant_0002",
        parent_variant_id="variant_0001",
        source_prompt="make it slower",
        canonical_prompt="restore zombie speed to standard",
        variant_kind="followup_variant",
        speed_tier="standard",
        baseline_variant_id="variant_0001",
        outcome_summary="speed standard",
        decision_status="rejected",
        decision_order=2,
        decision_timestamp="2026-04-02T07:05:00Z",
        decision_source="explicit_user_review",
    )
    _write_session_tuning_state(
        config,
        home_surface.DEFAULT_SUBMIT_SESSION_ID,
        _session_tuning_record(
            order=1,
            family="speed",
            capability_id="level_0001_restore_zombie_speed_standard",
            source_prompt="make it slower",
            canonical_prompt="restore zombie speed to standard",
            previous_tier="fast",
            requested_tier="standard",
            resulting_tier="standard",
            observed_value=3.5,
        ),
        extra_state={
            "experiment_tracking": {
                "active_experiment_id": experiment_id,
                "next_decision_order": 3,
                "experiments": [
                    {
                        "experiment_id": experiment_id,
                        "target_entity": "zombie",
                        "created_at": "2026-04-02T01:00:00Z",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "latest_decision": {
                            "action": "set_current_variant_as_baseline",
                            "variant_id": "variant_0002",
                            "timestamp": "2026-04-02T07:10:00Z",
                            "order": 3,
                            "source": "explicit_user_review",
                                    "summary": "Latest explicit user decision: set variant_0002 as the preferred baseline. Later baseline comparisons will reference variant_0002. Original baseline remains variant_0001.",
                        },
                        "variants": [variant_one, variant_two],
                    }
                ],
            }
        },
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("show current experiment decisions", project)

    assert preview.available is True
    assert preview.decision_state == "Review only"
    assert preview.next_action_label == "Refresh summary"
    assert preview.plan_title == "Current experiment decisions"
    assert preview.plan_steps == [
        "variant_0001 | target context: zombie | status: original baseline, kept | prompt: make zombie faster | outcome: speed fast | deltas from baseline: none.",
        "variant_0002 | target context: zombie | status: current, preferred baseline, rejected | prompt: make it slower | outcome: speed standard | deltas from baseline: Speed: fast -> standard.",
    ]
    assert preview.decision_reason.startswith("Decision review: experiment_0001.")
    assert "Preferred baseline: variant_0002." in preview.decision_reason
    assert "Kept variants: variant_0001." in preview.decision_reason
    assert "Rejected variants: variant_0002." in preview.decision_reason
    assert "Undecided variants: none." in preview.decision_reason


def test_task_intake_lists_recorded_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_navigation_list")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-navigation-list-session")
    state_store.save(
        {
            "session_id": "experiment-navigation-list-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0002",
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                aggression_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0001",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make it slower",
                                canonical_prompt="restore zombie speed to standard",
                                variant_kind="followup_variant",
                                speed_tier="standard",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed standard",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                aggression_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0002",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make runner more dangerous",
                                canonical_prompt="make runner more dangerous",
                                variant_kind="followup_variant",
                                speed_tier="fast",
                                aggression_tier="aggressive",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast, aggression aggressive",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "show experiments",
        session_id="experiment-navigation-list-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Experiment list"
    assert result.routing.decision_reason == "experiment_navigation_list"
    assert "Recorded experiments: 2." in result.routing.decision_summary
    assert "Active experiment: experiment_0002." in result.routing.decision_summary
    assert any(
        "experiment_0001 | target context: zombie | status: inactive | variants: 2 | current: variant_0002" in line
        for line in result.routing.plan_step_titles or []
    )
    assert any(
        "experiment_0002 | target context: runner | status: active | variants: 2 | current: variant_0002" in line
        for line in result.routing.plan_step_titles or []
    )


def test_home_surface_apply_experiment_navigation_switches_active_context(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_navigation_switch")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    state_store = StateStore(config.runs_dir, home_surface.DEFAULT_SUBMIT_SESSION_ID)
    state_store.save(
        {
            "session_id": home_surface.DEFAULT_SUBMIT_SESSION_ID,
            "experiment_tracking": {
                "active_experiment_id": "experiment_0001",
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                aggression_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0001",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make it slower",
                                canonical_prompt="restore zombie speed to standard",
                                variant_kind="followup_variant",
                                speed_tier="standard",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed standard",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                aggression_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                ],
            },
        }
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = type("_ConfigLoader", (), {"load": staticmethod(lambda: config)})
    bridge._state_store_cls = StateStore
    bridge._apply_experiment_decision_fn = apply_experiment_decision
    bridge._apply_experiment_navigation_fn = apply_experiment_navigation
    bridge._get_current_timestamp_fn = lambda: "2026-04-03T10:00:00Z"
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    switch_preview = bridge.prepare_prompt("open experiment_0002", project)

    assert switch_preview.available is True
    assert switch_preview.decision_state == "Review only"
    assert switch_preview.next_action_label == "Switch context"
    assert switch_preview.plan_title == "Switch experiment context"
    assert "Requested active experiment: experiment_0002." in switch_preview.decision_reason
    assert "Context change after review: active experiment -> experiment_0002." in switch_preview.plan_steps

    switch_result = bridge.apply_experiment_review_prompt(switch_preview)
    assert switch_result.ok is True
    assert switch_result.message.startswith("Active experiment context switched to experiment_0002.")

    variants_preview = bridge.prepare_prompt("show current experiment variants", project)
    assert variants_preview.decision_reason.startswith("Variant review: experiment_0002.")
    assert any(
        "variant_0001 | target context: runner | status: current, original baseline, preferred baseline, undecided" in line
        for line in variants_preview.plan_steps
    )


def test_task_intake_shows_selected_experiment_summary(tmp_path):
    config = _make_config(tmp_path / "experiment_navigation_summary")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-navigation-summary-session")
    state_store.save(
        {
            "session_id": "experiment-navigation-summary-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0001",
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                aggression_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "latest_decision": {
                            "summary": "Latest explicit user decision: set variant_0002 as the preferred baseline. Later baseline comparisons will reference variant_0002. Original baseline remains variant_0001.",
                        },
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                                decision_status="kept",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0002",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make runner more dangerous",
                                canonical_prompt="make runner more dangerous",
                                variant_kind="followup_variant",
                                speed_tier="fast",
                                aggression_tier="aggressive",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast, aggression aggressive",
                                decision_status="kept",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "show experiment_0002 summary",
        session_id="experiment-navigation-summary-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Experiment summary"
    assert result.routing.decision_reason == "experiment_navigation_summary"
    assert result.routing.decision_summary.startswith("Experiment summary: experiment_0002.")
    assert "Preferred baseline: variant_0002." in result.routing.decision_summary
    assert any(
        "variant_0002 | target context: runner | status: current, preferred baseline, kept | prompt: make runner more dangerous" in line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_inspects_variant_in_active_experiment(tmp_path):
    config = _make_config(tmp_path / "experiment_variant_navigation")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-variant-navigation-session")
    state_store.save(
        {
            "session_id": "experiment-variant-navigation-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0002",
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                aggression_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                ],
            },
            "result_evaluation_history": [
                {
                    "experiment_id": "experiment_0002",
                    "variant_id": "variant_0001",
                    "experiment_comparison_description": (
                        "What changed\n"
                        "Speed changed.\n\n"
                        "Current variant vs baseline\n"
                        "Speed: fast vs standard\n\n"
                        "Key differences\n"
                        "Speed: standard -> fast\n\n"
                        "Expected gameplay impact\n"
                        "Higher movement speed."
                    ),
                }
            ],
        }
    )

    result = intake.accept_message(
        "show variant_0001",
        session_id="experiment-variant-navigation-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Variant details"
    assert result.routing.decision_reason == "experiment_variant_review"
    assert result.routing.decision_summary.startswith("Variant inspection: variant_0001.")
    assert result.routing.plan_step_titles[:4] == [
        "Experiment: experiment_0002.",
        "Variant: variant_0001.",
        "Target context: runner.",
        "Status: current, original baseline, undecided.",
    ]
    assert "Evaluation:" in result.routing.plan_step_titles
    assert "Speed: standard -> fast" in result.routing.plan_step_titles


def test_task_intake_blocks_ambiguous_variant_navigation_across_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_variant_navigation_ambiguous")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-variant-navigation-ambiguous-session")
    state_store.save(
        {
            "session_id": "experiment-variant-navigation-ambiguous-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "inspect variant_0001",
        session_id="experiment-variant-navigation-ambiguous-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.decision_reason == "ambiguous_experiment_context"
    assert result.routing.plan_title == "Clarify experiment context"
    assert result.routing.plan_step_titles == ["open experiment_0001", "open experiment_0002"]
    assert result.routing.decision_summary == (
        "This request is ambiguous across multiple experiments. Choose one explicit experiment context first."
    )


def test_task_intake_compares_variants_across_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_variants")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-variants-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-variants-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0002",
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0002",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make runner more dangerous",
                                canonical_prompt="make runner more dangerous",
                                variant_kind="followup_variant",
                                speed_tier="fast",
                                aggression_tier="aggressive",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast, aggression aggressive",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare variant_0001 in experiment_0001 with variant_0002 in experiment_0002",
        session_id="experiment-cross-comparison-variants-session",
        target_repo=str(config.root_dir),
    )

    combined_text = "\n".join(result.routing.plan_step_titles or []).lower()
    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Cross-experiment variant comparison"
    assert result.routing.decision_reason == "cross_experiment_variant_comparison"
    assert result.routing.decision_summary.startswith("Cross-experiment variant comparison.")
    assert "Left experiment: experiment_0001." in result.routing.plan_step_titles
    assert "Right experiment: experiment_0002." in result.routing.plan_step_titles
    assert "Left target context: zombie." in result.routing.plan_step_titles
    assert "Right target context: runner." in result.routing.plan_step_titles
    assert "What changed" in result.routing.plan_step_titles
    assert "Key differences" in result.routing.plan_step_titles
    assert "Expected gameplay impact" in result.routing.plan_step_titles
    assert "Target context: runner -> zombie" in result.routing.plan_step_titles
    assert "better" not in combined_text
    assert "best" not in combined_text
    assert "recommend" not in combined_text


def test_task_intake_compares_baselines_across_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_baselines")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-baselines-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-baselines-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0001",
                                variant_id="variant_0002",
                                source_prompt="make zombie slower",
                                canonical_prompt="make zombie slower",
                                variant_kind="followup_variant",
                                speed_tier="slow",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed slow",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0002",
                                variant_id="variant_0002",
                                source_prompt="make runner slower",
                                canonical_prompt="make runner slower",
                                variant_kind="followup_variant",
                                speed_tier="slow",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed slow",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare baselines of experiment_0001 and experiment_0002",
        session_id="experiment-cross-comparison-baselines-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Baseline comparison"
    assert result.routing.decision_reason == "cross_experiment_baseline_comparison"
    assert result.routing.decision_summary.startswith("Cross-experiment baseline comparison.")
    assert "Original baseline comparison:" in result.routing.plan_step_titles
    assert "Preferred baseline comparison:" in result.routing.plan_step_titles
    assert any(line == "Original baseline vs original baseline" for line in result.routing.plan_step_titles or [])
    assert any(line == "Preferred baseline vs preferred baseline" for line in result.routing.plan_step_titles or [])


def test_task_intake_blocks_ambiguous_cross_experiment_variant_comparison(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_ambiguous")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-ambiguous-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-ambiguous-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare variant_0001",
        session_id="experiment-cross-comparison-ambiguous-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Clarify experiment comparison"
    assert result.routing.decision_reason == "ambiguous_experiment_comparison"
    assert result.routing.decision_summary == (
        "This request is ambiguous across experiments. Specify which experiment variants to compare for variant_0001."
    )
    assert result.routing.plan_step_titles == [
        "compare variant_0001 in experiment_0001 with variant_0001 in experiment_0002"
    ]


def test_task_intake_compares_current_variants_across_mixed_context_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_mixed_contexts")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-mixed-contexts-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-mixed-contexts-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "encounter",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="increase encounter count",
                                canonical_prompt="increase encounter count",
                                variant_kind="baseline",
                                encounter_count_tier="high",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="encounter count high",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare experiment_0001 and experiment_0002",
        session_id="experiment-cross-comparison-mixed-contexts-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Cross-experiment comparison"
    assert result.routing.decision_reason == "cross_experiment_current_variant_comparison"
    assert "Left target context: zombie." in result.routing.plan_step_titles
    assert "Right target context: encounter." in result.routing.plan_step_titles
    assert "Different tuning context." in result.routing.plan_step_titles
    assert "Target context: encounter -> zombie" in result.routing.plan_step_titles


def test_task_intake_compares_named_platformer_level_sets_without_session_history(tmp_path):
    config = _make_config(tmp_path / "platformer_level_set_direct_comparison")
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "compare level set a and level set b",
        session_id="platformer-level-set-compare-session",
        target_repo=str(config.root_dir),
    )

    combined_text = "\n".join(result.routing.plan_step_titles or [])
    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Level set comparison"
    assert result.routing.decision_reason == "platformer_level_set_comparison"
    assert result.routing.decision_summary.startswith("Platformer level set comparison.")
    assert "Left level set: level set a." in combined_text
    assert "Left profile: easy traversal." in combined_text
    assert "Right level set: level set b." in combined_text
    assert "Right profile: long sparse run." in combined_text
    assert "Applied level set: level set a." in combined_text
    assert "Applied profile: easy traversal." in combined_text
    assert "Previous level set: level set b." in combined_text
    assert "Previous profile: long sparse run." in combined_text
    assert "Jump height: standard -> high" in combined_text
    assert "Gravity: standard_gravity -> low_gravity" in combined_text
    assert "Speed: fast -> standard" in combined_text


def test_home_surface_prepares_cross_experiment_comparison_as_review_only(tmp_path):
    config = _make_config(tmp_path / "home_surface_cross_experiment_comparison")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    state_store = StateStore(config.runs_dir, home_surface.DEFAULT_SUBMIT_SESSION_ID)
    state_store.save(
        {
            "session_id": home_surface.DEFAULT_SUBMIT_SESSION_ID,
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "zombie",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="make zombie faster",
                                canonical_prompt="make zombie faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="make runner faster",
                                canonical_prompt="make runner faster",
                                variant_kind="baseline",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                            ),
                        ],
                    },
                ],
            },
        }
    )
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("compare experiment_0001 and experiment_0002", project)

    assert preview.available is True
    assert preview.decision_state == "Review only"
    assert preview.next_action_label == "Refresh summary"
    assert preview.plan_title == "Cross-experiment comparison"
    assert "Execution: none." in preview.decision_reason


def test_home_surface_blocks_experiment_decisions_without_active_experiment(tmp_path):
    config = _make_config(tmp_path / "home_surface_experiment_decisions_blocked")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("show current experiment decisions", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == "AI-E can show current experiment decisions only after a supported tuning result exists in the current session. Start with something like: 'make zombie faster', 'make runner faster', or 'increase encounter count'."
    )


def test_home_surface_blocks_unsupported_combat_variation_plan_with_supported_example(tmp_path):
    config = _make_config(tmp_path / "home_surface_unsupported_combat_variation")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    _write_zombie_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make boss more dangerous", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == "AI-E currently supports this combat variation plan only for the zombie or runner systems in BABYLON. Try something like: 'make zombie faster and more aggressive' or 'make runner faster and more aggressive'."
    )


def test_home_surface_blocks_unsupported_safety_plan_with_supported_example(tmp_path):
    config = _make_config(tmp_path / "home_surface_unsupported_safety_plan")
    _write_move_zombie_capability_contract(config)
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make boss safer", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == "AI-E currently supports this safety plan only for the zombie system in BABYLON. Try something like: 'make zombie safer'."
    )


def test_home_surface_blocks_unsupported_variation_plan_with_supported_example(tmp_path):
    config = _make_config(tmp_path / "home_surface_unsupported_variation_plan")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make boss move differently", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert (
        preview.decision_reason
        == "AI-E currently supports this movement variation plan only for the zombie system in BABYLON. Try something like: 'make zombie move differently'."
    )


def test_home_surface_loads_speed_result_from_attempt_artifact(tmp_path):
    session_dir = tmp_path / "session_run"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / "INTAKE_SPEED_001_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "operator_prompt": "make zombie faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                },
                "result": {
                    "status": "completed",
                    "summary": "level_0001_entity_transform_handler executed make zombie faster via mutate_enemy_move_speed",
                    "details": {
                        "translated_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "executed_probe": "MutateEnemyMoveSpeed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "requested_speed": 4.5,
                        "minimum_speed": 2.0,
                        "maximum_speed": 5.0,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-01T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.original_request == "make zombie faster"
    assert proof.before_after_summary == "AIE_Zombie_001_Instance speed changed from 3.5 to 4.5."
    assert "movement speed" in proof.change_summary.lower()
    assert proof.validation_outcome == "Recorded validation passed."


def test_home_surface_loads_attempt_result_evaluation_from_session_state(tmp_path):
    session_dir = tmp_path / "session_run_with_evaluation"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / "INTAKE_SPEED_002_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_SPEED_002",
                    "request_id": "REQ_SPEED_002",
                    "operator_prompt": "make zombie slower",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                },
                "result": {
                    "status": "completed",
                    "summary": "level_0001_entity_transform_handler executed make zombie slower via mutate_enemy_move_speed",
                    "details": {
                        "translated_command": "make zombie slower",
                        "action_name": "decrease_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "executed_probe": "MutateEnemyMoveSpeed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 4.5,
                        "new_speed": 2.5,
                        "requested_speed": 2.5,
                        "minimum_speed": 2.0,
                        "maximum_speed": 5.0,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-02T06:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "result_evaluation_history": [
                    {
                        "task_id": "INTAKE_SPEED_002",
                        "request_id": "REQ_SPEED_002",
                        "plan_id": "",
                        "evaluation_source": "deterministic_rules",
                        "comparison_description": "What changed\nSpeed changed.\n\nCurrent state vs previous version\nSpeed: slow vs fast\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nLower movement speed.",
                        "detected_differences": ["Speed: fast -> slow"],
                        "suggestion": "",
                    }
                ],
                "latest_result_evaluation": {
                    "task_id": "INTAKE_SPEED_002",
                    "request_id": "REQ_SPEED_002",
                    "plan_id": "",
                    "evaluation_source": "deterministic_rules",
                    "comparison_description": "What changed\nSpeed changed.\n\nCurrent state vs previous version\nSpeed: slow vs fast\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nLower movement speed.",
                    "detected_differences": ["Speed: fast -> slow"],
                    "suggestion": "",
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current state vs previous version\n"
        "Speed: slow vs fast\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Lower movement speed."
    )
    assert proof.evaluation_differences == ["Speed: fast -> slow"]
    assert proof.evaluation_suggestion == ""
    assert proof.evaluation_source == "deterministic_rules"


def test_home_surface_loads_attempt_result_experiment_metadata_from_session_state(tmp_path):
    session_dir = tmp_path / "session_run_with_experiment"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / "INTAKE_SPEED_004_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_SPEED_004",
                    "request_id": "REQ_SPEED_004",
                    "operator_prompt": "restore zombie speed to standard",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "restore zombie speed to standard",
                        "action_name": "restore_enemy_move_speed_standard",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 4.5,
                        "new_speed": 3.5,
                        "requested_speed": 3.5,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-02T06:10:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "result_evaluation_history": [
                    {
                        "task_id": "INTAKE_SPEED_004",
                        "request_id": "REQ_SPEED_004",
                        "comparison_description": "What changed\nSpeed changed.\n\nCurrent state vs previous version\nSpeed: standard vs fast\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nLower movement speed.",
                        "detected_differences": ["Speed: fast -> standard"],
                        "suggestion": "",
                        "evaluation_source": "deterministic_rules",
                        "experiment_id": "experiment_0001",
                        "variant_id": "variant_0002",
                        "previous_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "compared_against_variant_id": "variant_0001",
                        "experiment_comparison_description": "What changed\nSpeed changed.\n\nCurrent variant vs Variant 1\nSpeed: standard vs fast\n\nKey differences\nSpeed: fast -> standard\n\nExpected gameplay impact\nLower movement speed.",
                    }
                ],
                "latest_result_evaluation": {},
                "experiment_tracking": {
                    "active_experiment_id": "experiment_0001",
                    "experiments": [
                        {
                            "experiment_id": "experiment_0001",
                            "target_entity": "zombie",
                            "created_at": "2026-04-02T06:00:00Z",
                            "active_variant_id": "variant_0002",
                            "baseline_variant_id": "variant_0001",
                            "preferred_baseline_variant_id": "variant_0002",
                            "latest_decision": {
                                "action": "set_current_variant_as_baseline",
                                "variant_id": "variant_0002",
                                "timestamp": "2026-04-02T06:09:00Z",
                                "order": 3,
                                "source": "explicit_user_review",
                                "summary": "Latest explicit user decision: set variant_0002 as the preferred baseline. Later baseline comparisons will reference variant_0002. Original baseline remains variant_0001.",
                            },
                            "variants": [
                                _experiment_variant(
                                    order=1,
                                    experiment_id="experiment_0001",
                                    variant_id="variant_0001",
                                    source_prompt="make zombie faster",
                                    canonical_prompt="make zombie faster",
                                    variant_kind="baseline",
                                    speed_tier="fast",
                                    baseline_marker=True,
                                    baseline_variant_id="variant_0001",
                                    outcome_summary="speed fast",
                                    task_id="INTAKE_SPEED_001",
                                    request_id="REQ_SPEED_001",
                                ),
                                _experiment_variant(
                                    order=2,
                                    experiment_id="experiment_0001",
                                    variant_id="variant_0002",
                                    parent_variant_id="variant_0001",
                                    source_prompt="make it slower",
                                    canonical_prompt="restore zombie speed to standard",
                                    variant_kind="followup_variant",
                                    speed_tier="standard",
                                    baseline_variant_id="variant_0001",
                                    outcome_summary="speed standard",
                                    task_id="INTAKE_SPEED_004",
                                    request_id="REQ_SPEED_004",
                                    decision_status="kept",
                                    decision_order=1,
                                    decision_timestamp="2026-04-02T06:08:00Z",
                                    decision_source="explicit_user_review",
                                ),
                            ],
                        }
                    ],
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(artifact_path)

    assert proof.available is True
    assert proof.experiment_available is True
    assert proof.experiment_id == "experiment_0001"
    assert proof.variant_id == "variant_0002"
    assert proof.compared_variant_id == "variant_0001"
    assert proof.baseline_variant_id == "variant_0001"
    assert proof.preferred_baseline_variant_id == "variant_0002"
    assert proof.variant_kind == "followup_variant"
    assert proof.experiment_summary == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current variant vs Variant 1\n"
        "Speed: standard vs fast\n\n"
        "Key differences\n"
        "Speed: fast -> standard\n\n"
        "Expected gameplay impact\n"
        "Lower movement speed."
    )
    assert proof.decision_status == "kept"
    assert proof.latest_decision_summary == (
        "Latest explicit user decision: set variant_0002 as the preferred baseline. "
        "Later baseline comparisons will reference variant_0002. "
        "Original baseline remains variant_0001."
    )


def test_home_surface_omits_evaluation_when_insufficient_history(tmp_path):
    session_dir = tmp_path / "session_run_without_evaluation"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / "INTAKE_SPEED_003_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_SPEED_003",
                    "request_id": "REQ_SPEED_003",
                    "operator_prompt": "make zombie faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-02T06:05:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "result_state_history": [
                    {
                        "task_id": "INTAKE_SPEED_003",
                        "request_id": "REQ_SPEED_003",
                    }
                ],
                "result_evaluation_history": [],
                "latest_result_evaluation": {},
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.evaluation_available is False
    assert proof.evaluation_summary == ""
    assert proof.evaluation_differences == []
    assert proof.evaluation_suggestion == ""


def test_home_surface_loads_combined_combat_variation_result_from_session_artifacts(tmp_path):
    config = _make_config(tmp_path / "combined_combat_variation_result")
    session_dir = config.runs_dir / "combat_variation_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_PLAN.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "test combat variation",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie faster and more aggressive",
                            "plan_title": "Test zombie combat variation",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "combat_variation_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-01T00:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "session_id": "combat_variation_session",
                "status": "completed",
                "result_evaluation_history": [
                    {
                        "task_id": "INTAKE_PLAN__STEP_02",
                        "request_id": "REQ_PLAN",
                        "plan_id": "PLAN_PLAN",
                        "evaluation_source": "deterministic_rules",
                        "comparison_description": "What changed\nSpeed and aggression changed.\n\nCurrent state vs previous version\nSpeed: fast vs standard\nAggression: aggressive vs standard\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nHigher movement speed.\nShorter attack cooldown.",
                        "detected_differences": [
                            "Speed: standard -> fast",
                            "Aggression: standard -> aggressive",
                        ],
                        "suggestion": "",
                    }
                ],
                "latest_result_evaluation": {
                    "task_id": "INTAKE_PLAN__STEP_02",
                    "request_id": "REQ_PLAN",
                    "plan_id": "PLAN_PLAN",
                    "evaluation_source": "deterministic_rules",
                    "comparison_description": "What changed\nSpeed and aggression changed.\n\nCurrent state vs previous version\nSpeed: fast vs standard\nAggression: aggressive vs standard\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nHigher movement speed.\nShorter attack cooldown.",
                    "detected_differences": [
                        "Speed: standard -> fast",
                        "Aggression: standard -> aggressive",
                    ],
                    "suggestion": "",
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    faster_artifact = artifacts_dir / "INTAKE_PLAN__STEP_01_attempt_01.json"
    faster_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_PLAN__STEP_01",
                    "plan_id": "PLAN_PLAN",
                    "plan_title": "Test zombie combat variation",
                    "plan_step_index": 1,
                    "plan_step_title": "Increase zombie speed",
                    "operator_prompt": "make zombie faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-01T00:00:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    move_artifact = artifacts_dir / "INTAKE_PLAN__STEP_02_attempt_01.json"
    move_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_PLAN__STEP_02",
                    "plan_id": "PLAN_PLAN",
                    "plan_title": "Test zombie combat variation",
                    "plan_step_index": 2,
                    "plan_step_title": "Increase zombie aggression",
                    "operator_prompt": "make zombie more aggressive",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "action_type": "mutate_enemy_aggression",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_attack_cooldown": 1.0,
                        "new_attack_cooldown": 0.6,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_aggression_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded aggression validation passed.",
                },
                "timestamp": "2026-04-01T00:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.title == "test combat variation"
    assert proof.detected_action == "Test zombie combat variation"
    assert proof.proof_status == "Passed"
    assert len(proof.key_steps) == 2
    assert "Increase zombie speed" in proof.key_steps[0]
    assert "Increase zombie aggression" in proof.key_steps[1]
    assert "movement speed" in proof.change_summary.lower()
    assert "attack cooldown" in proof.before_after_summary.lower()
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Speed and aggression changed.\n\n"
        "Current state vs previous version\n"
        "Speed: fast vs standard\n"
        "Aggression: aggressive vs standard\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Higher movement speed.\n"
        "Shorter attack cooldown."
    )
    assert proof.evaluation_differences == [
        "Speed: standard -> fast",
        "Aggression: standard -> aggressive",
    ]
    assert proof.evaluation_suggestion == ""
    assert proof.evaluation_source == "deterministic_rules"


def test_home_surface_loads_combined_combat_variation_result_from_goal_intent_mapping(tmp_path):
    config = _make_config(tmp_path / "combined_goal_intent_combat_variation_result")
    session_dir = config.runs_dir / "goal_intent_combat_variation_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_GOAL_PLAN.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make zombie more dangerous",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie faster and more aggressive",
                            "plan_title": "Test zombie combat variation",
                            "resolution_source": "goal_intent_mapping",
                            "resolved_from_prompt": "make zombie more dangerous",
                            "session_resolution_note": 'AI-E mapped the gameplay goal "make zombie more dangerous" to the bounded plan "make zombie faster and more aggressive".',
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "goal_intent_combat_variation_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-02T04:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    faster_artifact = artifacts_dir / "INTAKE_GOAL_PLAN__STEP_01_attempt_01.json"
    faster_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_GOAL_PLAN__STEP_01",
                    "plan_id": "PLAN_GOAL_PLAN",
                    "plan_title": "Test zombie combat variation",
                    "plan_step_index": 1,
                    "plan_step_title": "Increase zombie speed",
                    "operator_prompt": "make zombie faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_GOAL_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-02T04:00:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    aggression_artifact = artifacts_dir / "INTAKE_GOAL_PLAN__STEP_02_attempt_01.json"
    aggression_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_GOAL_PLAN__STEP_02",
                    "plan_id": "PLAN_GOAL_PLAN",
                    "plan_title": "Test zombie combat variation",
                    "plan_step_index": 2,
                    "plan_step_title": "Increase zombie aggression",
                    "operator_prompt": "make zombie more aggressive",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_GOAL_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "action_type": "mutate_enemy_aggression",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_attack_cooldown": 1.0,
                        "new_attack_cooldown": 0.6,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_aggression_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded aggression validation passed.",
                },
                "timestamp": "2026-04-02T04:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.original_request == "make zombie more dangerous"
    assert proof.normalized_request == "make zombie faster and more aggressive"
    assert proof.detected_action == "Test zombie combat variation"
    assert proof.key_steps[0].startswith("Resolution: AI-E mapped the gameplay goal 'make zombie more dangerous'")
    assert "bounded plan \"make zombie faster and more aggressive\"" in proof.key_steps[1]
    assert "Increase zombie speed" in proof.key_steps[2]
    assert "Increase zombie aggression" in proof.key_steps[3]


def test_home_surface_loads_combined_goal_composition_result_with_component_metadata(tmp_path):
    config = _make_config(tmp_path / "combined_goal_composition_result")
    session_dir = config.runs_dir / "goal_composition_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_COMPOSED_PLAN.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make zombie faster but less aggressive",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie faster but less aggressive",
                            "plan_title": "Test fast low-aggression zombie variation",
                            "resolution_source": "goal_composition",
                            "resolved_from_prompt": "make zombie faster but less aggressive",
                            "session_resolution_note": 'AI-E combined the gameplay goals "faster" and "less aggressive" into the bounded plan "make zombie faster but less aggressive".',
                            "goal_components": [
                                "increase zombie speed",
                                "decrease zombie aggression",
                            ],
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "goal_composition_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-02T05:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    speed_artifact = artifacts_dir / "INTAKE_COMPOSED_PLAN__STEP_01_attempt_01.json"
    speed_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_COMPOSED_PLAN__STEP_01",
                    "plan_id": "PLAN_COMPOSED_PLAN",
                    "plan_title": "Test fast low-aggression zombie variation",
                    "plan_step_index": 1,
                    "plan_step_title": "Increase zombie speed",
                    "operator_prompt": "make zombie faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_COMPOSED_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-02T05:00:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    aggression_artifact = artifacts_dir / "INTAKE_COMPOSED_PLAN__STEP_02_attempt_01.json"
    aggression_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_COMPOSED_PLAN__STEP_02",
                    "plan_id": "PLAN_COMPOSED_PLAN",
                    "plan_title": "Test fast low-aggression zombie variation",
                    "plan_step_index": 2,
                    "plan_step_title": "Restore zombie aggression to standard",
                    "operator_prompt": "restore zombie aggression to standard",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_COMPOSED_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "restore zombie aggression to standard",
                        "action_name": "restore_enemy_aggression_standard",
                        "action_type": "mutate_enemy_aggression",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_attack_cooldown": 0.6,
                        "new_attack_cooldown": 1.0,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_aggression_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded aggression validation passed.",
                },
                "timestamp": "2026-04-02T05:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.original_request == "make zombie faster but less aggressive"
    assert proof.detected_action == "Test fast low-aggression zombie variation"
    assert proof.key_steps[0].startswith("Resolution: AI-E combined the gameplay goals from 'make zombie faster but less aggressive'")
    assert "bounded plan \"make zombie faster but less aggressive\"" in proof.key_steps[1]
    assert "Increase zombie speed" in proof.key_steps[2]
    assert "Restore zombie aggression to standard" in proof.key_steps[3]
    assert "Goal components: Increase zombie speed; Decrease zombie aggression." in proof.validation_checks


def test_home_surface_loads_combined_combat_variation_result_with_skipped_step(tmp_path):
    config = _make_config(tmp_path / "combined_combat_variation_result_with_skip")
    session_dir = config.runs_dir / "combat_variation_skip_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_PLAN_SKIP.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "test combat variation",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie faster and more aggressive",
                            "plan_title": "Test zombie combat variation",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "combat_variation_skip_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-02T01:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    faster_artifact = artifacts_dir / "INTAKE_PLAN_SKIP__STEP_01_attempt_01.json"
    faster_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_PLAN_SKIP__STEP_01",
                    "plan_id": "PLAN_PLAN_SKIP",
                    "plan_title": "Test zombie combat variation",
                    "plan_step_index": 1,
                    "plan_step_title": "Increase zombie speed",
                    "operator_prompt": "make zombie faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_PLAN_SKIP.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 4.5,
                        "executed": True,
                        "result_reason": "applied",
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-02T01:00:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    aggression_artifact = artifacts_dir / "INTAKE_PLAN_SKIP__STEP_02_attempt_01.json"
    aggression_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_PLAN_SKIP__STEP_02",
                    "plan_id": "PLAN_PLAN_SKIP",
                    "plan_title": "Test zombie combat variation",
                    "plan_step_index": 2,
                    "plan_step_title": "Increase zombie aggression",
                    "operator_prompt": "make zombie more aggressive",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_PLAN_SKIP.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "action_type": "mutate_enemy_aggression",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_attack_cooldown": 0.5,
                        "new_attack_cooldown": 0.5,
                        "requested_attack_cooldown": 0.6,
                        "executed": False,
                        "result_reason": "skipped_already_satisfied",
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_aggression_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded aggression validation passed.",
                },
                "timestamp": "2026-04-02T01:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.detected_action == "Test zombie combat variation"
    assert proof.proof_status == "Passed"
    assert "desired aggression threshold" in proof.key_steps[1].lower()
    assert "skipped the change" in proof.change_summary.lower()
    assert "stayed at attack cooldown 0.5" in proof.before_after_summary.lower()
    assert "1 step(s) were skipped" in proof.validation_outcome


def test_home_surface_loads_combined_variation_plan_result_from_session_followup_resolution(tmp_path):
    config = _make_config(tmp_path / "combined_variation_followup_result")
    session_dir = config.runs_dir / "variation_followup_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_VARIATION_FOLLOWUP.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "try another version",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie move differently",
                            "plan_title": "Try zombie movement variation",
                            "resolution_source": "session_followup_resolution",
                            "resolved_from_prompt": "try another version",
                            "session_resolution_note": 'AI-E resolved "try another version" from the current zombie session into the bounded movement variation route.',
                            "state_family": "movement",
                            "previous_tier": "standard_forward",
                            "requested_tier": "movement_variation",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "variation_followup_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-02T02:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    farther_artifact = artifacts_dir / "INTAKE_VARIATION_FOLLOWUP__STEP_01_attempt_01.json"
    farther_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_VARIATION_FOLLOWUP__STEP_01",
                    "plan_id": "PLAN_VARIATION_FOLLOWUP",
                    "plan_title": "Try zombie movement variation",
                    "plan_step_index": 1,
                    "plan_step_title": "Move zombie farther forward for variation testing",
                    "operator_prompt": "move zombie farther forward",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_VARIATION_FOLLOWUP.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "move zombie farther forward",
                        "action_name": "move_entity_farther_forward",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 3.0],
                        "new_position": [0.0, 0.0, 6.0],
                        "movement_distance": 3.0,
                        "position_changed": True,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_entity_transform_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded variation validation passed.",
                },
                "timestamp": "2026-04-02T02:00:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    move_artifact = artifacts_dir / "INTAKE_VARIATION_FOLLOWUP__STEP_02_attempt_01.json"
    move_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_VARIATION_FOLLOWUP__STEP_02",
                    "plan_id": "PLAN_VARIATION_FOLLOWUP",
                    "plan_title": "Try zombie movement variation",
                    "plan_step_index": 2,
                    "plan_step_title": "Move zombie forward to compare against the standard path",
                    "operator_prompt": "move zombie forward",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_VARIATION_FOLLOWUP.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 6.0],
                        "new_position": [0.0, 0.0, 3.0],
                        "movement_distance": 3.0,
                        "position_changed": True,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_entity_transform_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded forward validation passed.",
                },
                "timestamp": "2026-04-02T02:00:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.original_request == "try another version"
    assert proof.detected_action == "Try zombie movement variation"
    assert proof.key_steps[0].startswith("Resolution: AI-E resolved the follow-up prompt 'try another version'")
    assert proof.key_steps[1] == 'AI-E resolved "try another version" from the current zombie session into the bounded movement variation route.'
    assert "Session tier path: Movement standard_forward -> movement_variation." in proof.validation_checks
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."


def test_home_surface_loads_combined_safety_plan_result_from_session_artifacts(tmp_path):
    config = _make_config(tmp_path / "combined_safety_plan_result")
    session_dir = config.runs_dir / "safety_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_SAFETY_PLAN.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make zombie safer",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie less aggressive",
                            "plan_title": "Reduce zombie aggression",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "safety_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-01T00:10:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    slower_artifact = artifacts_dir / "INTAKE_SAFETY__STEP_01_attempt_01.json"
    slower_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_SAFETY__STEP_01",
                    "plan_id": "PLAN_SAFETY",
                    "plan_title": "Reduce zombie aggression",
                    "plan_step_index": 1,
                    "plan_step_title": "Decrease zombie movement speed",
                    "operator_prompt": "make zombie slower",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_SAFETY_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "make zombie slower",
                        "action_name": "decrease_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_speed": 3.5,
                        "new_speed": 2.5,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded speed validation passed.",
                },
                "timestamp": "2026-04-01T00:10:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    move_artifact = artifacts_dir / "INTAKE_SAFETY__STEP_02_attempt_01.json"
    move_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_SAFETY__STEP_02",
                    "plan_id": "PLAN_SAFETY",
                    "plan_title": "Reduce zombie aggression",
                    "plan_step_index": 2,
                    "plan_step_title": "Move zombie forward to validate the calmer behavior",
                    "operator_prompt": "move zombie forward",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_SAFETY_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 0.0],
                        "new_position": [0.0, 0.0, 3.0],
                        "movement_distance": 3.0,
                        "position_changed": True,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_entity_transform_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded movement validation passed.",
                },
                "timestamp": "2026-04-01T00:10:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.title == "make zombie safer"
    assert proof.detected_action == "Reduce zombie aggression"
    assert proof.proof_status == "Passed"
    assert len(proof.key_steps) == 2
    assert "Decrease zombie movement speed" in proof.key_steps[0]
    assert "Move zombie forward to validate the calmer behavior" in proof.key_steps[1]
    assert "from 3.5 to 2.5" in proof.change_summary
    assert "moved from" in proof.before_after_summary.lower()
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."


def test_home_surface_loads_combined_variation_plan_result_from_session_artifacts(tmp_path):
    config = _make_config(tmp_path / "combined_variation_plan_result")
    session_dir = config.runs_dir / "variation_session"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_VARIATION_PLAN.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "try a variation",
                    "context": {
                        "routing": {
                            "mapped_prompt": "make zombie move differently",
                            "plan_title": "Try zombie movement variation",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_summary.json").write_text(
        json.dumps(
            {
                "session_id": "variation_session",
                "status": "completed",
                "tasks_attempted": 2,
                "tasks_completed": 2,
                "tasks_blocked": 0,
                "timestamp": "2026-04-02T00:20:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    farther_artifact = artifacts_dir / "INTAKE_VARIATION__STEP_01_attempt_01.json"
    farther_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_VARIATION__STEP_01",
                    "plan_id": "PLAN_VARIATION",
                    "plan_title": "Try zombie movement variation",
                    "plan_step_index": 1,
                    "plan_step_title": "Move zombie farther forward for variation testing",
                    "operator_prompt": "move zombie farther forward",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_VARIATION_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "move zombie farther forward",
                        "action_name": "move_entity_farther_forward",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 0.0],
                        "new_position": [0.0, 0.0, 6.0],
                        "movement_distance": 6.0,
                        "position_changed": True,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_entity_transform_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded movement variation validation passed.",
                },
                "timestamp": "2026-04-02T00:20:01Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    move_artifact = artifacts_dir / "INTAKE_VARIATION__STEP_02_attempt_01.json"
    move_artifact.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_VARIATION__STEP_02",
                    "plan_id": "PLAN_VARIATION",
                    "plan_title": "Try zombie movement variation",
                    "plan_step_index": 2,
                    "plan_step_title": "Move zombie forward to compare against the standard path",
                    "operator_prompt": "move zombie forward",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                    "request_payload_path": "contracts/intake/requests/REQ_VARIATION_PLAN.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "translated_command": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "action_type": "mutate_entity_transform",
                        "object_name": "AIE_Zombie_001_Instance",
                        "previous_position": [0.0, 0.0, 0.0],
                        "new_position": [0.0, 0.0, 3.0],
                        "movement_distance": 3.0,
                        "position_changed": True,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_entity_transform_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded movement validation passed.",
                },
                "timestamp": "2026-04-02T00:20:02Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.title == "try a variation"
    assert proof.detected_action == "Try zombie movement variation"
    assert proof.proof_status == "Passed"
    assert len(proof.key_steps) == 2
    assert "Move zombie farther forward for variation testing" in proof.key_steps[0]
    assert "Move zombie forward to compare against the standard path" in proof.key_steps[1]
    assert "to (0, 0, 6)" in proof.before_after_summary
    assert "to (0, 0, 3)" in proof.before_after_summary
    assert proof.validation_outcome == "All recorded validation checks passed across 2 planned step(s)."


def test_task_intake_auto_promotes_reference_grass_capability_when_reference_evidence_is_present(tmp_path):
    config = _make_config(tmp_path / "auto_promoted_grass_mutation")
    _write_grass_capability_contracts(config)
    _seed_auto_promoted_reference_capability_proof(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make grass for level_0001",
        session_id="operator-session-auto",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.queue_entry["status"] == "pending"
    assert result.queue_entry["approval_state"] == "auto_approved"
    assert result.queue_entry["approved_by"] == "system_intelligence_v1"
    assert result.routing.execution_decision == "auto_execute"
    assert result.routing.recommended_action == "auto_execute"
    assert result.routing.auto_execution_enabled is True
    assert result.routing.approval_required is False
    assert result.routing.eligible_for_auto is True
    assert result.routing.decision == "auto_execute"
    assert runtime_payload["runtime_task"]["approval_state"] == "auto_approved"
    assert runtime_payload["runtime_task"]["execution_decision"] == "auto_execute"
    assert runtime_payload["runtime_task"]["auto_execution_enabled"] is True
    assert runtime_payload["runtime_task"]["decision"] == "auto_execute"


def test_task_intake_blocks_mutation_that_exceeds_locked_project_rating(tmp_path):
    config = _make_config(tmp_path / "blocked_content_policy_mutation")
    _write_locked_content_profile(config, rating_system="ESRB", rating_target="T")
    _write_finisher_capability_contract(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "add finisher system for level_0001",
        session_id="operator-session-rating-block",
        target_repo="E:/AI projects 2025/BABYLON VER 2",
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.queue_entry["status"] == "blocked"
    assert result.queue_entry["approval_state"] == "blocked"
    assert result.routing.capability_id == "level_0001_finisher_system"
    assert result.routing.content_policy_match == "exceeds_rating"
    assert result.routing.content_policy_decision == "blocked"
    assert result.routing.required_rating_upgrade == "M"
    assert result.routing.execution_decision == "blocked"
    assert result.routing.recommended_action == "blocked"
    assert result.routing.decision == "block"
    assert runtime_payload["runtime_task"]["approval_state"] == "blocked"
    assert runtime_payload["runtime_task"]["requested_content_dimensions"]["gore_level"] == "extreme"
    assert runtime_payload["runtime_task"]["requested_content_dimensions"]["dismemberment"] is True


def test_task_intake_routes_direct_encounter_count_prompt(tmp_path):
    config = _make_config(tmp_path / "encounter_count_mutation_request")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "increase encounter count",
        session_id="operator-session-encounter-count",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.routing.capability_id == "level_0001_increase_encounter_count"
    assert result.routing.decision == "sandbox_first"
    assert result.routing.plan_title is None
    assert runtime_payload["runtime_task"]["operator_prompt"] == "increase encounter count"


def test_task_intake_routes_direct_spawn_pressure_prompt(tmp_path):
    config = _make_config(tmp_path / "spawn_pressure_mutation_request")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "decrease spawn pressure",
        session_id="operator-session-spawn-pressure",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.routing.capability_id == "level_0001_decrease_spawn_pressure"
    assert result.routing.decision == "sandbox_first"
    assert runtime_payload["runtime_task"]["operator_prompt"] == "decrease spawn pressure"


def test_task_intake_resolves_goal_intent_prompt_to_predefined_encounter_plan(tmp_path):
    config = _make_config(tmp_path / "goal_intent_encounter_intensity_plan")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make encounter more intense",
        session_id="operator-session-goal-intent-encounter",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.mapped_prompt == "increase encounter intensity"
    assert result.routing.plan_title == "Increase encounter intensity"
    assert result.routing.decision == "sandbox_first"
    assert result.plan_step_titles == [
        "Increase encounter count",
        "Increase spawn pressure",
    ]
    assert result.routing.session_resolution_note == (
        'AI-E mapped the gameplay goal "make encounter more intense" to the bounded plan "increase encounter intensity".'
    )
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "increase encounter intensity"
    assert [payload["operator_prompt"] for payload in runtime_payloads] == [
        "increase encounter count",
        "increase spawn pressure",
    ]


def test_task_intake_resolves_restore_encounter_goal_intent_prompt_to_standard_plan(tmp_path):
    config = _make_config(tmp_path / "goal_intent_encounter_restore_plan")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "restore encounter to standard",
        session_id="operator-session-goal-intent-encounter-restore",
        target_repo=target_repo,
    )

    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.mapped_prompt == "restore encounter to standard"
    assert result.routing.plan_title == "Restore encounter to standard"
    assert [payload["operator_prompt"] for payload in runtime_payloads] == [
        "restore encounter count to standard",
        "restore spawn pressure to standard",
    ]


def test_home_surface_prepare_prompt_resolves_encounter_followup_when_unambiguous(tmp_path):
    config = _make_config(tmp_path / "home_surface_encounter_followup")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    state_store = StateStore(config.runs_dir, home_surface.DEFAULT_SUBMIT_SESSION_ID)
    state_store.save(
        {
            "session_id": home_surface.DEFAULT_SUBMIT_SESSION_ID,
            "session_tuning_history": [
                {
                    "family": "encounter_count",
                    "target_context": "encounter",
                    "target_entity": "encounter",
                    "source_prompt": "increase encounter count",
                    "canonical_prompt": "increase encounter count",
                    "previous_tier": "standard",
                    "requested_tier": "high",
                    "resulting_tier": "high",
                    "executed": True,
                    "result_reason": "applied",
                }
            ],
            "session_tuning_state": {
                "target_context": "encounter",
                "target_entity": "encounter",
                "last_mutation": {
                    "family": "encounter_count",
                    "target_context": "encounter",
                    "target_entity": "encounter",
                    "resulting_tier": "high",
                },
                "contexts": {
                    "encounter": {
                        "encounter_count": {
                            "family": "encounter_count",
                            "target_context": "encounter",
                            "target_entity": "encounter",
                            "resulting_tier": "high",
                        },
                        "last_mutation": {
                            "family": "encounter_count",
                            "target_context": "encounter",
                            "target_entity": "encounter",
                            "resulting_tier": "high",
                        },
                    }
                },
            },
            "experiment_tracking": {},
            "latest_experiment_variant": {},
            "result_state_history": [],
            "result_evaluation_history": [],
            "latest_result_evaluation": {},
        }
    )

    preview = bridge.prepare_prompt("make it easier", project)

    assert preview.available is True
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.plan_title == "Reduce encounter intensity"
    assert preview.mapped_prompt == "decrease encounter intensity"
    assert preview.plan_steps == [
        "Decrease encounter count",
        "Decrease spawn pressure",
    ]
    assert preview.decision_reason.startswith('AI-E resolved "make it easier" from the current encounter session')


def test_home_surface_blocks_followup_when_enemy_and_encounter_contexts_are_mixed(tmp_path):
    config = _make_config(tmp_path / "home_surface_mixed_followup_blocked")
    _write_zombie_speed_capability_contracts(config)
    _write_runner_speed_capability_contracts(config)
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    state_store = StateStore(config.runs_dir, home_surface.DEFAULT_SUBMIT_SESSION_ID)
    state_store.save(
        {
            "session_id": home_surface.DEFAULT_SUBMIT_SESSION_ID,
            "session_tuning_history": [
                {
                    "family": "speed",
                    "target_context": "zombie",
                    "target_entity": "zombie",
                    "source_prompt": "make zombie faster",
                    "canonical_prompt": "make zombie faster",
                    "previous_tier": "standard",
                    "requested_tier": "fast",
                    "resulting_tier": "fast",
                    "executed": True,
                    "result_reason": "applied",
                },
                {
                    "family": "encounter_count",
                    "target_context": "encounter",
                    "target_entity": "encounter",
                    "source_prompt": "increase encounter count",
                    "canonical_prompt": "increase encounter count",
                    "previous_tier": "standard",
                    "requested_tier": "high",
                    "resulting_tier": "high",
                    "executed": True,
                    "result_reason": "applied",
                },
            ],
            "session_tuning_state": {
                "target_context": "encounter",
                "target_entity": "encounter",
                "last_mutation": {
                    "family": "encounter_count",
                    "target_context": "encounter",
                    "target_entity": "encounter",
                    "resulting_tier": "high",
                },
                "contexts": {
                    "zombie": {
                        "speed": {
                            "family": "speed",
                            "target_context": "zombie",
                            "target_entity": "zombie",
                            "resulting_tier": "fast",
                        }
                    },
                    "encounter": {
                        "encounter_count": {
                            "family": "encounter_count",
                            "target_context": "encounter",
                            "target_entity": "encounter",
                            "resulting_tier": "high",
                        },
                        "last_mutation": {
                            "family": "encounter_count",
                            "target_context": "encounter",
                            "target_entity": "encounter",
                            "resulting_tier": "high",
                        },
                    },
                },
            },
            "experiment_tracking": {},
            "latest_experiment_variant": {},
            "result_state_history": [],
            "result_evaluation_history": [],
            "latest_result_evaluation": {},
        }
    )

    preview = bridge.prepare_prompt("make it easier", project)

    assert preview.available is True
    assert preview.decision_state == "Blocked"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Revise request"
    assert preview.plan_title == "Clarify target"
    assert preview.plan_steps == [
        "make zombie easier",
        "make runner easier",
        "make encounter easier",
    ]
    assert preview.plan_execution_mode == "Clarification required"
    assert "contains both" in preview.decision_reason
    assert "ambiguous between entity tuning and encounter tuning" in preview.decision_reason
    assert "make encounter easier" in preview.decision_reason


def test_task_intake_blocks_mixed_followup_with_clarification_options_and_no_execution(tmp_path):
    config = _make_config(tmp_path / "task_intake_mixed_followup_blocked")
    _write_zombie_speed_capability_contracts(config)
    _write_runner_speed_capability_contracts(config)
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    state_store = StateStore(config.runs_dir, "mixed-followup-intake-session")
    state_store.save(
        {
            "session_id": "mixed-followup-intake-session",
            "session_tuning_history": [
                {
                    "family": "speed",
                    "target_context": "zombie",
                    "target_entity": "zombie",
                    "source_prompt": "make zombie faster",
                    "canonical_prompt": "make zombie faster",
                    "previous_tier": "standard",
                    "requested_tier": "fast",
                    "resulting_tier": "fast",
                    "executed": True,
                    "result_reason": "applied",
                },
                {
                    "family": "encounter_count",
                    "target_context": "encounter",
                    "target_entity": "encounter",
                    "source_prompt": "increase encounter count",
                    "canonical_prompt": "increase encounter count",
                    "previous_tier": "standard",
                    "requested_tier": "high",
                    "resulting_tier": "high",
                    "executed": True,
                    "result_reason": "applied",
                },
            ],
            "session_tuning_state": {
                "target_context": "encounter",
                "target_entity": "encounter",
                "contexts": {
                    "zombie": {
                        "speed": {
                            "family": "speed",
                            "target_context": "zombie",
                            "target_entity": "zombie",
                            "resulting_tier": "fast",
                        }
                    },
                    "encounter": {
                        "encounter_count": {
                            "family": "encounter_count",
                            "target_context": "encounter",
                            "target_entity": "encounter",
                            "resulting_tier": "high",
                        }
                    },
                },
            },
            "experiment_tracking": {},
            "latest_experiment_variant": {},
            "result_state_history": [],
            "result_evaluation_history": [],
            "latest_result_evaluation": {},
        }
    )
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make it easier",
        session_id="mixed-followup-intake-session",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))["runtime_task"]

    assert result.queue_entry["status"] == "blocked"
    assert result.routing.decision == "block"
    assert result.routing.clarification_options == [
        "make zombie easier",
        "make runner easier",
        "make encounter easier",
    ]
    assert result.routing.plan_expected_outcome == (
        "Clarification only. No execution will start until you choose one explicit supported request."
    )
    assert runtime_payload["decision"] == "block"
    assert runtime_payload["clarification_options"] == [
        "make zombie easier",
        "make runner easier",
        "make encounter easier",
    ]


def test_home_surface_prepare_prompt_shows_current_encounter_experiment_decisions(tmp_path):
    config = _make_config(tmp_path / "home_surface_encounter_experiment_decisions")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    state_store = StateStore(config.runs_dir, home_surface.DEFAULT_SUBMIT_SESSION_ID)
    state_store.save(
        {
            "session_id": home_surface.DEFAULT_SUBMIT_SESSION_ID,
            "experiment_tracking": {
                "active_experiment_id": "experiment_0001",
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_context": "encounter",
                        "target_entity": "encounter",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "",
                        "latest_decision": {},
                        "variants": [
                            {
                                "experiment_id": "experiment_0001",
                                "variant_id": "variant_0001",
                                "baseline_variant_id": "variant_0001",
                                "baseline_marker": True,
                                "variant_kind": "baseline",
                                "source_prompt": "increase encounter count",
                                "canonical_prompt": "increase encounter count",
                                "encounter_count_tier": "high",
                                "spawn_pressure_tier": "standard",
                                "outcome_summary": "encounter count high, spawn pressure standard",
                                "decision_status": "undecided",
                                "target_context": "encounter",
                                "target_entity": "encounter",
                            }
                        ],
                    }
                ],
            },
            "session_tuning_history": [],
            "session_tuning_state": {},
            "latest_experiment_variant": {},
            "result_state_history": [],
            "result_evaluation_history": [],
            "latest_result_evaluation": {},
        }
    )

    preview = bridge.prepare_prompt("show current experiment decisions", project)

    assert preview.available is True
    assert preview.decision_state == "Review only"
    assert preview.plan_execution_mode == "Current session summary"
    assert "Target context: encounter." in preview.decision_reason
    assert "encounter count high" in " ".join(preview.plan_steps).lower()


def test_home_surface_prepare_prompt_allows_explicit_encounter_goal_without_clarification(tmp_path):
    config = _make_config(tmp_path / "home_surface_explicit_encounter_goal")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make encounter easier", project)

    assert preview.available is True
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.plan_title == "Reduce encounter intensity"
    assert preview.plan_steps == [
        "Decrease encounter count",
        "Decrease spawn pressure",
    ]
    assert preview.plan_title != "Clarify target"


def _write_grass_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_add_grass.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_add_grass",
                "title": "LEVEL_0001 add grass",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/MinimalPlayableArena.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_grass_handler",
                "agent_type": "level_0001_grass_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none",
                },
                "match_terms": ["level_0001", "grass"],
                "match_verbs": ["make", "add", "create", "generate", "place", "build"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_remove_grass.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_remove_grass",
                "title": "LEVEL_0001 remove grass",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/MinimalPlayableArena.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_remove_grass_handler",
                "agent_type": "level_0001_grass_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none",
                },
                "match_terms": ["level_0001", "grass"],
                "match_verbs": ["remove", "delete", "clear"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _session_tuning_record(
    *,
    order: int,
    family: str,
    capability_id: str,
    source_prompt: str,
    canonical_prompt: str,
    previous_tier: str | None = None,
    requested_tier: str | None = None,
    resulting_tier: str | None = None,
    requested_target_value=None,
    observed_value=None,
    executed: bool = True,
    result_reason: str = "applied",
    timestamp: str | None = None,
) -> dict:
    return {
        "order": int(order),
        "timestamp": timestamp or f"2026-04-02T00:00:{order:02d}Z",
        "task_id": f"SESSION_TUNING_{order:03d}",
        "request_id": f"REQ_SESSION_TUNING_{order:03d}",
        "capability_id": capability_id,
        "family": family,
        "target_entity": "zombie",
        "source_prompt": source_prompt,
        "canonical_prompt": canonical_prompt,
        "requested_target_value": requested_target_value,
        "observed_value": observed_value,
        "executed": executed,
        "result_reason": result_reason,
        "previous_tier": previous_tier,
        "requested_tier": requested_tier,
        "resulting_tier": resulting_tier,
        "resolution_source": "direct_prompt",
        "resolved_from_prompt": "",
        "revert_requested": False,
        "revert_summary": "",
    }


def _write_session_tuning_state(
    config: OrchestratorConfig,
    session_id: str,
    *records: dict,
    extra_state: dict | None = None,
) -> None:
    session_dir = config.runs_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    history = [dict(record) for record in records]
    tuning_state: dict[str, object] = {"target_entity": "zombie"}
    if history:
        tuning_state["last_mutation"] = dict(history[-1])
        for record in history:
            family = str(record.get("family") or "").strip()
            if family:
                tuning_state[family] = dict(record)
    payload = {
        "session_id": session_id,
        "status": "idle",
        "session_tuning_history": history,
        "session_tuning_state": tuning_state,
    }
    if isinstance(extra_state, dict):
        payload.update(extra_state)
    (session_dir / "session_state.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )


def _experiment_variant(
    *,
    order: int,
    experiment_id: str,
    variant_id: str,
    source_prompt: str,
    canonical_prompt: str,
    variant_kind: str,
    speed_tier: str = "",
    aggression_tier: str = "",
    movement_tier: str = "",
    encounter_count_tier: str = "",
    spawn_pressure_tier: str = "",
    jump_height_tier: str = "",
    gravity_tier: str = "",
    gap_size_tier: str = "",
    obstacle_density_tier: str = "",
    enemy_density_tier: str = "",
    segment_count_tier: str = "",
    acceleration_tier: str = "",
    max_speed_tier: str = "",
    baseline_marker: bool = False,
    baseline_variant_id: str = "",
    parent_variant_id: str = "",
    outcome_summary: str = "",
    task_id: str | None = None,
    request_id: str | None = None,
    plan_id: str = "",
    plan_key: str = "",
    plan_title: str = "",
    level_set_id: str = "",
    level_set_name: str = "",
    level_profile_id: str = "",
    level_profile_name: str = "",
    layout_id: str = "",
    layout_name: str = "",
    manual_edit_mode: str = "",
    layout_correction_count: int = 0,
    layout_correction_summary: str = "",
    derived_from_corrected_layout: bool = False,
    layout_validation_available: bool = False,
    layout_validation_status: str = "",
    layout_validation_status_label: str = "",
    layout_validation_summary: str = "",
    layout_validation_issue_count: int = 0,
    layout_validation_blocking_issue_count: int = 0,
    layout_validation_severity_counts: dict | None = None,
    layout_validation_severity_summary: str = "",
    layout_validation_category_counts: dict | None = None,
    layout_validation_category_summary: str = "",
    layout_validation_issue_type_counts: dict | None = None,
    layout_validation_issue_type_summary: str = "",
    layout_validation_highlights: list[str] | None = None,
    decision_status: str = "undecided",
    decision_order: int | None = None,
    decision_timestamp: str = "",
    decision_source: str = "",
) -> dict:
    return {
        "experiment_id": experiment_id,
        "variant_id": variant_id,
        "parent_variant_id": parent_variant_id,
        "baseline_variant_id": baseline_variant_id or variant_id,
        "baseline_marker": baseline_marker,
        "variant_kind": variant_kind,
        "order": int(order),
        "timestamp": f"2026-04-02T01:00:{order:02d}Z",
        "task_id": task_id or f"TASK_{variant_id}",
        "request_id": request_id or f"REQ_{variant_id}",
        "plan_id": plan_id,
        "plan_key": plan_key,
        "plan_title": plan_title,
        "level_set_id": level_set_id,
        "level_set_name": level_set_name,
        "source_prompt": source_prompt,
        "canonical_prompt": canonical_prompt,
        "resolution_source": "direct_prompt",
        "resolved_from_prompt": "",
        "level_profile_id": level_profile_id,
        "level_profile_name": level_profile_name,
        "layout_id": layout_id,
        "layout_name": layout_name,
        "manual_edit_mode": manual_edit_mode,
        "layout_correction_count": int(layout_correction_count),
        "layout_correction_summary": layout_correction_summary,
        "derived_from_corrected_layout": derived_from_corrected_layout,
        "layout_validation_available": layout_validation_available,
        "layout_validation_status": layout_validation_status,
        "layout_validation_status_label": layout_validation_status_label,
        "layout_validation_summary": layout_validation_summary,
        "layout_validation_issue_count": int(layout_validation_issue_count),
        "layout_validation_blocking_issue_count": int(layout_validation_blocking_issue_count),
        "layout_validation_severity_counts": dict(layout_validation_severity_counts or {}),
        "layout_validation_severity_summary": layout_validation_severity_summary,
        "layout_validation_category_counts": dict(layout_validation_category_counts or {}),
        "layout_validation_category_summary": layout_validation_category_summary,
        "layout_validation_issue_type_counts": dict(layout_validation_issue_type_counts or {}),
        "layout_validation_issue_type_summary": layout_validation_issue_type_summary,
        "layout_validation_highlights": list(layout_validation_highlights or []),
        "speed_tier": speed_tier,
        "speed_value": 4.5 if speed_tier == "fast" else (2.5 if speed_tier == "slow" else 3.5 if speed_tier else None),
        "aggression_tier": aggression_tier,
        "aggression_value": 0.6 if aggression_tier == "aggressive" else (1.0 if aggression_tier else None),
        "movement_tier": movement_tier,
        "movement_value": [0.0, 0.0, 6.0] if movement_tier == "movement_variation" else ([0.0, 0.0, 3.0] if movement_tier == "standard_forward" else None),
        "encounter_count_tier": encounter_count_tier,
        "encounter_count_value": 5 if encounter_count_tier == "high" else (2 if encounter_count_tier == "low" else 3 if encounter_count_tier == "standard" else None),
        "spawn_pressure_tier": spawn_pressure_tier,
        "spawn_pressure_value": 1.2 if spawn_pressure_tier == "high" else (3.0 if spawn_pressure_tier == "low" else 2.0 if spawn_pressure_tier == "standard" else None),
        "jump_height_tier": jump_height_tier,
        "jump_height_value": 1.6 if jump_height_tier == "high" else (0.9 if jump_height_tier == "low" else 1.2 if jump_height_tier == "standard" else None),
        "gravity_tier": gravity_tier,
        "gravity_value": 6.0 if gravity_tier == "low_gravity" else (13.0 if gravity_tier == "high_gravity" else 9.81 if gravity_tier == "standard_gravity" else None),
        "gap_size_tier": gap_size_tier,
        "gap_size_value": 4.5 if gap_size_tier == "large" else (2.0 if gap_size_tier == "small" else 3.0 if gap_size_tier == "standard" else None),
        "obstacle_density_tier": obstacle_density_tier,
        "obstacle_density_value": 1.5 if obstacle_density_tier == "dense" else (0.5 if obstacle_density_tier == "sparse" else 1.0 if obstacle_density_tier == "standard" else None),
        "enemy_density_tier": enemy_density_tier,
        "enemy_density_value": 3.0 if enemy_density_tier == "high" else (1.0 if enemy_density_tier == "low" else 2.0 if enemy_density_tier == "standard" else None),
        "segment_count_tier": segment_count_tier,
        "segment_count_value": 12.0 if segment_count_tier == "long" else (5.0 if segment_count_tier == "short" else 8.0 if segment_count_tier == "standard" else None),
        "acceleration_tier": acceleration_tier,
        "acceleration_value": 6.5 if acceleration_tier == "fast" else (3.5 if acceleration_tier == "slow" else 5.0 if acceleration_tier == "standard" else None),
        "max_speed_tier": max_speed_tier,
        "max_speed_value": 15.0 if max_speed_tier == "fast" else (10.0 if max_speed_tier == "slow" else 12.5 if max_speed_tier == "standard" else None),
        "generic_capability_state": build_generic_capability_state(
            target_context="encounter" if encounter_count_tier or spawn_pressure_tier else "platformer" if gap_size_tier or obstacle_density_tier or enemy_density_tier or segment_count_tier or jump_height_tier or gravity_tier or "jump" in canonical_prompt or "gravity" in canonical_prompt or "movement" in canonical_prompt or "gap" in canonical_prompt or "obstacle" in canonical_prompt or "segment" in canonical_prompt or "level" in canonical_prompt else "racer" if acceleration_tier or max_speed_tier else "runner" if "runner" in canonical_prompt else "zombie",
            speed_tier=speed_tier,
            speed_value=4.5 if speed_tier == "standard" else (5.0 if speed_tier == "fast" else 3.5 if speed_tier == "slow" else None),
            aggression_tier=aggression_tier,
            aggression_value=0.8 if aggression_tier == "standard" else (0.5 if aggression_tier == "aggressive" else None),
            encounter_count_tier=encounter_count_tier,
            encounter_count_value=5 if encounter_count_tier == "high" else (2 if encounter_count_tier == "low" else 3 if encounter_count_tier == "standard" else None),
            spawn_pressure_tier=spawn_pressure_tier,
            spawn_pressure_value=1.2 if spawn_pressure_tier == "high" else (3.0 if spawn_pressure_tier == "low" else 2.0 if spawn_pressure_tier == "standard" else None),
            jump_height_tier=jump_height_tier,
            jump_height_value=1.6 if jump_height_tier == "high" else (0.9 if jump_height_tier == "low" else 1.2 if jump_height_tier == "standard" else None),
            gravity_tier=gravity_tier,
            gravity_value=6.0 if gravity_tier == "low_gravity" else (13.0 if gravity_tier == "high_gravity" else 9.81 if gravity_tier == "standard_gravity" else None),
            gap_size_tier=gap_size_tier,
            gap_size_value=4.5 if gap_size_tier == "large" else (2.0 if gap_size_tier == "small" else 3.0 if gap_size_tier == "standard" else None),
            obstacle_density_tier=obstacle_density_tier,
            obstacle_density_value=1.5 if obstacle_density_tier == "dense" else (0.5 if obstacle_density_tier == "sparse" else 1.0 if obstacle_density_tier == "standard" else None),
            enemy_density_tier=enemy_density_tier,
            enemy_density_value=3.0 if enemy_density_tier == "high" else (1.0 if enemy_density_tier == "low" else 2.0 if enemy_density_tier == "standard" else None),
            segment_count_tier=segment_count_tier,
            segment_count_value=12.0 if segment_count_tier == "long" else (5.0 if segment_count_tier == "short" else 8.0 if segment_count_tier == "standard" else None),
            acceleration_tier=acceleration_tier,
            acceleration_value=6.5 if acceleration_tier == "fast" else (3.5 if acceleration_tier == "slow" else 5.0 if acceleration_tier == "standard" else None),
            max_speed_tier=max_speed_tier,
            max_speed_value=15.0 if max_speed_tier == "fast" else (10.0 if max_speed_tier == "slow" else 12.5 if max_speed_tier == "standard" else None),
        ),
        "executed": True,
        "result_reason": "applied",
        "decision_status": decision_status,
        "decision_order": decision_order,
        "decision_timestamp": decision_timestamp,
        "decision_source": decision_source,
        "outcome_summary": outcome_summary or ", ".join(
            [
                part
                for part in (
                    f"speed {speed_tier}" if speed_tier else "",
                    f"aggression {aggression_tier}" if aggression_tier else "",
                    "movement variation" if movement_tier == "movement_variation" else ("standard forward movement" if movement_tier == "standard_forward" else ""),
                    f"encounter count {encounter_count_tier}" if encounter_count_tier else "",
                    f"spawn pressure {spawn_pressure_tier}" if spawn_pressure_tier else "",
                    f"jump height {jump_height_tier}" if jump_height_tier else "",
                    f"gravity {gravity_tier}" if gravity_tier else "",
                    f"gap size {gap_size_tier}" if gap_size_tier else "",
                    f"obstacle density {obstacle_density_tier}" if obstacle_density_tier else "",
                    f"enemy density {enemy_density_tier}" if enemy_density_tier else "",
                    f"segment count {segment_count_tier}" if segment_count_tier else "",
                    f"acceleration {acceleration_tier}" if acceleration_tier else "",
                    f"max speed {max_speed_tier}" if max_speed_tier else "",
                )
                if part
            ]
        ),
    }

@pytest.mark.parametrize(
    ("prompt_text", "expected_capability", "expected_canonical_prompt", "expected_decision"),
    [
        ("make runner faster", "level_0001_increase_runner_speed", "make runner faster", "sandbox_first"),
        ("make runner slower", "level_0001_decrease_runner_speed", "make runner slower", "sandbox_first"),
        ("restore runner speed to standard", "level_0001_restore_runner_speed_standard", "restore runner speed to standard", "require_approval"),
        ("make runner more aggressive", "level_0001_increase_runner_aggression", "make runner more aggressive", "sandbox_first"),
        (
            "restore runner aggression to standard",
            "level_0001_restore_runner_aggression_standard",
            "restore runner aggression to standard",
            "require_approval",
        ),
    ],
)
def test_task_intake_supports_direct_runner_deterministic_capabilities(
    tmp_path,
    prompt_text,
    expected_capability,
    expected_canonical_prompt,
    expected_decision,
):
    config = _make_config(tmp_path / "runner_direct_capabilities")
    _write_runner_speed_capability_contracts(config)
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-runner-direct",
        target_repo=target_repo,
    )

    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))["runtime_task"]

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == expected_capability
    assert result.routing.mapped_prompt == expected_canonical_prompt
    assert result.routing.decision == expected_decision
    assert runtime_payload["operator_prompt"] == expected_canonical_prompt


@pytest.mark.parametrize(
    ("prompt_text", "expected_note"),
    [
        (
            "make runner more dangerous",
            'AI-E mapped the gameplay goal "make runner more dangerous" to the bounded plan "make runner faster and more aggressive".',
        ),
        (
            "make runner more intense",
            'AI-E mapped the gameplay goal "make runner more intense" to the bounded plan "make runner faster and more aggressive".',
        ),
    ],
)
def test_task_intake_resolves_runner_goal_intent_to_predefined_combat_variation_plan(
    tmp_path,
    prompt_text,
    expected_note,
):
    config = _make_config(tmp_path / "runner_goal_intent_combat_plan")
    _write_runner_speed_capability_contracts(config)
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-runner-goal-intent",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(Path(path).read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.session_resolution_note == expected_note
    assert result.routing.mapped_prompt == "make runner faster and more aggressive"
    assert result.routing.plan_title == "Test runner combat variation"
    assert result.plan_step_titles == [
        "Increase runner speed",
        "Increase runner aggression",
    ]
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "make runner faster and more aggressive"
    assert runtime_payloads[0]["operator_prompt"] == "make runner faster"
    assert runtime_payloads[1]["operator_prompt"] == "make runner more aggressive"


@pytest.mark.parametrize(
    ("prompt_text", "expected_note"),
    [
        (
            "make runner easier",
            'AI-E mapped the gameplay goal "make runner easier" to the bounded plan "restore runner danger to standard".',
        ),
        (
            "make runner less dangerous",
            'AI-E mapped the gameplay goal "make runner less dangerous" to the bounded plan "restore runner danger to standard".',
        ),
    ],
)
def test_task_intake_resolves_runner_goal_intent_to_restore_standard_runner_plan(
    tmp_path,
    prompt_text,
    expected_note,
):
    config = _make_config(tmp_path / "runner_goal_intent_restore_plan")
    _write_runner_speed_capability_contracts(config)
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="operator-session-runner-restore-goal",
        target_repo=target_repo,
    )

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.session_resolution_note == expected_note
    assert result.routing.mapped_prompt == "restore runner danger to standard"
    assert result.routing.plan_title == "Restore standard runner danger"
    assert result.plan_step_titles == [
        "Restore runner movement speed to standard",
        "Restore runner aggression to standard",
    ]


def test_task_intake_resolves_runner_session_followup_when_unambiguous(tmp_path):
    config = _make_config(tmp_path / "runner_followup")
    _write_runner_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "runner-followup-session")
    state_store.save(
        {
            "session_id": "runner-followup-session",
            "session_tuning_history": [
                {
                    "order": 1,
                    "family": "speed",
                    "target_entity": "runner",
                    "source_prompt": "make runner faster",
                    "canonical_prompt": "make runner faster",
                    "requested_tier": "fast",
                    "resulting_tier": "fast",
                    "executed": True,
                    "result_reason": "applied",
                }
            ],
            "session_tuning_state": {
                "target_entity": "runner",
                "last_mutation": {
                    "family": "speed",
                    "target_entity": "runner",
                    "resulting_tier": "fast",
                    "canonical_prompt": "make runner faster",
                },
                "speed": {
                    "family": "speed",
                    "target_entity": "runner",
                    "resulting_tier": "fast",
                    "canonical_prompt": "make runner faster",
                },
                "entities": {
                    "runner": {
                        "last_mutation": {
                            "family": "speed",
                            "target_entity": "runner",
                            "resulting_tier": "fast",
                            "canonical_prompt": "make runner faster",
                        },
                        "speed": {
                            "family": "speed",
                            "target_entity": "runner",
                            "resulting_tier": "fast",
                            "canonical_prompt": "make runner faster",
                        },
                    }
                },
            },
        }
    )

    result = intake.accept_message(
        "make it slower",
        session_id="runner-followup-session",
        target_repo=target_repo,
    )

    assert result.routing.resolution_source == "session_followup_resolution"
    assert result.routing.mapped_prompt == "restore runner speed to standard"
    assert result.routing.requested_tier == "standard"
    assert result.routing.decision == "require_approval"


def test_task_intake_resolves_runner_session_make_it_easier_when_unambiguous(tmp_path):
    config = _make_config(tmp_path / "runner_followup_easier")
    _write_runner_speed_capability_contracts(config)
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "runner-followup-easier-session")
    state_store.save(
        {
            "session_id": "runner-followup-easier-session",
            "session_tuning_history": [
                {
                    "order": 1,
                    "family": "speed",
                    "target_context": "runner",
                    "target_entity": "runner",
                    "source_prompt": "make runner faster",
                    "canonical_prompt": "make runner faster",
                    "requested_tier": "fast",
                    "resulting_tier": "fast",
                    "executed": True,
                    "result_reason": "applied",
                }
            ],
            "session_tuning_state": {
                "target_context": "runner",
                "target_entity": "runner",
                "last_mutation": {
                    "family": "speed",
                    "target_context": "runner",
                    "target_entity": "runner",
                    "resulting_tier": "fast",
                    "canonical_prompt": "make runner faster",
                },
                "contexts": {
                    "runner": {
                        "last_mutation": {
                            "family": "speed",
                            "target_context": "runner",
                            "target_entity": "runner",
                            "resulting_tier": "fast",
                            "canonical_prompt": "make runner faster",
                        },
                        "speed": {
                            "family": "speed",
                            "target_context": "runner",
                            "target_entity": "runner",
                            "resulting_tier": "fast",
                            "canonical_prompt": "make runner faster",
                        },
                    }
                },
            },
        }
    )

    result = intake.accept_message(
        "make it easier",
        session_id="runner-followup-easier-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] != "blocked"
    assert result.routing.resolution_source == "session_followup_resolution"
    assert result.routing.mapped_prompt == "restore runner danger to standard"
    assert result.routing.clarification_options in (None, [])
    assert result.routing.decision == "require_approval"


def test_task_intake_shows_runner_experiment_decision_review_summary(tmp_path):
    config = _make_config(tmp_path / "runner_experiment_review")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "runner-experiment-review-session")
    state_store.save(
        {
            "session_id": "runner-experiment-review-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0002",
                "experiments": [
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            {
                                "variant_id": "variant_0001",
                                "source_prompt": "make runner faster",
                                "outcome_summary": "speed fast, aggression standard",
                                "baseline_marker": True,
                                "decision_status": "undecided",
                            },
                            {
                                "variant_id": "variant_0002",
                                "source_prompt": "make runner more dangerous",
                                "outcome_summary": "speed fast, aggression aggressive",
                                "decision_status": "kept",
                            },
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment decisions",
        session_id="runner-experiment-review-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Current experiment decisions"
    assert "Target context: runner." in result.routing.decision_summary
    assert any(
        "variant_0002 | target context: runner | status: current, preferred baseline, kept | prompt: make runner more dangerous" in line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_shows_runner_experiment_variant_review_summary(tmp_path):
    config = _make_config(tmp_path / "runner_experiment_variants_review")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "runner-experiment-variants-session")
    state_store.save(
        {
            "session_id": "runner-experiment-variants-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0003",
                "experiments": [
                    {
                        "experiment_id": "experiment_0003",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            {
                                "variant_id": "variant_0001",
                                "source_prompt": "make runner faster",
                                "outcome_summary": "speed fast, aggression standard",
                                "baseline_marker": True,
                                "decision_status": "undecided",
                            },
                            {
                                "variant_id": "variant_0002",
                                "parent_variant_id": "variant_0001",
                                "source_prompt": "make runner more dangerous",
                                "outcome_summary": "speed fast, aggression aggressive",
                                "decision_status": "kept",
                            },
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment variants",
        session_id="runner-experiment-variants-session",
        target_repo=str(config.root_dir),
    )

    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Current experiment variants"
    assert "Target context: runner." in result.routing.decision_summary
    assert any(
        "variant_0001 | target context: runner | status: original baseline, undecided | prompt: make runner faster" in line
        for line in result.routing.plan_step_titles or []
    )
    assert any(
        "variant_0002 | target context: runner | status: current, kept | prompt: make runner more dangerous" in line
        for line in result.routing.plan_step_titles or []
    )


def test_home_surface_apply_runner_experiment_decision_updates_keep_and_preferred_baseline(tmp_path):
    config = _make_config(tmp_path / "home_surface_runner_experiment_decision_apply")
    _write_move_zombie_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    state_store = StateStore(config.runs_dir, home_surface.DEFAULT_SUBMIT_SESSION_ID)
    state_store.save(
        {
            "session_id": home_surface.DEFAULT_SUBMIT_SESSION_ID,
            "session_tuning_state": {
                "target_entity": "runner",
                "last_mutation": {
                    "family": "speed",
                    "target_entity": "runner",
                    "resulting_tier": "fast",
                    "canonical_prompt": "make runner faster",
                },
            },
            "experiment_tracking": {
                "active_experiment_id": "experiment_0004",
                "next_decision_order": 1,
                "experiments": [
                    {
                        "experiment_id": "experiment_0004",
                        "target_entity": "runner",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            {
                                "variant_id": "variant_0001",
                                "source_prompt": "make runner faster",
                                "outcome_summary": "speed fast, aggression standard",
                                "baseline_marker": True,
                                "decision_status": "undecided",
                            },
                            {
                                "variant_id": "variant_0002",
                                "parent_variant_id": "variant_0001",
                                "source_prompt": "make runner more dangerous",
                                "outcome_summary": "speed fast, aggression aggressive",
                                "decision_status": "undecided",
                            },
                        ],
                    }
                ],
            },
        }
    )
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = type("_ConfigLoader", (), {"load": staticmethod(lambda: config)})
    bridge._state_store_cls = StateStore
    bridge._apply_experiment_decision_fn = apply_experiment_decision
    bridge._get_current_timestamp_fn = lambda: "2026-04-02T08:00:00Z"
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    keep_preview = bridge.prepare_prompt("keep current variant", project)
    keep_result = bridge.apply_experiment_review_prompt(keep_preview)
    assert keep_result.ok is True
    assert keep_result.message == (
        "Recorded: variant_0002 is kept in experiment_0004. "
        "Preferred baseline remains variant_0001. "
        "Original baseline remains variant_0001."
    )

    bridge._get_current_timestamp_fn = lambda: "2026-04-02T08:05:00Z"
    baseline_preview = bridge.prepare_prompt("set current variant as baseline", project)
    baseline_result = bridge.apply_experiment_review_prompt(baseline_preview)
    assert baseline_result.ok is True
    assert baseline_result.message == (
        "Recorded: variant_0002 is now the preferred baseline in experiment_0004. "
        "Later baseline comparisons will reference variant_0002. "
        "Original baseline remains variant_0001."
    )

    updated_state = json.loads(
        (config.runs_dir / home_surface.DEFAULT_SUBMIT_SESSION_ID / "session_state.json").read_text(encoding="utf-8")
    )
    experiment = updated_state["experiment_tracking"]["experiments"][0]
    assert experiment["baseline_variant_id"] == "variant_0001"
    assert experiment["preferred_baseline_variant_id"] == "variant_0002"
    assert experiment["variants"][1]["decision_status"] == "kept"


def test_home_surface_loads_runner_result_with_evaluation_and_decision_metadata(tmp_path):
    session_dir = tmp_path / "runner_session_with_metadata"
    artifacts_dir = session_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / "INTAKE_RUNNER_SPEED_001_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "INTAKE_RUNNER_SPEED_001",
                    "request_id": "REQ_RUNNER_SPEED_001",
                    "operator_prompt": "make runner faster",
                    "target_repo": "E:/AI projects 2025/BABYLON VER 2",
                },
                "result": {
                    "status": "completed",
                    "summary": "level_0001_entity_transform_handler executed make runner faster via mutate_enemy_move_speed",
                    "details": {
                        "translated_command": "make runner faster",
                        "action_name": "increase_enemy_move_speed",
                        "action_type": "mutate_enemy_move_speed",
                        "entity_type": "runner",
                        "object_name": "AIE_Runner_Profile_Instance",
                        "previous_speed": 4.5,
                        "new_speed": 5.0,
                        "requested_speed": 5.0,
                        "minimum_speed": 3.5,
                        "maximum_speed": 5.0,
                        "validation": {
                            "status": "passed",
                            "check": "mutate_enemy_move_speed_artifact_confirmed",
                        },
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded runner speed validation passed.",
                },
                "timestamp": "2026-04-02T08:10:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (session_dir / "session_state.json").write_text(
        json.dumps(
            {
                "result_evaluation_history": [
                    {
                        "task_id": "INTAKE_RUNNER_SPEED_001",
                        "request_id": "REQ_RUNNER_SPEED_001",
                        "evaluation_source": "deterministic_rules",
                        "comparison_description": "What changed\nSpeed changed.\n\nCurrent state vs previous version\nSpeed: fast vs standard\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nHigher movement speed.",
                        "detected_differences": ["Speed: standard -> fast"],
                        "suggestion": "",
                        "experiment_id": "experiment_0004",
                        "variant_id": "variant_0002",
                        "previous_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                    }
                ],
                "latest_result_evaluation": {
                    "task_id": "INTAKE_RUNNER_SPEED_001",
                    "request_id": "REQ_RUNNER_SPEED_001",
                    "evaluation_source": "deterministic_rules",
                    "comparison_description": "What changed\nSpeed changed.\n\nCurrent state vs previous version\nSpeed: fast vs standard\n\nKey differences\nSee explicit deltas below.\n\nExpected gameplay impact\nHigher movement speed.",
                    "detected_differences": ["Speed: standard -> fast"],
                    "suggestion": "",
                    "experiment_id": "experiment_0004",
                    "variant_id": "variant_0002",
                    "previous_variant_id": "variant_0001",
                    "baseline_variant_id": "variant_0001",
                    "preferred_baseline_variant_id": "variant_0002",
                },
                "experiment_tracking": {
                    "active_experiment_id": "experiment_0004",
                    "experiments": [
                        {
                            "experiment_id": "experiment_0004",
                            "target_entity": "runner",
                            "active_variant_id": "variant_0002",
                            "baseline_variant_id": "variant_0001",
                            "preferred_baseline_variant_id": "variant_0002",
                            "latest_decision": {
                                "action": "set_current_variant_as_baseline",
                                "variant_id": "variant_0002",
                                "timestamp": "2026-04-02T08:05:00Z",
                                "order": 2,
                                "source": "explicit_user_review",
                                "summary": "Latest explicit user decision: set variant_0002 as the preferred baseline. Later baseline comparisons will reference variant_0002. Original baseline remains variant_0001.",
                            },
                            "variants": [
                                {
                                    "experiment_id": "experiment_0004",
                                    "variant_id": "variant_0001",
                                    "task_id": "INTAKE_RUNNER_SPEED_000",
                                    "request_id": "REQ_RUNNER_SPEED_000",
                                    "source_prompt": "restore runner speed to standard",
                                    "outcome_summary": "speed standard, aggression standard",
                                    "baseline_marker": True,
                                    "decision_status": "undecided",
                                },
                                {
                                    "experiment_id": "experiment_0004",
                                    "variant_id": "variant_0002",
                                    "parent_variant_id": "variant_0001",
                                    "task_id": "INTAKE_RUNNER_SPEED_001",
                                    "request_id": "REQ_RUNNER_SPEED_001",
                                    "source_prompt": "make runner faster",
                                    "outcome_summary": "speed fast, aggression standard",
                                    "decision_status": "kept",
                                },
                            ],
                        }
                    ],
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(session_dir)

    assert proof.available is True
    assert proof.original_request == "make runner faster"
    assert proof.evaluation_available is True
    assert proof.evaluation_summary == (
        "What changed\n"
        "Speed changed.\n\n"
        "Current state vs previous version\n"
        "Speed: fast vs standard\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "Higher movement speed."
    )
    assert proof.evaluation_differences == ["Speed: standard -> fast"]
    assert proof.experiment_available is True
    assert proof.experiment_id == "experiment_0004"
    assert proof.variant_id == "variant_0002"
    assert proof.preferred_baseline_variant_id == "variant_0002"
    assert proof.decision_status == "kept"
    assert "runner" in proof.before_after_summary.lower()


def test_result_evaluation_formats_combined_encounter_deltas_deterministically():
    state = {
        "session_tuning_state": {
            "target_context": "encounter",
            "target_entity": "encounter",
            "contexts": {
                "encounter": {
                    "encounter_count": {
                        "resulting_tier": "standard",
                        "observed_value": 5,
                        "target_context": "encounter",
                    },
                    "spawn_pressure": {
                        "resulting_tier": "standard",
                        "observed_value": 6.0,
                        "target_context": "encounter",
                    },
                }
            },
        },
        "result_state_history": [],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_ENCOUNTER_BASELINE",
            "request_id": "REQ_ENCOUNTER_BASELINE",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "restore encounter count to standard",
        },
        timestamp="2026-04-03T12:00:00Z",
    )

    state["session_tuning_state"]["contexts"]["encounter"]["encounter_count"] = {
        "resulting_tier": "high",
        "observed_value": 7,
        "target_context": "encounter",
    }
    state["session_tuning_state"]["contexts"]["encounter"]["spawn_pressure"] = {
        "resulting_tier": "high",
        "observed_value": 4.0,
        "target_context": "encounter",
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_ENCOUNTER_VARIANT",
            "request_id": "REQ_ENCOUNTER_VARIANT",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "increase spawn pressure",
        },
        timestamp="2026-04-03T12:01:00Z",
    )

    evaluation = state["latest_result_evaluation"]

    assert evaluation["comparison_description"] == (
        "What changed\n"
        "Spawn count and spawn interval changed.\n\n"
        "Current state vs previous version\n"
        "Spawn count: 7 vs 5\n"
        "Spawn interval: 4.0s vs 6.0s\n\n"
        "Key differences\n"
        "See explicit deltas below.\n\n"
        "Expected gameplay impact\n"
        "More enemies per encounter.\n"
        "Spawn interval is shorter, which increases pressure."
    )
    assert evaluation["detected_differences"] == [
        "Spawn count: 5 -> 7",
        "Spawn interval: 6.0s -> 4.0s (higher pressure)",
    ]
    combined_text = "\n".join([evaluation["comparison_description"], *evaluation["detected_differences"]]).lower()
    assert "better" not in combined_text
    assert "best" not in combined_text


@pytest.mark.parametrize(
    ("target_context", "family", "expected_system", "expected_name", "expected_restore"),
    [
        ("zombie", "speed", "movement", "speed", "restore zombie speed to standard"),
        ("zombie", "aggression", "combat", "aggression", "restore zombie aggression to standard"),
        ("runner", "speed", "movement", "speed", "restore runner speed to standard"),
        ("runner", "aggression", "combat", "aggression", "restore runner aggression to standard"),
        ("encounter", "encounter_count", "encounter", "spawn_count", "restore encounter count to standard"),
        ("encounter", "spawn_pressure", "encounter", "spawn_interval", "restore spawn pressure to standard"),
        ("racer", "acceleration", "movement", "acceleration", "restore racer acceleration to standard"),
        ("racer", "max_speed", "movement", "max_speed", "restore racer max speed to standard"),
        ("platformer", "jump_height", "movement", "jump_height", "restore jump to standard"),
        ("platformer", "gravity", "physics", "gravity", "restore gravity to standard"),
        ("platformer", "speed", "movement", "speed", "restore movement to standard"),
    ],
)
def test_generic_capability_mapping_covers_supported_bounded_systems(
    target_context,
    family,
    expected_system,
    expected_name,
    expected_restore,
):
    mapping = generic_capability_definition(target_context, family)

    assert mapping["target_context"] == target_context
    assert mapping["target_system"] == expected_system
    assert mapping["parameter_name"] == expected_name
    assert mapping["restore_standard_behavior"] == expected_restore
    assert mapping["bounded_tiers"]
    assert mapping["deterministic_values"]
    assert mapping["evaluation_dimension"]


def test_supported_generic_capability_mappings_cover_all_current_domains():
    mappings = supported_generic_capability_mappings()
    expected_pairs = {
        ("zombie", "speed"),
        ("zombie", "aggression"),
        ("runner", "speed"),
        ("runner", "aggression"),
        ("encounter", "spawn_count"),
        ("encounter", "spawn_interval"),
        ("racer", "acceleration"),
        ("racer", "max_speed"),
        ("platformer", "jump_height"),
        ("platformer", "gravity"),
        ("platformer", "speed"),
        ("platformer", "gap_size"),
        ("platformer", "obstacle_density"),
        ("platformer", "enemy_density"),
        ("platformer", "segment_count"),
    }

    assert len(mappings) == len(expected_pairs)
    assert {item["target_context"] for item in mappings} == {
        "zombie",
        "runner",
        "encounter",
        "racer",
        "platformer",
    }
    assert {
        (item["target_context"], item["parameter_name"])
        for item in mappings
    } == expected_pairs


def test_task_intake_preserves_zombie_prompt_and_attaches_generic_capability_definition(tmp_path):
    config = _make_config(tmp_path / "generic_capability_zombie_prompt")
    _write_zombie_speed_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make zombie faster",
        session_id="generic-zombie-session",
        target_repo=target_repo,
    )

    assert result.routing.capability_id == "level_0001_increase_zombie_speed"
    assert result.routing.generic_capability_definition == {
        "target_context": "zombie",
        "target_system": "movement",
        "parameter_family": "speed",
        "parameter_name": "speed",
        "bounded_tiers": ["slow", "standard", "fast"],
        "deterministic_values": {"slow": 2.5, "standard": 3.5, "fast": 4.5},
        "restore_standard_behavior": "restore zombie speed to standard",
        "evaluation_dimension": "movement_speed",
        "source_family": "speed",
    }
    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    assert runtime_payload["runtime_task"]["generic_capability_definition"]["target_context"] == "zombie"


def test_task_intake_preserves_runner_prompt_and_attaches_generic_capability_definition(tmp_path):
    config = _make_config(tmp_path / "generic_capability_runner_prompt")
    _write_runner_aggression_capability_contract(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make runner more aggressive",
        session_id="generic-runner-session",
        target_repo=target_repo,
    )

    assert result.routing.capability_id == "level_0001_increase_runner_aggression"
    assert result.routing.generic_capability_definition["target_context"] == "runner"
    assert result.routing.generic_capability_definition["target_system"] == "combat"
    assert result.routing.generic_capability_definition["parameter_name"] == "aggression"
    assert result.routing.generic_capability_definition["restore_standard_behavior"] == "restore runner aggression to standard"


def test_task_intake_preserves_encounter_prompt_and_attaches_generic_capability_definition(tmp_path):
    config = _make_config(tmp_path / "generic_capability_encounter_prompt")
    _write_encounter_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "increase spawn pressure",
        session_id="generic-encounter-session",
        target_repo=target_repo,
    )

    assert result.routing.capability_id == "level_0001_increase_spawn_pressure"
    assert result.routing.generic_capability_definition["target_context"] == "encounter"
    assert result.routing.generic_capability_definition["target_system"] == "encounter"
    assert result.routing.generic_capability_definition["parameter_name"] == "spawn_interval"
    assert result.routing.generic_capability_definition["restore_standard_behavior"] == "restore spawn pressure to standard"


@pytest.mark.parametrize(
    ("prompt_text", "expected_capability", "expected_parameter_name"),
    [
        ("increase racer acceleration", "level_0001_increase_racer_acceleration", "acceleration"),
        ("increase racer max speed", "level_0001_increase_racer_max_speed", "max_speed"),
    ],
)
def test_task_intake_preserves_racer_prompt_and_attaches_generic_capability_definition(
    tmp_path,
    prompt_text,
    expected_capability,
    expected_parameter_name,
):
    config = _make_config(tmp_path / "generic_capability_racer_prompt")
    _write_racer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="generic-racer-session",
        target_repo=target_repo,
    )

    assert result.routing.capability_id == expected_capability
    assert result.routing.generic_capability_definition["target_context"] == "racer"
    assert result.routing.generic_capability_definition["target_system"] == "movement"
    assert result.routing.generic_capability_definition["parameter_name"] == expected_parameter_name
    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    assert runtime_payload["runtime_task"]["generic_capability_definition"]["target_context"] == "racer"


@pytest.mark.parametrize(
    ("prompt_text", "expected_capability", "expected_parameter_name", "expected_restore_prompt"),
    [
        ("make jump higher", "level_0001_increase_platformer_jump_height", "jump_height", "restore jump to standard"),
        ("reduce gravity", "level_0001_reduce_platformer_gravity", "gravity", "restore gravity to standard"),
        ("make movement faster", "level_0001_increase_platformer_speed", "speed", "restore movement to standard"),
        ("make gaps larger", "level_0001_increase_platformer_gap_size", "gap_size", "restore gap size to standard"),
        ("reduce obstacle density", "level_0001_reduce_platformer_obstacle_density", "obstacle_density", "restore obstacle density to standard"),
        ("increase enemy density", "level_0001_increase_platformer_enemy_density", "enemy_density", "restore enemy density to standard"),
        ("make level longer", "level_0001_increase_platformer_segment_count", "segment_count", "restore segment count to standard"),
    ],
)
def test_task_intake_preserves_platformer_prompt_and_attaches_generic_capability_definition(
    tmp_path,
    prompt_text,
    expected_capability,
    expected_parameter_name,
    expected_restore_prompt,
):
    config = _make_config(tmp_path / "generic_capability_platformer_prompt")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="generic-platformer-session",
        target_repo=target_repo,
    )

    assert result.routing.capability_id == expected_capability
    assert result.routing.generic_capability_definition["target_context"] == "platformer"
    assert result.routing.generic_capability_definition["parameter_name"] == expected_parameter_name
    assert result.routing.generic_capability_definition["restore_standard_behavior"] == expected_restore_prompt
    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))
    assert runtime_payload["runtime_task"]["generic_capability_definition"]["target_context"] == "platformer"


@pytest.mark.parametrize(
    ("prompt_text", "expected_plan_key", "expected_plan_title", "expected_step_prompts"),
    [
        (
            "use level set a",
            "platformer_level_set_a_v1",
            "Use level set a",
            [
                "make jump higher",
                "reduce gravity",
                "restore movement to standard",
                "make gaps smaller",
                "reduce obstacle density",
                "reduce enemy density",
                "restore segment count to standard",
            ],
        ),
        (
            "use level set b",
            "platformer_level_set_b_v1",
            "Use level set b",
            [
                "restore jump to standard",
                "restore gravity to standard",
                "make movement faster",
                "restore gap size to standard",
                "reduce obstacle density",
                "reduce enemy density",
                "make level longer",
            ],
        ),
        (
            "use level set c",
            "platformer_level_set_c_v1",
            "Use level set c",
            [
                "make jump lower",
                "increase gravity",
                "make movement faster",
                "make gaps larger",
                "increase obstacle density",
                "increase enemy density",
                "make level longer",
            ],
        ),
        (
            "make the level easier",
            "platformer_easy_traversal_v1",
            "Use easy traversal",
            [
                "make gaps smaller",
                "reduce obstacle density",
                "reduce enemy density",
                "restore segment count to standard",
            ],
        ),
        (
            "use balanced traversal",
            "platformer_balanced_traversal_v1",
            "Use balanced traversal",
            [
                "restore gap size to standard",
                "restore obstacle density to standard",
                "restore enemy density to standard",
                "restore segment count to standard",
            ],
        ),
        (
            "use challenge traversal",
            "platformer_challenge_traversal_v1",
            "Use challenge traversal",
            [
                "make gaps larger",
                "increase obstacle density",
                "increase enemy density",
                "make level longer",
            ],
        ),
        (
            "use long sparse run",
            "platformer_long_sparse_run_v1",
            "Use long sparse run",
            [
                "restore gap size to standard",
                "reduce obstacle density",
                "reduce enemy density",
                "make level longer",
            ],
        ),
        (
            "use short dense run",
            "platformer_short_dense_run_v1",
            "Use short dense run",
            [
                "restore gap size to standard",
                "increase obstacle density",
                "increase enemy density",
                "make level shorter",
            ],
        ),
    ],
)
def test_task_intake_routes_platformer_profile_plan(
    tmp_path,
    prompt_text,
    expected_plan_key,
    expected_plan_title,
    expected_step_prompts,
):
    config = _make_config(tmp_path / "platformer_profile_plan")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="platformer-profile-session",
        target_repo=target_repo,
    )

    assert result.is_multi_step is True
    assert result.routing.plan_key == expected_plan_key
    assert result.routing.plan_title == expected_plan_title
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]
    assert [payload["operator_prompt"] for payload in runtime_payloads] == expected_step_prompts
    assert {payload["plan_key"] for payload in runtime_payloads} == {expected_plan_key}


def test_task_intake_routes_restore_platformer_level_to_standard_plan(tmp_path):
    config = _make_config(tmp_path / "platformer_restore_layout_plan")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "restore level to standard",
        session_id="platformer-restore-layout-session",
        target_repo=target_repo,
    )

    assert result.is_multi_step is True
    assert result.routing.plan_key == "platformer_restore_layout_standard_v1"
    assert result.plan_step_titles == [
        "Restore gap size to standard",
        "Restore obstacle density to standard",
        "Restore enemy density to standard",
        "Restore segment count to standard",
    ]
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]
    assert [payload["operator_prompt"] for payload in runtime_payloads] == [
        "restore gap size to standard",
        "restore obstacle density to standard",
        "restore enemy density to standard",
        "restore segment count to standard",
    ]
    assert {payload["plan_key"] for payload in runtime_payloads} == {"platformer_restore_layout_standard_v1"}


def test_task_intake_routes_restore_platformer_level_set_to_standard_plan(tmp_path):
    config = _make_config(tmp_path / "platformer_restore_level_set_plan")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "restore level set to standard",
        session_id="platformer-restore-level-set-session",
        target_repo=target_repo,
    )

    assert result.is_multi_step is True
    assert result.routing.plan_key == "platformer_restore_level_set_standard_v1"
    assert result.plan_step_titles == [
        "Restore jump height to standard",
        "Restore gravity to standard",
        "Restore movement speed to standard",
        "Restore gap size to standard",
        "Restore obstacle density to standard",
        "Restore enemy density to standard",
        "Restore segment count to standard",
    ]
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]
    assert [payload["operator_prompt"] for payload in runtime_payloads] == [
        "restore jump to standard",
        "restore gravity to standard",
        "restore movement to standard",
        "restore gap size to standard",
        "restore obstacle density to standard",
        "restore enemy density to standard",
        "restore segment count to standard",
    ]
    assert {payload["plan_key"] for payload in runtime_payloads} == {"platformer_restore_level_set_standard_v1"}


@pytest.mark.parametrize(
    ("prompt_text", "expected_note"),
    [
        (
            "make level more intense",
            'AI-E mapped the gameplay goal "make level more intense" to the bounded platformer plan "use challenge traversal" across the known gap size, obstacle density, enemy density, and segment count families.',
        ),
        (
            "make traversal more challenging but fair",
            'AI-E mapped the gameplay goal "make traversal more challenging but fair" to the bounded platformer plan "use challenge traversal" across the known gap size, obstacle density, enemy density, and segment count families while preserving fairness through mandatory validation and evaluation.',
        ),
    ],
)
def test_task_intake_resolves_platformer_goal_intents_to_bounded_traversal_plan(
    tmp_path,
    prompt_text,
    expected_note,
):
    config = _make_config(tmp_path / "platformer_goal_intent_plan")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="platformer-goal-intent-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.session_resolution_note == expected_note
    assert result.routing.mapped_prompt == "use challenge traversal"
    assert result.routing.goal_components == [
        "increase gap size",
        "increase obstacle density",
        "increase enemy density",
        "increase segment count",
    ]
    assert result.routing.plan_key == "platformer_challenge_traversal_v1"
    assert result.routing.plan_title == "Use challenge traversal"
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert result.plan_step_titles == [
        "Set gap size to large",
        "Set obstacle density to dense",
        "Set enemy density to high",
        "Set segment count to long",
    ]
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "use challenge traversal"
    assert request_payload["conversational_request"]["context"]["routing"]["goal_components"] == [
        "increase gap size",
        "increase obstacle density",
        "increase enemy density",
        "increase segment count",
    ]
    assert [payload["operator_prompt"] for payload in runtime_payloads] == [
        "make gaps larger",
        "increase obstacle density",
        "increase enemy density",
        "make level longer",
    ]
    assert all(payload["source_prompt"] == normalize_prompt(prompt_text) for payload in runtime_payloads)
    assert all(payload["mapped_prompt"] == "use challenge traversal" for payload in runtime_payloads)


@pytest.mark.parametrize(
    "prompt_text",
    [
        "Make this level more intense",
        "Create multiple validated variations for the current platformer level",
        "Modify the current platformer level to increase intensity while preserving reachability and layout validity",
        "Generate bounded platformer variations for review",
    ],
)
def test_task_intake_accepts_natural_language_platformer_autonomy_requests(tmp_path, prompt_text):
    config = _make_config(tmp_path / "platformer_natural_goal_intent_plan")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="platformer-natural-goal-intent-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.requested_intent == "mutate"
    assert result.routing.resolution_source == "goal_intent_mapping"
    assert result.routing.mapped_prompt == "use challenge traversal"
    assert result.routing.plan_key == "platformer_challenge_traversal_v1"
    assert result.routing.plan_title == "Use challenge traversal"
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert "bounded autonomy pipeline" in str(result.routing.decision_summary or "")
    assert "No supported write-capable capability matched the request." not in str(result.routing.decision_summary or "")
    assert "couldn't match it to a known action" not in str(result.routing.decision_summary or "")
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "use challenge traversal"
    assert [payload["operator_prompt"] for payload in runtime_payloads] == [
        "make gaps larger",
        "increase obstacle density",
        "increase enemy density",
        "make level longer",
    ]
    assert all(payload["mapped_prompt"] == "use challenge traversal" for payload in runtime_payloads)
    assert all(payload["source_prompt"] == normalize_prompt(prompt_text) for payload in runtime_payloads)


@pytest.mark.parametrize(
    ("prompt_text", "expected_plan_key", "expected_plan_title", "expected_mapped_prompt", "expected_step_prompts"),
    [
        (
            "Increase obstacle density and enemy density",
            "platformer_multi_intent_obstacle_enemy_v1",
            "Increase obstacle density and enemy density",
            "increase obstacle density and enemy density",
            ["increase obstacle density", "increase enemy density"],
        ),
        (
            "Make the gaps larger and add more obstacles",
            "platformer_multi_intent_gap_obstacle_v1",
            "Make gaps larger and add more obstacles",
            "make gaps larger and add more obstacles",
            ["make gaps larger", "increase obstacle density"],
        ),
        (
            "Make the level longer and increase enemy density",
            "platformer_multi_intent_enemy_segment_v1",
            "Make the level longer and increase enemy density",
            "make level longer and increase enemy density",
            ["increase enemy density", "make level longer"],
        ),
        (
            "Make this section more intense with more obstacles and enemies",
            "platformer_multi_intent_obstacle_enemy_v1",
            "Increase obstacle density and enemy density",
            "increase obstacle density and enemy density",
            ["increase obstacle density", "increase enemy density"],
        ),
    ],
)
def test_task_intake_routes_allowlisted_platformer_multi_intent_prompts_into_reviewed_plans(
    tmp_path,
    prompt_text,
    expected_plan_key,
    expected_plan_title,
    expected_mapped_prompt,
    expected_step_prompts,
):
    config = _make_config(tmp_path / "platformer_multi_intent_plan")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="platformer-multi-intent-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "platformer_multi_intent_composition"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.mapped_prompt == expected_mapped_prompt
    assert result.routing.plan_key == expected_plan_key
    assert result.routing.plan_title == expected_plan_title
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == expected_mapped_prompt
    assert [payload["operator_prompt"] for payload in runtime_payloads] == expected_step_prompts
    assert all(payload["mapped_prompt"] == expected_mapped_prompt for payload in runtime_payloads)
    assert all(payload["source_prompt"] == normalize_prompt(prompt_text) for payload in runtime_payloads)


@pytest.mark.parametrize(
    ("prompt_text", "expected_message_fragment"),
    [
        (
            "Make the gaps larger and add lava",
            "Remove unsupported scope such as lava, destructibles, terrain realism, or art direction.",
        ),
        (
            "Increase obstacle density and make the level longer",
            "AI-E only supports a small allowlisted set of compound platformer mutations in this pass.",
        ),
    ],
)
def test_task_intake_blocks_unsupported_platformer_multi_intent_prompts(tmp_path, prompt_text, expected_message_fragment):
    config = _make_config(tmp_path / "platformer_multi_intent_blocked")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="platformer-multi-intent-blocked-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "blocked"
    assert result.routing.decision == "block"
    assert result.routing.decision_reason == "route_missing"
    assert result.routing.capability_supported is False
    assert result.routing.mutation_capable is False
    assert expected_message_fragment in str(result.routing.fail_closed_reason or "")


def test_platformer_action_extraction_finds_multiple_bounded_families_without_duplicates():
    matches = extract_platformer_action_matches("Make the gaps larger and add more obstacles and more obstacles")

    assert [match.resolution.action_id for match in matches] == [
        "platformer_increase_obstacle_density",
        "platformer_increase_gap_size",
    ]


@pytest.mark.parametrize(
    ("prompt_text", "expected_capability", "expected_canonical_prompt"),
    [
        (
            "Increase obstacle density in the platformer level",
            "level_0001_increase_platformer_obstacle_density",
            "increase obstacle density",
        ),
        (
            "increase platformer obstacle density",
            "level_0001_increase_platformer_obstacle_density",
            "increase obstacle density",
        ),
        (
            "make more obstacles",
            "level_0001_increase_platformer_obstacle_density",
            "increase obstacle density",
        ),
        (
            "increase gap size",
            "level_0001_increase_platformer_gap_size",
            "make gaps larger",
        ),
        (
            "make the gaps larger",
            "level_0001_increase_platformer_gap_size",
            "make gaps larger",
        ),
    ],
)
def test_task_intake_routes_direct_platformer_action_variants_through_canonical_prompt(
    tmp_path,
    prompt_text,
    expected_capability,
    expected_canonical_prompt,
):
    config = _make_config(tmp_path / "direct_platformer_action_variants")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="direct-platformer-action-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == expected_capability
    assert result.routing.mapped_prompt == expected_canonical_prompt
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert "bounded autonomy pipeline" in str(result.routing.decision_summary or "")
    assert "No supported write-capable capability matched the request." not in str(result.routing.decision_summary or "")
    assert "couldn't match it to a known action" not in str(result.routing.decision_summary or "")
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == expected_canonical_prompt


def test_environment_theme_action_normalization_canonicalizes_ground_grass_prompt():
    assert canonicalize_environment_theme_action_prompt("Make the ground grassy") == "apply grass ground theme"


def test_environment_theme_action_normalization_canonicalizes_ground_dirt_prompt():
    assert canonicalize_environment_theme_action_prompt("Change the ground to dirt") == "apply dirt ground theme"


def test_environment_theme_action_normalization_canonicalizes_ground_gravel_prompt():
    assert canonicalize_environment_theme_action_prompt("Change the ground to gravel") == "apply gravel ground theme"


def test_environment_theme_action_normalization_canonicalizes_damaged_ground_prompt():
    assert canonicalize_environment_theme_action_prompt("Make the ground look damaged") == "apply damaged-ground theme"


def test_barrel_action_normalization_canonicalizes_place_prompt():
    assert canonicalize_barrel_action_prompt("Place an explosive barrel") == "enable explosive barrel"


def test_task_intake_routes_direct_explosive_barrel_prompt_through_canonical_prompt(tmp_path):
    config = _make_config(tmp_path / "direct_explosive_barrel_action")
    _write_barrel_capability_contracts(config)
    _write_barrel_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Place an explosive barrel",
        session_id="direct-explosive-barrel-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == "level_0001_enable_explosive_barrel_foundation"
    assert result.routing.mapped_prompt == "enable explosive barrel"
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "enable explosive barrel"


def test_home_surface_explosive_barrel_review_surface_explains_bounded_foundation_scope(tmp_path):
    config = _make_config(tmp_path / "home_surface_explosive_barrel_review")
    _write_barrel_capability_contracts(config)
    _write_barrel_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Enable the explosive barrel", project)
    review = bridge.build_review_surface(preview, project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.mapped_prompt == "enable explosive barrel"
    assert review.available is True
    assert review.request_summary == (
        "Reviewing the bounded explosive barrel foundation action 'enable explosive barrel' for BABYLON TEST. "
        "This approval covers only the reviewed single-barrel foundation change at the fixed approved scene point."
    )
    assert review.approval_reason == (
        "This request enters bounded destructible-object foundation review before any run is queued. "
        "Approval authorizes only the reviewed explosive barrel foundation action 'enable explosive barrel'. "
        "It does not authorize leak simulation, explosion triggers, blast-radius damage, chain reactions, or any extra combat-environment mutation outside the reviewed scope."
    )
    assert review.expected_change_scope == (
        "Limit execution to the reviewed explosive barrel foundation action 'enable explosive barrel' "
        "on the fixed approved barrel target in Babylon FPS game ver 002 for BABYLON TEST. "
        "No free placement, multi-barrel scattering, leak state, explosion trigger, blast-radius damage, or extra combat-prop behavior is included."
    )
    assert review.validation_intent == (
        "After approval, AI-E will execute the reviewed bounded explosive barrel foundation action through the deterministic project tool route, "
        "validate the recorded barrel-foundation artifact, and confirm the approved Babylon scene target before treating the run as complete. "
        "Sandbox remains an explicit alternative path instead of the default approval path."
    )
    assert "single-barrel foundation" in review.request_summary
    assert "leak simulation" in review.approval_reason


def test_task_intake_blocks_richer_explosive_barrel_prompt_outside_foundation_scope(tmp_path):
    config = _make_config(tmp_path / "unsupported_explosive_barrel_prompt")
    _write_barrel_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Add leaking explosive barrels that damage zombies and the player in a blast radius",
        session_id="unsupported-explosive-barrel-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "blocked"
    assert result.routing.decision == "block"
    assert "does not support leak, explosion, blast-radius" in str(result.routing.fail_closed_reason or "")
    assert "place an explosive barrel" in str(result.routing.fail_closed_reason or "")


def test_task_intake_routes_direct_ground_theme_prompt_through_canonical_prompt(tmp_path):
    config = _make_config(tmp_path / "direct_ground_theme_action")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Make the ground grassy",
        session_id="direct-ground-theme-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == "level_0001_apply_grass_ground_theme"
    assert result.routing.mapped_prompt == "apply grass ground theme"
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "apply grass ground theme"


def test_task_intake_routes_direct_dirt_ground_theme_prompt_through_canonical_prompt(tmp_path):
    config = _make_config(tmp_path / "direct_dirt_ground_theme_action")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Change the ground to dirt",
        session_id="direct-dirt-ground-theme-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == "level_0001_apply_dirt_ground_theme"
    assert result.routing.mapped_prompt == "apply dirt ground theme"
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "apply dirt ground theme"


def test_task_intake_routes_direct_gravel_ground_theme_prompt_through_canonical_prompt(tmp_path):
    config = _make_config(tmp_path / "direct_gravel_ground_theme_action")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Change the ground to gravel",
        session_id="direct-gravel-ground-theme-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == "level_0001_apply_gravel_ground_theme"
    assert result.routing.mapped_prompt == "apply gravel ground theme"
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "apply gravel ground theme"


def test_task_intake_routes_direct_damaged_ground_theme_prompt_through_canonical_prompt(tmp_path):
    config = _make_config(tmp_path / "direct_damaged_ground_theme_action")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Make the ground look damaged",
        session_id="direct-damaged-ground-theme-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))

    assert result.task_type == "mutation_request"
    assert result.routing.capability_id == "level_0001_apply_damaged_ground_theme"
    assert result.routing.mapped_prompt == "apply damaged-ground theme"
    assert result.routing.capability_supported is True
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == "apply damaged-ground theme"


@pytest.mark.parametrize(
    ("prompt_text", "expected_plan_key", "expected_plan_title", "expected_mapped_prompt", "expected_step_prompts"),
    [
        (
            "Make the ground gravel and damaged",
            "environment_theme_gravel_damaged_v1",
            "Apply gravel then damaged ground theme",
            "apply gravel then damaged ground theme",
            ["apply gravel ground theme", "apply damaged-ground theme"],
        ),
        (
            "Apply a dirt and damaged ground theme",
            "environment_theme_dirt_damaged_v1",
            "Apply dirt then damaged ground theme",
            "apply dirt then damaged ground theme",
            ["apply dirt ground theme", "apply damaged-ground theme"],
        ),
        (
            "Make the ground grassy and damaged",
            "environment_theme_grass_damaged_v1",
            "Apply grass then damaged ground theme",
            "apply grass then damaged ground theme",
            ["apply grass ground theme", "apply damaged-ground theme"],
        ),
    ],
)
def test_task_intake_routes_allowlisted_environment_theme_multi_intent_prompts_into_reviewed_plans(
    tmp_path,
    prompt_text,
    expected_plan_key,
    expected_plan_title,
    expected_mapped_prompt,
    expected_step_prompts,
):
    config = _make_config(tmp_path / "environment_theme_multi_intent_plan")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        prompt_text,
        session_id="environment-theme-multi-intent-session",
        target_repo=target_repo,
    )

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]
    runtime_payloads = [
        json.loads(path.read_text(encoding="utf-8"))["runtime_task"]
        for path in result.artifacts.runtime_task_payload_paths
    ]

    assert result.task_type == "mutation_plan_request"
    assert result.routing.resolution_source == "environment_theme_multi_intent_composition"
    assert result.routing.resolved_from_prompt == normalize_prompt(prompt_text)
    assert result.routing.mapped_prompt == expected_mapped_prompt
    assert result.routing.plan_key == expected_plan_key
    assert result.routing.plan_title == expected_plan_title
    assert result.routing.goal_components is not None
    assert result.routing.decision == "require_approval"
    assert result.queue_entry["status"] == "needs_approval"
    assert request_payload["conversational_request"]["context"]["resolved_execution_prompt"] == expected_mapped_prompt
    assert len(queue) == 2
    assert queue[0]["status"] == "needs_approval"
    assert queue[1]["status"] == "needs_approval"
    assert queue[1]["dependencies"] == [queue[0]["task_id"]]
    assert [payload["operator_prompt"] for payload in runtime_payloads] == expected_step_prompts
    assert all(payload["plan_title"] == expected_plan_title for payload in runtime_payloads)
    assert all(payload["mapped_prompt"] == expected_mapped_prompt for payload in runtime_payloads)
    assert runtime_payloads[1]["plan_expected_outcome"].startswith("AI-E applies the reviewed")


def test_home_surface_prepare_prompt_routes_environment_theme_into_review(tmp_path):
    config = _make_config(tmp_path / "home_surface_environment_theme_review")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make the ground grassy", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.mapped_prompt == "apply grass ground theme"
    assert "requires operator approval" in preview.decision_reason


def test_home_surface_prepare_prompt_routes_dirt_environment_theme_into_review(tmp_path):
    config = _make_config(tmp_path / "home_surface_dirt_environment_theme_review")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Change the ground to dirt", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.mapped_prompt == "apply dirt ground theme"
    assert "requires operator approval" in preview.decision_reason


def test_home_surface_prepare_prompt_routes_gravel_environment_theme_into_review(tmp_path):
    config = _make_config(tmp_path / "home_surface_gravel_environment_theme_review")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Change the ground to gravel", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.mapped_prompt == "apply gravel ground theme"
    assert "requires operator approval" in preview.decision_reason


def test_home_surface_prepare_prompt_routes_damaged_environment_theme_into_review(tmp_path):
    config = _make_config(tmp_path / "home_surface_damaged_environment_theme_review")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make the ground look damaged", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.mapped_prompt == "apply damaged-ground theme"
    assert "requires operator approval" in preview.decision_reason


@pytest.mark.parametrize(
    ("prompt_text", "expected_plan_title", "expected_step_titles", "expected_mapped_prompt"),
    [
        (
            "Make the ground gravel and damaged",
            "Apply gravel then damaged ground theme",
            ["Apply gravel ground theme", "Apply damaged-ground theme"],
            "apply gravel then damaged ground theme",
        ),
        (
            "Apply a dirt and damaged ground theme",
            "Apply dirt then damaged ground theme",
            ["Apply dirt ground theme", "Apply damaged-ground theme"],
            "apply dirt then damaged ground theme",
        ),
    ],
)
def test_home_surface_prepare_prompt_routes_environment_theme_multi_intent_plan_into_review(
    tmp_path,
    prompt_text,
    expected_plan_title,
    expected_step_titles,
    expected_mapped_prompt,
):
    config = _make_config(tmp_path / "home_surface_environment_theme_multi_intent_review")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt(prompt_text, project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.plan_title == expected_plan_title
    assert preview.plan_steps == expected_step_titles
    assert preview.mapped_prompt == expected_mapped_prompt
    assert preview.plan_execution_mode == "Needs approval"
    assert "reviewed multi-intent plan" in preview.decision_reason


def test_home_surface_environment_theme_review_surface_explains_scope_validation_and_boundary(tmp_path):
    config = _make_config(tmp_path / "home_surface_environment_theme_review_surface")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make the ground grassy", project)
    review = bridge.build_review_surface(preview, project)

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert review.request_summary == (
        "Reviewing the bounded environment theme action 'apply grass ground theme' for BABYLON TEST. "
        "This approval covers only the reviewed Ground material theme change."
    )
    assert review.approval_reason == (
        "This request enters bounded environment visual-theme review before any run is queued. "
        "Approval authorizes only the reviewed Ground material action 'apply grass ground theme'. "
        "It does not authorize broader terrain art direction, follow-on scene styling, or any extra mutation outside the reviewed scope."
    )
    assert review.expected_change_scope == (
        "Limit execution to the reviewed environment theme action 'apply grass ground theme' on Ground in Babylon FPS game ver 002 for BABYLON TEST. "
        "No broader terrain realism pass, foliage expansion, decal work, or extra scene styling changes are included."
    )
    assert review.validation_intent == (
        "After approval, AI-E will execute the reviewed bounded environment theme action through the deterministic project tool route, "
        "validate the recorded Ground material mutation artifact, and confirm the approved Babylon scene target before treating the run as complete. "
        "Sandbox remains an explicit alternative path instead of the default approval path."
    )
    assert "Guardrails limit execution to the reviewed environment theme action 'apply grass ground theme'." in review.risk_guardrail_status
    assert "Scope is limited to the approved Ground material mutation in the supported Babylon scene." in review.risk_guardrail_status
    assert "Deterministic project tool routing has already been matched for this request." in review.risk_guardrail_status
    assert "Sandbox remains a separate operator choice and is not implied by approval." in review.risk_guardrail_status
    assert review.status_message == (
        "This bounded environment theme review is prepared only. Nothing has run yet. "
        "Approve to queue the reviewed run, reject to stop here, or choose sandbox as the explicit alternative path."
    )
    assert review.approve_enabled is True
    assert review.sandbox_enabled is True


def test_home_surface_environment_theme_multi_intent_review_surface_explains_bounded_plan_scope(tmp_path):
    config = _make_config(tmp_path / "home_surface_environment_theme_multi_intent_review_surface")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make the ground gravel and damaged", project)
    review = bridge.build_review_surface(preview, project)

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert review.request_summary == (
        "Reviewing the bounded environment theme plan 'Apply gravel then damaged ground theme' for BABYLON TEST. "
        "This approval covers 2 fixed Ground theme step(s) in the reviewed scope only."
    )
    assert review.approval_reason == (
        "This request enters bounded environment visual-theme review before any run is queued. "
        "Approval authorizes only the reviewed environment theme plan 'Apply gravel then damaged ground theme'. "
        "It does not authorize freeform material blending, broader terrain art direction, follow-on scene styling, or any extra mutation outside the reviewed scope."
    )
    assert review.expected_change_scope == (
        "Limit execution to the reviewed environment theme plan 'Apply gravel then damaged ground theme' with 2 fixed step(s) "
        "on Ground in Babylon FPS game ver 002 for BABYLON TEST. "
        "No broader terrain realism pass, foliage expansion, decal work, freeform material blending, or extra scene styling changes are included."
    )
    assert review.validation_intent == (
        "After approval, AI-E will execute the reviewed bounded environment theme plan through the deterministic project tool route, "
        "validate the recorded Ground material mutation artifact for each approved step, and confirm the approved Babylon scene target before treating the run as complete. "
        "Sandbox remains an explicit alternative path instead of the default approval path."
    )
    assert "Guardrails limit execution to the 2-step reviewed environment theme plan 'Apply gravel then damaged ground theme'." in review.risk_guardrail_status
    assert "Scope is limited to the approved Ground material mutation in the supported Babylon scene." in review.risk_guardrail_status
    assert review.status_message == (
        "This bounded environment theme review is prepared only. Nothing has run yet. "
        "Approve to queue the reviewed run, reject to stop here, or choose sandbox as the explicit alternative path."
    )


def test_home_surface_review_approve_once_approves_environment_theme_request(tmp_path):
    config = _make_config(tmp_path / "home_surface_environment_theme_review_approve_once")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = OrchestratorConfig
    bridge._build_review_bundle_fn = build_review_bundle
    bridge._approve_mutation_task_fn = approve_mutation_task
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make the ground grassy", project)
    review = bridge.build_review_surface(preview, project)
    action_result = bridge.apply_review_action(
        review,
        action="approve_once",
        project=project,
        approved_by="Operator",
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert action_result.ok is True
    assert action_result.queue_status == "pending"
    assert len(queue) == 1
    assert queue[0]["status"] == "pending"
    assert queue[0]["approval_state"] == "approved"


def test_home_surface_review_approve_once_approves_all_environment_theme_multi_intent_plan_steps(tmp_path):
    config = _make_config(tmp_path / "home_surface_environment_theme_multi_intent_review_approve_once")
    _write_environment_theme_capability_contracts(config)
    _write_environment_theme_real_target_evidence(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = OrchestratorConfig
    bridge._build_review_bundle_fn = build_review_bundle
    bridge._approve_mutation_task_fn = approve_mutation_task
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make the ground gravel and damaged", project)
    review = bridge.build_review_surface(preview, project)
    action_result = bridge.apply_review_action(
        review,
        action="approve_once",
        project=project,
        approved_by="Operator",
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert action_result.ok is True
    assert action_result.queue_status == "pending"
    assert len(queue) == 2
    assert all(task["status"] == "pending" for task in queue)
    assert all(task["approval_state"] == "approved" for task in queue)


def test_task_intake_blocks_broad_ground_realism_prompt(tmp_path):
    config = _make_config(tmp_path / "blocked_ground_realism_action")
    _write_environment_theme_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Make the terrain realistic with grass, flowers, and gravel everywhere",
        session_id="blocked-ground-realism-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "blocked"
    assert result.routing.decision == "block"
    assert result.routing.capability_supported is False
    assert result.routing.mutation_capable is False
    assert "bounded environment look-dev actions" in str(result.routing.fail_closed_reason or "")


def test_task_intake_blocks_requested_broad_damaged_gravel_terrain_art_prompt(tmp_path):
    config = _make_config(tmp_path / "blocked_requested_ground_art_action")
    _write_environment_theme_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Make the terrain realistic with damaged gravel, dirt paths, flowers, fog, and battle debris",
        session_id="blocked-requested-ground-art-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "blocked"
    assert result.routing.decision == "block"
    assert result.routing.capability_supported is False
    assert result.routing.mutation_capable is False
    assert "bounded environment look-dev actions" in str(result.routing.fail_closed_reason or "")


def test_task_intake_blocks_broad_layered_ground_art_prompt(tmp_path):
    config = _make_config(tmp_path / "blocked_layered_ground_art_action")
    _write_environment_theme_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Make the terrain realistic with craters, damaged dirt, gravel, debris, flowers, and smoke",
        session_id="blocked-layered-ground-art-session",
        target_repo=target_repo,
    )

    assert result.queue_entry["status"] == "blocked"
    assert result.routing.decision == "block"
    assert result.routing.capability_supported is False
    assert result.routing.mutation_capable is False
    assert "bounded environment look-dev actions" in str(result.routing.fail_closed_reason or "")


def test_task_intake_reports_missing_ground_theme_route_assets_for_supported_prompt(tmp_path):
    config = _make_config(tmp_path / "ground_theme_route_assets_missing")
    _write_environment_theme_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    tools_dir = Path(target_repo) / "Tools"
    (tools_dir / "run_unity_mutate_ground_theme.ps1").unlink()
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "Make the ground grassy",
        session_id="ground-theme-route-assets-missing-session",
        target_repo=target_repo,
    )

    assert result.routing.decision == "block"
    assert result.routing.mapped_prompt == "apply grass ground theme"
    assert "recognized the bounded environment theme action 'apply grass ground theme'" in (result.routing.fail_closed_reason or "")


def test_home_surface_prepare_prompt_routes_platformer_direct_mutation_into_review(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_direct_review")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make more obstacles", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.mapped_prompt == "increase obstacle density"
    assert "bounded autonomy pipeline" in preview.decision_reason


def test_home_surface_prepare_prompt_routes_platformer_goal_plan_into_review(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_goal_review")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make this level more intense", project)

    assert preview.available is True
    assert preview.decision_state == "Needs approval"
    assert preview.next_action_label == "Open review"
    assert preview.plan_title == "Use challenge traversal"
    assert preview.plan_steps == [
        "Set gap size to large",
        "Set obstacle density to dense",
        "Set enemy density to high",
        "Set segment count to long",
    ]
    assert "bounded autonomy pipeline" in preview.decision_reason


def test_home_surface_review_approve_once_approves_all_platformer_plan_steps(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_review_approve_all_steps")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._config_cls = OrchestratorConfig
    bridge._build_review_bundle_fn = build_review_bundle
    bridge._approve_mutation_task_fn = approve_mutation_task
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make this level more intense", project)
    review = bridge.build_review_surface(preview, project)
    action_result = bridge.apply_review_action(
        review,
        action="approve_once",
        project=project,
        approved_by="Operator",
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert action_result.ok is True
    assert action_result.queue_status == "pending"
    assert all(task["status"] == "pending" for task in queue)
    assert all(task["approval_state"] == "approved" for task in queue)


def test_home_surface_platformer_direct_review_surface_explains_scope_validation_and_boundary(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_direct_review_surface")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("make more obstacles", project)
    review = bridge.build_review_surface(preview, project)

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert review.request_summary == (
        "Reviewing the bounded platformer action 'increase obstacle density' for BABYLON TEST. "
        "This approval covers only the reviewed deterministic platformer change."
    )
    assert review.approval_reason == (
        "This request enters bounded platformer review before any run is queued. "
        "Approval authorizes only the reviewed platformer action 'increase obstacle density'. "
        "It does not authorize arbitrary follow-on mutations, and sandbox remains a separate operator choice."
    )
    assert review.expected_change_scope == (
        "Limit execution to the reviewed platformer action 'increase obstacle density' in BABYLON TEST. "
        "No arbitrary geometry, content, or unsupported gameplay changes are included."
    )
    assert review.validation_intent == (
        "After approval, AI-E will execute the reviewed bounded platformer action through the deterministic project tool route "
        "and validate the resulting platformer state before treating the run as complete. "
        "Sandbox runs that bounded route as an explicit proof path instead of the approval path."
    )
    assert "Guardrails limit execution to the reviewed platformer action 'increase obstacle density'." in review.risk_guardrail_status
    assert "Deterministic project tool routing has already been matched for this request." in review.risk_guardrail_status
    assert "Sandbox remains a separate operator choice and is not implied by approval." in review.risk_guardrail_status
    assert review.status_message == (
        "This bounded platformer review is prepared only. Nothing has run yet. "
        "Approve to queue the reviewed run, reject to stop here, or choose sandbox as the explicit alternative path."
    )
    assert review.approve_enabled is True
    assert review.sandbox_enabled is True


def test_home_surface_platformer_plan_review_surface_explains_scope_validation_and_boundary(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_plan_review_surface")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt("Make this level more intense", project)
    review = bridge.build_review_surface(preview, project)

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert review.request_summary == (
        "Reviewing the bounded platformer plan 'Use challenge traversal' for BABYLON TEST. "
        "This approval covers 4 fixed step(s) in the reviewed traversal scope only."
    )
    assert review.approval_reason == (
        "This request enters bounded platformer review before any run is queued. "
        "Approval authorizes only the reviewed platformer plan 'Use challenge traversal'. "
        "It does not authorize arbitrary follow-on mutations, and sandbox remains a separate operator choice."
    )
    assert review.expected_change_scope == (
        "Limit execution to the reviewed platformer plan 'Use challenge traversal' with 4 fixed step(s) in BABYLON TEST. "
        "No extra mutation families or unsupported content changes are included."
    )
    assert review.validation_intent == (
        "After approval, AI-E will execute the reviewed bounded platformer plan, keep each step inside the deterministic "
        "project tool route, and validate the resulting platformer state before treating the run as complete. "
        "Sandbox runs the same bounded route as an explicit proof path instead of the approval path."
    )
    assert "Guardrails limit execution to the 4-step reviewed plan 'Use challenge traversal'." in review.risk_guardrail_status
    assert "Deterministic project tool routing has already been matched for this request." in review.risk_guardrail_status
    assert "Sandbox remains a separate operator choice and is not implied by approval." in review.risk_guardrail_status
    assert review.status_message == (
        "This bounded platformer review is prepared only. Nothing has run yet. "
        "Approve to queue the reviewed run, reject to stop here, or choose sandbox as the explicit alternative path."
    )
    assert review.approve_enabled is True
    assert review.sandbox_enabled is True


def test_home_surface_review_ignores_stale_blocked_platformer_request_for_fresh_prepare(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_stale_blocked_review")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)
    prompt = "make more obstacles"
    task_type = "mutation_request"
    request_id = intake._derive_request_id(prompt, target_repo, task_type)
    queue_payload = {
        "tasks": [
            {
                "task_id": "INTAKE_STALE_BLOCKED",
                "request_id": request_id,
                "status": "blocked",
                "approval_state": "approved",
                "execution_lane": "approval_required_mutation",
            }
        ]
    }
    config.queue_path.write_text(json.dumps(queue_payload, indent=2), encoding="utf-8")

    bridge = home_surface.IntakePreviewBridge()
    bridge._create_intake = lambda: intake
    bridge._build_review_bundle_fn = build_review_bundle
    project = home_surface.SupportedProject(
        name="BABYLON TEST",
        path=Path(target_repo),
        project_type="unity_project",
        source="test",
        status="supported",
    )

    preview = bridge.prepare_prompt(prompt, project)
    review = bridge.build_review_surface(preview, project)

    assert preview.decision_state == "Needs approval"
    assert review.available is True
    assert review.queue_status == ""
    assert review.approve_enabled is True
    assert review.reject_enabled is True
    assert review.sandbox_enabled is True


@pytest.mark.parametrize(
    ("user_prompt", "plan_step_text", "expected_action", "expected_canonical_prompt"),
    [
        (
            "increase platformer obstacle density",
            "Set obstacle density to dense",
            "platformer_increase_obstacle_density",
            "increase obstacle density",
        ),
        (
            "increase gap size",
            "Set gap size to large",
            "platformer_increase_gap_size",
            "make gaps larger",
        ),
    ],
)
def test_platformer_action_normalization_maps_direct_and_plan_step_text_to_same_canonical_action(
    user_prompt,
    plan_step_text,
    expected_action,
    expected_canonical_prompt,
):
    assert normalize_platformer_action(user_prompt) == expected_action
    assert normalize_platformer_action(plan_step_text) == expected_action
    assert canonicalize_platformer_action_prompt(user_prompt) == expected_canonical_prompt
    assert canonicalize_platformer_action_prompt(plan_step_text) == expected_canonical_prompt


@pytest.mark.parametrize(
    ("prompt_text", "expected_translated_command", "expected_probe_action_type"),
    [
        (
            "increase platformer obstacle density",
            "increase obstacle density",
            "mutate_platformer_obstacle_density",
        ),
        (
            "Set gap size to large",
            "make gaps larger",
            "mutate_platformer_gap_size",
        ),
    ],
)
def test_entity_transform_route_resolution_uses_platformer_canonical_action_normalization(
    tmp_path,
    prompt_text,
    expected_translated_command,
    expected_probe_action_type,
):
    config = _make_config(tmp_path / "platformer_route_normalization")
    target_repo = _create_entity_transform_prompt_repo(config)

    route_resolution, route_issue = resolve_entity_transform_route(Path(target_repo), prompt_text)

    assert route_issue is None
    assert route_resolution is not None
    assert route_resolution.translated_command == expected_translated_command
    assert route_resolution.probe_action_type == expected_probe_action_type


def test_task_intake_blocks_out_of_scope_platformer_goal_intent_with_explicit_guidance(tmp_path):
    config = _make_config(tmp_path / "unsupported_platformer_goal_intent")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make traversal more challenging but fair and add lava",
        session_id="platformer-goal-intent-blocked-session",
        target_repo=target_repo,
    )

    queue = json.loads(config.queue_path.read_text(encoding="utf-8"))["tasks"]

    assert result.queue_entry["status"] == "blocked"
    assert queue[0]["status"] == "blocked"
    assert result.routing.decision == "block"
    assert result.routing.decision_reason == "route_missing"
    assert result.routing.capability_supported is False
    assert result.routing.mutation_capable is False
    assert result.routing.mapped_prompt == "make traversal more challenging but fair and add lava"
    assert "bounded platformer gameplay directives only through deterministic traversal profiles and level sets" in (result.routing.intelligence_summary or "")


def test_task_intake_reports_missing_platformer_route_assets_for_supported_direct_prompt(tmp_path):
    config = _make_config(tmp_path / "platformer_route_assets_missing")
    _write_platformer_capability_contracts(config)
    target_repo = _create_entity_transform_prompt_repo(config)
    _strip_platformer_route_assets(target_repo)
    intake = ConversationalTaskIntake(config)

    result = intake.accept_message(
        "make more obstacles",
        session_id="platformer-route-assets-missing-session",
        target_repo=target_repo,
    )

    assert result.routing.decision == "block"
    assert result.routing.mapped_prompt == "increase obstacle density"
    assert "recognized the bounded platformer action 'increase obstacle density'" in (result.routing.fail_closed_reason or "")
    assert "does not expose the deterministic platformer prompt aliases, route entries, and wrapper scripts" in (result.routing.fail_closed_reason or "")
    assert "couldn't match it to a known action" not in (result.routing.fail_closed_reason or "")


def test_result_evaluation_preserves_generic_capability_state_metadata():
    state = {
        "session_tuning_state": {
            "target_context": "runner",
            "target_entity": "runner",
            "contexts": {
                "runner": {
                    "speed": {
                        "resulting_tier": "fast",
                        "observed_value": 5.0,
                        "target_context": "runner",
                    },
                    "aggression": {
                        "resulting_tier": "aggressive",
                        "observed_value": 0.5,
                        "target_context": "runner",
                    },
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0001",
            "experiments": [
                {
                    "experiment_id": "experiment_0001",
                    "target_context": "runner",
                    "target_entity": "runner",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0001",
                            variant_id="variant_0001",
                            source_prompt="make runner faster",
                            canonical_prompt="make runner faster",
                            variant_kind="baseline",
                            speed_tier="standard",
                            aggression_tier="standard",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="speed standard, aggression standard",
                            task_id="TASK_RUNNER_BASELINE",
                            request_id="REQ_RUNNER_BASELINE",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0001",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="make runner more dangerous",
                            canonical_prompt="make runner more dangerous",
                            variant_kind="followup_variant",
                            speed_tier="fast",
                            aggression_tier="aggressive",
                            baseline_variant_id="variant_0001",
                            outcome_summary="speed fast, aggression aggressive",
                            task_id="TASK_RUNNER_VARIANT",
                            request_id="REQ_RUNNER_VARIANT",
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-03T12:00:00Z",
                "task_id": "TASK_RUNNER_BASELINE",
                "request_id": "REQ_RUNNER_BASELINE",
                "plan_id": "",
                "plan_title": "",
                "target_context": "runner",
                "target_entity": "runner",
                "speed_tier": "standard",
                "speed_value": 4.5,
                "aggression_tier": "standard",
                "aggression_value": 0.8,
                "movement_tier": None,
                "movement_target_z": None,
                "encounter_count_tier": "",
                "encounter_count_value": None,
                "spawn_pressure_tier": "",
                "spawn_pressure_value": None,
                "experiment_id": "experiment_0001",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_RUNNER_VARIANT",
            "request_id": "REQ_RUNNER_VARIANT",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "make runner more dangerous",
        },
        timestamp="2026-04-03T12:01:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    generic_state = evaluation["generic_capability_state"]
    assert len(generic_state) == 2
    assert generic_state[0]["target_system"] == "movement"
    assert generic_state[0]["parameter_name"] == "speed"
    assert generic_state[0]["current_tier"] == "fast"
    assert generic_state[1]["target_system"] == "combat"
    assert generic_state[1]["parameter_name"] == "aggression"
    assert generic_state[1]["current_tier"] == "aggressive"


def test_experiment_tracking_records_generic_capability_state_on_variants():
    state = {
        "session_tuning_state": {
            "target_context": "encounter",
            "target_entity": "encounter",
            "contexts": {
                "encounter": {
                    "encounter_count": {
                        "family": "encounter_count",
                        "target_context": "encounter",
                        "target_entity": "encounter",
                        "resulting_tier": "high",
                        "observed_value": 7,
                    },
                    "spawn_pressure": {
                        "family": "spawn_pressure",
                        "target_context": "encounter",
                        "target_entity": "encounter",
                        "resulting_tier": "high",
                        "observed_value": 4.0,
                    },
                }
            },
        },
        "experiment_tracking": {},
    }

    updated = apply_experiment_tracking(
        state,
        task={
            "task_id": "TASK_EXPERIMENT_ENCOUNTER",
            "request_id": "REQ_EXPERIMENT_ENCOUNTER",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "increase spawn pressure",
            "capability_id": "level_0001_increase_spawn_pressure",
        },
        details={
            "translated_command": "increase spawn pressure",
            "target_context": "encounter",
            "target_entity": "encounter",
            "resolution_source": "direct_prompt",
            "result_reason": "applied",
            "executed": True,
        },
        timestamp="2026-04-03T12:02:00Z",
    )

    variant = updated["latest_experiment_variant"]
    generic_state = variant["generic_capability_state"]
    assert [entry["parameter_name"] for entry in generic_state] == ["spawn_count", "spawn_interval"]
    assert generic_state[0]["current_tier"] == "high"
    assert generic_state[0]["current_value"] == 7
    assert generic_state[1]["current_tier"] == "high"
    assert generic_state[1]["current_value"] == 4.0


def test_result_evaluation_formats_racer_generic_capability_comparison():
    state = {
        "session_tuning_state": {
            "target_context": "racer",
            "target_entity": "racer",
            "contexts": {
                "racer": {
                    "acceleration": {
                        "family": "acceleration",
                        "target_context": "racer",
                        "resulting_tier": "fast",
                        "observed_value": 6.5,
                    },
                    "max_speed": {
                        "family": "max_speed",
                        "target_context": "racer",
                        "resulting_tier": "fast",
                        "observed_value": 15.0,
                    },
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0007",
            "experiments": [
                {
                    "experiment_id": "experiment_0007",
                    "target_context": "racer",
                    "target_entity": "racer",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0007",
                            variant_id="variant_0001",
                            source_prompt="restore racer acceleration to standard",
                            canonical_prompt="restore racer acceleration to standard",
                            variant_kind="baseline",
                            acceleration_tier="standard",
                            max_speed_tier="standard",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="acceleration standard, max speed standard",
                            task_id="TASK_RACER_BASELINE",
                            request_id="REQ_RACER_BASELINE",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0007",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="increase racer acceleration",
                            canonical_prompt="increase racer acceleration",
                            variant_kind="followup_variant",
                            acceleration_tier="fast",
                            max_speed_tier="fast",
                            baseline_variant_id="variant_0001",
                            outcome_summary="acceleration fast, max speed fast",
                            task_id="TASK_RACER_VARIANT",
                            request_id="REQ_RACER_VARIANT",
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-03T13:00:00Z",
                "task_id": "TASK_RACER_BASELINE",
                "request_id": "REQ_RACER_BASELINE",
                "plan_id": "",
                "plan_title": "",
                "target_context": "racer",
                "target_entity": "racer",
                "acceleration_tier": "standard",
                "acceleration_value": 5.0,
                "max_speed_tier": "standard",
                "max_speed_value": 12.5,
                "generic_capability_state": build_generic_capability_state(
                    target_context="racer",
                    acceleration_tier="standard",
                    acceleration_value=5.0,
                    max_speed_tier="standard",
                    max_speed_value=12.5,
                ),
                "experiment_id": "experiment_0007",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_RACER_VARIANT",
            "request_id": "REQ_RACER_VARIANT",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "increase racer acceleration",
        },
        timestamp="2026-04-03T13:01:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    combined_text = "\n".join([evaluation["comparison_description"], *evaluation["detected_differences"]])
    assert "Acceleration" in combined_text
    assert "Max speed" in combined_text
    assert "Acceleration: standard -> fast" in evaluation["detected_differences"]
    assert "Max speed: standard -> fast" in evaluation["detected_differences"]
    assert "Quicker speed buildup." in combined_text
    assert "Higher top speed." in combined_text


def test_experiment_tracking_records_racer_generic_capability_state_on_variants():
    state = {
        "session_tuning_state": {
            "target_context": "racer",
            "target_entity": "racer",
            "contexts": {
                "racer": {
                    "acceleration": {
                        "family": "acceleration",
                        "target_context": "racer",
                        "target_entity": "racer",
                        "resulting_tier": "fast",
                        "observed_value": 6.5,
                    },
                    "max_speed": {
                        "family": "max_speed",
                        "target_context": "racer",
                        "target_entity": "racer",
                        "resulting_tier": "fast",
                        "observed_value": 15.0,
                    },
                }
            },
        },
        "experiment_tracking": {},
    }

    updated = apply_experiment_tracking(
        state,
        task={
            "task_id": "TASK_EXPERIMENT_RACER",
            "request_id": "REQ_EXPERIMENT_RACER",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "increase racer acceleration",
            "capability_id": "level_0001_increase_racer_acceleration",
        },
        details={
            "translated_command": "increase racer acceleration",
            "target_context": "racer",
            "target_entity": "racer",
            "resolution_source": "direct_prompt",
            "result_reason": "applied",
            "executed": True,
        },
        timestamp="2026-04-03T13:02:00Z",
    )

    variant = updated["latest_experiment_variant"]
    assert variant["target_context"] == "racer"
    assert variant["outcome_summary"] == "acceleration fast, max speed fast"
    generic_state = variant["generic_capability_state"]
    assert [entry["parameter_name"] for entry in generic_state] == ["acceleration", "max_speed"]
    assert generic_state[0]["current_tier"] == "fast"
    assert generic_state[0]["current_value"] == 6.5
    assert generic_state[1]["current_tier"] == "fast"
    assert generic_state[1]["current_value"] == 15


def test_result_evaluation_formats_platformer_generic_capability_comparison():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "jump_height": {
                        "family": "jump_height",
                        "target_context": "platformer",
                        "resulting_tier": "high",
                        "observed_value": 1.6,
                    },
                    "gravity": {
                        "family": "gravity",
                        "target_context": "platformer",
                        "resulting_tier": "low_gravity",
                        "observed_value": 6.0,
                    },
                    "speed": {
                        "family": "speed",
                        "target_context": "platformer",
                        "resulting_tier": "fast",
                        "observed_value": 7.0,
                    },
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0010",
            "experiments": [
                {
                    "experiment_id": "experiment_0010",
                    "target_context": "platformer",
                    "target_entity": "platformer",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0010",
                            variant_id="variant_0001",
                            source_prompt="restore gravity to standard",
                            canonical_prompt="restore gravity to standard",
                            variant_kind="baseline",
                            jump_height_tier="standard",
                            gravity_tier="standard_gravity",
                            speed_tier="standard",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="jump height standard, gravity standard_gravity, speed standard",
                            task_id="TASK_PLATFORMER_BASELINE",
                            request_id="REQ_PLATFORMER_BASELINE",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0010",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="make jump higher",
                            canonical_prompt="make jump higher",
                            variant_kind="followup_variant",
                            jump_height_tier="high",
                            gravity_tier="low_gravity",
                            speed_tier="fast",
                            baseline_variant_id="variant_0001",
                            outcome_summary="jump height high, gravity low_gravity, speed fast",
                            task_id="TASK_PLATFORMER_VARIANT",
                            request_id="REQ_PLATFORMER_VARIANT",
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-03T14:00:00Z",
                "task_id": "TASK_PLATFORMER_BASELINE",
                "request_id": "REQ_PLATFORMER_BASELINE",
                "plan_id": "",
                "plan_title": "",
                "target_context": "platformer",
                "target_entity": "platformer",
                "speed_tier": "standard",
                "speed_value": 5.5,
                "jump_height_tier": "standard",
                "jump_height_value": 1.2,
                "gravity_tier": "standard_gravity",
                "gravity_value": 9.81,
                "generic_capability_state": build_generic_capability_state(
                    target_context="platformer",
                    speed_tier="standard",
                    speed_value=5.5,
                    jump_height_tier="standard",
                    jump_height_value=1.2,
                    gravity_tier="standard_gravity",
                    gravity_value=9.81,
                ),
                "experiment_id": "experiment_0010",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_PLATFORMER_VARIANT",
            "request_id": "REQ_PLATFORMER_VARIANT",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "make jump higher",
        },
        timestamp="2026-04-03T14:01:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    combined_text = "\n".join([evaluation["comparison_description"], *evaluation["detected_differences"]])
    assert "Jump height: standard -> high" in evaluation["detected_differences"]
    assert "Gravity: standard_gravity -> low_gravity" in evaluation["detected_differences"]
    assert "Speed: standard -> fast" in evaluation["detected_differences"]
    assert "Longer airtime." in combined_text
    assert "Slower fall speed." in combined_text
    assert "Faster traversal." in combined_text


def test_experiment_tracking_records_platformer_generic_capability_state_on_variants():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "jump_height": {
                        "family": "jump_height",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "high",
                        "observed_value": 1.6,
                    },
                    "gravity": {
                        "family": "gravity",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "low_gravity",
                        "observed_value": 6.0,
                    },
                    "speed": {
                        "family": "speed",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "fast",
                        "observed_value": 7.0,
                    },
                }
            },
        },
        "experiment_tracking": {},
    }

    updated = apply_experiment_tracking(
        state,
        task={
            "task_id": "TASK_EXPERIMENT_PLATFORMER",
            "request_id": "REQ_EXPERIMENT_PLATFORMER",
            "plan_id": "",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "operator_prompt": "make jump higher",
            "capability_id": "level_0001_increase_platformer_jump_height",
        },
        details={
            "translated_command": "make jump higher",
            "target_context": "platformer",
            "target_entity": "platformer",
            "resolution_source": "direct_prompt",
            "result_reason": "applied",
            "executed": True,
        },
        timestamp="2026-04-03T14:02:00Z",
    )

    variant = updated["latest_experiment_variant"]
    assert variant["target_context"] == "platformer"
    assert variant["outcome_summary"] == "speed fast, jump height high, gravity low gravity"
    generic_state = variant["generic_capability_state"]
    assert [entry["parameter_name"] for entry in generic_state] == ["speed", "jump_height", "gravity"]
    assert generic_state[0]["current_tier"] == "fast"
    assert generic_state[1]["current_tier"] == "high"
    assert generic_state[2]["current_tier"] == "low_gravity"


def test_result_evaluation_formats_platformer_layout_generic_capability_comparison():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "gap_size": {
                        "family": "gap_size",
                        "target_context": "platformer",
                        "resulting_tier": "large",
                        "observed_value": 4.5,
                    },
                    "obstacle_density": {
                        "family": "obstacle_density",
                        "target_context": "platformer",
                        "resulting_tier": "dense",
                        "observed_value": 1.5,
                    },
                    "enemy_density": {
                        "family": "enemy_density",
                        "target_context": "platformer",
                        "resulting_tier": "high",
                        "observed_value": 3.0,
                    },
                    "segment_count": {
                        "family": "segment_count",
                        "target_context": "platformer",
                        "resulting_tier": "long",
                        "observed_value": 12.0,
                    },
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0020",
            "experiments": [
                {
                    "experiment_id": "experiment_0020",
                    "target_context": "platformer",
                    "target_entity": "platformer",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0020",
                            variant_id="variant_0001",
                            source_prompt="restore level to standard",
                            canonical_prompt="restore level to standard",
                            variant_kind="baseline",
                            gap_size_tier="standard",
                            obstacle_density_tier="standard",
                            enemy_density_tier="standard",
                            segment_count_tier="standard",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="gap size standard, obstacle density standard, enemy density standard, segment count standard",
                            task_id="TASK_PLATFORMER_LAYOUT_BASELINE",
                            request_id="REQ_PLATFORMER_LAYOUT_BASELINE",
                            plan_key="platformer_restore_layout_standard_v1",
                            plan_title="Restore platformer level structure to standard",
                            level_profile_id="balanced_traversal",
                            level_profile_name="balanced traversal",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0020",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="use challenge traversal",
                            canonical_prompt="use challenge traversal",
                            variant_kind="followup_variant",
                            gap_size_tier="large",
                            obstacle_density_tier="dense",
                            enemy_density_tier="high",
                            segment_count_tier="long",
                            baseline_variant_id="variant_0001",
                            outcome_summary="gap size large, obstacle density dense, enemy density high, segment count long",
                            task_id="TASK_PLATFORMER_LAYOUT_VARIANT",
                            request_id="REQ_PLATFORMER_LAYOUT_VARIANT",
                            plan_key="platformer_challenge_traversal_v1",
                            plan_title="Use challenge traversal",
                            level_profile_id="challenge_traversal",
                            level_profile_name="challenge traversal",
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-03T15:00:00Z",
                "task_id": "TASK_PLATFORMER_LAYOUT_BASELINE",
                "request_id": "REQ_PLATFORMER_LAYOUT_BASELINE",
                "plan_id": "",
                "plan_key": "platformer_restore_layout_standard_v1",
                "plan_title": "Restore platformer level structure to standard",
                "level_profile_id": "balanced_traversal",
                "level_profile_name": "balanced traversal",
                "target_context": "platformer",
                "target_entity": "platformer",
                "gap_size_tier": "standard",
                "gap_size_value": 3.0,
                "obstacle_density_tier": "standard",
                "obstacle_density_value": 1.0,
                "enemy_density_tier": "standard",
                "enemy_density_value": 2.0,
                "segment_count_tier": "standard",
                "segment_count_value": 8.0,
                "generic_capability_state": build_generic_capability_state(
                    target_context="platformer",
                    gap_size_tier="standard",
                    gap_size_value=3.0,
                    obstacle_density_tier="standard",
                    obstacle_density_value=1.0,
                    enemy_density_tier="standard",
                    enemy_density_value=2.0,
                    segment_count_tier="standard",
                    segment_count_value=8.0,
                ),
                "experiment_id": "experiment_0020",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_PLATFORMER_LAYOUT_VARIANT",
            "request_id": "REQ_PLATFORMER_LAYOUT_VARIANT",
            "plan_id": "",
            "plan_key": "platformer_challenge_traversal_v1",
            "plan_title": "Use challenge traversal",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "source_prompt": "use challenge traversal",
            "operator_prompt": "make level longer",
        },
        timestamp="2026-04-03T15:01:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    combined_text = "\n".join([evaluation["comparison_description"], *evaluation["detected_differences"]])
    assert evaluation["applied_profile_id"] == "challenge_traversal"
    assert evaluation["applied_profile_name"] == "challenge traversal"
    assert "Applied profile: challenge traversal." in evaluation["comparison_description"]
    assert "Previous profile: balanced traversal." in evaluation["comparison_description"]
    assert "Gap size: standard -> large" in evaluation["detected_differences"]
    assert "Obstacle density: standard -> dense" in evaluation["detected_differences"]
    assert "Enemy density: standard -> high" in evaluation["detected_differences"]
    assert "Segment count: standard -> long" in evaluation["detected_differences"]
    assert "Wider jumps required." in combined_text
    assert "More obstacles per segment." in combined_text
    assert "More enemies per segment." in combined_text
    assert "Longer level traversal." in combined_text


def test_experiment_tracking_records_platformer_layout_generic_capability_state_on_variants():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "gap_size": {
                        "family": "gap_size",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "large",
                        "observed_value": 4.5,
                    },
                    "obstacle_density": {
                        "family": "obstacle_density",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "dense",
                        "observed_value": 1.5,
                    },
                    "enemy_density": {
                        "family": "enemy_density",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "high",
                        "observed_value": 3.0,
                    },
                    "segment_count": {
                        "family": "segment_count",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "long",
                        "observed_value": 12.0,
                    },
                }
            },
        },
        "experiment_tracking": {},
    }

    updated = apply_experiment_tracking(
        state,
        task={
            "task_id": "TASK_EXPERIMENT_PLATFORMER_LAYOUT",
            "request_id": "REQ_EXPERIMENT_PLATFORMER_LAYOUT",
            "plan_id": "",
            "plan_key": "platformer_challenge_traversal_v1",
            "plan_title": "Use challenge traversal",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "source_prompt": "use challenge traversal",
            "operator_prompt": "make level longer",
            "capability_id": "level_0001_increase_platformer_gap_size",
        },
        details={
            "translated_command": "use challenge traversal",
            "target_context": "platformer",
            "target_entity": "platformer",
            "resolution_source": "direct_prompt",
            "result_reason": "applied",
            "executed": True,
        },
        timestamp="2026-04-03T15:02:00Z",
    )

    variant = updated["latest_experiment_variant"]
    assert variant["target_context"] == "platformer"
    assert variant["level_profile_id"] == "challenge_traversal"
    assert variant["level_profile_name"] == "challenge traversal"
    assert variant["outcome_summary"] == "gap size large, obstacle density dense, enemy density high, segment count long"
    generic_state = variant["generic_capability_state"]
    assert [entry["parameter_name"] for entry in generic_state] == [
        "gap_size",
        "obstacle_density",
        "enemy_density",
        "segment_count",
    ]
    assert generic_state[0]["current_tier"] == "large"
    assert generic_state[1]["current_tier"] == "dense"
    assert generic_state[2]["current_tier"] == "high"
    assert generic_state[3]["current_tier"] == "long"


def test_result_evaluation_formats_platformer_level_set_comparison():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "jump_height": {
                        "family": "jump_height",
                        "target_context": "platformer",
                        "resulting_tier": "high",
                        "observed_value": 1.6,
                    },
                    "gravity": {
                        "family": "gravity",
                        "target_context": "platformer",
                        "resulting_tier": "low_gravity",
                        "observed_value": 6.0,
                    },
                    "speed": {
                        "family": "speed",
                        "target_context": "platformer",
                        "resulting_tier": "standard",
                        "observed_value": 5.5,
                    },
                    "gap_size": {
                        "family": "gap_size",
                        "target_context": "platformer",
                        "resulting_tier": "small",
                        "observed_value": 2.0,
                    },
                    "obstacle_density": {
                        "family": "obstacle_density",
                        "target_context": "platformer",
                        "resulting_tier": "sparse",
                        "observed_value": 0.5,
                    },
                    "enemy_density": {
                        "family": "enemy_density",
                        "target_context": "platformer",
                        "resulting_tier": "low",
                        "observed_value": 1.0,
                    },
                    "segment_count": {
                        "family": "segment_count",
                        "target_context": "platformer",
                        "resulting_tier": "standard",
                        "observed_value": 8.0,
                    },
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0025",
            "experiments": [
                {
                    "experiment_id": "experiment_0025",
                    "target_context": "platformer",
                    "target_entity": "platformer",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0025",
                            variant_id="variant_0001",
                            source_prompt="restore level set to standard",
                            canonical_prompt="restore level set to standard",
                            variant_kind="baseline",
                            jump_height_tier="standard",
                            gravity_tier="standard_gravity",
                            speed_tier="standard",
                            gap_size_tier="standard",
                            obstacle_density_tier="standard",
                            enemy_density_tier="standard",
                            segment_count_tier="standard",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="speed standard, jump height standard, gravity standard gravity, gap size standard, obstacle density standard, enemy density standard, segment count standard",
                            task_id="TASK_PLATFORMER_LEVEL_SET_BASELINE",
                            request_id="REQ_PLATFORMER_LEVEL_SET_BASELINE",
                            plan_key="platformer_restore_level_set_standard_v1",
                            plan_title="Restore platformer level set to standard",
                            level_set_id="standard_level_set",
                            level_set_name="standard level set",
                            level_profile_id="balanced_traversal",
                            level_profile_name="balanced traversal",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0025",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="use level set a",
                            canonical_prompt="use level set a",
                            variant_kind="followup_variant",
                            jump_height_tier="high",
                            gravity_tier="low_gravity",
                            speed_tier="standard",
                            gap_size_tier="small",
                            obstacle_density_tier="sparse",
                            enemy_density_tier="low",
                            segment_count_tier="standard",
                            baseline_variant_id="variant_0001",
                            outcome_summary="speed standard, jump height high, gravity low gravity, gap size small, obstacle density sparse, enemy density low, segment count standard",
                            task_id="TASK_PLATFORMER_LEVEL_SET_VARIANT",
                            request_id="REQ_PLATFORMER_LEVEL_SET_VARIANT",
                            plan_key="platformer_level_set_a_v1",
                            plan_title="Use level set a",
                            level_set_id="level_set_a",
                            level_set_name="level set a",
                            level_profile_id="easy_traversal",
                            level_profile_name="easy traversal",
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-03T15:10:00Z",
                "task_id": "TASK_PLATFORMER_LEVEL_SET_BASELINE",
                "request_id": "REQ_PLATFORMER_LEVEL_SET_BASELINE",
                "plan_id": "",
                "plan_key": "platformer_restore_level_set_standard_v1",
                "plan_title": "Restore platformer level set to standard",
                "level_set_id": "standard_level_set",
                "level_set_name": "standard level set",
                "level_profile_id": "balanced_traversal",
                "level_profile_name": "balanced traversal",
                "target_context": "platformer",
                "target_entity": "platformer",
                "speed_tier": "standard",
                "speed_value": 5.5,
                "jump_height_tier": "standard",
                "jump_height_value": 1.2,
                "gravity_tier": "standard_gravity",
                "gravity_value": 9.81,
                "gap_size_tier": "standard",
                "gap_size_value": 3.0,
                "obstacle_density_tier": "standard",
                "obstacle_density_value": 1.0,
                "enemy_density_tier": "standard",
                "enemy_density_value": 2.0,
                "segment_count_tier": "standard",
                "segment_count_value": 8.0,
                "generic_capability_state": build_generic_capability_state(
                    target_context="platformer",
                    speed_tier="standard",
                    speed_value=5.5,
                    jump_height_tier="standard",
                    jump_height_value=1.2,
                    gravity_tier="standard_gravity",
                    gravity_value=9.81,
                    gap_size_tier="standard",
                    gap_size_value=3.0,
                    obstacle_density_tier="standard",
                    obstacle_density_value=1.0,
                    enemy_density_tier="standard",
                    enemy_density_value=2.0,
                    segment_count_tier="standard",
                    segment_count_value=8.0,
                ),
                "experiment_id": "experiment_0025",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_PLATFORMER_LEVEL_SET_VARIANT",
            "request_id": "REQ_PLATFORMER_LEVEL_SET_VARIANT",
            "plan_id": "",
            "plan_key": "platformer_level_set_a_v1",
            "plan_title": "Use level set a",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "source_prompt": "use level set a",
            "operator_prompt": "restore segment count to standard",
        },
        timestamp="2026-04-03T15:11:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    combined_text = "\n".join([evaluation["comparison_description"], *evaluation["detected_differences"]])
    assert evaluation["applied_level_set_id"] == "level_set_a"
    assert evaluation["applied_level_set_name"] == "level set a"
    assert evaluation["applied_profile_id"] == "easy_traversal"
    assert evaluation["applied_profile_name"] == "easy traversal"
    assert "Applied level set: level set a." in evaluation["comparison_description"]
    assert "Previous level set: standard level set." in evaluation["comparison_description"]
    assert "Applied profile: easy traversal." in evaluation["comparison_description"]
    assert "Previous profile: balanced traversal." in evaluation["comparison_description"]
    assert "Jump height: standard -> high" in evaluation["detected_differences"]
    assert "Gravity: standard_gravity -> low_gravity" in evaluation["detected_differences"]
    assert "Gap size: standard -> small" in evaluation["detected_differences"]
    assert "Obstacle density: standard -> sparse" in evaluation["detected_differences"]
    assert "Enemy density: standard -> low" in evaluation["detected_differences"]
    assert "Longer airtime." in combined_text
    assert "Slower fall speed." in combined_text
    assert "Shorter jumps required." in combined_text


def test_platformer_layout_correction_result_persists_project_local_artifacts(tmp_path):
    config = _make_config(tmp_path / "platformer_layout_correction_artifacts")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)

    result = persist_platformer_layout_correction_result(
        task={
            "task_id": "TASK_PLATFORMER_CORRECTION_001",
            "request_id": "REQ_PLATFORMER_CORRECTION_001",
            "target_repo": str(target_repo),
        },
        result={
            "status": "completed",
            "details": {
                "target_context": "platformer",
                "manual_edit_mode": "keyboard_mouse",
                "layout_id": "super_monkee_tutorial",
                "layout_name": "Super Monkee Tutorial",
                "layout_corrections": [
                    {
                        "object_id": "platform_01",
                        "object_type": "platform",
                        "action": "move",
                        "original_position": [0.0, 0.0, 0.0],
                        "corrected_position": [1.5, 0.0, 0.0],
                        "note": "Create a safer landing.",
                    },
                    {
                        "object_id": "ladder_01",
                        "object_type": "ladder",
                        "action": "nudge",
                        "original_position": [4.0, 0.0, 0.0],
                        "corrected_position": [4.25, 0.0, 0.0],
                        "note": "Align the climb start.",
                    },
                ],
                "corrected_layout": {
                    "layout_id": "super_monkee_tutorial",
                    "objects": [
                        {"object_id": "platform_01"},
                        {"object_id": "ladder_01"},
                    ],
                },
            },
        },
        timestamp="2026-04-04T10:15:00Z",
    )

    details = result["details"]
    record_path = Path(details["layout_correction_artifact_path"])
    history_path = Path(details["layout_correction_history_path"])
    layout_path = Path(details["corrected_layout_artifact_path"])
    assert record_path.exists()
    assert history_path.exists()
    assert layout_path.exists()
    assert details["layout_correction_count"] == 2
    assert details["layout_correction_summary"] == "2 manual keyboard/mouse correction(s) saved for Super Monkee Tutorial."

    state = apply_platformer_layout_correction_record(
        {},
        task={
            "task_id": "TASK_PLATFORMER_CORRECTION_001",
            "request_id": "REQ_PLATFORMER_CORRECTION_001",
            "plan_id": "",
            "target_repo": str(target_repo),
        },
        details=details,
        timestamp="2026-04-04T10:15:00Z",
    )
    assert state["latest_platformer_layout_correction"]["layout_name"] == "Super Monkee Tutorial"
    assert state["latest_platformer_layout_correction"]["layout_correction_count"] == 2


def test_platformer_layout_validation_detects_unreachable_platform_and_gap_issue():
    metadata = extract_platformer_layout_validation_metadata(
        {
            "target_context": "platformer",
            "layout_name": "Super Monkee Tutorial",
            "jump_height_value": 1.2,
            "gravity_value": 9.81,
            "speed_value": 5.5,
            "corrected_layout": {
                "layout_id": "super_monkee_tutorial",
                "layout_name": "Super Monkee Tutorial",
                "ground": {"center_x": 0.0, "center_z": 0.0, "top_y": 0.0, "width": 4.0, "depth": 2.0},
                "platforms": [
                    {"object_id": "platform_near", "center_x": 1.5, "center_z": 0.0, "top_y": 0.3, "width": 1.5, "depth": 1.0},
                    {"object_id": "platform_far", "center_x": 10.0, "center_z": 0.0, "top_y": 2.1, "width": 1.5, "depth": 1.0},
                ],
            },
        }
    )

    assert metadata["layout_validation_available"] is True
    assert metadata["layout_validation_issue_count"] >= 1
    assert "gap_exceeds_jump_capability" in metadata["layout_validation_issue_codes"]
    assert any("Gap exceeds jump capability" in message for message in metadata["layout_validation_issue_messages"])


def test_platformer_layout_validation_detects_invalid_ladder():
    metadata = extract_platformer_layout_validation_metadata(
        {
            "target_context": "platformer",
            "layout_name": "Super Monkee Tutorial",
            "corrected_layout": {
                "layout_id": "super_monkee_tutorial",
                "ground": {"center_x": 0.0, "center_z": 0.0, "top_y": 0.0, "width": 6.0, "depth": 2.0},
                "objects": [
                    {"object_id": "platform_01", "object_type": "platform", "position": [0.0, 0.0, 0.0], "size": [2.0, 0.5, 1.0]},
                    {"object_id": "ladder_01", "object_type": "ladder", "position": [3.0, 0.0, 0.0], "height": 3.0},
                ],
            },
        }
    )

    assert metadata["layout_validation_issue_count"] >= 1
    assert "invalid_ladder" in metadata["layout_validation_issue_codes"]
    assert any("Ladder does not connect to valid platform surfaces" in message for message in metadata["layout_validation_issue_messages"])


def test_platformer_layout_validation_detects_overlap_and_crowding():
    metadata = extract_platformer_layout_validation_metadata(
        {
            "target_context": "platformer",
            "layout_name": "Dense Test Layout",
            "corrected_layout": {
                "layout_id": "dense_test_layout",
                "ground": {"center_x": 0.0, "center_z": 0.0, "top_y": 0.0, "width": 8.0, "depth": 2.0},
                "objects": [
                    {"object_id": "platform_01", "object_type": "platform", "position": [1.0, 0.0, 0.0], "size": [2.0, 0.5, 1.0]},
                    {"object_id": "obstacle_01", "object_type": "obstacle_cluster", "position": [1.0, 0.0, 0.0], "size": [1.0, 1.0, 1.0]},
                    {"object_id": "obstacle_02", "object_type": "obstacle_cluster", "position": [1.3, 0.0, 0.0], "size": [1.0, 1.0, 1.0]},
                    {"object_id": "obstacle_03", "object_type": "obstacle_cluster", "position": [1.55, 0.0, 0.0], "size": [1.0, 1.0, 1.0]},
                ],
            },
        }
    )

    assert metadata["layout_validation_issue_count"] >= 1
    assert "overlapping_objects" in metadata["layout_validation_issue_codes"]
    assert "cramped_layout" in metadata["layout_validation_issue_codes"]


def test_result_evaluation_includes_platformer_layout_validation_summary():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "speed": {"family": "speed", "target_context": "platformer", "resulting_tier": "standard", "observed_value": 5.5},
                    "jump_height": {"family": "jump_height", "target_context": "platformer", "resulting_tier": "standard", "observed_value": 1.2},
                    "gravity": {"family": "gravity", "target_context": "platformer", "resulting_tier": "standard_gravity", "observed_value": 9.81},
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0040",
            "experiments": [
                {
                    "experiment_id": "experiment_0040",
                    "target_context": "platformer",
                    "target_entity": "platformer",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0040",
                            variant_id="variant_0001",
                            source_prompt="restore level to standard",
                            canonical_prompt="restore level to standard",
                            variant_kind="baseline",
                            speed_tier="standard",
                            jump_height_tier="standard",
                            gravity_tier="standard_gravity",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="speed standard, jump height standard, gravity standard gravity",
                            task_id="TASK_LAYOUT_VALIDATION_BASELINE",
                            request_id="REQ_LAYOUT_VALIDATION_BASELINE",
                            layout_validation_available=True,
                            layout_validation_status="passed",
                            layout_validation_status_label="clean",
                            layout_validation_summary="Spatial validation clean for Super Monkee Tutorial: 0 issues detected.",
                            layout_validation_issue_count=0,
                            layout_validation_severity_summary="none",
                            layout_validation_category_summary="none",
                            layout_validation_issue_type_summary="none",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0040",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="save manual correction",
                            canonical_prompt="save manual correction",
                            variant_kind="followup_variant",
                            speed_tier="standard",
                            jump_height_tier="standard",
                            gravity_tier="standard_gravity",
                            baseline_variant_id="variant_0001",
                            outcome_summary="manual correction saved",
                            task_id="TASK_LAYOUT_VALIDATION_VARIANT",
                            request_id="REQ_LAYOUT_VALIDATION_VARIANT",
                            layout_validation_available=True,
                            layout_validation_status="issues_found",
                            layout_validation_status_label="issues detected",
                            layout_validation_summary="3 spatial issue(s) detected for Super Monkee Tutorial: 1 unreachable platform, 1 invalid ladder, 1 obstacle crowding issue.",
                            layout_validation_issue_count=3,
                            layout_validation_blocking_issue_count=2,
                            layout_validation_severity_counts={"error": 2, "warning": 1},
                            layout_validation_severity_summary="2 errors, 1 warning",
                            layout_validation_category_counts={"reachability": 1, "traversal": 1, "density_overlap": 1},
                            layout_validation_category_summary="1 reachability, 1 traversal, 1 density/overlap",
                            layout_validation_issue_type_counts={"unreachable_platform": 1, "invalid_ladder": 1, "cramped_layout": 1},
                            layout_validation_issue_type_summary="1 unreachable platform, 1 invalid ladder, 1 obstacle crowding issue",
                            layout_validation_highlights=["1 unreachable platform", "1 invalid ladder", "1 obstacle crowding issue"],
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-04T11:00:00Z",
                "task_id": "TASK_LAYOUT_VALIDATION_BASELINE",
                "request_id": "REQ_LAYOUT_VALIDATION_BASELINE",
                "plan_id": "",
                "plan_key": "platformer_restore_layout_standard_v1",
                "plan_title": "Restore platformer level structure to standard",
                "target_context": "platformer",
                "target_entity": "platformer",
                "speed_tier": "standard",
                "speed_value": 5.5,
                "jump_height_tier": "standard",
                "jump_height_value": 1.2,
                "gravity_tier": "standard_gravity",
                "gravity_value": 9.81,
                "layout_validation_available": True,
                "layout_validation_status": "passed",
                "layout_validation_status_label": "clean",
                "layout_validation_summary": "Spatial validation clean for Super Monkee Tutorial: 0 issues detected.",
                "layout_validation_issue_count": 0,
                "layout_validation_blocking_issue_count": 0,
                "layout_validation_severity_summary": "none",
                "layout_validation_category_summary": "none",
                "layout_validation_issue_type_summary": "none",
                "generic_capability_state": build_generic_capability_state(
                    target_context="platformer",
                    speed_tier="standard",
                    speed_value=5.5,
                    jump_height_tier="standard",
                    jump_height_value=1.2,
                    gravity_tier="standard_gravity",
                    gravity_value=9.81,
                ),
                "experiment_id": "experiment_0040",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_LAYOUT_VALIDATION_VARIANT",
            "request_id": "REQ_LAYOUT_VALIDATION_VARIANT",
            "plan_id": "",
            "plan_key": "platformer_manual_correction_capture_v1",
            "plan_title": "Save manual platformer correction",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "source_prompt": "save manual correction",
            "operator_prompt": "save manual correction",
        },
        timestamp="2026-04-04T11:01:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    assert evaluation["layout_validation_issue_count"] == 3
    assert evaluation["layout_validation_status_label"] == "issues detected"
    assert evaluation["layout_validation_summary"] == "3 spatial issue(s) detected for Super Monkee Tutorial: 1 unreachable platform, 1 invalid ladder, 1 obstacle crowding issue."
    assert evaluation["layout_validation_severity_summary"] == "2 errors, 1 warning"
    assert evaluation["layout_validation_category_summary"] == "1 reachability, 1 traversal, 1 density/overlap"
    assert evaluation["layout_validation_issue_type_summary"] == "1 unreachable platform, 1 invalid ladder, 1 obstacle crowding issue"
    assert evaluation["layout_validation_delta"]["issue_count_delta"] == 3
    assert evaluation["layout_validation_delta"]["summary"].startswith("Spatial validation issue count: 0 -> 3")
    assert "Spatial validation status: issues detected." in evaluation["comparison_description"]
    assert "Spatial validation summary: 3 spatial issue(s) detected for Super Monkee Tutorial: 1 unreachable platform, 1 invalid ladder, 1 obstacle crowding issue." in evaluation["comparison_description"]
    assert "Spatial validation severity: 2 errors, 1 warning." in evaluation["comparison_description"]
    assert "Spatial validation categories: 1 reachability, 1 traversal, 1 density/overlap." in evaluation["comparison_description"]
    assert any("introduced unreachable platform (0 -> 1)" in entry for entry in evaluation["detected_differences"])


def test_merge_platformer_layout_correction_payload_accepts_unity_emitted_json(tmp_path):
    payload_path = tmp_path / "unity" / "platformer_correction.json"
    payload_path.parent.mkdir(parents=True, exist_ok=True)
    payload_path.write_text(
        json.dumps(
            {
                "layout_id": "super_monkee_tutorial",
                "layout_name": "Super Monkee Tutorial",
                "target_context": "platformer",
                "manual_edit_mode": "keyboard_mouse",
                "corrections": [
                    {
                        "object_id": "platform_01",
                        "object_type": "platform",
                        "action": "move",
                        "original_position": [0.0, 0.0, 0.0],
                        "new_position": [1.5, 0.0, 0.0],
                    }
                ],
                "corrected_layout": {
                    "layout_id": "super_monkee_tutorial",
                    "objects": [{"object_id": "platform_01", "position": [1.5, 0.0, 0.0]}],
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    details, issue = merge_platformer_layout_correction_payload(
        {"unity_exit_code": "0"},
        payload_path_value=str(payload_path),
    )

    assert issue == ""
    assert details["target_context"] == "platformer"
    assert details["layout_id"] == "super_monkee_tutorial"
    assert details["layout_name"] == "Super Monkee Tutorial"
    assert details["manual_edit_mode"] == "keyboard_mouse"
    assert len(details["layout_corrections"]) == 1
    assert details["layout_corrections"][0]["object_id"] == "platform_01"
    assert details["corrected_layout"]["layout_id"] == "super_monkee_tutorial"


def test_result_evaluation_preserves_platformer_manual_correction_metadata():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "jump_height": {
                        "family": "jump_height",
                        "target_context": "platformer",
                        "resulting_tier": "standard",
                        "observed_value": 1.2,
                    },
                    "gravity": {
                        "family": "gravity",
                        "target_context": "platformer",
                        "resulting_tier": "standard_gravity",
                        "observed_value": 9.81,
                    },
                    "speed": {
                        "family": "speed",
                        "target_context": "platformer",
                        "resulting_tier": "standard",
                        "observed_value": 5.5,
                    },
                }
            },
        },
        "experiment_tracking": {
            "active_experiment_id": "experiment_0030",
            "experiments": [
                {
                    "experiment_id": "experiment_0030",
                    "target_context": "platformer",
                    "target_entity": "platformer",
                    "active_variant_id": "variant_0002",
                    "baseline_variant_id": "variant_0001",
                    "variants": [
                        _experiment_variant(
                            order=1,
                            experiment_id="experiment_0030",
                            variant_id="variant_0001",
                            source_prompt="restore level to standard",
                            canonical_prompt="restore level to standard",
                            variant_kind="baseline",
                            speed_tier="standard",
                            jump_height_tier="standard",
                            gravity_tier="standard_gravity",
                            baseline_marker=True,
                            baseline_variant_id="variant_0001",
                            outcome_summary="speed standard, jump height standard, gravity standard gravity",
                            task_id="TASK_PLATFORMER_MANUAL_BASELINE",
                            request_id="REQ_PLATFORMER_MANUAL_BASELINE",
                            plan_key="platformer_restore_layout_standard_v1",
                            plan_title="Restore platformer level to standard",
                        ),
                        _experiment_variant(
                            order=2,
                            experiment_id="experiment_0030",
                            variant_id="variant_0002",
                            parent_variant_id="variant_0001",
                            source_prompt="save manual correction",
                            canonical_prompt="save manual correction",
                            variant_kind="followup_variant",
                            speed_tier="standard",
                            jump_height_tier="standard",
                            gravity_tier="standard_gravity",
                            baseline_variant_id="variant_0001",
                            outcome_summary="manual correction saved",
                            task_id="TASK_PLATFORMER_MANUAL_VARIANT",
                            request_id="REQ_PLATFORMER_MANUAL_VARIANT",
                            plan_key="platformer_manual_correction_capture_v1",
                            plan_title="Save manual platformer correction",
                            layout_id="super_monkee_tutorial",
                            layout_name="Super Monkee Tutorial",
                            manual_edit_mode="keyboard_mouse",
                            layout_correction_count=2,
                            layout_correction_summary="2 manual keyboard/mouse correction(s) saved for Super Monkee Tutorial.",
                            derived_from_corrected_layout=True,
                        ),
                    ],
                }
            ],
        },
        "result_state_history": [
            {
                "order": 1,
                "timestamp": "2026-04-04T10:20:00Z",
                "task_id": "TASK_PLATFORMER_MANUAL_BASELINE",
                "request_id": "REQ_PLATFORMER_MANUAL_BASELINE",
                "plan_id": "",
                "plan_key": "platformer_restore_layout_standard_v1",
                "plan_title": "Restore platformer level to standard",
                "target_context": "platformer",
                "target_entity": "platformer",
                "speed_tier": "standard",
                "speed_value": 5.5,
                "jump_height_tier": "standard",
                "jump_height_value": 1.2,
                "gravity_tier": "standard_gravity",
                "gravity_value": 9.81,
                "generic_capability_state": build_generic_capability_state(
                    target_context="platformer",
                    speed_tier="standard",
                    speed_value=5.5,
                    jump_height_tier="standard",
                    jump_height_value=1.2,
                    gravity_tier="standard_gravity",
                    gravity_value=9.81,
                ),
                "experiment_id": "experiment_0030",
                "variant_id": "variant_0001",
                "baseline_variant_id": "variant_0001",
                "preferred_baseline_variant_id": "",
                "baseline_marker": True,
                "variant_kind": "baseline",
            }
        ],
        "result_evaluation_history": [],
        "latest_result_evaluation": {},
    }

    state = apply_result_evaluation(
        state,
        task={
            "task_id": "TASK_PLATFORMER_MANUAL_VARIANT",
            "request_id": "REQ_PLATFORMER_MANUAL_VARIANT",
            "plan_id": "",
            "plan_key": "platformer_manual_correction_capture_v1",
            "plan_title": "Save manual platformer correction",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "source_prompt": "save manual correction",
            "operator_prompt": "save manual correction",
        },
        timestamp="2026-04-04T10:21:00Z",
    )

    evaluation = state["latest_result_evaluation"]
    assert evaluation["layout_correction_count"] == 2
    assert evaluation["layout_correction_summary"] == "2 manual keyboard/mouse correction(s) saved for Super Monkee Tutorial."
    assert evaluation["derived_from_corrected_layout"] is True
    assert "Manual correction capture: 2 manual keyboard/mouse correction(s) saved for Super Monkee Tutorial." in evaluation["comparison_description"]
    assert "Derived from corrected layout: yes." in evaluation["comparison_description"]


def test_home_surface_loads_manual_platformer_correction_summary(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_manual_correction")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    run_dir = config.runs_dir / "manual-platformer-correction-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    result = persist_platformer_layout_correction_result(
        task={
            "task_id": "TASK_PLATFORMER_CORRECTION_SURFACE",
            "request_id": "REQ_PLATFORMER_CORRECTION_SURFACE",
            "target_repo": str(target_repo),
        },
        result={
            "status": "completed",
            "details": {
                "target_context": "platformer",
                "action_type": "capture_manual_platformer_layout_correction",
                "layout_id": "super_monkee_tutorial",
                "layout_name": "Super Monkee Tutorial",
                "layout_corrections": [
                    {
                        "object_id": "platform_01",
                        "object_type": "platform",
                        "action": "move",
                        "original_position": [0.0, 0.0, 0.0],
                        "corrected_position": [1.0, 0.0, 0.0],
                    }
                ],
            },
        },
        timestamp="2026-04-04T10:30:00Z",
    )
    artifact_path = artifacts_dir / "TASK_PLATFORMER_CORRECTION_SURFACE_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_CORRECTION_SURFACE",
                    "request_id": "REQ_PLATFORMER_CORRECTION_SURFACE",
                    "target_repo": str(target_repo),
                    "operator_prompt": "save manual correction",
                    "source_prompt": "save manual correction",
                },
                "result": result,
                "validation": {"validation_state": "passed", "queue_action": "complete"},
                "timestamp": "2026-04-04T10:30:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "session_state.json").write_text(json.dumps({}, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(artifact_path)
    assert proof.available is True
    assert proof.manual_correction_available is True
    assert proof.manual_correction_count == 1
    assert proof.manual_correction_summary == "1 manual keyboard/mouse correction(s) saved for Super Monkee Tutorial."
    assert proof.final_verdict == "Manual platformer layout corrections were saved as project-local artifacts and the recorded checks passed."
    assert "platform_01 moved from" in proof.before_after_summary


def test_home_surface_surfaces_platformer_layout_validation_findings(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_layout_validation")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    run_dir = config.runs_dir / "platformer-layout-validation-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    result = persist_platformer_layout_correction_result(
        task={
            "task_id": "TASK_PLATFORMER_LAYOUT_VALIDATION_SURFACE",
            "request_id": "REQ_PLATFORMER_LAYOUT_VALIDATION_SURFACE",
            "target_repo": str(target_repo),
        },
        result={
            "status": "completed",
            "details": {
                "target_context": "platformer",
                "layout_id": "super_monkee_tutorial",
                "layout_name": "Super Monkee Tutorial",
                "speed_value": 5.5,
                "jump_height_value": 1.2,
                "gravity_value": 9.81,
                "corrected_layout": {
                    "layout_id": "super_monkee_tutorial",
                    "layout_name": "Super Monkee Tutorial",
                    "ground": {"center_x": 0.0, "center_z": 0.0, "top_y": 0.0, "width": 4.0, "depth": 2.0},
                    "platforms": [
                        {"object_id": "platform_far", "center_x": 10.0, "center_z": 0.0, "top_y": 2.1, "width": 1.5, "depth": 1.0},
                    ],
                },
            },
        },
        timestamp="2026-04-04T11:15:00Z",
    )
    result["details"].update(extract_platformer_layout_validation_metadata(result["details"]))

    artifact_path = artifacts_dir / "TASK_PLATFORMER_LAYOUT_VALIDATION_SURFACE_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_LAYOUT_VALIDATION_SURFACE",
                    "request_id": "REQ_PLATFORMER_LAYOUT_VALIDATION_SURFACE",
                    "target_repo": str(target_repo),
                    "operator_prompt": "save manual correction",
                    "source_prompt": "save manual correction",
                },
                "result": result,
                "validation": {"validation_state": "passed", "queue_action": "complete"},
                "timestamp": "2026-04-04T11:15:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "session_state.json").write_text(json.dumps({}, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(artifact_path)
    assert any("Spatial validation status: issues detected." in check for check in proof.validation_checks)
    assert any("Spatial validation highlights:" in check for check in proof.validation_checks)
    assert proof.validation_outcome == "Recorded spatial validation status: issues detected; 1 layout issue(s) detected."
    assert proof.final_verdict == "Requested change completed, but spatial validation found 1 layout issue(s)."


def test_home_surface_surfaces_platformer_direct_proof_with_review_scope_language(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_direct_proof_scope")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_PLATFORMER_DIRECT_SCOPE.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make more obstacles",
                    "context": {
                        "routing": {
                            "capability_id": "bounded_platformer_entity_transform",
                            "mapped_prompt": "increase obstacle density",
                            "target_context": "platformer",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_dir = config.runs_dir / "platformer-direct-proof-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / "TASK_PLATFORMER_DIRECT_SCOPE_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_DIRECT_SCOPE",
                    "request_id": "REQ_PLATFORMER_DIRECT_SCOPE",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make more obstacles",
                    "source_prompt": "make more obstacles",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_DIRECT_SCOPE.json",
                    "approval_state": "approved",
                    "approved_by": "Operator",
                },
                "result": {
                    "status": "blocked",
                    "details": {
                        "target_context": "platformer",
                        "translated_command": "increase obstacle density",
                        "action_name": "verified_change",
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "blocked",
                    "note": "Translated route execution failed for 'increase obstacle density'.",
                },
                "timestamp": "2026-04-05T15:32:33Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "session_state.json").write_text(json.dumps({}, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(artifact_path)

    assert proof.available is True
    assert proof.final_verdict == (
        "The approved bounded platformer action 'increase obstacle density' entered the deterministic project tool route after Operator approval, "
        "but AI-E stopped it before completion. Stop reason: Translated route execution failed for 'increase obstacle density'. "
        "Constraint: Deterministic guardrail."
    )
    assert proof.validation_outcome == (
        "Validation stopped after the approved bounded platformer action 'increase obstacle density' entered the deterministic project tool route. "
        "AI-E did not widen scope beyond the reviewed change. Failing check: Translated route execution. "
        "Stop reason: Translated route execution failed for 'increase obstacle density'. Constraint enforcement: Deterministic guardrail."
    )
    assert proof.change_summary == (
        "AI-E stayed inside the approved bounded platformer action 'increase obstacle density' for this recorded run. "
        "Attempt trace: Reached validation for 'increase obstacle density' and stopped before completion."
    )
    assert "Mutation attempt: 'increase obstacle density'." in proof.key_steps
    assert "Stop reason: Translated route execution failed for 'increase obstacle density'." in proof.key_steps
    assert "Constraint enforcement: Deterministic guardrail." in proof.key_steps
    assert "Failing check: Translated route execution." in proof.validation_checks
    assert "Constraint enforcement: Deterministic guardrail." in proof.validation_checks
    assert proof.debug_expanded is False
    assert proof.debug_router_refs == []
    assert proof.debug_translated_commands == []

    debug_proof = home_surface.load_proof_result_surface(artifact_path, debug_expanded=True)

    assert debug_proof.debug_available is True
    assert debug_proof.debug_expanded is True
    assert "mapped_prompt=increase obstacle density" in debug_proof.debug_translated_commands
    assert "translated_command=increase obstacle density" in debug_proof.debug_translated_commands
    assert "validation_state=blocked" in debug_proof.debug_validation_codes
    assert any(item == "task_id=TASK_PLATFORMER_DIRECT_SCOPE" for item in debug_proof.debug_attempt_metadata)


def test_home_surface_surfaces_platformer_plan_proof_with_review_scope_language(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_plan_proof_scope")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_PLATFORMER_PLAN_SCOPE.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make this level more intense",
                    "context": {
                        "routing": {
                            "plan_key": "platformer_use_challenge_traversal",
                            "capability_id": "bounded_platformer_traversal_plan",
                            "mapped_prompt": "use challenge traversal",
                            "plan_title": "Use challenge traversal",
                            "plan_step_titles": [
                                "Set gap size to large",
                                "Set obstacle density to dense",
                                "Set enemy density to high",
                                "Set segment count to long",
                            ],
                            "target_context": "platformer",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_dir = config.runs_dir / "platformer-plan-proof-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "session_state.json").write_text(
        json.dumps(
            {
                "last_generated_plan_steps": [
                    "Set gap size to large",
                    "Set obstacle density to dense",
                    "Set enemy density to high",
                    "Set segment count to long",
                ]
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    artifact_path = artifacts_dir / "TASK_PLATFORMER_PLAN_SCOPE__STEP_01_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_PLAN_SCOPE__STEP_01",
                    "request_id": "REQ_PLATFORMER_PLAN_SCOPE",
                    "plan_id": "PLAN_PLATFORMER_PLAN_SCOPE",
                    "plan_title": "Use challenge traversal",
                    "plan_step_index": 1,
                    "plan_step_title": "Set gap size to large",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make this level more intense",
                    "source_prompt": "make this level more intense",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_PLAN_SCOPE.json",
                    "approval_state": "approved",
                    "approved_by": "Operator",
                },
                "result": {
                    "status": "blocked",
                    "details": {
                        "target_context": "platformer",
                        "translated_command": "make gaps larger",
                        "action_name": "verified_change",
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "blocked",
                    "note": "Translated route execution failed for 'make gaps larger'.",
                },
                "timestamp": "2026-04-05T15:32:50Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    proof = home_surface.load_proof_result_surface(run_dir)

    assert proof.available is True
    assert proof.final_verdict == (
        "AI-E started the approved bounded platformer plan 'Use challenge traversal' after Operator approval, "
        "but stopped when a reviewed step could not complete safely. Stopped at reviewed step 1: Set gap size to large. "
        "Stop reason: Translated route execution failed for 'make gaps larger'. Constraint: Deterministic guardrail."
    )
    assert proof.validation_outcome == (
        "At least one reviewed step in the approved bounded platformer plan 'Use challenge traversal' was blocked inside the deterministic project tool route. "
        "AI-E did not widen scope beyond the approved traversal. Stopped at reviewed step 1: Set gap size to large. "
        "Failing check: Translated route execution. Stop reason: Translated route execution failed for 'make gaps larger'. "
        "Constraint enforcement: Deterministic guardrail."
    )
    assert proof.change_summary == (
        "AI-E stayed inside the approved 4-step platformer plan 'Use challenge traversal' for this recorded run. "
        "Attempt trace: executed 1 reviewed step(s) and stopped at step 1 'Set gap size to large'."
    )
    assert any(
        step.startswith(
            "1. Set gap size to large: Status: Blocked. Mutation: 'make gaps larger'. Failing check: Translated route execution. "
            "Stop reason: Translated route execution failed for 'make gaps larger'. Constraint: Deterministic guardrail."
        )
        for step in proof.key_steps
    )
    assert "Set gap size to large: Failing check: Translated route execution." in proof.validation_checks
    assert "Set gap size to large: Constraint enforcement: Deterministic guardrail." in proof.validation_checks
    assert proof.debug_expanded is False
    assert proof.debug_attempt_metadata == []

    debug_proof = home_surface.load_proof_result_surface(run_dir, debug_expanded=True)

    assert debug_proof.debug_available is True
    assert debug_proof.debug_expanded is True
    assert "step_1:translated_command=make gaps larger" in debug_proof.debug_translated_commands
    assert "step_1:validation_state=blocked" in debug_proof.debug_validation_codes
    assert any(item.startswith("step_1: title=Set gap size to large; result_status=blocked;") for item in debug_proof.debug_attempt_metadata)


def test_home_surface_keeps_multiple_reviewed_plans_separate_in_one_session(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_multi_plan_proof")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)

    request_dir = config.contracts_dir / "intake" / "requests"
    request_dir.mkdir(parents=True, exist_ok=True)
    request_dir.joinpath("REQ_PLATFORMER_MULTI_PLAN_ONE.json").write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "increase obstacle density and enemy density",
                    "context": {
                        "routing": {
                            "plan_key": "platformer_multi_intent_obstacle_enemy_v1",
                            "capability_id": "bounded_platformer_intensity_plan",
                            "mapped_prompt": "increase obstacle density and enemy density",
                            "plan_title": "Increase obstacle density and enemy density",
                            "plan_step_titles": [
                                "Set obstacle density to dense",
                                "Set enemy density to high",
                            ],
                            "target_context": "platformer",
                            "resolution_source": "platformer_multi_intent_composition",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    request_dir.joinpath("REQ_PLATFORMER_MULTI_PLAN_TWO.json").write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make the gaps larger and add more obstacles",
                    "context": {
                        "routing": {
                            "plan_key": "platformer_multi_intent_gap_obstacle_v1",
                            "capability_id": "bounded_platformer_intensity_plan",
                            "mapped_prompt": "make the gaps larger and add more obstacles",
                            "plan_title": "Make gaps larger and add more obstacles",
                            "plan_step_titles": [
                                "Set gap size to large",
                                "Set obstacle density to dense",
                            ],
                            "target_context": "platformer",
                            "resolution_source": "platformer_multi_intent_composition",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_dir = config.runs_dir / "platformer-multi-plan-proof-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    attempts = [
        (
            "TASK_MULTI_PLAN_ONE__STEP_01_attempt_01.json",
            {
                "task": {
                    "task_id": "TASK_MULTI_PLAN_ONE__STEP_01",
                    "request_id": "REQ_PLATFORMER_MULTI_PLAN_ONE",
                    "plan_id": "PLAN_PLATFORMER_MULTI_PLAN_ONE",
                    "plan_title": "Increase obstacle density and enemy density",
                    "plan_step_index": 1,
                    "plan_step_title": "Set obstacle density to dense",
                    "target_repo": str(target_repo),
                    "operator_prompt": "increase obstacle density and enemy density",
                    "source_prompt": "increase obstacle density and enemy density",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_MULTI_PLAN_ONE.json",
                    "approval_state": "approved",
                    "approved_by": "Operator",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "translated_command": "increase obstacle density",
                        "action_name": "verified_change",
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded validation passed.",
                },
                "timestamp": "2026-04-05T17:10:00Z",
            },
        ),
        (
            "TASK_MULTI_PLAN_ONE__STEP_02_attempt_01.json",
            {
                "task": {
                    "task_id": "TASK_MULTI_PLAN_ONE__STEP_02",
                    "request_id": "REQ_PLATFORMER_MULTI_PLAN_ONE",
                    "plan_id": "PLAN_PLATFORMER_MULTI_PLAN_ONE",
                    "plan_title": "Increase obstacle density and enemy density",
                    "plan_step_index": 2,
                    "plan_step_title": "Set enemy density to high",
                    "target_repo": str(target_repo),
                    "operator_prompt": "increase obstacle density and enemy density",
                    "source_prompt": "increase obstacle density and enemy density",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_MULTI_PLAN_ONE.json",
                    "approval_state": "approved",
                    "approved_by": "Operator",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "translated_command": "increase enemy density",
                        "action_name": "verified_change",
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded validation passed.",
                },
                "timestamp": "2026-04-05T17:10:10Z",
            },
        ),
        (
            "TASK_MULTI_PLAN_TWO__STEP_01_attempt_01.json",
            {
                "task": {
                    "task_id": "TASK_MULTI_PLAN_TWO__STEP_01",
                    "request_id": "REQ_PLATFORMER_MULTI_PLAN_TWO",
                    "plan_id": "PLAN_PLATFORMER_MULTI_PLAN_TWO",
                    "plan_title": "Make gaps larger and add more obstacles",
                    "plan_step_index": 1,
                    "plan_step_title": "Set gap size to large",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make the gaps larger and add more obstacles",
                    "source_prompt": "make the gaps larger and add more obstacles",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_MULTI_PLAN_TWO.json",
                    "approval_state": "approved",
                    "approved_by": "Operator",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "translated_command": "make gaps larger",
                        "action_name": "verified_change",
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded validation passed.",
                },
                "timestamp": "2026-04-05T17:10:20Z",
            },
        ),
        (
            "TASK_MULTI_PLAN_TWO__STEP_02_attempt_01.json",
            {
                "task": {
                    "task_id": "TASK_MULTI_PLAN_TWO__STEP_02",
                    "request_id": "REQ_PLATFORMER_MULTI_PLAN_TWO",
                    "plan_id": "PLAN_PLATFORMER_MULTI_PLAN_TWO",
                    "plan_title": "Make gaps larger and add more obstacles",
                    "plan_step_index": 2,
                    "plan_step_title": "Set obstacle density to dense",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make the gaps larger and add more obstacles",
                    "source_prompt": "make the gaps larger and add more obstacles",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_MULTI_PLAN_TWO.json",
                    "approval_state": "approved",
                    "approved_by": "Operator",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "translated_command": "increase obstacle density",
                        "action_name": "verified_change",
                    },
                    "artifacts": [],
                },
                "validation": {
                    "validation_state": "passed",
                    "note": "Recorded validation passed.",
                },
                "timestamp": "2026-04-05T17:10:30Z",
            },
        ),
    ]
    for filename, payload in attempts:
        artifacts_dir.joinpath(filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(run_dir)

    assert proof.available is True
    assert proof.title == "2 approved reviewed plans"
    assert "2 separate approved reviewed plans" in proof.final_verdict
    assert "Plan 1 'Increase obstacle density and enemy density'" in proof.final_verdict
    assert "Plan 2 'Make gaps larger and add more obstacles'" in proof.final_verdict
    assert "Plan 1 'Increase obstacle density and enemy density'" in proof.change_summary
    assert "Plan 2 'Make gaps larger and add more obstacles'" in proof.validation_outcome
    assert "Plan 1: Increase obstacle density and enemy density." in proof.key_steps
    assert "Plan 2: Make gaps larger and add more obstacles." in proof.key_steps
    assert any(
        step.startswith(
            "Plan 1 - 1. Set obstacle density to dense: Status: Passed. Mutation: 'increase obstacle density'."
        )
        for step in proof.key_steps
    )
    assert any(
        step.startswith(
            "Plan 2 - 1. Set gap size to large: Status: Passed. Mutation: 'make gaps larger'."
        )
        for step in proof.key_steps
    )

def test_home_surface_surfaces_platformer_autonomous_review_summary_and_approval_boundary(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_autonomous_build")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    run_dir = config.runs_dir / "platformer-autonomous-build-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    request_payload_path = config.contracts_dir / "intake" / "requests" / "REQ_PLATFORMER_AUTONOMOUS_BUILD.json"
    request_payload_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload_path.write_text(
        json.dumps(
            {
                "conversational_request": {
                    "operator_prompt": "make traversal more challenging but fair",
                    "context": {
                        "routing": {
                            "mapped_prompt": "use challenge traversal",
                        }
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    artifact_path = artifacts_dir / "TASK_PLATFORMER_AUTONOMOUS_BUILD_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_AUTONOMOUS_BUILD",
                    "request_id": "REQ_PLATFORMER_AUTONOMOUS_BUILD",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make traversal more challenging but fair",
                    "source_prompt": "make traversal more challenging but fair",
                    "request_payload_path": "contracts/intake/requests/REQ_PLATFORMER_AUTONOMOUS_BUILD.json",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "platformer_autonomous_build_complete": "AUTONOMOUS BUILD COMPLETE",
                        "platformer_autonomous_build_parameter_families": [
                            "gap_size",
                            "obstacle_density",
                            "enemy_density",
                            "segment_count",
                        ],
                        "platformer_auto_iteration_valid_candidates": [
                            {
                                "candidate_id": "candidate_1",
                                "candidate_label": "Candidate A",
                                "evaluation_summary": "Gap size: large; Obstacle density: dense; Enemy density: high; Segment count: long",
                                "layout_parameters": {
                                    "gap_size_tier": "large",
                                    "obstacle_density_tier": "dense",
                                    "enemy_density_tier": "high",
                                    "segment_count_tier": "long",
                                },
                                "validation_metadata": {
                                    "layout_validation_status_label": "clean",
                                    "layout_validation_issue_count": 0,
                                },
                                "result_payload": {
                                    "details": {
                                        "derived_from_corrected_layout": True,
                                        "level_profile_name": "ChallengeTraversalProfile",
                                        "level_set_name": "ChallengeTraversalSet",
                                    }
                                },
                            },
                            {
                                "candidate_id": "candidate_2",
                                "candidate_label": "Candidate B",
                                "evaluation_summary": "Gap size: medium; Obstacle density: medium; Enemy density: medium; Segment count: medium",
                                "validation_metadata": {
                                    "layout_validation_status_label": "issues detected",
                                    "layout_validation_issue_count": 1,
                                },
                                "result_payload": {
                                    "details": {
                                        "derived_from_corrected_layout": False,
                                        "level_profile_name": "FallbackProfile",
                                        "level_set_name": "FallbackSet",
                                    }
                                },
                            },
                        ],
                        "platformer_auto_iteration_attempts": [
                            {
                                "attempt_number": 1,
                                "decision": "rejected",
                                "layout_validation_status": "issues_found",
                                "reason": "Unreachable platform at P9.",
                            },
                            {
                                "attempt_number": 2,
                                "decision": "accepted",
                                "layout_validation_status": "passed",
                                "reason": "no blocking issues",
                            },
                        ],
                    },
                    "artifacts": [],
                },
                "validation": {"validation_state": "passed", "queue_action": "complete"},
                "timestamp": "2026-04-04T12:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "session_state.json").write_text(json.dumps({}, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(artifact_path)

    assert proof.available is True
    assert proof.autonomous_build_available is True
    assert proof.autonomous_build_phase == "review"
    assert proof.autonomous_build_banner == "AUTONOMOUS REVIEW READY"
    assert proof.autonomous_build_status_line == (
        "Bounded autonomous variations have been generated and validated. No variation has been selected. Awaiting user decision."
    )
    assert proof.final_verdict == "AUTONOMOUS REVIEW READY. Awaiting user decision."
    assert proof.validation_outcome == (
        "No candidate has been selected automatically. Choose a candidate to approve, reject all candidates, or request changes."
    )
    assert proof.autonomous_build_requested_directive == "make traversal more challenging but fair"
    assert proof.autonomous_build_bounded_mapping == "use challenge traversal"
    assert proof.autonomous_build_constraints == [
        "validation required",
        "no automatic selection",
        "user approval required",
    ]
    assert proof.autonomous_build_parameter_families == [
        "gap_size",
        "obstacle_density",
        "enemy_density",
        "segment_count",
    ]
    assert proof.autonomous_build_candidate_count == 2
    assert [candidate.label for candidate in proof.autonomous_build_candidates] == ["Candidate A", "Candidate B"]
    assert [candidate.candidate_id for candidate in proof.autonomous_build_candidates] == ["candidate_1", "candidate_2"]
    assert proof.autonomous_build_candidates[0].summary == (
        "Gap size: large; Obstacle density: dense; Enemy density: high; Segment count: long"
    )
    assert proof.autonomous_build_candidates[0].evaluation_notes == [
        "Gap size: large",
        "Obstacle density: dense",
        "Enemy density: high",
        "Segment count: long",
    ]
    assert proof.autonomous_build_candidates[0].validation_status == "clean"
    assert proof.autonomous_build_candidates[0].derived_from_corrected_layout is True
    assert proof.autonomous_build_candidates[1].issue_count == 1
    assert proof.autonomous_build_attempt_log == [
        "Attempt 1: rejected | validation: issues_found | reason: Unreachable platform at P9.",
        "Attempt 2: accepted into candidate set | validation: passed | reason: no blocking issues",
    ]
    assert proof.autonomous_build_user_controls == ["Approve candidate", "Reject all candidates", "Request changes"]
    assert proof.autonomous_build_requires_approval is True
    assert proof.autonomous_build_selected_candidate_id == ""
    assert proof.autonomous_build_selected_candidate_label == ""
    assert proof.autonomous_build_completion_summary == ""
    assert "AUTONOMOUS REVIEW READY" in proof.change_summary
    assert "AUTONOMOUS BUILD COMPLETE" not in proof.change_summary
    assert "Candidate A (candidate_1)" in proof.change_summary
    assert "Attempt log" in proof.change_summary
    assert "User control" in proof.change_summary
    assert "No candidate has been selected automatically" in proof.change_summary
    assert "recommend" not in proof.change_summary.lower()


def test_review_surface_does_not_claim_autonomous_build_complete_before_user_selection(tmp_path):
    config = _make_config(tmp_path / "hs_auto_guard")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    run_dir = config.runs_dir / "auto-guard"
    run_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    artifact_path = artifacts_dir / "AUTO_GUARD.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_AUTONOMOUS_REVIEW_GUARD",
                    "request_id": "REQ_PLATFORMER_AUTONOMOUS_REVIEW_GUARD",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make this level more intense",
                    "source_prompt": "make this level more intense",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "platformer_autonomous_build_complete": "AUTONOMOUS BUILD COMPLETE",
                        "platformer_auto_iteration_valid_candidates": [
                            {
                                "candidate_id": "candidate_1",
                                "candidate_label": "Candidate A",
                                "evaluation_summary": "Gap size: large; Obstacle density: dense",
                                "validation_metadata": {
                                    "layout_validation_status_label": "clean",
                                },
                            }
                        ],
                        "platformer_auto_iteration_attempts": [
                            {
                                "attempt_number": 1,
                                "decision": "accepted",
                                "layout_validation_status": "passed",
                                "reason": "no blocking issues",
                            }
                        ],
                    },
                    "artifacts": [],
                },
                "validation": {"validation_state": "passed", "queue_action": "complete"},
                "timestamp": "2026-04-04T12:15:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "session_state.json").write_text(json.dumps({}, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(artifact_path)

    assert proof.autonomous_build_phase == "review"
    assert proof.autonomous_build_banner == "AUTONOMOUS REVIEW READY"
    assert "AUTONOMOUS BUILD COMPLETE" not in proof.change_summary
    assert proof.final_verdict != "AUTONOMOUS BUILD COMPLETE. User-approved variation applied."


def test_home_surface_surfaces_platformer_autonomous_build_completion_after_explicit_selection(tmp_path):
    config = _make_config(tmp_path / "home_surface_platformer_autonomous_completion")
    target_repo = config.root_dir / "BABYLON_TEST"
    target_repo.mkdir(parents=True, exist_ok=True)
    run_dir = config.runs_dir / "platformer-autonomous-completion-session"
    artifacts_dir = run_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    artifact_path = artifacts_dir / "TASK_PLATFORMER_AUTONOMOUS_COMPLETION_attempt_01.json"
    artifact_path.write_text(
        json.dumps(
            {
                "task": {
                    "task_id": "TASK_PLATFORMER_AUTONOMOUS_COMPLETION",
                    "request_id": "REQ_PLATFORMER_AUTONOMOUS_COMPLETION",
                    "target_repo": str(target_repo),
                    "operator_prompt": "make this level more intense",
                    "source_prompt": "make this level more intense",
                },
                "result": {
                    "status": "completed",
                    "details": {
                        "target_context": "platformer",
                        "platformer_autonomous_build_complete": "AUTONOMOUS BUILD COMPLETE",
                        "platformer_autonomous_selected_candidate_id": "candidate_1",
                        "platformer_autonomous_selected_candidate_label": "Candidate A",
                        "platformer_autonomous_completion_summary": "Applied ChallengeTraversalSet with validation-confirmed traversal coverage.",
                        "platformer_autonomous_build_parameter_families": [
                            "gap_size",
                            "obstacle_density",
                        ],
                        "platformer_auto_iteration_valid_candidates": [
                            {
                                "candidate_id": "candidate_1",
                                "candidate_label": "Candidate A",
                                "evaluation_summary": "Gap size: large; Obstacle density: dense",
                                "validation_metadata": {
                                    "layout_validation_status_label": "clean",
                                    "layout_validation_summary": "Spatial validation clean for platformer layout: 0 issues detected.",
                                },
                                "result_payload": {
                                    "details": {
                                        "level_profile_name": "ChallengeTraversalProfile",
                                        "level_set_name": "ChallengeTraversalSet",
                                    }
                                },
                            }
                        ],
                        "platformer_auto_iteration_attempts": [
                            {
                                "attempt_number": 1,
                                "decision": "accepted",
                                "candidate_label": "Candidate A",
                                "layout_validation_status": "passed",
                                "reason": "no blocking issues",
                            }
                        ],
                    },
                    "artifacts": [],
                },
                "validation": {"validation_state": "passed", "queue_action": "complete"},
                "timestamp": "2026-04-04T12:30:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run_dir / "session_state.json").write_text(json.dumps({}, indent=2), encoding="utf-8")

    proof = home_surface.load_proof_result_surface(artifact_path)

    assert proof.autonomous_build_phase == "completion"
    assert proof.autonomous_build_banner == "AUTONOMOUS BUILD COMPLETE"
    assert proof.final_verdict == "AUTONOMOUS BUILD COMPLETE. User-approved variation applied."
    assert proof.autonomous_build_selected_candidate_id == "candidate_1"
    assert proof.autonomous_build_selected_candidate_label == "Candidate A"
    assert proof.autonomous_build_requires_approval is False
    assert proof.autonomous_build_user_controls == []
    assert proof.autonomous_build_completion_summary == (
        "Applied ChallengeTraversalSet with validation-confirmed traversal coverage."
    )
    assert proof.validation_outcome == (
        "User-approved variation applied. No autonomous final selection occurred outside user approval."
    )
    assert "AUTONOMOUS BUILD COMPLETE" in proof.change_summary
    assert "Selected variation" in proof.change_summary
    assert "Candidate A (candidate_1)" in proof.change_summary
    assert "Final selection was made through explicit user approval" in proof.change_summary
    assert "Approve candidate" not in proof.change_summary
    assert "recommend" not in proof.change_summary.lower()


def test_experiment_tracking_records_platformer_level_set_metadata_on_variants():
    state = {
        "session_tuning_state": {
            "target_context": "platformer",
            "target_entity": "platformer",
            "contexts": {
                "platformer": {
                    "jump_height": {
                        "family": "jump_height",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "low",
                        "observed_value": 0.9,
                    },
                    "gravity": {
                        "family": "gravity",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "high_gravity",
                        "observed_value": 13.0,
                    },
                    "speed": {
                        "family": "speed",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "fast",
                        "observed_value": 7.0,
                    },
                    "gap_size": {
                        "family": "gap_size",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "large",
                        "observed_value": 4.5,
                    },
                    "obstacle_density": {
                        "family": "obstacle_density",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "dense",
                        "observed_value": 1.5,
                    },
                    "enemy_density": {
                        "family": "enemy_density",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "high",
                        "observed_value": 3.0,
                    },
                    "segment_count": {
                        "family": "segment_count",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "resulting_tier": "long",
                        "observed_value": 12.0,
                    },
                }
            },
        },
        "experiment_tracking": {},
    }

    updated = apply_experiment_tracking(
        state,
        task={
            "task_id": "TASK_EXPERIMENT_PLATFORMER_LEVEL_SET",
            "request_id": "REQ_EXPERIMENT_PLATFORMER_LEVEL_SET",
            "plan_id": "",
            "plan_key": "platformer_level_set_c_v1",
            "plan_title": "Use level set c",
            "plan_total_steps": 1,
            "plan_step_index": 1,
            "source_prompt": "use level set c",
            "operator_prompt": "make level longer",
            "capability_id": "level_0001_increase_platformer_segment_count",
        },
        details={
            "translated_command": "use level set c",
            "target_context": "platformer",
            "target_entity": "platformer",
            "resolution_source": "direct_prompt",
            "result_reason": "applied",
            "executed": True,
            "speed_value": 7.0,
            "jump_height_value": 0.9,
            "gravity_value": 13.0,
            "corrected_layout": {
                "layout_id": "level_set_c_layout",
                "layout_name": "Level Set C Layout",
                "ground": {"center_x": 0.0, "center_z": 0.0, "top_y": 0.0, "width": 4.0, "depth": 2.0},
                "platforms": [
                    {"object_id": "platform_far", "center_x": 0.5, "center_z": 0.0, "top_y": 3.0, "width": 1.5, "depth": 1.0},
                ],
                "ladders": [
                    {"object_id": "ladder_void", "object_type": "ladder", "center_x": 5.0, "center_z": 0.0, "bottom_y": 0.0, "top_y": 2.0},
                ],
            },
        },
        timestamp="2026-04-03T15:12:00Z",
    )

    variant = updated["latest_experiment_variant"]
    assert variant["target_context"] == "platformer"
    assert variant["level_set_id"] == "level_set_c"
    assert variant["level_set_name"] == "level set c"
    assert variant["level_profile_id"] == "challenge_traversal"
    assert variant["level_profile_name"] == "challenge traversal"
    assert variant["layout_validation_status_label"] == "issues detected"
    assert variant["layout_validation_issue_count"] == 2
    assert variant["layout_validation_category_summary"] == "1 reachability, 1 traversal"
    assert variant["layout_validation_issue_type_summary"] == "1 invalid ladder, 1 unreachable platform"
    assert variant["outcome_summary"] == "speed fast, jump height low, gravity high gravity, gap size large, obstacle density dense, enemy density high, segment count long"


def test_task_intake_compares_platformer_layout_variants_across_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_platformer_layout")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-platformer-layout-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-platformer-layout-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0021",
                        "target_entity": "platformer",
                        "target_context": "platformer",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0021",
                                variant_id="variant_0001",
                                source_prompt="use challenge traversal",
                                canonical_prompt="use challenge traversal",
                                variant_kind="baseline",
                                gap_size_tier="large",
                                obstacle_density_tier="dense",
                                enemy_density_tier="high",
                                segment_count_tier="long",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="gap size large, obstacle density dense, enemy density high, segment count long",
                                plan_key="platformer_challenge_traversal_v1",
                                plan_title="Use challenge traversal",
                                level_profile_id="challenge_traversal",
                                level_profile_name="challenge traversal",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0022",
                        "target_entity": "platformer",
                        "target_context": "platformer",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0022",
                                variant_id="variant_0001",
                                source_prompt="restore level to standard",
                                canonical_prompt="restore level to standard",
                                variant_kind="baseline",
                                gap_size_tier="standard",
                                obstacle_density_tier="standard",
                                enemy_density_tier="standard",
                                segment_count_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="gap size standard, obstacle density standard, enemy density standard, segment count standard",
                                plan_key="platformer_restore_layout_standard_v1",
                                plan_title="Restore platformer level structure to standard",
                                level_profile_id="balanced_traversal",
                                level_profile_name="balanced traversal",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare variant_0001 in experiment_0021 with variant_0001 in experiment_0022",
        session_id="experiment-cross-comparison-platformer-layout-session",
        target_repo=str(config.root_dir),
    )

    combined_text = "\n".join(result.routing.plan_step_titles or [])
    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Cross-experiment variant comparison"
    assert "Left profile: challenge traversal." in combined_text
    assert "Right profile: balanced traversal." in combined_text
    assert "Gap size: standard -> large" in combined_text
    assert "Obstacle density: standard -> dense" in combined_text
    assert "Enemy density: standard -> high" in combined_text
    assert "Segment count: standard -> long" in combined_text


def test_task_intake_shows_platformer_layout_experiment_variant_review_summary(tmp_path):
    config = _make_config(tmp_path / "platformer_layout_variant_review_summary")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "platformer-layout-variant-review-session")
    state_store.save(
        {
            "session_id": "platformer-layout-variant-review-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0023",
                "experiments": [
                    {
                        "experiment_id": "experiment_0023",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0023",
                                variant_id="variant_0001",
                                source_prompt="restore level to standard",
                                canonical_prompt="restore level to standard",
                                variant_kind="baseline",
                                gap_size_tier="standard",
                                obstacle_density_tier="standard",
                                enemy_density_tier="standard",
                                segment_count_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="gap size standard, obstacle density standard, enemy density standard, segment count standard",
                                plan_key="platformer_restore_layout_standard_v1",
                                plan_title="Restore platformer level structure to standard",
                                level_profile_id="balanced_traversal",
                                level_profile_name="balanced traversal",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0023",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="use challenge traversal",
                                canonical_prompt="use challenge traversal",
                                variant_kind="followup_variant",
                                gap_size_tier="large",
                                obstacle_density_tier="dense",
                                enemy_density_tier="high",
                                segment_count_tier="long",
                                baseline_variant_id="variant_0001",
                                outcome_summary="gap size large, obstacle density dense, enemy density high, segment count long",
                                plan_key="platformer_challenge_traversal_v1",
                                plan_title="Use challenge traversal",
                                level_profile_id="challenge_traversal",
                                level_profile_name="challenge traversal",
                                decision_status="kept",
                            ),
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment variants",
        session_id="platformer-layout-variant-review-session",
        target_repo=str(config.root_dir),
    )

    assert result.routing.plan_title == "Current experiment variants"
    assert "Target context: platformer." in result.routing.decision_summary
    assert any(
        "variant_0002 | target context: platformer | status: current, preferred baseline, kept | prompt: use challenge traversal | profile: challenge traversal | outcome: gap size large, obstacle density dense, enemy density high, segment count long | deltas from baseline: Gap size: standard -> large; Obstacle density: standard -> dense; Enemy density: standard -> high; Segment count: standard -> long."
        == line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_shows_platformer_level_set_experiment_variant_review_summary(tmp_path):
    config = _make_config(tmp_path / "platformer_level_set_variant_review_summary")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "platformer-level-set-variant-review-session")
    state_store.save(
        {
            "session_id": "platformer-level-set-variant-review-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0026",
                "experiments": [
                    {
                        "experiment_id": "experiment_0026",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0026",
                                variant_id="variant_0001",
                                source_prompt="restore level set to standard",
                                canonical_prompt="restore level set to standard",
                                variant_kind="baseline",
                                jump_height_tier="standard",
                                gravity_tier="standard_gravity",
                                speed_tier="standard",
                                gap_size_tier="standard",
                                obstacle_density_tier="standard",
                                enemy_density_tier="standard",
                                segment_count_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed standard, jump height standard, gravity standard gravity, gap size standard, obstacle density standard, enemy density standard, segment count standard",
                                plan_key="platformer_restore_level_set_standard_v1",
                                plan_title="Restore platformer level set to standard",
                                level_set_id="standard_level_set",
                                level_set_name="standard level set",
                                level_profile_id="balanced_traversal",
                                level_profile_name="balanced traversal",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0026",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="use level set c",
                                canonical_prompt="use level set c",
                                variant_kind="followup_variant",
                                jump_height_tier="low",
                                gravity_tier="high_gravity",
                                speed_tier="fast",
                                gap_size_tier="large",
                                obstacle_density_tier="dense",
                                enemy_density_tier="high",
                                segment_count_tier="long",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast, jump height low, gravity high gravity, gap size large, obstacle density dense, enemy density high, segment count long",
                                plan_key="platformer_level_set_c_v1",
                                plan_title="Use level set c",
                                level_set_id="level_set_c",
                                level_set_name="level set c",
                                level_profile_id="challenge_traversal",
                                level_profile_name="challenge traversal",
                                decision_status="kept",
                            ),
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment variants",
        session_id="platformer-level-set-variant-review-session",
        target_repo=str(config.root_dir),
    )

    assert result.routing.plan_title == "Current experiment variants"
    assert any(
        "variant_0002 | target context: platformer | status: current, preferred baseline, kept | prompt: use level set c | level set: level set c | profile: challenge traversal | outcome: speed fast, jump height low, gravity high gravity, gap size large, obstacle density dense, enemy density high, segment count long | deltas from baseline: Speed: standard -> fast; Jump height: standard -> low; Gravity: standard_gravity -> high_gravity; Gap size: standard -> large; Obstacle density: standard -> dense; Enemy density: standard -> high; Segment count: standard -> long."
        == line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_shows_platformer_profile_decision_summary(tmp_path):
    config = _make_config(tmp_path / "platformer_profile_decision_summary")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "platformer-profile-decision-session")
    state_store.save(
        {
            "session_id": "platformer-profile-decision-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0024",
                "experiments": [
                    {
                        "experiment_id": "experiment_0024",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0024",
                                variant_id="variant_0001",
                                source_prompt="restore level to standard",
                                canonical_prompt="restore level to standard",
                                variant_kind="baseline",
                                gap_size_tier="standard",
                                obstacle_density_tier="standard",
                                enemy_density_tier="standard",
                                segment_count_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="gap size standard, obstacle density standard, enemy density standard, segment count standard",
                                plan_key="platformer_restore_layout_standard_v1",
                                plan_title="Restore platformer level structure to standard",
                                level_profile_id="balanced_traversal",
                                level_profile_name="balanced traversal",
                                decision_status="kept",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0024",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="use short dense run",
                                canonical_prompt="use short dense run",
                                variant_kind="followup_variant",
                                gap_size_tier="standard",
                                obstacle_density_tier="dense",
                                enemy_density_tier="high",
                                segment_count_tier="short",
                                baseline_variant_id="variant_0001",
                                outcome_summary="gap size standard, obstacle density dense, enemy density high, segment count short",
                                plan_key="platformer_short_dense_run_v1",
                                plan_title="Use short dense run",
                                level_profile_id="short_dense_run",
                                level_profile_name="short dense run",
                                decision_status="rejected",
                            ),
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment decisions",
        session_id="platformer-profile-decision-session",
        target_repo=str(config.root_dir),
    )

    assert result.routing.plan_title == "Current experiment decisions"
    assert any(
        "variant_0002 | target context: platformer | status: current, preferred baseline, rejected | prompt: use short dense run | profile: short dense run | outcome: gap size standard, obstacle density dense, enemy density high, segment count short | deltas from baseline: Obstacle density: standard -> dense; Enemy density: standard -> high; Segment count: standard -> short."
        == line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_compares_platformer_variants_across_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_platformer")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-platformer-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-platformer-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0003",
                        "target_entity": "platformer",
                        "target_context": "platformer",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0003",
                                variant_id="variant_0001",
                                source_prompt="make jump higher",
                                canonical_prompt="make jump higher",
                                variant_kind="baseline",
                                jump_height_tier="high",
                                gravity_tier="low_gravity",
                                speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="jump height high, gravity low_gravity, speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0004",
                        "target_entity": "platformer",
                        "target_context": "platformer",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0004",
                                variant_id="variant_0001",
                                source_prompt="restore movement to standard",
                                canonical_prompt="restore movement to standard",
                                variant_kind="baseline",
                                jump_height_tier="standard",
                                gravity_tier="standard_gravity",
                                speed_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="jump height standard, gravity standard_gravity, speed standard",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare variant_0001 in experiment_0003 with variant_0001 in experiment_0004",
        session_id="experiment-cross-comparison-platformer-session",
        target_repo=str(config.root_dir),
    )

    combined_text = "\n".join(result.routing.plan_step_titles or [])
    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Cross-experiment variant comparison"
    assert "Left target context: platformer." in result.routing.plan_step_titles
    assert "Right target context: platformer." in result.routing.plan_step_titles
    assert "Jump height: standard -> high" in combined_text
    assert "Gravity: standard_gravity -> low_gravity" in combined_text
    assert "Speed: standard -> fast" in combined_text
    assert "Longer airtime." in combined_text
    assert "Slower fall speed." in combined_text


def test_task_intake_shows_platformer_experiment_variant_review_summary(tmp_path):
    config = _make_config(tmp_path / "platformer_variant_review_summary")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "platformer-variant-review-session")
    state_store.save(
        {
            "session_id": "platformer-variant-review-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0011",
                "experiments": [
                    {
                        "experiment_id": "experiment_0011",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0011",
                                variant_id="variant_0001",
                                source_prompt="restore movement to standard",
                                canonical_prompt="restore movement to standard",
                                variant_kind="baseline",
                                jump_height_tier="standard",
                                gravity_tier="standard_gravity",
                                speed_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed standard, jump height standard, gravity standard gravity",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0011",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make jump higher",
                                canonical_prompt="make jump higher",
                                variant_kind="followup_variant",
                                jump_height_tier="high",
                                gravity_tier="low_gravity",
                                speed_tier="fast",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast, jump height high, gravity low gravity",
                                decision_status="kept",
                            ),
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment variants",
        session_id="platformer-variant-review-session",
        target_repo=str(config.root_dir),
    )

    assert result.routing.plan_title == "Current experiment variants"
    assert "Target context: platformer." in result.routing.decision_summary
    assert "Preferred baseline: variant_0002." in result.routing.decision_summary
    assert any(
        "variant_0002 | target context: platformer | status: current, preferred baseline, kept | prompt: make jump higher | outcome: speed fast, jump height high, gravity low gravity | deltas from baseline: Speed: standard -> fast; Jump height: standard -> high; Gravity: standard_gravity -> low_gravity."
        == line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_shows_platformer_experiment_decision_review_summary(tmp_path):
    config = _make_config(tmp_path / "platformer_decision_review_summary")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "platformer-decision-review-session")
    state_store.save(
        {
            "session_id": "platformer-decision-review-session",
            "experiment_tracking": {
                "active_experiment_id": "experiment_0012",
                "experiments": [
                    {
                        "experiment_id": "experiment_0012",
                        "target_context": "platformer",
                        "target_entity": "platformer",
                        "active_variant_id": "variant_0002",
                        "baseline_variant_id": "variant_0001",
                        "preferred_baseline_variant_id": "variant_0002",
                        "latest_decision": {
                            "summary": "Latest explicit user decision: set variant_0002 as the preferred baseline. Later baseline comparisons will reference variant_0002. Original baseline remains variant_0001.",
                        },
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0012",
                                variant_id="variant_0001",
                                source_prompt="restore gravity to standard",
                                canonical_prompt="restore gravity to standard",
                                variant_kind="baseline",
                                jump_height_tier="standard",
                                gravity_tier="standard_gravity",
                                speed_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed standard, jump height standard, gravity standard gravity",
                                decision_status="kept",
                            ),
                            _experiment_variant(
                                order=2,
                                experiment_id="experiment_0012",
                                variant_id="variant_0002",
                                parent_variant_id="variant_0001",
                                source_prompt="make movement faster",
                                canonical_prompt="make movement faster",
                                variant_kind="followup_variant",
                                jump_height_tier="high",
                                gravity_tier="low_gravity",
                                speed_tier="fast",
                                baseline_variant_id="variant_0001",
                                outcome_summary="speed fast, jump height high, gravity low gravity",
                                decision_status="kept",
                            ),
                        ],
                    }
                ],
            },
        }
    )

    result = intake.accept_message(
        "show current experiment decisions",
        session_id="platformer-decision-review-session",
        target_repo=str(config.root_dir),
    )

    assert result.routing.plan_title == "Current experiment decisions"
    assert "Decision review: experiment_0012." in result.routing.decision_summary
    assert "Target context: platformer." in result.routing.decision_summary
    assert "Original baseline: variant_0001." in result.routing.decision_summary
    assert "Preferred baseline: variant_0002." in result.routing.decision_summary
    assert "Kept variants: variant_0001, variant_0002." in result.routing.decision_summary
    assert "Rejected variants: none." in result.routing.decision_summary
    assert "Undecided variants: none." in result.routing.decision_summary
    assert any(
        "variant_0002 | target context: platformer | status: current, preferred baseline, kept | prompt: make movement faster | outcome: speed fast, jump height high, gravity low gravity | deltas from baseline: Speed: standard -> fast; Jump height: standard -> high; Gravity: standard_gravity -> low_gravity."
        == line
        for line in result.routing.plan_step_titles or []
    )


def test_task_intake_compares_racer_variants_across_experiments(tmp_path):
    config = _make_config(tmp_path / "experiment_cross_comparison_racer")
    intake = ConversationalTaskIntake(config)
    state_store = StateStore(config.runs_dir, "experiment-cross-comparison-racer-session")
    state_store.save(
        {
            "session_id": "experiment-cross-comparison-racer-session",
            "experiment_tracking": {
                "experiments": [
                    {
                        "experiment_id": "experiment_0001",
                        "target_entity": "racer",
                        "target_context": "racer",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0001",
                                variant_id="variant_0001",
                                source_prompt="increase racer acceleration",
                                canonical_prompt="increase racer acceleration",
                                variant_kind="baseline",
                                acceleration_tier="fast",
                                max_speed_tier="fast",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="acceleration fast, max speed fast",
                            ),
                        ],
                    },
                    {
                        "experiment_id": "experiment_0002",
                        "target_entity": "racer",
                        "target_context": "racer",
                        "active_variant_id": "variant_0001",
                        "baseline_variant_id": "variant_0001",
                        "variants": [
                            _experiment_variant(
                                order=1,
                                experiment_id="experiment_0002",
                                variant_id="variant_0001",
                                source_prompt="restore racer acceleration to standard",
                                canonical_prompt="restore racer acceleration to standard",
                                variant_kind="baseline",
                                acceleration_tier="standard",
                                max_speed_tier="standard",
                                baseline_marker=True,
                                baseline_variant_id="variant_0001",
                                outcome_summary="acceleration standard, max speed standard",
                            ),
                        ],
                    },
                ],
            },
        }
    )

    result = intake.accept_message(
        "compare variant_0001 in experiment_0001 with variant_0001 in experiment_0002",
        session_id="experiment-cross-comparison-racer-session",
        target_repo=str(config.root_dir),
    )

    combined_text = "\n".join(result.routing.plan_step_titles or [])
    assert result.task_type == "experiment_review_request"
    assert result.routing.plan_title == "Cross-experiment variant comparison"
    assert "Left target context: racer." in result.routing.plan_step_titles
    assert "Right target context: racer." in result.routing.plan_step_titles
    assert "Acceleration: standard -> fast" in combined_text
    assert "Max speed: standard -> fast" in combined_text
    assert "Quicker speed buildup." in combined_text
    assert "Higher top speed." in combined_text


def _write_racer_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    payloads = {
        "level_0001_increase_racer_acceleration.json": {
            "capability_id": "level_0001_increase_racer_acceleration",
            "title": "LEVEL_0001 increase racer acceleration",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["racer", "acceleration"],
            "match_verbs": ["increase"],
        },
        "level_0001_restore_racer_acceleration_standard.json": {
            "capability_id": "level_0001_restore_racer_acceleration_standard",
            "title": "LEVEL_0001 restore racer acceleration standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["racer", "acceleration", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_increase_racer_max_speed.json": {
            "capability_id": "level_0001_increase_racer_max_speed",
            "title": "LEVEL_0001 increase racer max speed",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["racer", "max", "speed"],
            "match_verbs": ["increase"],
        },
    }
    for filename, payload in payloads.items():
        (capabilities_dir / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _write_platformer_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    payloads = {
        "level_0001_increase_platformer_jump_height.json": {
            "capability_id": "level_0001_increase_platformer_jump_height",
            "title": "LEVEL_0001 increase platformer jump height",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["jump", "higher"],
            "match_verbs": ["make"],
        },
        "level_0001_decrease_platformer_jump_height.json": {
            "capability_id": "level_0001_decrease_platformer_jump_height",
            "title": "LEVEL_0001 decrease platformer jump height",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["jump", "lower"],
            "match_verbs": ["make"],
        },
        "level_0001_restore_platformer_jump_height_standard.json": {
            "capability_id": "level_0001_restore_platformer_jump_height_standard",
            "title": "LEVEL_0001 restore platformer jump height standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["jump", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_reduce_platformer_gravity.json": {
            "capability_id": "level_0001_reduce_platformer_gravity",
            "title": "LEVEL_0001 reduce platformer gravity",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["gravity"],
            "match_verbs": ["reduce"],
        },
        "level_0001_increase_platformer_gravity.json": {
            "capability_id": "level_0001_increase_platformer_gravity",
            "title": "LEVEL_0001 increase platformer gravity",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["gravity"],
            "match_verbs": ["increase"],
        },
        "level_0001_restore_platformer_gravity_standard.json": {
            "capability_id": "level_0001_restore_platformer_gravity_standard",
            "title": "LEVEL_0001 restore platformer gravity standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["gravity", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_increase_platformer_speed.json": {
            "capability_id": "level_0001_increase_platformer_speed",
            "title": "LEVEL_0001 increase platformer speed",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["movement", "faster"],
            "match_verbs": ["make"],
        },
        "level_0001_decrease_platformer_speed.json": {
            "capability_id": "level_0001_decrease_platformer_speed",
            "title": "LEVEL_0001 decrease platformer speed",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["movement", "slower"],
            "match_verbs": ["make"],
        },
        "level_0001_restore_platformer_speed_standard.json": {
            "capability_id": "level_0001_restore_platformer_speed_standard",
            "title": "LEVEL_0001 restore platformer speed standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "content_tags": {
                "violence_level": "none",
                "blood_level": "none",
                "gore_level": "none",
                "dismemberment": False,
                "horror_intensity": "none",
                "language_level": "none",
                "sexual_content_level": "none",
                "nudity_level": "none",
                "substance_reference_level": "none",
                "gambling_reference_level": "none",
            },
            "match_terms": ["movement", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_increase_platformer_gap_size.json": {
            "capability_id": "level_0001_increase_platformer_gap_size",
            "title": "LEVEL_0001 increase platformer gap size",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["gaps", "larger"],
            "match_verbs": ["make"],
        },
        "level_0001_decrease_platformer_gap_size.json": {
            "capability_id": "level_0001_decrease_platformer_gap_size",
            "title": "LEVEL_0001 decrease platformer gap size",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["gaps", "smaller"],
            "match_verbs": ["make"],
        },
        "level_0001_restore_platformer_gap_size_standard.json": {
            "capability_id": "level_0001_restore_platformer_gap_size_standard",
            "title": "LEVEL_0001 restore platformer gap size standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["gap", "size", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_reduce_platformer_obstacle_density.json": {
            "capability_id": "level_0001_reduce_platformer_obstacle_density",
            "title": "LEVEL_0001 reduce platformer obstacle density",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["obstacle", "density"],
            "match_verbs": ["reduce"],
        },
        "level_0001_increase_platformer_obstacle_density.json": {
            "capability_id": "level_0001_increase_platformer_obstacle_density",
            "title": "LEVEL_0001 increase platformer obstacle density",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["obstacle", "density"],
            "match_verbs": ["increase"],
        },
        "level_0001_restore_platformer_obstacle_density_standard.json": {
            "capability_id": "level_0001_restore_platformer_obstacle_density_standard",
            "title": "LEVEL_0001 restore platformer obstacle density standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["obstacle", "density", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_reduce_platformer_enemy_density.json": {
            "capability_id": "level_0001_reduce_platformer_enemy_density",
            "title": "LEVEL_0001 reduce platformer enemy density",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["enemy", "density"],
            "match_verbs": ["reduce"],
        },
        "level_0001_increase_platformer_enemy_density.json": {
            "capability_id": "level_0001_increase_platformer_enemy_density",
            "title": "LEVEL_0001 increase platformer enemy density",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["enemy", "density"],
            "match_verbs": ["increase"],
        },
        "level_0001_restore_platformer_enemy_density_standard.json": {
            "capability_id": "level_0001_restore_platformer_enemy_density_standard",
            "title": "LEVEL_0001 restore platformer enemy density standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["enemy", "density", "standard"],
            "match_verbs": ["restore"],
        },
        "level_0001_increase_platformer_segment_count.json": {
            "capability_id": "level_0001_increase_platformer_segment_count",
            "title": "LEVEL_0001 increase platformer segment count",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["level", "longer"],
            "match_verbs": ["make"],
        },
        "level_0001_decrease_platformer_segment_count.json": {
            "capability_id": "level_0001_decrease_platformer_segment_count",
            "title": "LEVEL_0001 decrease platformer segment count",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["level", "shorter"],
            "match_verbs": ["make"],
        },
        "level_0001_restore_platformer_segment_count_standard.json": {
            "capability_id": "level_0001_restore_platformer_segment_count_standard",
            "title": "LEVEL_0001 restore platformer segment count standard",
            "intent": "mutate",
            "target_level": "LEVEL_0001",
            "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
            "requested_execution_lane": "approval_required_mutation",
            "handler_name": "level_0001_entity_transform_handler",
            "agent_type": "level_0001_entity_transform_mutation_agent",
            "approval_required": True,
            "eligible_for_auto": False,
            "evidence_state": "experimental",
            "safety_class": "approval_gated_automation",
            "match_terms": ["segment", "count", "standard"],
            "match_verbs": ["restore"],
        },
    }
    for filename, payload in payloads.items():
        (capabilities_dir / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _write_environment_theme_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_apply_grass_ground_theme.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_apply_grass_ground_theme",
                "title": "LEVEL_0001 apply grass ground theme",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/Babylon FPS game ver 002.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["grass", "ground", "theme"],
                "match_verbs": ["apply"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_apply_dirt_ground_theme.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_apply_dirt_ground_theme",
                "title": "LEVEL_0001 apply dirt ground theme",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/Babylon FPS game ver 002.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["dirt", "ground", "theme"],
                "match_verbs": ["apply", "change", "make"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_apply_gravel_ground_theme.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_apply_gravel_ground_theme",
                "title": "LEVEL_0001 apply gravel ground theme",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/Babylon FPS game ver 002.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["gravel", "ground", "theme"],
                "match_verbs": ["apply", "change", "make"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_apply_damaged_ground_theme.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_apply_damaged_ground_theme",
                "title": "LEVEL_0001 apply damaged ground theme",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/Babylon FPS game ver 002.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["damaged", "ground", "theme"],
                "match_verbs": ["apply", "change", "make"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_environment_theme_real_target_evidence(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "evidence.json").write_text(
        json.dumps(
            {
                "capabilities": {
                    "level_0001_apply_grass_ground_theme": {
                        "capability_id": "level_0001_apply_grass_ground_theme",
                        "handler_name": "level_0001_entity_transform_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 1,
                        "times_passed": 1,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "real_target_verified",
                        "sandbox_verified": True,
                        "real_target_verified": True,
                        "rollback_verified": False,
                        "evidence_progression": [
                            "experimental",
                            "sandbox_verified",
                            "real_target_verified",
                        ],
                        "validation_history_summary": "attempts=1; passed=1; last_validation_result=passed; sandbox_verified=yes; real_target_verified=yes",
                        "rollback_history_summary": "last_rollback_result=none; rollback_verified=no",
                        "notes": "Seeded test evidence for the bounded grass ground theme review path.",
                    },
                    "level_0001_apply_dirt_ground_theme": {
                        "capability_id": "level_0001_apply_dirt_ground_theme",
                        "handler_name": "level_0001_entity_transform_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 1,
                        "times_passed": 1,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "real_target_verified",
                        "sandbox_verified": True,
                        "real_target_verified": True,
                        "rollback_verified": False,
                        "evidence_progression": [
                            "experimental",
                            "sandbox_verified",
                            "real_target_verified",
                        ],
                        "validation_history_summary": "attempts=1; passed=1; last_validation_result=passed; sandbox_verified=yes; real_target_verified=yes",
                        "rollback_history_summary": "last_rollback_result=none; rollback_verified=no",
                        "notes": "Seeded test evidence for the bounded dirt ground theme review path.",
                    },
                    "level_0001_apply_gravel_ground_theme": {
                        "capability_id": "level_0001_apply_gravel_ground_theme",
                        "handler_name": "level_0001_entity_transform_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 1,
                        "times_passed": 1,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "real_target_verified",
                        "sandbox_verified": True,
                        "real_target_verified": True,
                        "rollback_verified": False,
                        "evidence_progression": [
                            "experimental",
                            "sandbox_verified",
                            "real_target_verified",
                        ],
                        "validation_history_summary": "attempts=1; passed=1; last_validation_result=passed; sandbox_verified=yes; real_target_verified=yes",
                        "rollback_history_summary": "last_rollback_result=none; rollback_verified=no",
                        "notes": "Seeded test evidence for the bounded gravel ground theme review path.",
                    },
                    "level_0001_apply_damaged_ground_theme": {
                        "capability_id": "level_0001_apply_damaged_ground_theme",
                        "handler_name": "level_0001_entity_transform_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 1,
                        "times_passed": 1,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "real_target_verified",
                        "sandbox_verified": True,
                        "real_target_verified": True,
                        "rollback_verified": False,
                        "evidence_progression": [
                            "experimental",
                            "sandbox_verified",
                            "real_target_verified",
                        ],
                        "validation_history_summary": "attempts=1; passed=1; last_validation_result=passed; sandbox_verified=yes; real_target_verified=yes",
                        "rollback_history_summary": "last_rollback_result=none; rollback_verified=no",
                        "notes": "Seeded test evidence for the bounded damaged-ground theme review path.",
                    }
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_barrel_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_enable_explosive_barrel_foundation.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_enable_explosive_barrel_foundation",
                "title": "LEVEL_0001 enable explosive barrel foundation",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/Babylon FPS game ver 002.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none",
                },
                "match_terms": ["explosive", "barrel"],
                "match_verbs": ["enable", "place", "add"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_barrel_real_target_evidence(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "evidence.json").write_text(
        json.dumps(
            {
                "capabilities": {
                    "level_0001_enable_explosive_barrel_foundation": {
                        "capability_id": "level_0001_enable_explosive_barrel_foundation",
                        "handler_name": "level_0001_entity_transform_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 1,
                        "times_passed": 1,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "real_target_verified",
                        "sandbox_verified": True,
                        "real_target_verified": True,
                        "rollback_verified": False,
                        "evidence_progression": [
                            "experimental",
                            "sandbox_verified",
                            "real_target_verified",
                        ],
                        "validation_history_summary": "attempts=1; passed=1; last_validation_result=passed; sandbox_verified=yes; real_target_verified=yes",
                        "rollback_history_summary": "last_rollback_result=none; rollback_verified=no",
                        "notes": "Seeded test evidence for the bounded explosive barrel foundation review path.",
                    }
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_move_zombie_capability_contract(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_move_zombie_forward.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_move_zombie_forward",
                "title": "LEVEL_0001 move zombie forward",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["zombie", "forward"],
                "match_verbs": ["move", "translate", "shift", "reposition"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capabilities_dir / "level_0001_move_zombie_farther_forward.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_move_zombie_farther_forward",
                "title": "LEVEL_0001 move zombie farther forward",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_entity_transform_handler",
                "agent_type": "level_0001_entity_transform_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "none",
                    "blood_level": "none",
                    "gore_level": "none",
                    "dismemberment": False,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["zombie", "farther", "forward"],
                "match_verbs": ["move", "translate", "shift", "reposition"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_enemy_speed_capability_contracts(config: OrchestratorConfig, *, entity: str) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    for capability_id, title, match_terms, match_verbs in (
        (f"level_0001_increase_{entity}_speed", f"LEVEL_0001 increase {entity} speed", ("faster",), ("make",)),
        (f"level_0001_decrease_{entity}_speed", f"LEVEL_0001 decrease {entity} speed", ("slower",), ("make",)),
        (
            f"level_0001_restore_{entity}_speed_standard",
            f"LEVEL_0001 restore {entity} speed to standard",
            ("speed", "standard"),
            ("restore",),
        ),
    ):
        (capabilities_dir / f"{capability_id}.json").write_text(
            json.dumps(
                {
                    "capability_id": capability_id,
                    "title": title,
                    "intent": "mutate",
                    "target_level": "LEVEL_0001",
                    "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                    "requested_execution_lane": "approval_required_mutation",
                    "handler_name": "level_0001_entity_transform_handler",
                    "agent_type": "level_0001_entity_transform_mutation_agent",
                    "approval_required": True,
                    "eligible_for_auto": False,
                    "evidence_state": "experimental",
                    "safety_class": "approval_gated_automation",
                    "content_tags": {
                        "violence_level": "none",
                        "blood_level": "none",
                        "gore_level": "none",
                        "dismemberment": False,
                        "horror_intensity": "none",
                        "language_level": "none",
                        "sexual_content_level": "none",
                        "nudity_level": "none",
                        "substance_reference_level": "none",
                        "gambling_reference_level": "none",
                    },
                    "match_terms": [entity, *(list(match_terms) if isinstance(match_terms, tuple) else [match_terms])],
                    "match_verbs": list(match_verbs) if isinstance(match_verbs, tuple) else ["make"],
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _write_zombie_speed_capability_contracts(config: OrchestratorConfig) -> None:
    _write_enemy_speed_capability_contracts(config, entity="zombie")


def _write_runner_speed_capability_contracts(config: OrchestratorConfig) -> None:
    _write_enemy_speed_capability_contracts(config, entity="runner")


def _write_enemy_aggression_capability_contract(config: OrchestratorConfig, *, entity: str) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    for capability_id, title, match_terms, match_verbs in (
        (
            f"level_0001_increase_{entity}_aggression",
            f"LEVEL_0001 increase {entity} aggression",
            ("aggressive",),
            ("make",),
        ),
        (
            f"level_0001_restore_{entity}_aggression_standard",
            f"LEVEL_0001 restore {entity} aggression to standard",
            ("aggression", "standard"),
            ("restore",),
        ),
    ):
        (capabilities_dir / f"{capability_id}.json").write_text(
            json.dumps(
                {
                    "capability_id": capability_id,
                    "title": title,
                    "intent": "mutate",
                    "target_level": "LEVEL_0001",
                    "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                    "requested_execution_lane": "approval_required_mutation",
                    "handler_name": "level_0001_entity_transform_handler",
                    "agent_type": "level_0001_entity_transform_mutation_agent",
                    "approval_required": True,
                    "eligible_for_auto": False,
                    "evidence_state": "experimental",
                    "safety_class": "approval_gated_automation",
                    "content_tags": {
                        "violence_level": "none",
                        "blood_level": "none",
                        "gore_level": "none",
                        "dismemberment": False,
                        "horror_intensity": "none",
                        "language_level": "none",
                        "sexual_content_level": "none",
                        "nudity_level": "none",
                        "substance_reference_level": "none",
                        "gambling_reference_level": "none"
                    },
                    "match_terms": [entity, *list(match_terms)],
                    "match_verbs": list(match_verbs),
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _write_zombie_aggression_capability_contract(config: OrchestratorConfig) -> None:
    _write_enemy_aggression_capability_contract(config, entity="zombie")


def _write_runner_aggression_capability_contract(config: OrchestratorConfig) -> None:
    _write_enemy_aggression_capability_contract(config, entity="runner")


def _write_encounter_capability_contracts(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    for capability_id, title, match_terms, match_verbs in (
        ("level_0001_increase_encounter_count", "LEVEL_0001 increase encounter count", ("encounter", "count"), ("increase",)),
        ("level_0001_decrease_encounter_count", "LEVEL_0001 decrease encounter count", ("encounter", "count"), ("decrease",)),
        (
            "level_0001_restore_encounter_count_standard",
            "LEVEL_0001 restore encounter count to standard",
            ("encounter", "count", "standard"),
            ("restore",),
        ),
        ("level_0001_increase_spawn_pressure", "LEVEL_0001 increase spawn pressure", ("spawn", "pressure"), ("increase",)),
        ("level_0001_decrease_spawn_pressure", "LEVEL_0001 decrease spawn pressure", ("spawn", "pressure"), ("decrease",)),
        (
            "level_0001_restore_spawn_pressure_standard",
            "LEVEL_0001 restore spawn pressure to standard",
            ("spawn", "pressure", "standard"),
            ("restore",),
        ),
    ):
        (capabilities_dir / f"{capability_id}.json").write_text(
            json.dumps(
                {
                    "capability_id": capability_id,
                    "title": title,
                    "intent": "mutate",
                    "target_level": "LEVEL_0001",
                    "target_scene": "Assets/AI_E_TestScenes/entity_test.unity",
                    "requested_execution_lane": "approval_required_mutation",
                    "handler_name": "level_0001_entity_transform_handler",
                    "agent_type": "level_0001_entity_transform_mutation_agent",
                    "approval_required": True,
                    "eligible_for_auto": False,
                    "evidence_state": "experimental",
                    "safety_class": "approval_gated_automation",
                    "match_terms": list(match_terms),
                    "match_verbs": list(match_verbs),
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _create_entity_transform_prompt_repo(config: OrchestratorConfig, *, target_repo_name: str = "BABYLON_TEST") -> str:
    target_repo = config.root_dir / target_repo_name
    tools_dir = target_repo / "Tools"
    scripts_logs_dir = target_repo / "scripts" / "logs"
    tools_dir.mkdir(parents=True, exist_ok=True)
    scripts_logs_dir.mkdir(parents=True, exist_ok=True)
    (tools_dir / "run_aie_prompt.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_entity_transform.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_enemy_move_speed.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_enemy_aggression.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_encounter_count.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_spawn_pressure.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_jump_height.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_gravity.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_speed.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_gap_size.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_obstacle_density.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_enemy_density.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_platformer_segment_count.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_ground_theme.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_explosive_barrel_foundation.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "aie_prompt_aliases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "aliases": [
                    {
                        "normalized_prompt": "apply grass ground theme",
                        "translated_command": "apply grass ground theme",
                    },
                    {
                        "normalized_prompt": "make the ground grassy",
                        "translated_command": "apply grass ground theme",
                    },
                    {
                        "normalized_prompt": "apply dirt ground theme",
                        "translated_command": "apply dirt ground theme",
                    },
                    {
                        "normalized_prompt": "change the ground to dirt",
                        "translated_command": "apply dirt ground theme",
                    },
                    {
                        "normalized_prompt": "apply gravel ground theme",
                        "translated_command": "apply gravel ground theme",
                    },
                    {
                        "normalized_prompt": "change the ground to gravel",
                        "translated_command": "apply gravel ground theme",
                    },
                    {
                        "normalized_prompt": "apply damaged-ground theme",
                        "translated_command": "apply damaged-ground theme",
                    },
                    {
                        "normalized_prompt": "make the ground look damaged",
                        "translated_command": "apply damaged-ground theme",
                    },
                    {
                        "normalized_prompt": "change the ground to a damaged theme",
                        "translated_command": "apply damaged-ground theme",
                    },
                    {
                        "normalized_prompt": "enable explosive barrel",
                        "translated_command": "enable explosive barrel",
                    },
                    {
                        "normalized_prompt": "enable the explosive barrel",
                        "translated_command": "enable explosive barrel",
                    },
                    {
                        "normalized_prompt": "place an explosive barrel",
                        "translated_command": "enable explosive barrel",
                    },
                    {
                        "normalized_prompt": "add an explosive barrel",
                        "translated_command": "enable explosive barrel",
                    },
                    {
                        "normalized_prompt": "move zombie forward",
                        "translated_command": "move zombie forward",
                    },
                    {
                        "normalized_prompt": "move zombie farther forward",
                        "translated_command": "move zombie farther forward",
                    },
                    {
                        "normalized_prompt": "make zombie faster",
                        "translated_command": "make zombie faster",
                    },
                    {
                        "normalized_prompt": "make zombie slower",
                        "translated_command": "make zombie slower",
                    },
                    {
                        "normalized_prompt": "restore zombie speed to standard",
                        "translated_command": "restore zombie speed to standard",
                    },
                    {
                        "normalized_prompt": "make zombie more aggressive",
                        "translated_command": "make zombie more aggressive",
                    },
                    {
                        "normalized_prompt": "restore zombie aggression to standard",
                        "translated_command": "restore zombie aggression to standard",
                    },
                    {
                        "normalized_prompt": "make runner faster",
                        "translated_command": "make runner faster",
                    },
                    {
                        "normalized_prompt": "make runner slower",
                        "translated_command": "make runner slower",
                    },
                    {
                        "normalized_prompt": "restore runner speed to standard",
                        "translated_command": "restore runner speed to standard",
                    },
                    {
                        "normalized_prompt": "make runner more aggressive",
                        "translated_command": "make runner more aggressive",
                    },
                    {
                        "normalized_prompt": "restore runner aggression to standard",
                        "translated_command": "restore runner aggression to standard",
                    },
                    {
                        "normalized_prompt": "increase racer acceleration",
                        "translated_command": "increase racer acceleration",
                    },
                    {
                        "normalized_prompt": "restore racer acceleration to standard",
                        "translated_command": "restore racer acceleration to standard",
                    },
                    {
                        "normalized_prompt": "increase racer max speed",
                        "translated_command": "increase racer max speed",
                    },
                    {
                        "normalized_prompt": "make jump higher",
                        "translated_command": "make jump higher",
                    },
                    {
                        "normalized_prompt": "make jump lower",
                        "translated_command": "make jump lower",
                    },
                    {
                        "normalized_prompt": "restore jump to standard",
                        "translated_command": "restore jump to standard",
                    },
                    {
                        "normalized_prompt": "reduce gravity",
                        "translated_command": "reduce gravity",
                    },
                    {
                        "normalized_prompt": "increase gravity",
                        "translated_command": "increase gravity",
                    },
                    {
                        "normalized_prompt": "restore gravity to standard",
                        "translated_command": "restore gravity to standard",
                    },
                    {
                        "normalized_prompt": "make movement faster",
                        "translated_command": "make movement faster",
                    },
                    {
                        "normalized_prompt": "make movement slower",
                        "translated_command": "make movement slower",
                    },
                    {
                        "normalized_prompt": "restore movement to standard",
                        "translated_command": "restore movement to standard",
                    },
                    {
                        "normalized_prompt": "make gaps larger",
                        "translated_command": "make gaps larger",
                    },
                    {
                        "normalized_prompt": "make gaps smaller",
                        "translated_command": "make gaps smaller",
                    },
                    {
                        "normalized_prompt": "restore gap size to standard",
                        "translated_command": "restore gap size to standard",
                    },
                    {
                        "normalized_prompt": "reduce obstacle density",
                        "translated_command": "reduce obstacle density",
                    },
                    {
                        "normalized_prompt": "increase obstacle density",
                        "translated_command": "increase obstacle density",
                    },
                    {
                        "normalized_prompt": "restore obstacle density to standard",
                        "translated_command": "restore obstacle density to standard",
                    },
                    {
                        "normalized_prompt": "increase enemy density",
                        "translated_command": "increase enemy density",
                    },
                    {
                        "normalized_prompt": "reduce enemy density",
                        "translated_command": "reduce enemy density",
                    },
                    {
                        "normalized_prompt": "restore enemy density to standard",
                        "translated_command": "restore enemy density to standard",
                    },
                    {
                        "normalized_prompt": "make level longer",
                        "translated_command": "make level longer",
                    },
                    {
                        "normalized_prompt": "make level shorter",
                        "translated_command": "make level shorter",
                    },
                    {
                        "normalized_prompt": "restore segment count to standard",
                        "translated_command": "restore segment count to standard",
                    },
                    {
                        "normalized_prompt": "increase encounter count",
                        "translated_command": "increase encounter count",
                    },
                    {
                        "normalized_prompt": "decrease encounter count",
                        "translated_command": "decrease encounter count",
                    },
                    {
                        "normalized_prompt": "restore encounter count to standard",
                        "translated_command": "restore encounter count to standard",
                    },
                    {
                        "normalized_prompt": "increase spawn pressure",
                        "translated_command": "increase spawn pressure",
                    },
                    {
                        "normalized_prompt": "decrease spawn pressure",
                        "translated_command": "decrease spawn pressure",
                    },
                    {
                        "normalized_prompt": "restore spawn pressure to standard",
                        "translated_command": "restore spawn pressure to standard",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (tools_dir / "intent_layer_v1_routes.json").write_text(
        json.dumps(
            {
                "scene_name": "entity_test",
                "routes": [
                    {
                        "normalized_command": "apply grass ground theme",
                        "action_name": "apply_grass_ground_theme",
                        "entity_type": "environment_theme",
                        "probe_name": "MutateGroundTheme",
                        "wrapper_path": "Tools/run_unity_mutate_ground_theme.ps1",
                        "probe_artifact_file": "intent_apply_grass_ground_theme_probe_result.json",
                        "probe_log_file": "intent_apply_grass_ground_theme_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "Babylon FPS game ver 002",
                            "TargetObjectName": "Ground",
                            "ThemeName": "grass_ground",
                            "RequestedMaterialPath": "Assets/Resources/Materials/GrassGround.mat",
                            "BaselineMaterialPath": "Assets/Resources/Materials/Cement.mat"
                        }
                    },
                    {
                        "normalized_command": "apply dirt ground theme",
                        "action_name": "apply_dirt_ground_theme",
                        "entity_type": "environment_theme",
                        "probe_name": "MutateGroundTheme",
                        "wrapper_path": "Tools/run_unity_mutate_ground_theme.ps1",
                        "probe_artifact_file": "intent_apply_dirt_ground_theme_probe_result.json",
                        "probe_log_file": "intent_apply_dirt_ground_theme_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "Babylon FPS game ver 002",
                            "TargetObjectName": "Ground",
                            "ThemeName": "dirt_ground",
                            "RequestedMaterialPath": "Assets/Resources/Materials/DirtGround.mat",
                            "BaselineMaterialPath": "Assets/Resources/Materials/Cement.mat"
                        }
                    },
                    {
                        "normalized_command": "apply gravel ground theme",
                        "action_name": "apply_gravel_ground_theme",
                        "entity_type": "environment_theme",
                        "probe_name": "MutateGroundTheme",
                        "wrapper_path": "Tools/run_unity_mutate_ground_theme.ps1",
                        "probe_artifact_file": "intent_apply_gravel_ground_theme_probe_result.json",
                        "probe_log_file": "intent_apply_gravel_ground_theme_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "Babylon FPS game ver 002",
                            "TargetObjectName": "Ground",
                            "ThemeName": "gravel_ground",
                            "RequestedMaterialPath": "Assets/Resources/Materials/GravelGround.mat",
                            "BaselineMaterialPath": "Assets/Resources/Materials/Cement.mat"
                        }
                    },
                    {
                        "normalized_command": "apply damaged-ground theme",
                        "action_name": "apply_damaged_ground_theme",
                        "entity_type": "environment_theme",
                        "probe_name": "MutateGroundTheme",
                        "wrapper_path": "Tools/run_unity_mutate_ground_theme.ps1",
                        "probe_artifact_file": "intent_apply_damaged_ground_theme_probe_result.json",
                        "probe_log_file": "intent_apply_damaged_ground_theme_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "Babylon FPS game ver 002",
                            "TargetObjectName": "Ground",
                            "ThemeName": "damaged_ground",
                            "RequestedMaterialPath": "Assets/Resources/Materials/DamagedGround.mat",
                            "BaselineMaterialPath": "Assets/Resources/Materials/Cement.mat"
                        }
                    },
                    {
                        "normalized_command": "enable explosive barrel",
                        "action_name": "enable_explosive_barrel_foundation",
                        "entity_type": "interactable_object",
                        "probe_name": "MutateExplosiveBarrelFoundation",
                        "wrapper_path": "Tools/run_unity_mutate_explosive_barrel_foundation.ps1",
                        "probe_artifact_file": "intent_enable_explosive_barrel_probe_result.json",
                        "probe_log_file": "intent_enable_explosive_barrel_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "Babylon FPS game ver 002",
                            "TargetObjectName": "barrel0",
                            "FoundationStage": "foundation_only",
                            "DesignationId": "level2_explosive_barrel_a",
                            "ApprovedPointId": "level2_barrel_point_a"
                        }
                    },
                    {
                        "normalized_command": "move zombie forward",
                        "action_name": "move_entity_forward",
                        "entity_type": "zombie",
                        "direction": "forward",
                        "probe_name": "MutateEntityTransform",
                        "wrapper_path": "Tools/run_unity_mutate_entity_transform.ps1",
                        "probe_artifact_file": "intent_move_zombie_forward_probe_result.json",
                        "probe_log_file": "intent_move_zombie_forward_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                        },
                    },
                    {
                        "normalized_command": "move zombie farther forward",
                        "action_name": "move_entity_farther_forward",
                        "entity_type": "zombie",
                        "direction": "forward_farther",
                        "probe_name": "MutateEntityTransform",
                        "wrapper_path": "Tools/run_unity_mutate_entity_transform.ps1",
                        "probe_artifact_file": "intent_move_zombie_farther_forward_probe_result.json",
                        "probe_log_file": "intent_move_zombie_farther_forward_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "TargetPositionX": 0.0,
                            "TargetPositionY": 0.0,
                            "TargetPositionZ": 6.0
                        },
                    },
                    {
                        "normalized_command": "make zombie faster",
                        "action_name": "increase_enemy_move_speed",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_zombie_faster_probe_result.json",
                        "probe_log_file": "intent_make_zombie_faster_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedSpeed": 4.5,
                            "BaselineSpeed": 3.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make zombie slower",
                        "action_name": "decrease_enemy_move_speed",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_zombie_slower_probe_result.json",
                        "probe_log_file": "intent_make_zombie_slower_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedSpeed": 2.5,
                            "BaselineSpeed": 3.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make zombie more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_make_zombie_more_aggressive_probe_result.json",
                        "probe_log_file": "intent_make_zombie_more_aggressive_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedAttackCooldown": 0.6,
                            "BaselineAttackCooldown": 1.0,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "restore zombie speed to standard",
                        "action_name": "set_enemy_move_speed",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_restore_zombie_speed_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_zombie_speed_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedSpeed": 3.5,
                            "BaselineSpeed": 3.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "restore zombie aggression to standard",
                        "action_name": "set_enemy_aggression",
                        "entity_type": "zombie",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_restore_zombie_aggression_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_zombie_aggression_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Zombie_001_Instance",
                            "RequestedAttackCooldown": 1.0,
                            "BaselineAttackCooldown": 1.0,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "make runner faster",
                        "action_name": "increase_enemy_move_speed",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_runner_faster_probe_result.json",
                        "probe_log_file": "intent_make_runner_faster_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedSpeed": 5.0,
                            "BaselineSpeed": 4.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make runner slower",
                        "action_name": "decrease_enemy_move_speed",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_make_runner_slower_probe_result.json",
                        "probe_log_file": "intent_make_runner_slower_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedSpeed": 3.5,
                            "BaselineSpeed": 4.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "restore runner speed to standard",
                        "action_name": "set_enemy_move_speed",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_restore_runner_speed_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_runner_speed_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedSpeed": 4.5,
                            "BaselineSpeed": 4.5,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 5.0
                        }
                    },
                    {
                        "normalized_command": "make runner more aggressive",
                        "action_name": "increase_enemy_aggression",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_make_runner_more_aggressive_probe_result.json",
                        "probe_log_file": "intent_make_runner_more_aggressive_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedAttackCooldown": 0.5,
                            "BaselineAttackCooldown": 0.8,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "restore runner aggression to standard",
                        "action_name": "set_enemy_aggression",
                        "entity_type": "runner",
                        "probe_name": "MutateEnemyAggression",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_aggression.ps1",
                        "probe_artifact_file": "intent_restore_runner_aggression_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_runner_aggression_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Runner_Profile_Instance",
                            "RequestedAttackCooldown": 0.8,
                            "BaselineAttackCooldown": 0.8,
                            "MinAttackCooldown": 0.25,
                            "MaxAttackCooldown": 2.0
                        }
                    },
                    {
                        "normalized_command": "increase racer acceleration",
                        "action_name": "increase_racer_acceleration",
                        "entity_type": "racer",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_increase_racer_acceleration_probe_result.json",
                        "probe_log_file": "intent_increase_racer_acceleration_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Racer_Profile_Instance",
                            "RequestedSpeed": 6.5,
                            "BaselineSpeed": 5.0,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 8.0
                        }
                    },
                    {
                        "normalized_command": "restore racer acceleration to standard",
                        "action_name": "set_racer_acceleration",
                        "entity_type": "racer",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_restore_racer_acceleration_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_racer_acceleration_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Racer_Profile_Instance",
                            "RequestedSpeed": 5.0,
                            "BaselineSpeed": 5.0,
                            "MinSpeed": 2.0,
                            "MaxSpeed": 8.0
                        }
                    },
                    {
                        "normalized_command": "increase racer max speed",
                        "action_name": "increase_racer_max_speed",
                        "entity_type": "racer",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_enemy_move_speed.ps1",
                        "probe_artifact_file": "intent_increase_racer_max_speed_probe_result.json",
                        "probe_log_file": "intent_increase_racer_max_speed_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_Racer_Profile_Instance",
                            "RequestedSpeed": 15.0,
                            "BaselineSpeed": 12.5,
                            "MinSpeed": 8.0,
                            "MaxSpeed": 18.0
                        }
                    },
                    {
                        "normalized_command": "make jump higher",
                        "action_name": "increase_platformer_jump_height",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerJumpHeight",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_jump_height.ps1",
                        "probe_artifact_file": "intent_make_jump_higher_probe_result.json",
                        "probe_log_file": "intent_make_jump_higher_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedJumpHeight": 1.6,
                            "BaselineJumpHeight": 1.2,
                            "MinJumpHeight": 0.9,
                            "MaxJumpHeight": 1.6
                        }
                    },
                    {
                        "normalized_command": "make jump lower",
                        "action_name": "decrease_platformer_jump_height",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerJumpHeight",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_jump_height.ps1",
                        "probe_artifact_file": "intent_make_jump_lower_probe_result.json",
                        "probe_log_file": "intent_make_jump_lower_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedJumpHeight": 0.9,
                            "BaselineJumpHeight": 1.2,
                            "MinJumpHeight": 0.9,
                            "MaxJumpHeight": 1.6
                        }
                    },
                    {
                        "normalized_command": "restore jump to standard",
                        "action_name": "set_platformer_jump_height",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerJumpHeight",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_jump_height.ps1",
                        "probe_artifact_file": "intent_restore_jump_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_jump_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedJumpHeight": 1.2,
                            "BaselineJumpHeight": 1.2,
                            "MinJumpHeight": 0.9,
                            "MaxJumpHeight": 1.6
                        }
                    },
                    {
                        "normalized_command": "reduce gravity",
                        "action_name": "reduce_platformer_gravity",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerGravity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_gravity.ps1",
                        "probe_artifact_file": "intent_reduce_gravity_probe_result.json",
                        "probe_log_file": "intent_reduce_gravity_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedGravity": 6.0,
                            "BaselineGravity": 9.81,
                            "MinGravity": 6.0,
                            "MaxGravity": 13.0
                        }
                    },
                    {
                        "normalized_command": "increase gravity",
                        "action_name": "increase_platformer_gravity",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerGravity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_gravity.ps1",
                        "probe_artifact_file": "intent_increase_gravity_probe_result.json",
                        "probe_log_file": "intent_increase_gravity_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedGravity": 13.0,
                            "BaselineGravity": 9.81,
                            "MinGravity": 6.0,
                            "MaxGravity": 13.0
                        }
                    },
                    {
                        "normalized_command": "restore gravity to standard",
                        "action_name": "set_platformer_gravity",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerGravity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_gravity.ps1",
                        "probe_artifact_file": "intent_restore_gravity_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_gravity_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedGravity": 9.81,
                            "BaselineGravity": 9.81,
                            "MinGravity": 6.0,
                            "MaxGravity": 13.0
                        }
                    },
                    {
                        "normalized_command": "make movement faster",
                        "action_name": "increase_platformer_speed",
                        "entity_type": "platformer",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_speed.ps1",
                        "probe_artifact_file": "intent_make_movement_faster_probe_result.json",
                        "probe_log_file": "intent_make_movement_faster_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedSpeed": 7.0,
                            "BaselineSpeed": 5.5,
                            "MinSpeed": 4.0,
                            "MaxSpeed": 7.0
                        }
                    },
                    {
                        "normalized_command": "make movement slower",
                        "action_name": "decrease_platformer_speed",
                        "entity_type": "platformer",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_speed.ps1",
                        "probe_artifact_file": "intent_make_movement_slower_probe_result.json",
                        "probe_log_file": "intent_make_movement_slower_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedSpeed": 4.0,
                            "BaselineSpeed": 5.5,
                            "MinSpeed": 4.0,
                            "MaxSpeed": 7.0
                        }
                    },
                    {
                        "normalized_command": "restore movement to standard",
                        "action_name": "set_platformer_speed",
                        "entity_type": "platformer",
                        "probe_name": "MutateEnemyMoveSpeed",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_speed.ps1",
                        "probe_artifact_file": "intent_restore_movement_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_movement_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_Profile_Instance",
                            "RequestedSpeed": 5.5,
                            "BaselineSpeed": 5.5,
                            "MinSpeed": 4.0,
                            "MaxSpeed": 7.0
                        }
                    },
                    {
                        "normalized_command": "make gaps larger",
                        "action_name": "increase_platformer_gap_size",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerGapSize",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_gap_size.ps1",
                        "probe_artifact_file": "intent_make_gaps_larger_probe_result.json",
                        "probe_log_file": "intent_make_gaps_larger_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedGapSize": 4.5,
                            "BaselineGapSize": 3.0,
                            "MinGapSize": 2.0,
                            "MaxGapSize": 4.5
                        }
                    },
                    {
                        "normalized_command": "make gaps smaller",
                        "action_name": "decrease_platformer_gap_size",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerGapSize",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_gap_size.ps1",
                        "probe_artifact_file": "intent_make_gaps_smaller_probe_result.json",
                        "probe_log_file": "intent_make_gaps_smaller_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedGapSize": 2.0,
                            "BaselineGapSize": 3.0,
                            "MinGapSize": 2.0,
                            "MaxGapSize": 4.5
                        }
                    },
                    {
                        "normalized_command": "restore gap size to standard",
                        "action_name": "set_platformer_gap_size",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerGapSize",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_gap_size.ps1",
                        "probe_artifact_file": "intent_restore_gap_size_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_gap_size_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedGapSize": 3.0,
                            "BaselineGapSize": 3.0,
                            "MinGapSize": 2.0,
                            "MaxGapSize": 4.5
                        }
                    },
                    {
                        "normalized_command": "reduce obstacle density",
                        "action_name": "reduce_platformer_obstacle_density",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerObstacleDensity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_obstacle_density.ps1",
                        "probe_artifact_file": "intent_reduce_obstacle_density_probe_result.json",
                        "probe_log_file": "intent_reduce_obstacle_density_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedObstacleDensity": 0.5,
                            "BaselineObstacleDensity": 1.0,
                            "MinObstacleDensity": 0.5,
                            "MaxObstacleDensity": 1.5
                        }
                    },
                    {
                        "normalized_command": "increase obstacle density",
                        "action_name": "increase_platformer_obstacle_density",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerObstacleDensity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_obstacle_density.ps1",
                        "probe_artifact_file": "intent_increase_obstacle_density_probe_result.json",
                        "probe_log_file": "intent_increase_obstacle_density_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedObstacleDensity": 1.5,
                            "BaselineObstacleDensity": 1.0,
                            "MinObstacleDensity": 0.5,
                            "MaxObstacleDensity": 1.5
                        }
                    },
                    {
                        "normalized_command": "restore obstacle density to standard",
                        "action_name": "set_platformer_obstacle_density",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerObstacleDensity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_obstacle_density.ps1",
                        "probe_artifact_file": "intent_restore_obstacle_density_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_obstacle_density_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedObstacleDensity": 1.0,
                            "BaselineObstacleDensity": 1.0,
                            "MinObstacleDensity": 0.5,
                            "MaxObstacleDensity": 1.5
                        }
                    },
                    {
                        "normalized_command": "increase enemy density",
                        "action_name": "increase_platformer_enemy_density",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerEnemyDensity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_enemy_density.ps1",
                        "probe_artifact_file": "intent_increase_enemy_density_probe_result.json",
                        "probe_log_file": "intent_increase_enemy_density_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedEnemyDensity": 3.0,
                            "BaselineEnemyDensity": 2.0,
                            "MinEnemyDensity": 1.0,
                            "MaxEnemyDensity": 3.0
                        }
                    },
                    {
                        "normalized_command": "reduce enemy density",
                        "action_name": "reduce_platformer_enemy_density",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerEnemyDensity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_enemy_density.ps1",
                        "probe_artifact_file": "intent_reduce_enemy_density_probe_result.json",
                        "probe_log_file": "intent_reduce_enemy_density_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedEnemyDensity": 1.0,
                            "BaselineEnemyDensity": 2.0,
                            "MinEnemyDensity": 1.0,
                            "MaxEnemyDensity": 3.0
                        }
                    },
                    {
                        "normalized_command": "restore enemy density to standard",
                        "action_name": "set_platformer_enemy_density",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerEnemyDensity",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_enemy_density.ps1",
                        "probe_artifact_file": "intent_restore_enemy_density_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_enemy_density_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedEnemyDensity": 2.0,
                            "BaselineEnemyDensity": 2.0,
                            "MinEnemyDensity": 1.0,
                            "MaxEnemyDensity": 3.0
                        }
                    },
                    {
                        "normalized_command": "make level longer",
                        "action_name": "increase_platformer_segment_count",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerSegmentCount",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_segment_count.ps1",
                        "probe_artifact_file": "intent_make_level_longer_probe_result.json",
                        "probe_log_file": "intent_make_level_longer_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedSegmentCount": 12.0,
                            "BaselineSegmentCount": 8.0,
                            "MinSegmentCount": 5.0,
                            "MaxSegmentCount": 12.0
                        }
                    },
                    {
                        "normalized_command": "make level shorter",
                        "action_name": "decrease_platformer_segment_count",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerSegmentCount",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_segment_count.ps1",
                        "probe_artifact_file": "intent_make_level_shorter_probe_result.json",
                        "probe_log_file": "intent_make_level_shorter_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedSegmentCount": 5.0,
                            "BaselineSegmentCount": 8.0,
                            "MinSegmentCount": 5.0,
                            "MaxSegmentCount": 12.0
                        }
                    },
                    {
                        "normalized_command": "restore segment count to standard",
                        "action_name": "set_platformer_segment_count",
                        "entity_type": "platformer",
                        "probe_name": "MutatePlatformerSegmentCount",
                        "wrapper_path": "Tools/run_unity_mutate_platformer_segment_count.ps1",
                        "probe_artifact_file": "intent_restore_segment_count_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_segment_count_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "TargetObjectName": "AIE_SuperMonkee_LevelLayout_Instance",
                            "RequestedSegmentCount": 8.0,
                            "BaselineSegmentCount": 8.0,
                            "MinSegmentCount": 5.0,
                            "MaxSegmentCount": 12.0
                        }
                    },
                    {
                        "normalized_command": "increase encounter count",
                        "action_name": "increase_encounter_count",
                        "entity_type": "encounter",
                        "probe_name": "MutateEncounterCount",
                        "wrapper_path": "Tools/run_unity_mutate_encounter_count.ps1",
                        "probe_artifact_file": "intent_increase_encounter_count_probe_result.json",
                        "probe_log_file": "intent_increase_encounter_count_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedEncounterCount": 7,
                            "BaselineEncounterCount": 5,
                            "MinEncounterCount": 3,
                            "MaxEncounterCount": 7
                        }
                    },
                    {
                        "normalized_command": "decrease encounter count",
                        "action_name": "decrease_encounter_count",
                        "entity_type": "encounter",
                        "probe_name": "MutateEncounterCount",
                        "wrapper_path": "Tools/run_unity_mutate_encounter_count.ps1",
                        "probe_artifact_file": "intent_decrease_encounter_count_probe_result.json",
                        "probe_log_file": "intent_decrease_encounter_count_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedEncounterCount": 3,
                            "BaselineEncounterCount": 5,
                            "MinEncounterCount": 3,
                            "MaxEncounterCount": 7
                        }
                    },
                    {
                        "normalized_command": "restore encounter count to standard",
                        "action_name": "set_encounter_count",
                        "entity_type": "encounter",
                        "probe_name": "MutateEncounterCount",
                        "wrapper_path": "Tools/run_unity_mutate_encounter_count.ps1",
                        "probe_artifact_file": "intent_restore_encounter_count_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_encounter_count_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedEncounterCount": 5,
                            "BaselineEncounterCount": 5,
                            "MinEncounterCount": 3,
                            "MaxEncounterCount": 7
                        }
                    },
                    {
                        "normalized_command": "increase spawn pressure",
                        "action_name": "increase_spawn_pressure",
                        "entity_type": "encounter",
                        "probe_name": "MutateSpawnPressure",
                        "wrapper_path": "Tools/run_unity_mutate_spawn_pressure.ps1",
                        "probe_artifact_file": "intent_increase_spawn_pressure_probe_result.json",
                        "probe_log_file": "intent_increase_spawn_pressure_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedSpawnInterval": 4.0,
                            "BaselineSpawnInterval": 6.0,
                            "MinSpawnInterval": 4.0,
                            "MaxSpawnInterval": 8.0
                        }
                    },
                    {
                        "normalized_command": "decrease spawn pressure",
                        "action_name": "decrease_spawn_pressure",
                        "entity_type": "encounter",
                        "probe_name": "MutateSpawnPressure",
                        "wrapper_path": "Tools/run_unity_mutate_spawn_pressure.ps1",
                        "probe_artifact_file": "intent_decrease_spawn_pressure_probe_result.json",
                        "probe_log_file": "intent_decrease_spawn_pressure_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedSpawnInterval": 8.0,
                            "BaselineSpawnInterval": 6.0,
                            "MinSpawnInterval": 4.0,
                            "MaxSpawnInterval": 8.0
                        }
                    },
                    {
                        "normalized_command": "restore spawn pressure to standard",
                        "action_name": "set_spawn_pressure",
                        "entity_type": "encounter",
                        "probe_name": "MutateSpawnPressure",
                        "wrapper_path": "Tools/run_unity_mutate_spawn_pressure.ps1",
                        "probe_artifact_file": "intent_restore_spawn_pressure_to_standard_probe_result.json",
                        "probe_log_file": "intent_restore_spawn_pressure_to_standard_probe.log",
                        "wrapper_arguments": {
                            "ProjectPath": ".",
                            "SceneName": "entity_test",
                            "SpawnerName": "EncounterSpawner_Main",
                            "RequestedSpawnInterval": 6.0,
                            "BaselineSpawnInterval": 6.0,
                            "MinSpawnInterval": 4.0,
                            "MaxSpawnInterval": 8.0
                        }
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return str(target_repo.resolve())


def _strip_platformer_route_assets(target_repo: str) -> None:
    tools_dir = Path(target_repo) / "Tools"

    alias_path = tools_dir / "aie_prompt_aliases.json"
    alias_payload = json.loads(alias_path.read_text(encoding="utf-8"))
    alias_payload["aliases"] = [
        entry
        for entry in alias_payload.get("aliases", [])
        if not any(
            token in str(entry.get("normalized_prompt") or "")
            for token in (
                "jump",
                "gravity",
                "movement",
                "gaps",
                "obstacle density",
                "enemy density",
                "segment count",
                "level longer",
                "level shorter",
                "platformer",
            )
        )
    ]
    alias_path.write_text(json.dumps(alias_payload, indent=2), encoding="utf-8")

    route_path = tools_dir / "intent_layer_v1_routes.json"
    route_payload = json.loads(route_path.read_text(encoding="utf-8"))
    route_payload["routes"] = [
        entry
        for entry in route_payload.get("routes", [])
        if not any(
            token in str(entry.get("normalized_command") or "")
            for token in (
                "jump",
                "gravity",
                "movement",
                "gaps",
                "obstacle density",
                "enemy density",
                "segment count",
                "level longer",
                "level shorter",
                "platformer",
            )
        )
    ]
    route_path.write_text(json.dumps(route_payload, indent=2), encoding="utf-8")

    for script_name in (
        "run_unity_mutate_platformer_jump_height.ps1",
        "run_unity_mutate_platformer_gravity.ps1",
        "run_unity_mutate_platformer_speed.ps1",
        "run_unity_mutate_platformer_gap_size.ps1",
        "run_unity_mutate_platformer_obstacle_density.ps1",
        "run_unity_mutate_platformer_enemy_density.ps1",
        "run_unity_mutate_platformer_segment_count.ps1",
    ):
        script_path = tools_dir / script_name
        if script_path.exists():
            script_path.unlink()


def _write_locked_content_profile(config: OrchestratorConfig, *, rating_system: str, rating_target: str) -> None:
    content_policy_dir = config.contracts_dir / "content_policy"
    content_policy_dir.mkdir(parents=True, exist_ok=True)
    (content_policy_dir / "project_content_profile.json").write_text(
        json.dumps(
            {
                "content_mode": "GAME_DEV",
                "rating_system": rating_system,
                "rating_target": rating_target,
                "rating_locked": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_finisher_capability_contract(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    (capabilities_dir / "level_0001_finisher_system.json").write_text(
        json.dumps(
            {
                "capability_id": "level_0001_finisher_system",
                "title": "LEVEL_0001 finisher system",
                "intent": "mutate",
                "target_level": "LEVEL_0001",
                "target_scene": "Assets/AI_E_TestScenes/MinimalPlayableArena.unity",
                "requested_execution_lane": "approval_required_mutation",
                "handler_name": "level_0001_finisher_handler",
                "agent_type": "level_0001_grass_mutation_agent",
                "approval_required": True,
                "eligible_for_auto": False,
                "evidence_state": "experimental",
                "safety_class": "approval_gated_automation",
                "content_tags": {
                    "violence_level": "intense",
                    "blood_level": "intense",
                    "gore_level": "extreme",
                    "dismemberment": True,
                    "horror_intensity": "none",
                    "language_level": "none",
                    "sexual_content_level": "none",
                    "nudity_level": "none",
                    "substance_reference_level": "none",
                    "gambling_reference_level": "none"
                },
                "match_terms": ["level_0001", "finisher"],
                "match_verbs": ["add", "create", "build"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _seed_auto_promoted_reference_capability_proof(config: OrchestratorConfig) -> None:
    capabilities_dir = config.contracts_dir / "capabilities"
    capabilities_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = capabilities_dir / "evidence.json"
    evidence_path.write_text(
        json.dumps(
            {
                "capabilities": {
                    "level_0001_add_grass": {
                        "capability_id": "level_0001_add_grass",
                        "handler_name": "level_0001_grass_handler",
                        "safety_class": "approval_gated_automation",
                        "times_attempted": 4,
                        "times_passed": 4,
                        "last_validation_result": "passed",
                        "last_rollback_result": "none",
                        "artifact_requirements_met": True,
                        "eligible_for_auto": False,
                        "requires_approval": True,
                        "evidence_state": "experimental",
                        "sandbox_verified": False,
                        "real_target_verified": False,
                        "rollback_verified": False,
                        "notes": "Reference capability evidence seeded for auto-promotion derivation.",
                    }
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_dir = config.runs_dir / "live_real_grass_validation_20260317"
    post_dir = run_dir / "post_mutation"
    rollback_dir = run_dir / "rollback"
    post_dir.mkdir(parents=True, exist_ok=True)
    rollback_dir.mkdir(parents=True, exist_ok=True)

    (post_dir / "real_target_validation_report.json").write_text(
        json.dumps(
            {
                "session_id": "live_real_grass_validation_20260317",
                "capability_id": "level_0001_add_grass",
                "validation_result": "passed",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (rollback_dir / "rollback_validation_report.json").write_text(
        json.dumps(
            {
                "session_id": "live_real_grass_validation_20260317",
                "capability_id": "level_0001_add_grass",
                "rollback_validation_result": "passed",
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _make_config(tmp_path) -> OrchestratorConfig:
    root_dir = tmp_path / "repo_root"
    runs_dir = root_dir / "runs"
    workspaces_dir = root_dir / "workspaces"
    queue_path = root_dir / "backlog" / "queue.json"
    queue_contracts_dir = root_dir / "contracts" / "queue"
    agent_registry_path = root_dir / "agents" / "registry.json"
    contracts_dir = root_dir / "contracts"
    templates_dir = contracts_dir / "templates"
    approvals_path = root_dir / "backlog" / "approvals.json"
    command_allowlist_path = root_dir / "backlog" / "command_allowlist.json"

    for path in [runs_dir, workspaces_dir, queue_contracts_dir, templates_dir, approvals_path.parent, agent_registry_path.parent]:
        path.mkdir(parents=True, exist_ok=True)
    queue_path.write_text(json.dumps({"tasks": []}, indent=2), encoding="utf-8")
    approvals_path.write_text(json.dumps({"approvals": []}, indent=2), encoding="utf-8")
    command_allowlist_path.write_text(json.dumps({"exact": [], "prefix": []}, indent=2), encoding="utf-8")
    agent_registry_path.write_text(json.dumps({"agents": []}, indent=2), encoding="utf-8")

    return OrchestratorConfig(
        root_dir=root_dir,
        runs_dir=runs_dir,
        workspaces_dir=workspaces_dir,
        queue_path=queue_path,
        queue_contracts_dir=queue_contracts_dir,
        agent_registry_path=agent_registry_path,
        contracts_dir=contracts_dir,
        templates_dir=templates_dir,
        approvals_path=approvals_path,
        command_allowlist_path=command_allowlist_path,
    )
