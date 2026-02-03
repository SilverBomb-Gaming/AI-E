"""Path helpers for the AI-E Control Panel."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS_ROOT = PROJECT_ROOT / "runner_artifacts"
APP_STATE_PATH = PROJECT_ROOT / "app_state.json"


def ensure_artifacts_root() -> Path:
    """Make sure the runner_artifacts folder exists."""
    ARTIFACTS_ROOT.mkdir(parents=True, exist_ok=True)
    return ARTIFACTS_ROOT


def create_run_dir() -> Path:
    """Create a timestamped run directory (YYYYMMDD_HHMMSS_run_XXXX)."""
    ensure_artifacts_root()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    counter = 1
    while True:
        suffix = f"run_{counter:04d}"
        run_dir = ARTIFACTS_ROOT / f"{timestamp}_{suffix}"
        if not run_dir.exists():
            run_dir.mkdir(parents=True, exist_ok=False)
            return run_dir
        counter += 1
