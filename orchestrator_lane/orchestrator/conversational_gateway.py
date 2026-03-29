from __future__ import annotations

from hashlib import sha256
import re

from orchestrator.env_guard import enforce_python

enforce_python()

from .decomposer import decompose_prompt
from .utils import slugify


SUPPORTED_INTENTS = [
    "analyze_level",
    "improve_playability",
    "run_closed_loop",
    "generate_design_tasks",
    "inspect_results",
]


_LEVEL_ID_PATTERN = re.compile(r"\bLEVEL_\d{4}\b", re.IGNORECASE)
_ITERATION_PATTERN = re.compile(
    r"\b(?:max(?:imum)?\s*)?(\d+)\s+iterations?\b",
    re.IGNORECASE,
)
_WHITESPACE_PATTERN = re.compile(r"\s+")
_INTENT_RULES = [
    {
        "intent": "run_closed_loop",
        "domain": "playability",
        "subdomain": "closed_validation",
        "priority": 90,
        "keywords": ("closed loop", "run repair loop", "run closed-loop", "repair loop"),
    },
    {
        "intent": "improve_playability",
        "domain": "playability",
        "subdomain": "repair_planning",
        "priority": 80,
        "keywords": ("improve playability", "fix playability", "repair playability", "make playable"),
    },
    {
        "intent": "analyze_level",
        "domain": "playability",
        "subdomain": "structural_analysis",
        "priority": 60,
        "keywords": ("analyze level", "inspect level", "check level", "analyze arena", "inspect arena"),
    },
    {
        "intent": "generate_design_tasks",
        "domain": "game_design",
        "subdomain": "task_generation",
        "priority": 50,
        "keywords": ("generate design tasks", "create design tasks", "design tasks", "variations", "variation"),
    },
    {
        "intent": "inspect_results",
        "domain": "reporting",
        "subdomain": "result_inspection",
        "priority": 40,
        "keywords": ("inspect results", "show results", "check results", "inspect report", "show report"),
    },
]


def process_conversational_request(request_text: str) -> dict:
    normalized_text = _normalize_request_text(request_text)
    if not normalized_text:
        return _unsupported_response("request_text must be a non-empty string.")

    intent_match = _classify_intent(normalized_text)
    if intent_match is None:
        return _unsupported_response(
            "Request did not match a supported deterministic conversational intent.",
        )

    request_id = _build_request_id(normalized_text)
    constraints = _build_constraints(normalized_text, intent_match["intent"])
    structured_tasks = _build_structured_tasks(
        normalized_text,
        request_id=request_id,
        intent=intent_match["intent"],
        domain=intent_match["domain"],
        subdomain=intent_match["subdomain"],
        priority=intent_match["priority"],
        constraints=constraints,
    )

    if not structured_tasks:
        return _unsupported_response(
            "Request did not produce any structured tasks within the supported gateway rules.",
        )

    return {
        "request_id": request_id,
        "original_text": normalized_text,
        "intent": intent_match["intent"],
        "domain": intent_match["domain"],
        "subdomain": intent_match["subdomain"],
        "structured_tasks": structured_tasks,
        "constraints": constraints,
        "priority": intent_match["priority"],
        "source": "conversational_gateway",
    }


def _normalize_request_text(request_text: str) -> str:
    return _WHITESPACE_PATTERN.sub(" ", str(request_text or "").strip())


def _classify_intent(normalized_text: str) -> dict | None:
    lowered_text = normalized_text.lower()
    for rule in _INTENT_RULES:
        if any(keyword in lowered_text for keyword in rule["keywords"]):
            return dict(rule)
    return None


def _build_request_id(normalized_text: str) -> str:
    digest = sha256(normalized_text.encode("utf-8")).hexdigest()[:12]
    return f"CGW_{digest.upper()}"


def _build_constraints(normalized_text: str, intent: str) -> dict:
    level_match = _LEVEL_ID_PATTERN.search(normalized_text)
    iteration_match = _ITERATION_PATTERN.search(normalized_text)

    constraints = {
        "bounded_execution": True,
        "deterministic_only": True,
        "allow_direct_execution": False,
        "level_id": level_match.group(0).upper() if level_match else "LEVEL_0001",
        "max_iterations": 1 if intent != "run_closed_loop" else 3,
        "scope": "ai_e_pipeline_only",
    }
    if iteration_match is not None:
        constraints["max_iterations"] = max(1, int(iteration_match.group(1)))
    return constraints


