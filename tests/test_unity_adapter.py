from __future__ import annotations

import json

from aie.adapters.unity_adapter import UnityAdapter
from aie.core.constraint_resolver import ConstraintResolver
from aie.core.plan_builder import PlanBuilder
from aie.core.request_parser import RequestParser


def _build_router_outputs(prompt: str):
    parser = RequestParser()
    resolver = ConstraintResolver()
    builder = PlanBuilder()
    adapter = UnityAdapter()
    intent = parser.parse(prompt)
    report = resolver.resolve(intent)
    plan = builder.build(intent, report)
    return intent, report, plan, adapter


def test_unity_adapter_emits_machine_readable_json() -> None:
    intent, report, plan, adapter = _build_router_outputs("Create a basic third-person controller in Unity")

    payload = adapter.to_payload(intent, report, plan)
    raw_json = adapter.to_json(intent, report, plan)
    parsed = json.loads(raw_json)

    assert payload["adapter"] == "unity"
    assert payload["supported"] is True
    assert payload["plan"]["status"] == "supported_ready"
    assert parsed["intent"]["engine_target"] == "unity"


def test_unity_adapter_renders_codex_ready_handoff_text() -> None:
    intent, report, plan, adapter = _build_router_outputs("Create a basic third-person controller in Unity")

    handoff = adapter.to_codex_handoff(intent, report, plan)

    assert "Goal: Create a basic third-person controller in Unity" in handoff
    assert "Tasks:" in handoff
    assert "File operations:" in handoff
    assert "Verification:" in handoff
    assert "Limitations:" in handoff


def test_unity_adapter_handles_unsupported_target_cleanly() -> None:
    intent, report, plan, adapter = _build_router_outputs("Make this work in Unreal")

    payload = adapter.to_payload(intent, report, plan)
    handoff = adapter.to_codex_handoff(intent, report, plan)

    assert payload["supported"] is False
    assert payload["plan"]["status"] == "unsupported_target"
    assert "Unsupported engine target: unreal" in handoff
    assert "Unity is the only implemented engine adapter in Constraint Router v1." in handoff


def test_unity_adapter_preserves_warning_output() -> None:
    intent, report, plan, adapter = _build_router_outputs("Build a polished Unity inventory system for mobile")

    payload = adapter.to_payload(intent, report, plan)
    handoff = adapter.to_codex_handoff(intent, report, plan)

    assert payload["plan"]["status"] == "supported_with_warnings"
    assert any("mobile" in warning.lower() for warning in payload["plan"]["warnings"])
    assert "Keep the first pass scaffold-level" in handoff
