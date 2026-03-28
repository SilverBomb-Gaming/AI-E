import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
from ai_e_runtime.intent_packager import package_intents_to_requests
from ai_e_runtime.queue_insertion_gate import evaluate_queue_insertion
from ai_e_runtime.queue_preview_builder import build_queue_preview
from ai_e_runtime.queue_sandbox_executor import write_to_sandbox_queue
from ai_e_runtime.request_review_bundle import build_review_bundle
from ai_e_runtime.request_review_decision import create_review_decision
from ai_e_runtime.sandbox_execution_dispatcher import dispatch_sandbox_queue


pytestmark = pytest.mark.fast


def test_dispatch_sandbox_queue_simulates_tasks_sequentially(capsys):
    queue = {
        "queue_id": "sandbox_queue_001",
        "tasks": [
            {"task_id": "task_001", "task_type": "queue_task::system_fix"},
            {"task_id": "task_002", "task_type": "queue_task::system_improve"},
            {"task_id": "task_003", "task_type": "queue_task::system_expand"},
        ],
    }

    report = dispatch_sandbox_queue(queue)
    output = capsys.readouterr().out

    assert report["dispatch_id"] == "sandbox_dispatch_001"
    assert report["total_tasks"] == 3
    assert report["status"] == "completed"
    assert [item["action"] for item in report["executed_tasks"]] == ["repair", "optimization", "expansion"]
    assert [item["task_id"] for item in report["executed_tasks"]] == ["task_001", "task_002", "task_003"]
    assert "Tasks to execute: 3" in output
    assert "Executing task: task_001 (system_fix)" in output
    assert "Executing task: task_002 (system_improve)" in output
    assert "Executing task: task_003 (system_expand)" in output
    assert "Final status: completed" in output


def test_dispatch_sandbox_queue_reads_json_path(tmp_path, capsys):
    queue_path = tmp_path / "runs" / "sample_clip_analysis" / "sandbox_queue.json"
    queue_path.parent.mkdir(parents=True)
    queue_path.write_text(
        json.dumps(
            {
                "queue_id": "sandbox_queue_001",
                "tasks": [
                    {"task_id": "task_001", "task_type": "queue_task::system_fix"},
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    report = dispatch_sandbox_queue(queue_path)
    output = capsys.readouterr().out

    assert report["total_tasks"] == 1
    assert report["executed_tasks"][0]["action"] == "repair"
    assert report["executed_tasks"][0]["status"] == "simulated"
    assert "Queue loaded:" in output
    assert "simulate_repair" in output


def test_full_pipeline_dispatches_sandbox_queue(tmp_path, capsys, monkeypatch):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
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
    decision = create_review_decision(bundle, "approved")
    preview = build_queue_preview(decision, bundle)
    gate_result = evaluate_queue_insertion(preview, decision)
    sandbox_result = write_to_sandbox_queue(gate_result)
    report = dispatch_sandbox_queue(sandbox_path)
    output = capsys.readouterr().out

    assert sandbox_result["status"] == "sandbox_ready"
    assert len(contracts) == 3
    assert len(intents) == 3
    assert len(requests) == 3
    assert report["total_tasks"] == 3
    assert report["status"] == "completed"
    assert [item["action"] for item in report["executed_tasks"]] == ["repair", "optimization", "expansion"]
    assert "Tasks to execute: 3" in output
    assert "Final status: completed" in output


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