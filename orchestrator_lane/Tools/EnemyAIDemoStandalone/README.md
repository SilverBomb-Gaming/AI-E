# Enemy AI Demo Standalone

This is a clean Unity demo project for Demo #1.

## What is included

- Keyboard-controlled player movement
- NavMesh-driven enemy patrol and chase behavior
- Editor menu item to generate the playable demo scene
- Command-line validation harness for patrol, detect, chase, and return-to-patrol flow

## Open in Unity

1. Open this folder as a Unity project:
   - `orchestrator_lane/Tools/EnemyAIDemoStandalone`
2. Unity version used for automation:
   - `6000.2.8f1`
3. Open the demo scene if it already exists:
   - `Assets/Scenes/EnemyAIDemo.unity`
4. If the scene does not exist yet, run:
   - `Tools > Enemy AI Demo > Build Playable Demo Scene`

## Demo controls

- `WASD` or arrow keys to move

## Expected demo flow

- Enemy patrols between four points
- Player enters detection range
- Enemy chases player
- Player leaves range
- Enemy resumes patrol

## Unity menu commands

- `Tools > Enemy AI Demo > Build Playable Demo Scene`
- `Tools > Enemy AI Demo > Build And Open Demo Scene`

## Automated validation

The project includes an editor batch entry point that builds the scene, enters Play Mode, and logs success or failure.
