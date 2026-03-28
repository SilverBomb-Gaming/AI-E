import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests
from ai_e_runtime.queue_preview_builder import build_queue_preview, export_queue_preview
from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle
from ai_e_runtime.request_review_decision import create_review_decision, export_review_decision
from ai_e_runtime.request_review_summary import export_review_summary


pytestmark = pytest.mark.fast


def test_build_queue_preview_for_approved_includes_all_requests(capsys):
    decision = {
        "decision_id": "review_decision_001",
        "bundle_id": "review_bundle_001",
        "decision": "approved",
    }
    bundle = {
        "bundle_id": "review_bundle_001",
        "requests": [
            {
                "request_id": "request_001",
                "intent_type": "system_fix",
                "priority": "high",
                "action_targets": ["segment_01"],
                "expected_changes": ["improve readability"],
            },
            {
                "request_id": "request_002",
                "intent_type": "system_improve",
                "priority": "medium",
                "action_targets": ["segment_02"],
                "expected_changes": ["tighten flow"],
            },
        ],
    }

    preview = build_queue_preview(decision, bundle)
    output = capsys.readouterr().out

    assert preview["preview_id"] == "queue_preview_001"
    assert preview["source_bundle_id"] == "review_bundle_001"
    assert preview["decision"] == "approved"
    assert preview["total_requests"] == 2
    assert preview["preview_status"] == "ready_for_queue"
    assert preview["preview_items"][0]["task_id"] == "task_request_001"
    assert preview["preview_items"][0]["task_type"] == "queue_task::system_fix"
    assert preview["preview_items"][0]["inputs"]["action_targets"] == ["segment_01"]
    assert preview["preview_items"][0]["status"] == "pending_execution"
    assert "Decision type: approved" in output
    assert "Preview items: 2" in output
    assert "Preview status: ready_for_queue" in output


def test_build_queue_preview_for_rejected_and_needs_changes(capsys):
    bundle = {
        "bundle_id": "review_bundle_001",
        "requests": [
            {
                "request_id": "request_001",
                "intent_type": "system_expand",
                "priority": "medium",
                "action_targets": ["segment_01"],
                "expected_changes": ["add density"],
            }
        ],
    }

    rejected_preview = build_queue_preview({"decision": "rejected", "bundle_id": "review_bundle_001"}, bundle)
    blocked_preview = build_queue_preview({"decision": "needs_changes", "bundle_id": "review_bundle_001"}, bundle)
    output = capsys.readouterr().out

    assert rejected_preview["preview_status"] == "empty"
    assert rejected_preview["preview_items"] == []
    assert rejected_preview["explanation"] == "bundle rejected; no queue items would be inserted"
    assert blocked_preview["preview_status"] == "blocked"
    assert blocked_preview["total_requests"] == 1
    assert blocked_preview["explanation"] == "blocked_pending_changes"
    assert blocked_preview["preview_items"][0]["task_type"] == "queue_task::system_expand"
    assert "Decision type: rejected" in output
    assert "Decision type: needs_changes" in output


def test_full_pipeline_exports_queue_preview(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    bundle_json_path = artifact_dir / "review_bundle_001.json"
    bundle_md_path = artifact_dir / "review_bundle_001.md"
    decision_json_path = artifact_dir / "review_decision_001.json"
    preview_json_path = artifact_dir / "queue_preview_001.json"
    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    requests = package_intents_to_requests(intents)
    bundle = build_review_bundle(requests)
    export_review_bundle(bundle, bundle_json_path)
    export_review_summary(bundle, bundle_md_path)
    decision_obj = create_review_decision(bundle_json_path, "needs_changes", notes="Wait for revisions.", summary_path=bundle_md_path)
    export_review_decision(decision_obj, decision_json_path)
    preview = build_queue_preview(decision_json_path, bundle_json_path)
    written_path = export_queue_preview(preview, preview_json_path)
    output = capsys.readouterr().out

    payload = json.loads(preview_json_path.read_text(encoding="utf-8"))
    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert written_path == preview_json_path
    assert payload["source_bundle_id"] == "review_bundle_001"
    assert payload["decision"] == "needs_changes"
    assert payload["preview_status"] == "blocked"
    assert payload["total_requests"] == 3
    assert len(payload["preview_items"]) == 3
    assert payload["preview_items"][0]["status"] == "pending_execution"
    assert f"Output path: {preview_json_path}" in output


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