# Phase Game-Dev 2 Real Unity Project Integration

## SUMMARY

AI-E is now verified against the real BABYLON Unity project at `E:\ai projects 2025\BABYLON VER 2` rather than the reduced harness-only surface. The external project root is readable from the current execution environment and contains the expected Unity root structure: `Assets`, `ProjectSettings`, and `Packages`.

The critical missing asset boundary from the prior Map 005 handoff is resolved for inspection readiness. AI-E can directly inspect real numbered gameplay scenes, real prefabs, real registry/config assets, and the real build-settings surface that controls gameplay-scene loading. Future map work can now be grounded in actual project assets instead of inferred placeholders.

Map_005 is now realistically executable as a future handoff because the concrete mutation path is visible: duplicate or extend an existing numbered gameplay scene, register it in `ProjectSettings/EditorBuildSettings.asset`, let `Assets/Editor/GameplaySceneRegistryGenerator.cs` rebuild `Assets/Resources/GameplaySceneRegistry.asset`, and expose it through the existing menu/navigation path in `Assets/UI/MainMenuUI.cs` and `Assets/Systems/SceneNavigator.cs`.

## FACTS

Actual Unity root verified:

- `E:\ai projects 2025\BABYLON VER 2`
- Root contains `Assets`, `ProjectSettings`, and `Packages`
- The project is a full Unity repo with solution files, editor/runtime folders, and a live `.git` directory

Real scene surfaces verified:

- Stable numbered gameplay scenes exist at:
	- `Assets/Babylon FPS game ver 001.unity`
	- `Assets/Babylon FPS game ver 002.unity`
	- `Assets/Babylon FPS game ver 003.unity`
	- `Assets/Babylon FPS game ver 004.unity`
- Additional related scenes exist at:
	- `Assets/Babylon FPS game.unity`
	- `Assets/Scenes/MainMenu.unity`
	- `Assets/Scenes/MainMenu_DebugCubeFresh.unity`
	- `Assets/AI_E_TestScenes/MinimalPlayableArena.unity`
	- `Assets/AI_E_TestScenes/entity_test.unity`

Direct asset inspection succeeded:

- `Assets/Babylon FPS game ver 004.unity` is readable as a real Unity scene asset
- `Assets/Prefabs/Player.prefab` is readable as a real Unity prefab asset
- `Assets/Prefabs/Player.prefab` contains a `CharacterController` and `PlayerController` binding, confirming that player-facing prefab surfaces are present in the real project

Build and scene-registration surfaces verified:

- `ProjectSettings/EditorBuildSettings.asset` currently includes:
	- `Assets/Scenes/MainMenu.unity`
	- `Assets/Babylon FPS game ver 001.unity`
	- `Assets/Babylon FPS game ver 002.unity`
	- `Assets/Babylon FPS game ver 003.unity`
	- `Assets/Babylon FPS game ver 004.unity`
- `Assets/Editor/GameplaySceneRegistryGenerator.cs` rebuilds the gameplay-scene registry from enabled build-settings scenes matching `^Babylon FPS game ver (\d{3})$`
- `Assets/Resources/GameplaySceneRegistry.asset` currently contains scene names `001` through `004`
- `Assets/Systems/GameplaySceneRegistry.cs` defines the runtime registry asset used by gameplay/menu flow

Gameplay flow and map-entry surfaces verified:

- `Assets/UI/MainMenuUI.cs` loads `Resources/GameplaySceneRegistry` at runtime and prepares gameplay scene loads from the menu path
- `Assets/Systems/SceneNavigator.cs` resolves the first gameplay scene, validates that the scene exists in Build Settings, and loads it through `SceneManager.LoadScene`
- `Assets/Systems/SceneNavigator.cs` still hardcodes preferred gameplay names through `Babylon FPS game ver 004`, so a future Map_005 task may need to extend this preferred-name list or rely on registry/build fallback behavior

Spawn and gameplay-readiness surfaces verified:

- `Assets/Prefabs/Player.prefab`
- `Assets/Resources/Prefabs/Player.prefab`
- `Assets/Spawning/EnemySpawner.cs`
- `Assets/Spawning/SpawnArea.cs`
- `Assets/Converted/Scripts/Core/MapSetup.cs`
- `Assets/Map/MapBuilder.cs`

Candidate scenes for future Map_005 work:

