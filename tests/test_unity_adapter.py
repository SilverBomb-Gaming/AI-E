from __future__ import annotations

import json

from aie.adapters.unity_adapter import UnityAdapter
from aie.core.constraint_resolver import ConstraintResolver
from aie.core.plan_builder import PlanBuilder
from aie.core.request_parser import RequestParser
from aie.core.task_chain_builder import TaskChainBuilder


def _build_router_outputs(prompt: str):
    parser = RequestParser()
    resolver = ConstraintResolver()
    builder = PlanBuilder()
    chain_builder = TaskChainBuilder()
    adapter = UnityAdapter()
    intent = parser.parse(prompt)
    report = resolver.resolve(intent)
    plan = builder.build(intent, report)
    task_chain = chain_builder.build(intent, report, plan)
    return intent, report, plan, task_chain, adapter


def test_unity_adapter_emits_machine_readable_json() -> None:
    intent, report, plan, task_chain, adapter = _build_router_outputs("Create a basic third-person controller in Unity")

    payload = adapter.to_payload(intent, report, plan, task_chain)
    raw_json = adapter.to_json(intent, report, plan, task_chain)
    parsed = json.loads(raw_json)

    assert payload["adapter"] == "unity"
    assert payload["supported"] is True
    assert payload["plan"]["status"] == "supported_ready"
    assert payload["task_chain"]["status"] == "execution_ready"
    assert payload["confirmation_requirements"]
    assert parsed["intent"]["engine_target"] == "unity"


def test_unity_adapter_renders_codex_ready_handoff_text() -> None:
    intent, report, plan, task_chain, adapter = _build_router_outputs("Create a basic third-person controller in Unity")

    handoff = adapter.to_codex_handoff(intent, report, plan, task_chain)

    assert "Goal: Create a basic third-person controller in Unity" in handoff
    assert "Task chain status: execution_ready" in handoff
    assert "Execution-ready task chain:" in handoff
    assert "Confirmation requirements:" in handoff
    assert "prepare_commit: Prepare commit summary" in handoff


def test_unity_adapter_handles_unsupported_target_cleanly() -> None:
    intent, report, plan, task_chain, adapter = _build_router_outputs("Make this work in Unreal")

    payload = adapter.to_payload(intent, report, plan, task_chain)
    handoff = adapter.to_codex_handoff(intent, report, plan, task_chain)

    assert payload["supported"] is False
    assert payload["plan"]["status"] == "unsupported_target"
    assert payload["task_chain"]["status"] == "blocked"
    assert "Unsupported engine target: unreal" in handoff
    assert "Unity is the only implemented adapter" in handoff


def test_unity_adapter_preserves_warning_and_review_output() -> None:
    intent, report, plan, task_chain, adapter = _build_router_outputs("Build a polished Unity inventory system for mobile")

    payload = adapter.to_payload(intent, report, plan, task_chain)
    handoff = adapter.to_codex_handoff(intent, report, plan, task_chain)

    assert payload["plan"]["status"] == "supported_with_warnings"
    assert payload["task_chain"]["status"] == "draft_supervised"
    assert payload["requires_playtest"] is True
    assert payload["requires_human_review"] is True
    assert any("mobile" in warning.lower() for warning in payload["plan"]["warnings"])
    assert "request_playtest: Request supervised playtest" in handoff
    assert "Open assumptions:" in handoff

