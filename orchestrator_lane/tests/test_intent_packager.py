import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests


pytestmark = pytest.mark.fast


def test_package_intents_to_requests_wraps_intents_cleanly(capsys):
    intents = [
        {
            "intent_id": "intent_repair_contract",
            "intent_type": "system_fix",
            "source_contract_id": "repair_contract",
            "priority": "high",
            "action_targets": ["segment_01", "segment_02"],
            "expected_changes": ["improve readability"],
        },
        {
            "intent_id": "intent_optimization_contract",
            "intent_type": "system_improve",
            "source_contract_id": "optimization_contract",
            "priority": "medium",
            "action_targets": ["segment_03"],
            "expected_changes": ["reduce downtime"],
        },
        {
            "intent_id": "intent_expansion_contract",
            "intent_type": "system_expand",
            "source_contract_id": "expansion_contract",
            "priority": "low",
            "action_targets": ["segment_04"],
            "expected_changes": ["increase density"],
        },
    ]

    requests = package_intents_to_requests(intents)
    output = capsys.readouterr().out

    assert [request["request_type"] for request in requests] == [
        "execution_request::system_fix",
        "execution_request::system_improve",
        "execution_request::system_expand",
    ]
    assert requests[0]["request_id"] == "request_intent_repair_contract"
    assert requests[0]["source_intent_id"] == "intent_repair_contract"
    assert requests[0]["status"] == "prepared"
    assert requests[0]["execution_mode"] == "manual_review"
    assert requests[0]["created_from"] == "gameplay_clip_pipeline"
    assert "Received 3 intent(s)." in output
    assert "Created 3 execution request(s)." in output
    assert (
        "Request types summary: execution_request::system_expand=1, execution_request::system_fix=1, execution_request::system_improve=1"
        in output
    )


def test_package_intents_to_requests_skips_invalid_entries_safely(capsys):
    intents = [
        "bad_entry",
        {"intent_type": "system_fix", "priority": "high", "action_targets": ["segment_01"], "expected_changes": []},
        {"intent_id": "intent_missing_type", "priority": "medium", "action_targets": ["segment_02"], "expected_changes": []},
        {"intent_id": "intent_valid", "intent_type": "system_fix", "priority": "medium", "action_targets": "not_a_list", "expected_changes": ["stabilize"]},
    ]

    requests = package_intents_to_requests(intents)
    output = capsys.readouterr().out

    assert len(requests) == 1
    assert requests[0]["source_intent_id"] == "intent_valid"
    assert requests[0]["action_targets"] == []
    assert "Skipping invalid intent #1" in output
    assert "Skipping invalid intent #2: missing intent_id." in output
    assert "Skipping intent intent_missing_type: missing intent_type." in output


def test_loader_adapter_packager_pipeline_produces_prepared_requests(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    requests = package_intents_to_requests(intents)
    output = capsys.readouterr().out

    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert [request["intent_type"] for request in requests] == ["system_fix", "system_improve", "system_expand"]
    assert all(request["status"] == "prepared" for request in requests)
    assert all(request["execution_mode"] == "manual_review" for request in requests)
    assert "Produced 3 normalized contracts." in output
    assert "Created 3 intent(s)." in output
    assert "Created 3 execution request(s)." in output


def _write_artifact(path, clip_id: str, contract_type: str, priority: str) -> None:
    payload = {
        "clip_id": clip_id,
        "segments": [
            {
                "segment_id": "segment_01",
                "timestamp_start": "00:00:01",
                "timestamp_end": "00:00:05",
                "description": "generic gameplay segment",
            }
        ],
        "movement_metrics": {"movement_style": "steady"},
        "camera_metrics": {"horizontal_movement": "stable"},
        "combat_metrics": {"pressure_level": "low"},
        "environment_metrics": {"visibility": "good"},
        "pacing_metrics": {"pacing": "steady"},
        "contracts": [
            {
                "contract_id": f"{clip_id}_contract",
                "contract_type": contract_type,
                "priority": priority,
                "inputs": {"segments": ["segment_01"], "observations": ["generic observation"]},
                "expected_changes": ["generic expected change"],
            }
        ],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")