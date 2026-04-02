# AI-E v1

Controlled execution surface for supported projects. AI-E turns a bounded request into a real, reviewable result with guardrails, live status, proof summaries, and saved history.

## AI-E v1 Product Surface Status

These sections are the current source of truth for the public-facing AI-E v1 experience. Where they conflict with older control-panel wording below, use this product-surface status first.

## Latest Validation Findings

AI-E v1 validation is now complete for the current supported deterministic path. The validated surface includes Home, Prompt Intake, Approval Review, Live Run Status, Result Summary, and Project / Session History, plus the hardening pass for copy, empty/error guidance, onboarding, proof/history polish, launch reliability, sandbox handoff, and next-step guidance. Intent normalization is now included in the deterministic movement path, so light natural-language variations map cleanly to the canonical supported action instead of failing on strict string matching alone.

## AI-E System Evolution (Latest)

AI-E now layers bounded interpretation and review tools on top of the original deterministic mutation path without introducing autonomous execution. Supported requests can move through explicit goal-intent mapping, bounded goal composition, deterministic outcome evaluation, current-session experiment tracking, and explicit experiment decision tracking while still resolving into known capabilities, known predefined plans, or safe review-only summaries.

- Goal-intent mapping:
  - explicit gameplay goals such as `make zombie more dangerous` and `make zombie easier` now resolve to supported bounded plans instead of requiring only literal plan phrasing
- Goal composition:
  - supported multi-goal requests such as `make zombie faster but less aggressive` resolve into bounded composed plans with conflict blocking for unsupported combinations like `make zombie faster and slower`
- Outcome evaluation:
  - AI-E now compares the latest supported result against the previous related result and can emit deterministic summaries such as `Current zombie is faster but less aggressive than previous version.`
- Experiment tracking:
  - AI-E now records current-session variants under deterministic ids such as `experiment_0001`, `variant_0001`, and `variant_0002`
  - review-only prompts such as `show current experiment variants` surface variant lineage without starting execution
- Decision tracking:
  - users can now mark the active variant as kept or rejected, set a preferred baseline, and review those decisions through bounded review-only prompts

Example flows:

- `make zombie faster but less aggressive`
  - resolves through bounded goal composition into a supported multi-step plan
- `show current experiment variants`
  - returns a review-only current-session variant summary
- `keep current variant`
  - records an explicit user decision on the active variant without executing any mutation

## Current V1 Validated Status

AI-E now exposes a validated v1 front door over the existing system. A user can launch with `python -m app.ui`, land in a clean first-run flow, select a supported project, prepare a bounded request, see a clear intake decision, review approval when required, run the current sandbox-first mutation path, follow status updates, open a readable result summary, and revisit saved sessions or results. Supported prompts that stay within the current deterministic scope now execute cleanly, and unsupported deterministic requests fail honestly with clear guidance instead of pretending support.

## Intent Normalization Support

- prompt normalization now removes light filler words such as `again`, `slightly`, `a bit`, `just`, and `please` before deterministic capability lookup
- soft matching now maps known movement phrasing back to the canonical deterministic command when the user intent is still clearly the same
- canonical prompt resolution feeds the existing deterministic intake, approval, runtime, and artifact flow without introducing a new execution path
- explicit unsupported-direction handling now blocks unsupported deterministic requests honestly instead of silently downgrading them

## Conversational Mapping Support

- generalized conversational terms can map to the supported deterministic target only through explicit controlled mappings
- current supported conversational mappings:
  - `enemy` -> `zombie`
  - `character` -> `zombie`
- mapped requests do not execute directly; AI-E first shows a confirmation-required step and asks the user to continue with the supported zombie target
- unsupported generalized terms such as `boss` remain blocked with a clear supported example instead of being guessed or executed blindly

## Supported Prompt Variation Examples

- `move zombie forward`
- `move zombie forward again`
- `move zombie slightly forward`
- `please move zombie forward`

