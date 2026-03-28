import json

import pytest

from ai_e_runtime.artifact_loader import DEFAULT_PRIORITY, load_and_prepare_contracts


pytestmark = pytest.mark.fast


def test_load_and_prepare_contracts_normalizes_multiple_artifacts(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    _write_artifact(
        artifact_dir / "clip_001.json",
        clip_id="clip_001",
        contract_type="repair",
        priority="high",
    )
    _write_artifact(
        artifact_dir / "clip_002.json",
        clip_id="clip_002",
        contract_type="optimization",
        priority=None,
    )
    _write_artifact(
        artifact_dir / "clip_003.json",
        clip_id="clip_003",
        contract_type="expansion",
        priority="medium",
    )

    contracts = load_and_prepare_contracts(artifact_dir)
    output = capsys.readouterr().out

    assert [contract["contract_type"] for contract in contracts] == ["repair", "optimization", "expansion"]
    assert contracts[0]["priority"] == "high"
    assert contracts[1]["priority"] == DEFAULT_PRIORITY
    assert contracts[2]["expected_changes"] == ["add one more traversal beat"]
    assert "Loading artifact clip_001.json" in output
    assert "Validation passed for clip_003.json" in output
    assert "Produced 3 normalized contracts." in output


def test_load_and_prepare_contracts_skips_invalid_artifacts_safely(tmp_path, capsys):
    artifact_dir = tmp_path / "runs" / "sample_clip_analysis"
    artifact_dir.mkdir(parents=True)
    _write_artifact(
        artifact_dir / "clip_valid.json",
        clip_id="clip_valid",
        contract_type="repair",
        priority="medium",
    )
    (artifact_dir / "clip_invalid.json").write_text(
        json.dumps(
            {
                "clip_id": "clip_invalid",
                "segments": [{"segment_id": "segment_01", "timestamp_start": "00:00:01", "timestamp_end": "00:00:02", "description": "broken contract enum"}],
                "movement_metrics": {},
                "camera_metrics": {},
                "combat_metrics": {},
                "environment_metrics": {},
                "pacing_metrics": {},
                "contracts": [
                    {
                        "contract_id": "invalid_contract",
                        "contract_type": "unknown_mode",
                        "inputs": {},
                        "expected_changes": []
                    }
                ]
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    contracts = load_and_prepare_contracts(artifact_dir)
    output = capsys.readouterr().out

    assert len(contracts) == 1
    assert contracts[0]["contract_id"] == "clip_valid_contract"
    assert "Validation failed for clip_invalid.json" in output
    assert "Produced 1 normalized contracts." in output


def _write_artifact(path, *, clip_id: str, contract_type: str, priority: str | None) -> None:
    contract = {
        "contract_id": f"{clip_id}_contract",
        "contract_type": contract_type,
        "inputs": {
            "segments": ["segment_01"],
            "observations": ["encounter is readable but can improve"],
        },
        "expected_changes": ["add one more traversal beat"],
    }
    if priority is not None:
        contract["priority"] = priority
    payload = {
        "clip_id": clip_id,
        "segments": [
            {
                "segment_id": "segment_01",
                "timestamp_start": "00:00:01",
                "timestamp_end": "00:00:05",
                "description": "generic fps encounter segment",
            }
        ],
        "movement_metrics": {"movement_style": "steady"},
        "camera_metrics": {"horizontal_movement": "stable"},
        "combat_metrics": {"pressure_level": "low"},
        "environment_metrics": {"visibility": "good"},
        "pacing_metrics": {"pacing": "steady"},
        "contracts": [contract],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")