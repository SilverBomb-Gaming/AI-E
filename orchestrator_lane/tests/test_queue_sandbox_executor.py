import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests
from ai_e_runtime.queue_insertion_gate import evaluate_queue_insertion
from ai_e_runtime.queue_preview_builder import build_queue_preview, export_queue_preview
from ai_e_runtime.queue_sandbox_executor import write_to_sandbox_queue
from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle
from ai_e_runtime.request_review_decision import create_review_decision, export_review_decision
from ai_e_runtime.request_review_summary import export_review_summary


pytestmark = pytest.mark.fast


def test_write_to_sandbox_queue_blocks_without_writing(tmp_path, capsys, monkeypatch):
    sandbox_path = tmp_path / "runs" / "sample_clip_analysis" / "sandbox_queue.json"
    monkeypatch.setattr(
        "ai_e_runtime.queue_sandbox_executor.DEFAULT_SANDBOX_QUEUE_PATH",
        sandbox_path,
    )

    gate_result = {
        "gate_id": "queue_insertion_gate_001",
        "allowed": False,
        "eligible_items": [
            {"task_id": "task_request_001", "task_type": "queue_task::system_fix"},
        ],
    }

    result = write_to_sandbox_queue(gate_result)
    output = capsys.readouterr().out

    assert result["execution_stage_id"] == "sandbox_execution_stage_001"
    assert result["status"] == "blocked"
    assert result["tasks_written"] == 0
    assert result["output_path"] == str(sandbox_path)
    assert sandbox_path.exists() is False
    assert "blocked" in output
    assert "Tasks written: 0" in output
    assert f"Output path: {sandbox_path}" in output


def test_write_to_sandbox_queue_writes_allowed_items(tmp_path, capsys, monkeypatch):
    sandbox_path = tmp_path / "runs" / "sample_clip_analysis" / "sandbox_queue.json"
    monkeypatch.setattr(
        "ai_e_runtime.queue_sandbox_executor.DEFAULT_SANDBOX_QUEUE_PATH",
        sandbox_path,
    )

    gate_result = {
        "gate_id": "queue_insertion_gate_001",
        "allowed": True,
        "eligible_items": [
            {"task_id": "task_request_001", "task_type": "queue_task::system_fix", "status": "pending_execution"},
            {"task_id": "task_request_002", "task_type": "queue_task::system_improve", "status": "pending_execution"},
        ],
    }

    result = write_to_sandbox_queue(gate_result)
    output = capsys.readouterr().out

    payload = json.loads(sandbox_path.read_text(encoding="utf-8"))
    assert result["status"] == "sandbox_ready"
    assert result["tasks_written"] == 2
    assert result["output_path"] == str(sandbox_path)
    assert payload == {
        "queue_id": "sandbox_queue_001",
        "source": "sandbox_execution",
        "tasks": gate_result["eligible_items"],
        "status": "ready_for_execution",
    }
    assert "allowed" in output
    assert "Tasks written: 2" in output
    assert f"Output path: {sandbox_path}" in output


def test_full_pipeline_writes_sandbox_queue_for_approved_decision(tmp_path, capsys, monkeypatch):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    bundle_json_path = artifact_dir / "review_bundle_001.json"
    bundle_md_path = artifact_dir / "review_bundle_001.md"
    decision_json_path = artifact_dir / "review_decision_001.json"
    preview_json_path = artifact_dir / "queue_preview_001.json"
    sandbox_path = artifact_dir / "sandbox_queue.json"
    monkeypatch.setattr(
        "ai_e_runtime.queue_sandbox_executor.DEFAULT_SANDBOX_QUEUE_PATH",
        sandbox_path,
    )

    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    requests = package_intents_to_requests(intents)
    bundle = build_review_bundle(requests)
    export_review_bundle(bundle, bundle_json_path)
    export_review_summary(bundle, bundle_md_path)
    decision_obj = create_review_decision(bundle_json_path, "approved", notes="Ready for sandbox staging.", summary_path=bundle_md_path)
    export_review_decision(decision_obj, decision_json_path)
    preview = build_queue_preview(decision_json_path, bundle_json_path)
    export_queue_preview(preview, preview_json_path)
    gate_result = evaluate_queue_insertion(preview_json_path, decision_json_path)
    result = write_to_sandbox_queue(gate_result)
    output = capsys.readouterr().out

    payload = json.loads(sandbox_path.read_text(encoding="utf-8"))
    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert gate_result["allowed"] is True
    assert result["status"] == "sandbox_ready"
    assert result["tasks_written"] == 3
    assert payload["queue_id"] == "sandbox_queue_001"
    assert payload["source"] == "sandbox_execution"
    assert payload["status"] == "ready_for_execution"
    assert len(payload["tasks"]) == 3
    assert payload["tasks"][0]["status"] == "pending_execution"
    assert f"Output path: {sandbox_path}" in output


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