All of these normalize to the canonical deterministic command `move zombie forward` and resolve to `level_0001_move_zombie_forward`.

## Explicitly Unsupported Deterministic Examples

- `move zombie backward`
- `move zombie backwards`
- `move zombie slightly backward`
- `please move zombie backward`
- `move boss forward`

These requests remain intentionally blocked because backward zombie movement is not a supported deterministic action yet, and unsupported generalized targets such as `boss` do not have a safe deterministic mapping. AI-E now says so clearly and suggests the supported example `move zombie forward`.

## What AI-E Supports Today

- supported-project selection from existing registry data plus the safe `BABYLON VER 2` fallback when present
- staged request preparation using existing intake and routing logic
- one-time approval review for requests that need approval
- live status polling from existing queue, session, and runtime state
- sandbox-first execution for the current bounded deterministic mutation path
- readable result summaries built from saved proof, run, and session artifacts
- project/session history with reopen and re-stage paths when saved data supports them
- deterministic prompt normalization for currently supported forward-movement variants
- controlled conversational mapping from `enemy` and `character` onto the supported zombie target with explicit confirmation before execution

## What Users Can Do Today

- choose a supported project like `BABYLON VER 2`
- prepare a request such as `move zombie forward`, `move zombie forward again`, or `please move zombie forward`
- use generalized terms such as `enemy` or `character`, then confirm the supported zombie target before continuing
- submit it when AI-E shows `Ready`, or open review and approve it once when needed
- use `Run in sandbox` when AI-E says `Sandbox first`
- watch progress in `Live Run Status`
- open `Result Summary` to see verdict, changes, and validations
- reopen earlier results or prepare the same request again from `Project / Session History`

## First-Run Path

1. Launch AI-E and confirm a supported project is selected.
2. Use the recommended first request: `move zombie forward`.
3. Choose `Prepare Request`.
4. Submit it when AI-E shows `Ready`, open review and use `Approve once` if approval is required, or choose `Run in sandbox` when AI-E says `Sandbox first`.
5. Follow `Live Run Status`.
6. Open `Result Summary` or `Project / Session History` to confirm the saved outcome.

## Validation Closeout Status

- Launch validated: `python -m app.ui` reliably creates the Qt application, shows the main window, and keeps the process running until the window closes.
- First-run experience validated: onboarding appears on a true clean-profile launch, stays in normal layout flow, and points the user to the first action.
- Core path validated: Home -> Intake -> Review -> Status -> Result -> History is working on the supported Babylon path.
- Result guidance validated: result opening, next-step guidance, and supporting-file access are visible and usable after completion.
- Honest failure boundary validated: unsupported deterministic requests now fail with explicit, trustworthy guidance instead of generic or misleading fallback behavior.

## What Remains Deferred to V2

- broader structured intent parsing beyond the minimal normalization layer
- additional deterministic actions such as backward zombie movement
- messaging/chat
- overnight session launcher UI
- multi-user and permissions work
- new backend architecture or orchestration redesign
- broader integrations, analytics, or comparison features

## Mission (Locked)

AI-E:

- Observes target windows (no desktop-wide capture)
- Structures artifacts immutably per run
- Reports clearly so operators can reason quickly
- Never automates without explicit approval
- Never trains on copyrighted content
- Never fights human input

AI-E **is not** a bot player, training framework, content generator, stealth automation tool, or monetization engine.

## v5 Definition of Done

| Pillar | Status | Notes |
| --- | --- | --- |
| Core Architecture | ✅ Locked | Engine-agnostic perception adapter (`UnityWindowPerception`), action interface abstraction (`DisabledActionInterface` by default), and clear separation of perception / processing / reporting / UI layers. |
| Perception Layer | 🟡 Stable | Window-bound captures, hash-based delta detection, and focus-aware input gating via `InputFocusGate`. |
| Artifact & Reporting | 🟡 Stable | Timestamped run directories, structured JSON outputs, and movement telemetry stored alongside screenshots. |
| Operator UI | 🟡 Calm | Start/Stop, runtime diagnostics, action layer status indicator, and explicit messaging that automation stays locked. |
| Stability & Guardrails | 🟡 Enforced | Zero background network calls, failure-aware recorders, and regression hooks for missing windows/devices/artifacts. |

