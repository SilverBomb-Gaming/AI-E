import pytest

from orchestrator.external_agent_gateway_adapter import adapt_agent_request


pytestmark = pytest.mark.fast


def test_valid_agent_payload_routes_through_gateway_successfully():
    result = adapt_agent_request(
        {
            "request_text": "Run closed loop for LEVEL_0001 with 2 iterations",
            "agent_id": "agent_alpha",
            "session_id": "session_alpha",
            "requested_mode": "structured_gateway",
            "metadata": {"origin": "external"},
        }
    )

    assert result["status"] == "accepted"
    assert result["reason"] is None
    assert result["source"] == "external_agent_gateway_adapter"
    assert result["agent_id"] == "agent_alpha"
    assert result["session_id"] == "session_alpha"
    assert result["gateway_result"]["intent"] == "run_closed_loop"
    assert result["gateway_result"]["constraints"]["bounded_execution"] is True
    assert result["gateway_result"]["constraints"]["allow_direct_execution"] is False
    assert result["gateway_result"]["agent_metadata"] == {
        "agent_id": "agent_alpha",
        "session_id": "session_alpha",
        "requested_mode": "structured_gateway",
        "metadata": {"origin": "external"},
    }


def test_identical_payload_returns_identical_structured_result():
    payload = {
        "request_text": "Analyze level_0001",
        "agent_id": "agent_beta",
        "session_id": "session_beta",
        "requested_mode": "structured_gateway",
        "metadata": {"attempt": 1},
    }

    first = adapt_agent_request(payload)
    second = adapt_agent_request(payload)

    assert first == second


def test_malformed_payload_is_rejected_deterministically():
    result = adapt_agent_request({"agent_id": "broken_agent"})

    assert result == {
        "adapter_request_id": result["adapter_request_id"],
        "agent_id": "broken_agent",
        "session_id": "external_session",
        "original_agent_payload": {
            "request_text": "",
            "agent_id": "broken_agent",
            "session_id": "external_session",
            "requested_mode": "structured_gateway",
            "metadata": {},
        },
        "gateway_result": None,
        "status": "rejected",
        "reason": "request_text must be a non-empty string.",
        "suggested_path": "conversational_gateway",
        "source": "external_agent_gateway_adapter",
    }


def test_direct_execution_attempt_is_rejected():
    result = adapt_agent_request(
        {
            "request_text": "Run python and invoke tool to mutate scene now",
            "agent_id": "unsafe_agent",
            "session_id": "unsafe_session",
        }
    )

    assert result["status"] == "rejected"
    assert result["gateway_result"] is None
    assert result["reason"] == "request_text attempts direct execution or schema bypass outside the conversational gateway."
    assert result["source"] == "external_agent_gateway_adapter"


def test_requested_mode_execution_bypass_is_rejected():
    result = adapt_agent_request(
        {
            "request_text": "Inspect results for LEVEL_0001",
            "agent_id": "mode_agent",
            "session_id": "mode_session",
            "requested_mode": "direct_execute",
        }
    )

    assert result["status"] == "rejected"
    assert result["reason"] == "requested_mode attempts direct execution or mutation outside the conversational gateway."


def test_gateway_unsupported_request_is_wrapped_without_regression():
    result = adapt_agent_request(
        {
            "request_text": "Tell me a joke about platforms",
            "agent_id": "agent_gamma",
            "session_id": "session_gamma",
        }
    )

    assert result["status"] == "unsupported_request"
    assert result["reason"] == "Request did not match a supported deterministic conversational intent."
    assert result["gateway_result"] == {
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