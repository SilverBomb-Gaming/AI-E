from __future__ import annotations

from hashlib import sha256
import json
import re

from orchestrator.env_guard import enforce_python

enforce_python()

from .conversational_gateway import process_conversational_request


_EXECUTION_BYPASS_PATTERN = re.compile(
    r"\b(run python|execute now|invoke tool|call tool|use terminal|run terminal|direct execution|mutate scene|edit scene|apply scene action|enqueue directly|bypass gateway|call closed validation loop|call analyzer|invoke bridge)\b",
    re.IGNORECASE,
)
_MUTATION_MODE_PATTERN = re.compile(r"\b(execute|mutation|mutate|direct|tool|terminal)\b", re.IGNORECASE)


def adapt_agent_request(agent_payload: dict) -> dict:
    validation = validate_agent_request(agent_payload)
    if not validation["valid"]:
        return {
            "adapter_request_id": validation["adapter_request_id"],
            "agent_id": validation["agent_id"],
            "session_id": validation["session_id"],
            "original_agent_payload": validation["normalized_payload"],
            "gateway_result": None,
            "status": "rejected",
            "reason": validation["reason"],
            "suggested_path": "conversational_gateway",
            "source": "external_agent_gateway_adapter",
        }

    normalized_payload = validation["normalized_payload"]
    gateway_result = route_agent_text_request(
        normalized_payload["request_text"],
        agent_metadata={
            "agent_id": normalized_payload["agent_id"],
            "session_id": normalized_payload["session_id"],
            "requested_mode": normalized_payload["requested_mode"],
            "metadata": dict(normalized_payload.get("metadata") or {}),
        },
    )
    gateway_status = str(gateway_result.get("status") or "")

    return {
        "adapter_request_id": validation["adapter_request_id"],
        "agent_id": normalized_payload["agent_id"],
        "session_id": normalized_payload["session_id"],
        "original_agent_payload": normalized_payload,
        "gateway_result": gateway_result,
        "status": "unsupported_request" if gateway_status == "unsupported_request" else "accepted",
        "reason": gateway_result.get("reason") if gateway_status == "unsupported_request" else None,
        "source": "external_agent_gateway_adapter",
    }


def route_agent_text_request(request_text: str, agent_metadata: dict | None = None) -> dict:
    normalized_metadata = _normalize_agent_metadata(agent_metadata)
    gateway_result = process_conversational_request(request_text)
    if gateway_result.get("status") == "unsupported_request":
        return gateway_result

    routed_result = dict(gateway_result)
    routed_result["agent_metadata"] = normalized_metadata
    return routed_result


def validate_agent_request(agent_payload: dict) -> dict:
    normalized_payload = _normalize_agent_payload(agent_payload)
    adapter_request_id = _build_adapter_request_id(normalized_payload)
    request_text = str(normalized_payload.get("request_text") or "").strip()
    requested_mode = str(normalized_payload.get("requested_mode") or "").strip()
    normalized_mode = requested_mode.replace("_", " ").replace("-", " ")

    if not isinstance(agent_payload, dict):
        return {
            "valid": False,
            "reason": "agent_payload must be a dictionary.",
            "adapter_request_id": adapter_request_id,
            "agent_id": normalized_payload["agent_id"],
            "session_id": normalized_payload["session_id"],
            "normalized_payload": normalized_payload,
        }

    if not request_text:
        return {
            "valid": False,
            "reason": "request_text must be a non-empty string.",
            "adapter_request_id": adapter_request_id,
            "agent_id": normalized_payload["agent_id"],
            "session_id": normalized_payload["session_id"],
            "normalized_payload": normalized_payload,
        }

    if requested_mode and _MUTATION_MODE_PATTERN.search(normalized_mode):
        return {
            "valid": False,
            "reason": "requested_mode attempts direct execution or mutation outside the conversational gateway.",
            "adapter_request_id": adapter_request_id,
            "agent_id": normalized_payload["agent_id"],
            "session_id": normalized_payload["session_id"],
            "normalized_payload": normalized_payload,
        }

    if _EXECUTION_BYPASS_PATTERN.search(request_text):
        return {
            "valid": False,
            "reason": "request_text attempts direct execution or schema bypass outside the conversational gateway.",
            "adapter_request_id": adapter_request_id,
            "agent_id": normalized_payload["agent_id"],
            "session_id": normalized_payload["session_id"],
            "normalized_payload": normalized_payload,
        }

    return {
        "valid": True,
        "reason": None,
        "adapter_request_id": adapter_request_id,
        "agent_id": normalized_payload["agent_id"],
        "session_id": normalized_payload["session_id"],
        "normalized_payload": normalized_payload,
    }


def _normalize_agent_payload(agent_payload: object) -> dict:
    payload = dict(agent_payload) if isinstance(agent_payload, dict) else {}
    metadata = payload.get("metadata")
    return {
        "request_text": str(payload.get("request_text") or "").strip(),
        "agent_id": str(payload.get("agent_id") or "external_agent").strip() or "external_agent",
        "session_id": str(payload.get("session_id") or "external_session").strip() or "external_session",
        "requested_mode": str(payload.get("requested_mode") or "structured_gateway").strip() or "structured_gateway",
        "metadata": dict(metadata) if isinstance(metadata, dict) else {},
    }


def _normalize_agent_metadata(agent_metadata: object) -> dict:
    metadata = dict(agent_metadata) if isinstance(agent_metadata, dict) else {}
    payload = _normalize_agent_payload(
        {
            "request_text": "metadata_only",
            "agent_id": metadata.get("agent_id"),
            "session_id": metadata.get("session_id"),
            "requested_mode": metadata.get("requested_mode"),
            "metadata": metadata.get("metadata"),
        }
    )
    return {
        "agent_id": payload["agent_id"],
        "session_id": payload["session_id"],
        "requested_mode": payload["requested_mode"],
        "metadata": payload["metadata"],
    }


def _build_adapter_request_id(normalized_payload: dict) -> str:
    digest = sha256(json.dumps(normalized_payload, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    return f"EAGA_{digest.upper()}"


__all__ = [
    "adapt_agent_request",
    "route_agent_text_request",
    "validate_agent_request",
]