Nothing outside these pillars is part of v5.

## Architecture Overview

```
app/
  actions.py      # Action interface abstractions (locked by default)
  artifacts.py    # Artifact builders, JSON writers, snapshot helpers
  config.py       # Operator profiles + persisted state
  dependencies.py # Optional dependency health checks
  diagnostics.py  # Focus tracker + elevation snapshot
  logger.py       # Append-only run event log
  main.py         # Entry point (python -m app.main)
  paths.py        # Project + artifact path helpers
  perception.py   # Window-bound perception adapters + movement deltas
  recorders.py    # Input + mic recorders (processing helpers)
  runner.py       # RunSession orchestrator (processing layer)
  ui.py           # PySide6 operator surface
```

- **Perception Layer** — `perception.py` exposes `UnityWindowPerception`, which captures screenshots, hashes them, and records `MovementDelta` entries to prove the window is alive without touching gameplay.
- **Processing Layer** — `RunSession` (runner.py) coordinates focus tracking, recorders, and action/perception adapters. Input capture is gated by `InputFocusGate` (recorders.py) so only foreground BABYLON activity is stored.
- **Reporting Layer** — `artifacts.py` (`build_run_summary`, `build_mapprobe_snapshot`) and `logger.py` guarantee immutable artifacts with explicit status blocks (OK, attention, no_data) instead of silent failures.
- **UI Layer** — `ui.py` (PySide6) keeps Start/Stop within reach, surfaces artifact folders, and shows the action layer lock so operators stay informed.
- **Action Layer** — `actions.py` defines `ActionInterface` but defaults to `DisabledActionInterface`. The UI’s Action Layer panel reiterates that automation stays off until an operator explicitly unlocks it.

## Setup & Run

## Python Environment Policy

- Approved interpreter: `E:\AI projects 2025\AI-E\.venv\Scripts\python.exe`
- For VS Code and Copilot work, pin this repo to `.venv\Scripts\python.exe`; do not create or select a different environment for this repo unless this README changes.
- For shell automation, prefer explicit interpreter invocation (`.\.venv\Scripts\python.exe ...`) over bare `python`.
- Run `powershell -ExecutionPolicy Bypass -File .\build_scripts\show_python_env.ps1` to print the expected interpreter path, version, and PASS/WARN status.

### Prerequisites

- Windows 10+
- Python 3.11+
- PowerShell 5.1+

### One-command environment setup

```powershell
cd "E:\AI projects 2025\AI-E"
. .\build_scripts\setup_env.ps1
```

Dot-source the script so your shell inherits the virtual environment. The script bootstraps `.venv`, upgrades `pip`, installs pinned requirements (PySide6, psutil, mss, pynput, sounddevice, pyinstaller), and activates the venv. Use `-SkipInstall` to reuse an existing environment.

### Manual setup (fallback)

