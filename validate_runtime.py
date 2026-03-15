"""Minimal runtime validation harness for AI-E v5."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Tuple

from app.paths import ensure_artifacts_root
from app.perception import UnityWindowPerception
from app.runner import RunSession


REQUIRED_ARTIFACTS = ("run_meta.json", "run_summary.json", "mapprobe_snapshot.json")


def _check_artifacts(run_dir: Path) -> list[str]:
    missing = []
    for name in REQUIRED_ARTIFACTS:
        if not (run_dir / name).exists():
            missing.append(name)
    return missing


def _assert_action_layer_locked(session: RunSession) -> None:
    descriptor = session.action_layer_descriptor()
    if descriptor.get("enabled") or descriptor.get("armed"):
        raise RuntimeError("Action layer must remain locked by default during validation.")


def _load_run_summary(run_dir: Path) -> dict[str, object]:
    return json.loads((run_dir / "run_summary.json").read_text(encoding="utf-8"))


def _execute_run(session: RunSession, *, run_number: int) -> Tuple[Path, dict[str, object]]:
    run_dir = session.start_run(
        map_id="001",
        babylon_exe_path="BABYLON.exe",
        record_input=False,
        record_mic=False,
        push_to_talk=False,
    )
    time.sleep(0.2)
    finished_dir = session.stop_run()
    missing = _check_artifacts(finished_dir)
    if missing:
        raise RuntimeError(f"Run {run_number} missing artifacts: {', '.join(missing)}")
    summary = _load_run_summary(finished_dir)
    movement = summary.get("perception", {}).get("movement", [])  # type: ignore[assignment]
    if not movement:
        raise RuntimeError(f"Run {run_number} missing movement delta metadata.")
    return finished_dir, summary


def main() -> int:
    ensure_artifacts_root()
    session = RunSession()

    adapter = UnityWindowPerception()
    adapter.bind_target("BABYLON.exe")
    _ = adapter.describe()  # sanity check

    try:
        _assert_action_layer_locked(session)
        run_a, summary_a = _execute_run(session, run_number=1)
        _assert_action_layer_locked(session)
        run_b, summary_b = _execute_run(session, run_number=2)
        _assert_action_layer_locked(session)
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] Runtime validation failed: {exc}")
        return 1

    if run_a == run_b:
        print("[FAIL] Sequential runs re-used the same artifact directory.")
        return 1

    print("[OK] AI-E runtime validation completed successfully.")
    print(f"Run 1 artifacts: {run_a}")
    print(f"Run 2 artifacts: {run_b}")
    print(f"Movement samples: run1={len(summary_a['perception']['movement'])}, run2={len(summary_b['perception']['movement'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
