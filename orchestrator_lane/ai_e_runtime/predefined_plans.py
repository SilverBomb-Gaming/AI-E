from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PredefinedPlanStep:
    step_index: int
    title: str
    operator_prompt: str
    task_type: str = "mutation_request"
    priority: int = 25
    execution_mode: str = "approval_required_mutation"


@dataclass(frozen=True)
class PredefinedPlan:
    plan_key: str
    title: str
    canonical_prompt: str
    expected_outcome: str
    execution_mode_label: str
    trigger_prompts: tuple[str, ...]
    steps: tuple[PredefinedPlanStep, ...]


_PREDEFINED_PLANS = (
    PredefinedPlan(
        plan_key="zombie_fast_low_aggression_v1",
        title="Test fast low-aggression zombie variation",
        canonical_prompt="make zombie faster but less aggressive",
        expected_outcome=(
            "AI-E increases zombie speed, then restores zombie aggression to the supported "
            "standard tier so the zombie moves faster without increasing combat pressure."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("make zombie faster but less aggressive",),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Increase zombie speed",
                operator_prompt="make zombie faster",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Restore zombie aggression to standard",
                operator_prompt="restore zombie aggression to standard",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="zombie_lower_danger_slower_v1",
        title="Make zombie less dangerous and slower",
        canonical_prompt="make zombie less dangerous and slower",
        expected_outcome=(
            "AI-E restores zombie aggression to the supported standard tier, then decreases "
            "zombie speed so the zombie becomes safer and slower with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("make zombie less dangerous and slower",),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Restore zombie aggression to standard",
                operator_prompt="restore zombie aggression to standard",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Decrease zombie movement speed",
                operator_prompt="make zombie slower",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="zombie_restore_standard_danger_v1",
        title="Restore standard zombie danger",
        canonical_prompt="restore zombie danger to standard",
        expected_outcome=(
            "AI-E restores zombie speed and aggression to their supported standard tiers so "
            "the zombie returns to the baseline combat profile with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("restore zombie danger to standard",),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Restore zombie movement speed to standard",
                operator_prompt="restore zombie speed to standard",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Restore zombie aggression to standard",
                operator_prompt="restore zombie aggression to standard",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="zombie_safety_v1",
        title="Reduce zombie aggression",
        canonical_prompt="make zombie less aggressive",
        expected_outcome=(
            "Zombie movement becomes slower, then AI-E validates the calmer behavior by moving the zombie "
            "forward in the supported test scene."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "make zombie less aggressive",
            "make zombie safer",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Decrease zombie movement speed",
                operator_prompt="make zombie slower",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Move zombie forward to validate the calmer behavior",
                operator_prompt="move zombie forward",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="zombie_combat_variation_v1",
        title="Test zombie combat variation",
        canonical_prompt="make zombie faster and more aggressive",
        expected_outcome=(
            "AI-E increases zombie speed, then increases zombie aggression, so the supported "
            "test scene records a stronger combat variation with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "make zombie faster and more aggressive",
            "try a more aggressive zombie",
            "test combat variation",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Increase zombie speed",
                operator_prompt="make zombie faster",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Increase zombie aggression",
                operator_prompt="make zombie more aggressive",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="zombie_movement_variation_v1",
        title="Try zombie movement variation",
        canonical_prompt="make zombie move differently",
        expected_outcome=(
            "AI-E tests a visibly different zombie movement path by moving the zombie farther "
            "forward, then validates the standard forward movement path in the supported test scene."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "make zombie move differently",
            "try a different movement",
            "try a variation",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Move zombie farther forward for variation testing",
                operator_prompt="move zombie farther forward",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Move zombie forward to compare against the standard path",
                operator_prompt="move zombie forward",
                priority=25,
            ),
        ),
    ),
)


def match_predefined_plan(prompt: str) -> PredefinedPlan | None:
    normalized = " ".join(str(prompt or "").strip().lower().split())
    if not normalized:
        return None
    for plan in _PREDEFINED_PLANS:
        if normalized in plan.trigger_prompts:
            return plan
    return None


def unsupported_predefined_plan_message(prompt: str) -> str | None:
    normalized = " ".join(str(prompt or "").strip().lower().split())
    if not normalized:
        return None
    if (
        "zombie" not in normalized
        and (
            "dangerous" in normalized
            or "combat variation" in normalized
            or "faster and more aggressive" in normalized
            or "intense" in normalized
            or "more aggressive zombie" in normalized
        )
    ):
        return (
            "AI-E currently supports this combat variation plan only for the zombie system in BABYLON. "
            "Try something like: 'make zombie faster and more aggressive'."
        )
    if (
        (
            "less aggressive" in normalized
            or "safer" in normalized
            or "less dangerous" in normalized
            or "easier" in normalized
            or "restore zombie danger to standard" in normalized
        )
        and "zombie" not in normalized
    ):
        if "safer" in normalized:
            return (
                "AI-E currently supports this safety plan only for the zombie system in BABYLON. "
                "Try something like: 'make zombie safer'."
            )
        return (
            "AI-E currently supports this lower-danger plan only for the zombie system in BABYLON. "
            "Try something like: 'make zombie less dangerous'."
        )
    if "move differently" in normalized and "zombie" not in normalized:
        return (
            "AI-E currently supports this movement variation plan only for the zombie system in BABYLON. "
            "Try something like: 'make zombie move differently'."
        )
    return None


__all__ = [
    "PredefinedPlan",
    "PredefinedPlanStep",
    "match_predefined_plan",
    "unsupported_predefined_plan_message",
]
