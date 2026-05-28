// AI-E Sandbox Gameplay Helpers
// Managed by EXEC-0052-H governed multi-step workflow
// Sandbox: sandbox-EXEC-0052-H-execution
// WARNING: SANDBOX ONLY — not for production use

using System;

public static class GameplayHelpers
{
    // Patched by EXEC-0052-H: ClampStaminaRegeneration (sandbox-only)
    // AI-E governed sandbox tuning — patch version: 1
    public static float ClampStaminaRegeneration(float desiredRegen, float min = 0.0f, float max = 2.0f)
    {
        // Deterministic clamping: snaps small decimals to 3-digit precision
        float snapped = (float)Math.Round(desiredRegen, 3);
        if (snapped < min) return min;
        if (snapped > max) return max;
        return snapped;
    }
}