def _build_structured_tasks(
    normalized_text: str,
    *,
    request_id: str,
    intent: str,
    domain: str,
    subdomain: str,
    priority: int,
    constraints: dict,
) -> list[dict]:
    if intent == "generate_design_tasks":
        decomposed_tasks = decompose_prompt(normalized_text)
        if decomposed_tasks:
            return [
                _build_queue_compatible_task(
                    request_id=request_id,
                    normalized_text=normalized_text,
                    intent=intent,
                    domain=domain,
                    subdomain=subdomain,
                    priority=priority,
                    constraints=constraints,
                    task=task,
                )
                for task in decomposed_tasks
            ]

    generated_task = {
        "task_id": _build_task_id(intent, normalized_text, index=1),
        "title": _build_task_title(intent, constraints["level_id"]),
        "description": _build_task_description(intent, constraints["level_id"], constraints["max_iterations"]),
        "domain": domain,
        "subdomain": subdomain,
        "intent": intent,
        "constraints": dict(constraints),
    }
    return [
        _build_queue_compatible_task(
            request_id=request_id,
            normalized_text=normalized_text,
            intent=intent,
            domain=domain,
            subdomain=subdomain,
            priority=priority,
            constraints=constraints,
            task=generated_task,
        )
    ]


def _build_queue_compatible_task(
    *,
    request_id: str,
    normalized_text: str,
    intent: str,
    domain: str,
    subdomain: str,
    priority: int,
    constraints: dict,
    task: dict,
) -> dict:
    normalized_task = dict(task)
    return {
        "task_id": str(normalized_task.get("task_id") or _build_task_id(intent, normalized_text, index=1)),
        "title": str(normalized_task.get("title") or "Conversational task"),
        "status": "pending",
        "source": "conversational_gateway",
        "description": str(normalized_task.get("description") or normalized_text),
        "created_from_prompt": normalized_text,
        "retry_count": 0,
        "request_id": request_id,
        "domain": str(normalized_task.get("domain") or domain),
        "subdomain": str(normalized_task.get("subdomain") or subdomain),
        "intent": str(normalized_task.get("intent") or intent),
        "priority": int(normalized_task.get("priority") or priority),
        "constraints": dict(normalized_task.get("constraints") or constraints),
        "evaluation": dict(normalized_task.get("evaluation") or {}),
        "gateway_metadata": {
            "source": "conversational_gateway",
            "request_slug": slugify(normalized_text),
        },
    }


def _build_task_id(intent: str, normalized_text: str, *, index: int) -> str:
    digest = sha256(normalized_text.encode("utf-8")).hexdigest()[:8]
    return f"{intent}_{index}_{digest}"


def _build_task_title(intent: str, level_id: str) -> str:
    if intent == "analyze_level":
        return f"Analyze level structure for {level_id}"
    if intent == "improve_playability":
        return f"Plan playability improvements for {level_id}"
    if intent == "run_closed_loop":
        return f"Run closed validation loop for {level_id}"
    if intent == "generate_design_tasks":
        return f"Generate design tasks for {level_id}"
    if intent == "inspect_results":
        return f"Inspect latest results for {level_id}"
    return "Conversational gateway task"


def _build_task_description(intent: str, level_id: str, max_iterations: int) -> str:
    if intent == "run_closed_loop":
        return f"run closed validation loop for {level_id} with max_iterations={max_iterations}"
    if intent == "improve_playability":
        return f"generate report-driven playability improvement tasks for {level_id}"
    if intent == "analyze_level":
        return f"analyze structural playability for {level_id}"
    if intent == "generate_design_tasks":
        return f"generate design tasks for {level_id}"
    if intent == "inspect_results":
        return f"inspect latest orchestrator results for {level_id}"
    return f"process conversational request for {level_id}"


def _unsupported_response(reason: str) -> dict:
    return {
        "status": "unsupported_request",
        "reason": reason,
        "suggested_intents": list(SUPPORTED_INTENTS),
    }


__all__ = [
    "SUPPORTED_INTENTS",
    "process_conversational_request",
]