import json

import pytest

from ai_e_runtime.artifact_loader import load_and_prepare_contracts
from ai_e_runtime.contract_adapter import adapt_contracts_to_intents


pytestmark = pytest.mark.fast


def test_adapt_contracts_to_intents_maps_all_supported_types(capsys):
    contracts = [
        {
            "contract_id": "repair_contract",
            "contract_type": "repair",
            "priority": "high",
            "inputs": {"segments": ["segment_01", "segment_02"], "observations": ["fix readability"]},
            "expected_changes": ["improve readability"],
        },
        {
            "contract_id": "optimization_contract",
            "contract_type": "optimization",
            "priority": "medium",
            "inputs": {"segments": ["segment_03"], "observations": ["tighten flow"]},
            "expected_changes": ["reduce downtime"],
        },
        {
            "contract_id": "expansion_contract",
            "contract_type": "expansion",
            "priority": "low",
            "inputs": {"segments": ["segment_04"], "observations": ["add density"]},
            "expected_changes": ["increase interaction density"],
        },
    ]

    intents = adapt_contracts_to_intents(contracts)
    output = capsys.readouterr().out

    assert [intent["intent_type"] for intent in intents] == ["system_fix", "system_improve", "system_expand"]
    assert intents[0]["intent_id"] == "intent_repair_contract"
    assert intents[0]["source_contract_id"] == "repair_contract"
    assert intents[0]["action_targets"] == ["segment_01", "segment_02"]
    assert intents[2]["expected_changes"] == ["increase interaction density"]
    assert "Received 3 contract(s)." in output
    assert "Created 3 intent(s)." in output
    assert "Intent types summary: system_expand=1, system_fix=1, system_improve=1" in output


def test_adapt_contracts_to_intents_skips_invalid_entries_safely(capsys):
    contracts = [
        "bad_entry",
        {"contract_type": "repair", "inputs": {"segments": ["segment_01"]}, "expected_changes": []},
        {"contract_id": "unknown_type", "contract_type": "mystery", "inputs": {"segments": ["segment_02"]}, "expected_changes": []},
        {"contract_id": "valid_contract", "contract_type": "repair", "inputs": {"observations": ["fallback keys only"]}, "expected_changes": ["stabilize"]},
    ]

    intents = adapt_contracts_to_intents(contracts)
    output = capsys.readouterr().out

    assert len(intents) == 1
    assert intents[0]["source_contract_id"] == "valid_contract"
    assert intents[0]["action_targets"] == ["observations"]
    assert "Skipping invalid contract #1" in output
    assert "Skipping invalid contract #2: missing contract_id." in output
    assert "Skipping contract unknown_type: unknown contract_type 'mystery'." in output


def test_artifact_loader_feeds_contract_adapter(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    _write_artifact(artifact_dir / "clip_001.json", "clip_001", "repair", "high")
    _write_artifact(artifact_dir / "clip_002.json", "clip_002", "optimization", "medium")
    _write_artifact(artifact_dir / "clip_003.json", "clip_003", "expansion", "low")

    contracts = load_and_prepare_contracts(artifact_dir)
    intents = adapt_contracts_to_intents(contracts)
    output = capsys.readouterr().out

    assert len(contracts) == 3
    assert len(intents) == 3
    assert [intent["intent_type"] for intent in intents] == ["system_fix", "system_improve", "system_expand"]
    assert "Produced 3 normalized contracts." in output
    assert "Created 3 intent(s)." in output


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