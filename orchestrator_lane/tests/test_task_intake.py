import json
from pathlib import Path

import pytest

from app import home_surface
from ai_e_runtime.experiment_tracking import apply_experiment_navigation, apply_experiment_tracking
from ai_e_runtime.outcome_evaluation import apply_result_evaluation
from ai_e_runtime.experiment_tracking import apply_experiment_decision
from ai_e_runtime.generic_capabilities import (
    build_generic_capability_state,
    generic_capability_definition,
    generic_capability_definition_for_capability_id,
    supported_generic_capability_mappings,
)
from ai_e_runtime.intent_normalizer import normalize_prompt
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
    assert result.routing.decision == "sandbox_first"
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
    assert preview.decision_state == "Sandbox first"
    assert preview.confirmation_required is False
    assert preview.next_action_label == "Run in sandbox"
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
    acceleration_tier: str = "",
    max_speed_tier: str = "",
    baseline_marker: bool = False,
    baseline_variant_id: str = "",
    parent_variant_id: str = "",
    outcome_summary: str = "",
    task_id: str | None = None,
    request_id: str | None = None,
    plan_id: str = "",
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
        "plan_title": "",
        "source_prompt": source_prompt,
        "canonical_prompt": canonical_prompt,
        "resolution_source": "direct_prompt",
        "resolved_from_prompt": "",
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
        "acceleration_tier": acceleration_tier,
        "acceleration_value": 6.5 if acceleration_tier == "fast" else (3.5 if acceleration_tier == "slow" else 5.0 if acceleration_tier == "standard" else None),
        "max_speed_tier": max_speed_tier,
        "max_speed_value": 15.0 if max_speed_tier == "fast" else (10.0 if max_speed_tier == "slow" else 12.5 if max_speed_tier == "standard" else None),
        "generic_capability_state": build_generic_capability_state(
            target_context="encounter" if encounter_count_tier or spawn_pressure_tier else "platformer" if jump_height_tier or gravity_tier or "jump" in canonical_prompt or "gravity" in canonical_prompt or "movement" in canonical_prompt else "racer" if acceleration_tier or max_speed_tier else "runner" if "runner" in canonical_prompt else "zombie",
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
                    f"acceleration {acceleration_tier}" if acceleration_tier else "",
                    f"max speed {max_speed_tier}" if max_speed_tier else "",
                )
                if part
            ]
        ),
    }

@pytest.mark.parametrize(
    ("prompt_text", "expected_capability", "expected_canonical_prompt"),
    [
        ("make runner faster", "level_0001_increase_runner_speed", "make runner faster"),
        ("make runner slower", "level_0001_decrease_runner_speed", "make runner slower"),
        ("restore runner speed to standard", "level_0001_restore_runner_speed_standard", "restore runner speed to standard"),
        ("make runner more aggressive", "level_0001_increase_runner_aggression", "make runner more aggressive"),
        (
            "restore runner aggression to standard",
            "level_0001_restore_runner_aggression_standard",
            "restore runner aggression to standard",
        ),
    ],
)
def test_task_intake_supports_direct_runner_deterministic_capabilities(
    tmp_path,
    prompt_text,
    expected_capability,
    expected_canonical_prompt,
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
    assert result.routing.decision == "sandbox_first"
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
    assert result.routing.decision == "sandbox_first"


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
    assert result.routing.decision == "sandbox_first"


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

    assert len(mappings) == 11
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
    } == {
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
    }


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
    }
    for filename, payload in payloads.items():
        (capabilities_dir / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")


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
    (tools_dir / "aie_prompt_aliases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "aliases": [
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
    assert result.routing.decision == "sandbox_first"
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
