# AI-E Control Panel v0.1

Operator-first companion application for BABYLON diagnostics and run orchestration. This project intentionally lives outside the Unity repository to keep responsibilities separated.

## Prerequisites

- Windows 10+
- Python 3.11+
- PowerShell 5.1+

## Setup

```powershell
cd "E:\AI projects 2025\AI-E"
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Running from Source

```powershell
.\.venv\Scripts\activate
python -m app.main
```

The UI appears as **AI-E Control Panel v0.2**. Use the Target panel to browse to the latest BABYLON build, then use Run Controls to pick a map and toggle **Record Input**, **Record Mic**, and optional **Push-to-Talk (Space)** before starting a run.

## Run Artifacts

Every run creates a timestamped folder under `runner_artifacts/` containing:

```
runner_artifacts/
  YYYYMMDD_HHMMSS_run_0001/
    run_meta.json
    events.log                # run_started, babylon_launched, attach_ok/failed, run_stopped, errors
    run_summary.json          # duration, attach status, artifact counts, warnings
    mapprobe_snapshot.json    # connection snapshot + heartbeat timestamps
    screenshot_start.png
    screenshot_end.png
    input_events.jsonl        # only when Record Input is enabled
    mic.wav + mic_meta.json   # only when Record Mic is enabled
```

- `run_meta.json` captures the operator selections and metadata.
- `events.log` is structured so you can see when the run started, when BABYLON was launched, whether attach succeeded, and any recorded errors.
- `run_summary.json` aggregates duration, attach status, artifact counts, and warnings for quick sharing.
- `mapprobe_snapshot.json` now reports the attach probe results, connection status, and heartbeat timestamps.
- Input and mic artifacts are omitted entirely if their toggles remain off, keeping the folders clean.

Screenshots rely on Windows desktop capture permissions. Mic recording is mic-only (no system audio) and can optionally be gated by holding the space bar when Push-to-Talk is enabled.

## Building the Windows Executable

```powershell
cd "E:\AI projects 2025\AI-E"
.\.venv\Scripts\activate
./build_scripts/build_windows.ps1
```

The script installs pinned dependencies, runs PyInstaller with the updated settings, and produces `dist/AI-E.exe`. Double-clicking the executable shows the same UI with no console window, and assets (icons, future resources) are bundled automatically.

First-launch UX: if the BABYLON path is empty, the UI prompts you to browse. Once selected, the exe path persists via `app_state.json` so subsequent launches auto-fill it. The typical workflow is **Launch BABYLON** → **Attach** → **Start Run** → interact/gameplay → **Stop Run** → **Open Last Run Folder** to inspect the collected screenshots, logs, and summaries.

## Usage Expectations

- Operator must pick the BABYLON executable path manually.
- **Launch BABYLON** starts the executable via subprocess.
- **Attach** checks whether the BABYLON process is currently running (using `psutil`).
- **Record Input** writes `input_events.jsonl` with keyboard/mouse telemetry.
- **Record Mic** captures mic-only audio to `mic.wav` (with optional push-to-talk gating) plus `mic_meta.json`.
- **Open Last Run Folder** opens the most recent artifacts directory in Windows Explorer.
- No gameplay logic or Unity assets live in this repository; integration happens through operator-selected paths and generated artifacts only.
