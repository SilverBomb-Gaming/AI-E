import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests
from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle


pytestmark = pytest.mark.fast


def test_build_review_bundle_collects_requests_cleanly(capsys):
    requests = [
        {
            "request_id": "request_intent_repair_contract",
            "request_type": "execution_request::system_fix",
            "source_intent_id": "intent_repair_contract",
            "intent_type": "system_fix",
            "priority": "high",
            "action_targets": ["segment_01"],
            "expected_changes": ["improve readability"],
            "status": "prepared",
            "execution_mode": "manual_review",
            "created_from": "gameplay_clip_pipeline",
        },
        {
            "request_id": "request_intent_optimization_contract",
            "request_type": "execution_request::system_improve",
            "source_intent_id": "intent_optimization_contract",
            "intent_type": "system_improve",
            "priority": "medium",
            "action_targets": ["segment_02"],
            "expected_changes": ["reduce downtime"],
            "status": "prepared",
            "execution_mode": "manual_review",
            "created_from": "gameplay_clip_pipeline",
        },
    ]

    bundle = build_review_bundle(requests)
    output = capsys.readouterr().out

    assert bundle["bundle_id"] == "review_bundle_001"
    assert bundle["created_from"] == "gameplay_clip_pipeline"
    assert bundle["total_requests"] == 2
    assert bundle["request_type_summary"] == {
        "execution_request::system_fix": 1,
        "execution_request::system_improve": 1,
    }
    assert bundle["review_status"] == "pending_owner_review"
    assert "Received 2 request(s)." in output
    assert "Built review bundle with 2 request(s)." in output


def test_export_review_bundle_writes_json_artifact(tmp_path, capsys):
    bundle = {
        "bundle_id": "review_bundle_001",
        "created_from": "gameplay_clip_pipeline",
        "total_requests": 1,
        "request_type_summary": {"execution_request::system_fix": 1},
        "requests": [
            {
                "request_id": "request_intent_repair_contract",
                "request_type": "execution_request::system_fix",
                "source_intent_id": "intent_repair_contract",
                "intent_type": "system_fix",
                "priority": "high",
                "action_targets": ["segment_01"],
                "expected_changes": ["improve readability"],
                "status": "prepared",
                "execution_mode": "manual_review",
                "created_from": "gameplay_clip_pipeline",
            }
        ],
        "review_status": "pending_owner_review",
    }
    output_path = tmp_path / "runs" / "sample_clip_analysis" / "review_bundle_001.json"

    written_path = export_review_bundle(bundle, output_path)
    output = capsys.readouterr().out

    assert written_path == output_path
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["bundle_id"] == "review_bundle_001"
    assert payload["total_requests"] == 1
    assert "Exported 1 request(s)." in output
    assert f"Output path: {output_path}" in output


def test_full_pipeline_builds_and_exports_review_bundle(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")
    output_path = artifact_dir / "review_bundle_001.json"

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    requests = package_intents_to_requests(intents)
    bundle = build_review_bundle(requests)
    export_review_bundle(bundle, output_path)
    output = capsys.readouterr().out

    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert bundle["total_requests"] == 3
    assert bundle["review_status"] == "pending_owner_review"
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["total_requests"] == 3
    assert payload["request_type_summary"] == {
        "execution_request::system_expand": 1,
        "execution_request::system_fix": 1,
        "execution_request::system_improve": 1,
    }
    assert "Created 3 execution request(s)." in output
    assert "Built review bundle with 3 request(s)." in output
    assert "Exported 3 request(s)." in output


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