```powershell
cd "E:\AI projects 2025\AI-E"
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### Run from source

```powershell
.\.venv\Scripts\activate
.\.venv\Scripts\python.exe -m app.ui
```

The window title reads **AI-E v1**. On first launch, AI-E prefers a supported project such as `BABYLON VER 2` when one is available, keeps guardrails visible on the Home screen, and lets the user prepare a bounded request before anything runs. Use the Home screen to prepare a request, follow the intake decision, track progress, and open the saved result. The Action Layer panel remains locked unless future revisions explicitly enable automation.

### Demo checklist

Use **Help > Demo Checklist...** inside the app and walk through:

1. Launch AI-E (exe or source) and confirm the Home screen, guardrails, and a supported project are visible.
2. Use the conversational demo prompt `move enemy forward`.
3. Choose `Prepare Request` and show that AI-E asks for confirmation on the supported zombie target instead of running immediately.
4. Choose `Use supported target`, then run the supported request in sandbox.
5. Open `Result Summary` and show the proof-backed outcome.
6. Use the next-step actions to show the fast iteration path: modify the request again or try a variation.

## Artifact & Reporting Layer

Every run creates a timestamped folder under `runner_artifacts/`:

```
runner_artifacts/
  YYYYMMDD_HHMMSS_run_0001/
    run_meta.json            # full operator config + diagnostics (start & stop)
    run_summary.json         # perception, action layer descriptor, warnings
    mapprobe_snapshot.json   # connection + focus heartbeat
    events.log               # append-only timeline
    screenshot_start.png
    screenshot_end.png
    input_events.jsonl       # only when Record Input is enabled
    mic.wav + mic_meta.json  # only when Record Mic is enabled
```

- `run_summary.json` now includes `perception.adapter`, `perception.movement[]`, and `action_layer` sections so every run proves observation (not automation).
- `events.log` logs attaches/detaches, screenshot successes/failures, and focus transitions; nothing fails silently.
- Movement deltas are derived from SHA-256 hashes of captured frames to confirm window activity without saving raw comparisons.
- When recorders are enabled but emit no data, artifacts include `{ "status": "no_data", "reason": "..." }` blocks so operators aren’t left guessing.

## Stability & Guardrails

- Window-bound focus gating prevents background capture.
- No network calls run in the background; only local filesystem + OS APIs are used.
- Missing dependencies (psutil, mss, pynput, sounddevice) surface in the System Warnings label.
- Failure modes (window not found, device count zero, artifact write failure) log explicit warnings and bubble into `run_summary.json`.
- Action interface stays disarmed. Requests for automation must be logged manually.

## Frozen Backlog Rule

All new ideas that stretch beyond the five pillars live in [`/FROZEN_BACKLOG.md`](FROZEN_BACKLOG.md). Log them; do not implement them in v5 without an explicit unlock. The Action Layer panel links back to this rule so future-you never wonders where an experimental toggle originated.
# AI-E Control Panel v0.1

Operator-first companion application for BABYLON diagnostics and run orchestration. This project intentionally lives outside the Unity repository to keep responsibilities separated.

## Prerequisites

- Windows 10+
- Python 3.11+
- PowerShell 5.1+

## Setup

### One-command setup

```powershell
cd "E:\AI projects 2025\AI-E"
. .\build_scripts\setup_env.ps1
```

Dot-source the script (`. path\setup_env.ps1`) so the PowerShell session remains active inside the virtual environment after it finishes. The helper script creates `.venv` if needed, upgrades `pip`, installs the pinned requirements (PySide6, psutil, pyinstaller, etc.), and finally activates the venv for you. Pass `-SkipInstall` if you just want to reopen the environment without reinstalling packages.

### Manual setup

```powershell
cd "E:\AI projects 2025\AI-E"
Set-ExecutionPolicy -Scope Process Bypass
\.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### Sanity install

