import json

import pytest

from ai_e_runtime.queue_insertion_gate import evaluate_queue_insertion


pytestmark = pytest.mark.fast


def test_evaluate_queue_insertion_allows_ready_approved_preview(capsys):
    preview = {
        "preview_id": "queue_preview_001",
        "preview_status": "ready_for_queue",
        "preview_items": [
            {"task_id": "task_request_001", "task_type": "queue_task::system_fix", "status": "pending_execution"},
            {"task_id": "task_request_002", "task_type": "queue_task::system_improve", "status": "pending_execution"},
        ],
    }
    decision = {
        "decision_id": "review_decision_001",
        "decision": "approved",
    }

    result = evaluate_queue_insertion(preview, decision)
    output = capsys.readouterr().out

    assert result["gate_id"] == "queue_insertion_gate_001"
    assert result["decision"] == "approved"
    assert result["allowed"] is True
    assert result["reason"] == "decision approved and preview is ready_for_queue"
    assert len(result["eligible_items"]) == 2
    assert "Decision: approved" in output
    assert "allowed" in output
    assert "Eligible items: 2" in output


def test_evaluate_queue_insertion_blocks_rejected_and_needs_changes(capsys):
    preview = {
        "preview_id": "queue_preview_001",
        "preview_status": "blocked",
        "preview_items": [{"task_id": "task_request_001"}],
    }

    rejected = evaluate_queue_insertion(preview, {"decision": "rejected"})
    needs_changes = evaluate_queue_insertion(preview, {"decision": "needs_changes"})
    output = capsys.readouterr().out

    assert rejected["allowed"] is False
    assert rejected["reason"] == "decision rejected; queue insertion is not allowed"
    assert rejected["eligible_items"] == []
    assert needs_changes["allowed"] is False
    assert needs_changes["reason"] == "decision needs_changes; queue insertion is blocked"
    assert needs_changes["eligible_items"] == []
    assert "Decision: rejected" in output
    assert "Decision: needs_changes" in output


def test_evaluate_queue_insertion_reads_realistic_json_paths_and_blocks_when_preview_not_ready(tmp_path, capsys):
    preview_path = tmp_path / "queue_preview_001.json"
    decision_path = tmp_path / "review_decision_001.json"
    preview_path.write_text(
        json.dumps(
            {
                "preview_id": "queue_preview_001",
                "preview_status": "blocked",
                "preview_items": [
                    {"task_id": "task_request_001", "task_type": "queue_task::system_fix", "status": "pending_execution"}
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    decision_path.write_text(
        json.dumps(
            {
                "decision_id": "review_decision_001",
                "decision": "approved",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    result = evaluate_queue_insertion(preview_path, decision_path)
    output = capsys.readouterr().out

    assert result["allowed"] is False
    assert result["reason"] == "decision approved but preview status is blocked"
    assert result["eligible_items"] == []
    assert "Preview loaded:" in output
    assert "Decision loaded:" in output
    assert "blocked" in output