# Checklist
1. Read the ingest manifest for the asset batch and confirm the requested prefab output path.
2. Verify raw environment variables for source + animation paths; sanitize them via `NormalizeProjectAssetPath`.
3. Run workload 0024 and watch the diagnostics for GUID, absolute file, and folder-candidate logs.
4. Confirm `prefab_created=true` and classification != `invalid` inside `zombie_prefab_creation.json`.
5. Queue workload 0025 once prefab proof is complete, then attach preview artifacts to the task record.
