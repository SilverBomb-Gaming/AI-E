import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests
from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle
from ai_e_runtime.request_review_summary import export_review_summary, generate_review_summary


pytestmark = pytest.mark.fast


def test_generate_review_summary_from_bundle_object(capsys):
    bundle = {
        "bundle_id": "review_bundle_001",
        "created_from": "gameplay_clip_pipeline",
        "total_requests": 2,
        "request_type_summary": {
            "execution_request::system_fix": 1,
            "execution_request::system_improve": 1,
        },
        "requests": [
            {
                "request_id": "request_intent_repair_contract",
                "intent_type": "system_fix",
                "priority": "high",
                "action_targets": ["segment_01", "segment_02"],
                "expected_changes": ["improve readability"],
            },
            {
                "request_id": "request_intent_optimization_contract",
                "intent_type": "system_improve",
                "priority": "medium",
                "action_targets": ["segment_03"],
                "expected_changes": ["reduce downtime"],
            },
        ],
        "review_status": "pending_owner_review",
    }

    markdown = generate_review_summary(bundle)
    output = capsys.readouterr().out

    assert "# AI-E Review Summary" in markdown
    assert "## Bundle Info" in markdown
    assert "- bundle_id: review_bundle_001" in markdown
    assert "## Request Summary" in markdown
    assert "- execution_request::system_fix: 1" in markdown
    assert "### request_intent_repair_contract" in markdown
    assert "  - segment_01" in markdown
    assert "## Notes" in markdown
    assert "No execution has occurred and no queue mutation has been performed." in markdown
    assert "Bundle loaded: review_bundle_001" in output


def test_export_review_summary_can_load_bundle_json_path(tmp_path, capsys):
    bundle_path = tmp_path / "runs" / "sample_clip_analysis" / "review_bundle_001.json"
    output_path = tmp_path / "runs" / "sample_clip_analysis" / "review_bundle_001.md"
    bundle_path.parent.mkdir(parents=True)
    bundle_path.write_text(
        json.dumps(
            {
                "bundle_id": "review_bundle_001",
                "created_from": "gameplay_clip_pipeline",
                "total_requests": 1,
                "request_type_summary": {"execution_request::system_fix": 1},
                "requests": [
                    {
                        "request_id": "request_intent_repair_contract",
                        "intent_type": "system_fix",
                        "priority": "high",
                        "action_targets": ["segment_01"],
                        "expected_changes": ["improve readability"],
                    }
                ],
                "review_status": "pending_owner_review",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    written_path = export_review_summary(bundle_path, output_path)
    output = capsys.readouterr().out
    markdown = output_path.read_text(encoding="utf-8")

    assert written_path == output_path
    assert "### request_intent_repair_contract" in markdown
    assert "Bundle loaded:" in output
    assert "Markdown file created." in output
    assert f"Output path: {output_path}" in output


def test_full_pipeline_exports_markdown_summary(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    bundle_json_path = artifact_dir / "review_bundle_001.json"
    bundle_md_path = artifact_dir / "review_bundle_001.md"
    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    requests = package_intents_to_requests(intents)
    bundle = build_review_bundle(requests)
    export_review_bundle(bundle, bundle_json_path)
    export_review_summary(bundle_json_path, bundle_md_path)
    output = capsys.readouterr().out

    markdown = bundle_md_path.read_text(encoding="utf-8")
    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert "# AI-E Review Summary" in markdown
    assert "- total_requests: 3" in markdown
    assert "### request_intent_clip_001_contract" in markdown
    assert "### request_intent_clip_002_contract" in markdown
    assert "### request_intent_clip_003_contract" in markdown
    assert "No execution has occurred and no queue mutation has been performed." in markdown
    assert "Exported 3 request(s)." in output
    assert "Markdown file created." in output


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