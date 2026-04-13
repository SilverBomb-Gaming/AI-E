# Platformer Manual Correction Capture

## Purpose

AI-E now supports a bounded manual correction capture path for platformer layouts. This path is for designer-authored keyboard/mouse adjustments only. It records explicit edits, saves corrected layout snapshots as project-local artifacts, and exposes those corrections through the existing experiment, evaluation, and proof surfaces.

The missing producer layer is now supplied by a minimal Unity-side edit tool in the Playmode harness. Designers mark editable objects, enter play mode, move them with bounded keyboard/mouse controls, and save an explicit correction payload that AI-E ingests through the existing Unity task/result path.

## Scope

- Supported target context: `platformer`
- Supported editable object types:
  - `platform`
  - `ladder`
  - `elevator`
  - `obstacle_cluster`
  - `enemy_spawn_anchor`
  - `collectible_anchor`
- Supported edit actions:
  - `move`
  - `nudge`
  - `reposition`

## Unity Producer

- Unity-side marker component: `PlatformerLayoutEditable`
- Unity-side runtime tool: `PlatformerLayoutManualCorrectionTool`
- Unity launcher script: `orchestrator_lane/Tools/run_unity_platformer_layout_editor.ps1`
- Supported controls:
  - left click to select
  - mouse drag to move on the layout plane
  - arrow keys to nudge
  - `PageUp` / `PageDown` for vertical adjustments
  - `G` to toggle grid snapping
  - `X` / `Y` to toggle axis lock
  - `Enter` to save
  - `Escape` to cancel
- Visual feedback:
  - selected object wireframe highlight
  - movement delta display
  - save confirmation text

## Explicit Boundaries

- Manual correction capture is project-local only.
- Manual correction capture does not write to any global AI-E knowledge store.
- Manual correction capture does not create autonomous geometry edits.
- Manual correction capture does not broaden planner autonomy.
- Manual correction capture is additive metadata layered on top of the existing deterministic experiment/evaluation architecture.

## Runtime Flow

1. A completed platformer task returns structured correction details.
2. When Unity is used, the manual edit tool writes a deterministic JSON payload containing `layout_id`, `layout_name`, `target_context`, `manual_edit_mode`, `corrections`, and `corrected_layout`.
3. The Unity control agent merges that JSON into `result.details` before the supervisor continues the normal completion flow.
4. AI-E normalizes the correction payload and rejects unsupported object types or actions.
5. AI-E writes project-local correction artifacts under:
  - `AIE_Local/platformer_corrections/records/<layout_id>/...`
  - `AIE_Local/platformer_corrections/layouts/<layout_id>/...`
  - `AIE_Local/platformer_corrections/history.json`
6. AI-E appends correction summary metadata to task result details before the normal attempt artifact is written.
7. The supervisor copies correction summary metadata into session state.
8. Experiment tracking stores correction metadata on the recorded variant.
9. Outcome evaluation adds correction summary and `derived_from_corrected_layout` markers to structured comparison output.
10. The home/proof surface renders the saved correction summary and links to the project-local artifacts.

## Stored Metadata

Each captured correction session can expose:

- `layout_id`
- `layout_name`
- `manual_edit_mode`
- `layout_correction_count`
- `layout_correction_summary`
- `editable_object_types`
- `derived_from_corrected_layout`
- `layout_correction_artifact_path`
- `layout_correction_history_path`
- `corrected_layout_artifact_path`

## Example Payload

```json
{
  "layout_id": "super_monkee_tutorial",
  "layout_name": "Super Monkee Tutorial",
  "target_context": "platformer",
  "manual_edit_mode": "keyboard_mouse",
  "corrections": [
    {
      "object_id": "platform_01",
      "object_type": "platform",
      "action": "move",
      "original_position": [0.0, 0.0, 0.0],
      "new_position": [1.0, 0.0, 0.0]
    }
  ],
  "corrected_layout": {
    "layout_id": "super_monkee_tutorial",
    "objects": [
      {
        "object_id": "platform_01",
        "object_type": "platform",
        "position": [1.0, 0.0, 0.0]
      }
    ]
  }
}
```

## Design Intent

This model keeps correction capture inspectable and reversible. AI-E records what a designer changed and where the corrected layout snapshot lives, but it does not infer new geometry changes on its own and it does not treat local corrections as global learning.