Use this anytime you need to verify the environment is intact (after pulling or before opening an issue):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.ui
```

## Running from Source

```powershell
.\.venv\Scripts\activate
.\.venv\Scripts\python.exe -m app.ui
```

The UI appears as **AI-E v1**. Use the Home screen to confirm a supported project, prepare a bounded request, review approval or sandbox guidance when needed, then follow status and open the saved result.

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

- `run_meta.json` captures operator selections, timestamps, duration, PID, and environment diagnostics so every folder stands alone.
- `events.log` now always records start/stop plus launch/attach attempts and focus/elevation diagnostics; attach failures surface the exception text.
- `run_summary.json` aggregates duration, attach status, artifact health, focus time, and warnings (including why input or screenshots might be missing).
- `mapprobe_snapshot.json` includes connection + focus status with `data_status` fields (`no_data` + reason when BABYLON is unreachable).
- Input and mic artifacts are omitted entirely if their toggles remain off, keeping the folders clean.

Guaranteed outputs every run:

- `run_meta.json` is written when **Start Run** is pressed and updated on stop with diagnostics, so it never ships empty.
- `events.log` always logs start/stop, launches, attaches, screenshot outcomes, and warnings (even if no input or mic data exists).
- `run_summary.json` is emitted on **Stop Run** with explicit references to each screenshot (or the failure reason) plus the new input-focus statistics.

Input capture is now clamped to the BABYLON foreground window. When **Record Input (BABYLON focus only)** is enabled, any keyboard/mouse events detected while another window is active are suppressed, counted, and surfaced as warnings so “empty” runs are still explainable.

Screenshots rely on Windows desktop capture permissions; if a capture fails the folder now contains a `screenshot_*` reason entry plus an events.log warning. Mic recording is mic-only (no system audio) and can optionally be gated by holding the space bar when Push-to-Talk is enabled. When a recorder is enabled but produces no data, the artifacts include `{ "status": "no_data", "reason": "..." }` blocks so operators never see empty files.

## Building the Windows Executable

```powershell
cd "E:\AI projects 2025\AI-E"
.\.venv\Scripts\activate
./build_scripts/build_windows.ps1
```

The script installs pinned dependencies, runs PyInstaller with the updated settings, and produces `dist/AI-E.exe`. It also collects the required PySide6 binaries, writes a transcript to `build_artifacts\build_log.txt`, and returns a non-zero exit code if anything fails. Double-clicking the executable shows the same UI with no console window, and assets (icons, future resources) are bundled automatically.

First-launch UX: if the BABYLON path is empty, the UI prompts you to browse. Once selected, the exe path persists via the local runtime state file `app_state.local.json` so subsequent launches auto-fill it. The tracked `app_state.example.json` file is only a sanitized example and is not used for runtime writes. The Run Controls panel now keeps the operator-oriented signals front and center: Target EXE path, detected PID/state, a live duration timer, and the artifacts destination. The typical workflow is **Launch BABYLON** → **Attach** → **Start Run** → interact/gameplay → **Stop Run** → **Open Run Folder** / **Open Logs Folder** to inspect the collected screenshots, logs, and summaries.

## Local State Files

- `app_state.example.json` is the tracked, sanitized example for operator profile structure.
- `app_state.local.json` is created and maintained locally at runtime; the app reads and writes this file only.
- `project_registry/projects.example.json` is a tracked, sanitized example for optional multi-project registry data.
- `project_registry/projects.local.json` is reserved for local-only registry data and is ignored by git.

## Usage Expectations

- Operator must pick the BABYLON executable path manually.
- **Launch BABYLON** starts the executable via subprocess.
- **Attach** checks whether the BABYLON process is currently running (using `psutil`).
- **Record Input** writes `input_events.jsonl` with keyboard/mouse telemetry.
- **Record Mic** captures mic-only audio to `mic.wav` (with optional push-to-talk gating) plus `mic_meta.json`.
- **Open Last Run Folder** opens the most recent artifacts directory in Windows Explorer.
- No gameplay logic or Unity assets live in this repository; integration happens through operator-selected paths and generated artifacts only.

## Acceptance Test Checklist

Use **Help > Demo Checklist...** inside the app to run the current quick walkthrough:

1. **A.** Launch `AI-E.exe` (or run from source) and confirm the Home screen and guardrails are visible.
2. **B.** Confirm a supported project is selected, such as `BABYLON VER 2`.
3. **C.** Use `move enemy forward` and choose `Prepare Request`.
4. **D.** Choose `Use supported target`, then run the supported request in sandbox.
5. **E.** Open `Result Summary` and point out the proof-backed outcome.
6. **F.** Use `Modify and test again` or `Try a variation` to show the next quick iteration.

The dialog resets each time you open it, so the same checklist can be reused before the next demo or local-user handoff.
