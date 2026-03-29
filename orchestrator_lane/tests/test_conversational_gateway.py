import pytest

from orchestrator.conversational_gateway import process_conversational_request


pytestmark = pytest.mark.fast


def test_process_conversational_request_maps_known_phrase_to_run_closed_loop():
    payload = process_conversational_request("Run closed loop for LEVEL_0001 with 2 iterations")

    assert payload["intent"] == "run_closed_loop"
    assert payload["domain"] == "playability"
    assert payload["subdomain"] == "closed_validation"
    assert payload["constraints"]["level_id"] == "LEVEL_0001"
    assert payload["constraints"]["max_iterations"] == 2
    assert payload["source"] == "conversational_gateway"
    assert len(payload["structured_tasks"]) == 1
    assert payload["structured_tasks"][0]["intent"] == "run_closed_loop"
    assert payload["structured_tasks"][0]["status"] == "pending"


def test_process_conversational_request_is_deterministic_for_same_input():
    first = process_conversational_request("Analyze level_0001")
    second = process_conversational_request("Analyze level_0001")

    assert first == second


def test_process_conversational_request_generate_design_tasks_aligns_with_existing_task_schema():
    payload = process_conversational_request("Extend map with 4 variations")

    assert payload["intent"] == "generate_design_tasks"
    assert len(payload["structured_tasks"]) == 4
    assert [task["task_id"] for task in payload["structured_tasks"]] == [
        "variation_1",
        "variation_2",
        "variation_3",
        "variation_4",
    ]
    for task in payload["structured_tasks"]:
        assert task["status"] == "pending"
        assert task["source"] == "conversational_gateway"
        assert task["created_from_prompt"] == "Extend map with 4 variations"
        assert isinstance(task["constraints"], dict)
        assert "safety" in task["constraints"]


def test_process_conversational_request_returns_controlled_failure_for_unsupported_input():
    payload = process_conversational_request("Tell me a joke about platforms")

    assert payload == {
        "status": "unsupported_request",
        "reason": "Request did not match a supported deterministic conversational intent.",
        "suggested_intents": [
            "analyze_level",
            "improve_playability",
            "run_closed_loop",
            "generate_design_tasks",
            "inspect_results",
        ],
    }