- Primary gameplay-template candidate: `Assets/Babylon FPS game ver 004.unity`
	- rationale: latest existing numbered gameplay scene already registered in Build Settings and the gameplay scene registry
- Conservative baseline alternative: `Assets/Babylon FPS game ver 001.unity`
	- rationale: lowest-risk stable numbered scene if future work should branch from the earliest known gameplay baseline
- Non-player-facing validation template only: `Assets/AI_E_TestScenes/MinimalPlayableArena.unity`
	- rationale: useful for isolated validation/mutation probes, but not the right primary source for a player-facing Map_005 flow

AI-E integration/readiness surfaces already present in this repo:

- `app_state.local.json` already points the active project at `E:\AI projects 2025\BABYLON VER 2`
- `app/home_surface.py` already auto-discovers `BABYLON VER 2` as a supported Unity project fallback when present
- `web/headless_autonomy.ts` and `web/local_node.ts` already support explicit `--allowedRoot` boundaries
- `orchestrator_lane/ai_e_runtime/unity_action_executor.py` already requires an approved execution request plus a configured Unity `project_path`

Recommended safe working boundary for future game-dev tasks:

- Inspection boundary:
	- full project root `E:\ai projects 2025\BABYLON VER 2`
- Default mutation boundary for map work:
	- `E:\ai projects 2025\BABYLON VER 2\Assets`
	- `E:\ai projects 2025\BABYLON VER 2\ProjectSettings\EditorBuildSettings.asset`
	- `E:\ai projects 2025\BABYLON VER 2\Assets\Resources\GameplaySceneRegistry.asset`
	- targeted supporting scripts under `Assets/Systems`, `Assets/UI`, `Assets/Spawning`, `Assets/Map`, or `Assets/Converted/Scripts/Core` when the task explicitly requires them
- Excluded by default from map-mutation tasks unless the task explicitly justifies them:
	- `Library`
	- `Logs`
	- `obj`
	- `Builds`
	- `UserSettings`
	- `Packages`

Approval-safety status:

- Future write actions can remain approval-gated by using explicit `allowedRoot` values scoped to the real Unity project
- The existing repo-action model remains applicable because the path policy already constrains file writes to reviewed allowed roots

Mutation-readiness determination:

- `Map_005 is now possible` from an asset-visibility and registration standpoint
- The next real map handoff can truthfully target real scenes, real prefabs, and real build/flow assets
- This handoff did not create or mutate any Unity scene, prefab, or gameplay asset

## ASSUMPTIONS

- The external Unity project at `E:\ai projects 2025\BABYLON VER 2` is the authoritative gameplay repo for future BABYLON game-development tasks.
- The numbered `Babylon FPS game ver 001` through `004` scenes are considered the stable player-facing map lineage unless a later task identifies a more appropriate source scene.
- Rebuilding the gameplay scene registry through the existing editor generator remains the intended workflow after adding a future numbered scene.
- Player spawn placement for future Map_005 work may be partly scene-local rather than driven by a single dedicated `PlayerSpawn` script, so the actual spawn anchor wiring should be validated during the real map implementation task.

## RECOMMENDATIONS

1. Use `Assets/Babylon FPS game ver 004.unity` as the first duplication candidate for a future Map_005 handoff unless scene-specific constraints suggest starting from `001` instead.
2. Keep future map mutations bounded to the real Unity project with an explicit allowed-root policy rooted at `E:\ai projects 2025\BABYLON VER 2\Assets` plus the single build-settings asset in `ProjectSettings`.
3. Treat `ProjectSettings/EditorBuildSettings.asset`, `Assets/Resources/GameplaySceneRegistry.asset`, `Assets/Editor/GameplaySceneRegistryGenerator.cs`, `Assets/Systems/SceneNavigator.cs`, and `Assets/UI/MainMenuUI.cs` as the primary scene-registration and flow-integration seam for future map additions.
4. During the future Map_005 task, validate scene-local player start placement and movement inside the chosen numbered scene before claiming gameplay readiness, since this integration pass only verified asset presence and not live playability.
5. Do not use `Assets/AI_E_TestScenes/MinimalPlayableArena.unity` as the primary player-facing Map_005 source unless the future task is intentionally building a test scene rather than extending the numbered gameplay flow.

## TIMESTAMP

2026-04-22T23:59:00Z