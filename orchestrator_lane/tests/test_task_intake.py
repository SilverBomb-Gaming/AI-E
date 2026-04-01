import json
from pathlib import Path

import pytest

from app import home_surface
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

    assert result.task_id == "INTAKE_3335996CEC5B"
    assert result.request_id == "REQ_3335996CEC5B"
    assert result.task_type == "bounded_activation_request"
    assert result.target_repo == "E:/AI projects 2025/BABYLON VER 2"
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
    assert queue[0]["contract_path"] == "contracts/intake/runtime_tasks/INTAKE_3335996CEC5B.json"
    assert queue[0]["requested_intent"] == "mutate"
    assert queue[0]["execution_lane"] == "approval_required_mutation"
    assert queue[0]["downgraded"] is False
    assert queue[0]["decision"] == "block"

    request_payload = json.loads(result.artifacts.request_payload_path.read_text(encoding="utf-8"))
    task_graph = json.loads(result.artifacts.task_graph_path.read_text(encoding="utf-8"))
    runtime_payload = json.loads(result.artifacts.runtime_task_payload_path.read_text(encoding="utf-8"))

    assert request_payload["conversational_request"]["operator_prompt"] == "expand LEVEL_0001 a bit and make the zombie move and damage the player"
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
    assert result.queue_entry["task_type"] == "stabilization_request"
    assert result.queue_entry["target_repo"] == "E:/AI projects 2025/BABYLON VER 2"
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
    ("prompt_text", "mapped_source"),
    [
        ("move enemy forward", "enemy"),
        ("move character forward", "character"),
    ],
)
def test_task_intake_requires_confirmation_for_generalized_entity_terms(tmp_path, prompt_text, mapped_source):
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
    assert result.routing.capability_id == "level_0001_move_zombie_forward"
    assert result.routing.capability_supported is True
    assert result.routing.entity_mapping_applied is True
    assert result.routing.entity_mapping_sources == [mapped_source]
    assert result.routing.confirmation_required is True
    assert result.routing.mapped_prompt == "move zombie forward"
    assert 'supported zombie system in BABYLON' in str(result.routing.confirmation_message)
    assert runtime_payload["runtime_task"]["decision"] == "block"
    assert runtime_payload["runtime_task"]["operator_prompt"] == prompt_text


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


def test_home_surface_prepare_prompt_prompts_for_confirmation_when_entity_mapping_is_applied(tmp_path):
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
    assert preview.decision_state == "Needs confirmation"
    assert preview.confirmation_required is True
    assert preview.confirmation_prompt == "move zombie forward"
    assert preview.next_action_label == "Use supported target"
    assert preview.detected_action == "LEVEL_0001 move zombie forward"
    assert 'I understood "enemy" as the supported zombie system in BABYLON.' in preview.decision_reason
    assert "Confirm that target" in preview.status_message or "Confirm the zombie target" in preview.decision_reason


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


def _create_entity_transform_prompt_repo(config: OrchestratorConfig, *, target_repo_name: str = "BABYLON_TEST") -> str:
    target_repo = config.root_dir / target_repo_name
    tools_dir = target_repo / "Tools"
    scripts_logs_dir = target_repo / "scripts" / "logs"
    tools_dir.mkdir(parents=True, exist_ok=True)
    scripts_logs_dir.mkdir(parents=True, exist_ok=True)
    (tools_dir / "run_aie_prompt.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "run_unity_mutate_entity_transform.ps1").write_text("placeholder", encoding="utf-8")
    (tools_dir / "aie_prompt_aliases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "aliases": [
                    {
                        "normalized_prompt": "move zombie forward",
                        "translated_command": "move zombie forward",
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
