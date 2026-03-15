# Checklist
1. Pull latest prefab + preview artifacts from the orchestrator run associated with the spawn proof.
2. Load the designated probe scene and confirm NavMesh, enemy layers, and spawn volumes are enabled.
3. Execute the spawn probe (Unity test runner or CLI) with logging cranked to diagnostic level.
4. Validate that health, damage, and death events fired; capture JSON + screenshot evidence.
5. File findings back to AI-E Orchestrator, tagging whether the prefab, scene, or gameplay scripts require action.
