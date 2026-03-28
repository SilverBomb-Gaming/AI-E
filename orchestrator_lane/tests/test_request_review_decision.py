import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests
from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle
from ai_e_runtime.request_review_decision import create_review_decision, export_review_decision
from ai_e_runtime.request_review_summary import export_review_summary


pytestmark = pytest.mark.fast


def test_create_review_decision_from_bundle_object(capsys):
    bundle = {
        "bundle_id": "review_bundle_001",
        "requests": [
            {"request_id": "request_001"},
            {"request_id": "request_002"},
        ],
    }

    decision_obj = create_review_decision(bundle, "approved", notes="Looks good.")
    output = capsys.readouterr().out

    assert decision_obj["decision_id"] == "review_decision_001"
    assert decision_obj["bundle_id"] == "review_bundle_001"
    assert decision_obj["decision"] == "approved"
    assert decision_obj["decided_by"] == "owner"
    assert decision_obj["notes"] == "Looks good."
    assert decision_obj["total_requests"] == 2
    assert decision_obj["approved_requests"] == ["request_001", "request_002"]
    assert decision_obj["timestamp"]
    assert "Bundle loaded: review_bundle_001" in output
    assert "Decision recorded: approved" in output


def test_create_review_decision_can_load_bundle_path_and_fallback_invalid_decision(tmp_path, capsys):
    bundle_path = tmp_path / "runs" / "sample_clip_analysis" / "review_bundle_001.json"
    bundle_path.parent.mkdir(parents=True)
    bundle_path.write_text(
        json.dumps(
            {
                "bundle_id": "review_bundle_001",
                "requests": [
                    {"request_id": "request_001"},
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    decision_obj = create_review_decision(bundle_path, "unknown_choice", summary_path=bundle_path.with_suffix(".md"))
    output = capsys.readouterr().out

    assert decision_obj["decision"] == "needs_changes"
    assert decision_obj["approved_requests"] == []
    assert "Bundle loaded:" in output
    assert "Unknown decision 'unknown_choice'. Falling back to 'needs_changes'." in output
    assert "Summary path provided:" in output


def test_full_pipeline_exports_review_decision(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    bundle_json_path = artifact_dir / "review_bundle_001.json"
    bundle_md_path = artifact_dir / "review_bundle_001.md"
    decision_json_path = artifact_dir / "review_decision_001.json"
    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    requests = package_intents_to_requests(intents)
    bundle = build_review_bundle(requests)
    export_review_bundle(bundle, bundle_json_path)
    export_review_summary(bundle, bundle_md_path)
    decision_obj = create_review_decision(bundle_json_path, "needs_changes", notes="Hold for owner follow-up.", summary_path=bundle_md_path)
    written_path = export_review_decision(decision_obj, decision_json_path)
    output = capsys.readouterr().out

    payload = json.loads(decision_json_path.read_text(encoding="utf-8"))
    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert written_path == decision_json_path
    assert payload["bundle_id"] == "review_bundle_001"
    assert payload["decision"] == "needs_changes"
    assert payload["decided_by"] == "owner"
    assert payload["total_requests"] == 3
    assert payload["approved_requests"] == []
    assert payload["notes"] == "Hold for owner follow-up."
    assert "Decision recorded: needs_changes" in output
    assert f"Output path: {decision_json_path}" in output


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