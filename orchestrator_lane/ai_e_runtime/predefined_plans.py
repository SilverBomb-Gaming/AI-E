from __future__ import annotations

from dataclasses import dataclass

from .encounter_profiles import (
    easier_encounter_prompt,
    restore_standard_encounter_prompt,
    supported_encounter_examples_for_family,
)
from .enemy_profiles import (
    less_dangerous_prompt,
    restore_standard_danger_prompt,
    supported_entity_examples_for_family,
)


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
        plan_key="encounter_increase_intensity_v1",
        title="Increase encounter intensity",
        canonical_prompt="increase encounter intensity",
        expected_outcome=(
            "AI-E increases the supported encounter count tier, then increases spawn pressure so "
            "the encounter becomes denser and faster to respawn with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("increase encounter intensity",),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Increase encounter count",
                operator_prompt="increase encounter count",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Increase spawn pressure",
                operator_prompt="increase spawn pressure",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="encounter_decrease_intensity_v1",
        title="Reduce encounter intensity",
        canonical_prompt="decrease encounter intensity",
        expected_outcome=(
            "AI-E decreases the supported encounter count tier, then decreases spawn pressure so "
            "the encounter becomes lighter and slower to respawn with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("decrease encounter intensity",),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Decrease encounter count",
                operator_prompt="decrease encounter count",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Decrease spawn pressure",
                operator_prompt="decrease spawn pressure",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="encounter_restore_standard_v1",
        title="Restore encounter to standard",
        canonical_prompt="restore encounter to standard",
        expected_outcome=(
            "AI-E restores encounter count and spawn pressure to their supported standard tiers so "
            "the encounter returns to the baseline bounded spawn profile with proof for both steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("restore encounter to standard",),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Restore encounter count to standard",
                operator_prompt="restore encounter count to standard",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Restore spawn pressure to standard",
                operator_prompt="restore spawn pressure to standard",
                priority=25,
            ),
        ),
    ),
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
        plan_key="runner_restore_standard_danger_v1",
        title="Restore standard runner danger",
        canonical_prompt="restore runner danger to standard",
        expected_outcome=(
            "AI-E restores runner speed and aggression to their supported standard tiers so "
            "the runner returns to the baseline fast-chase combat profile with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "restore runner danger to standard",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Restore runner movement speed to standard",
                operator_prompt="restore runner speed to standard",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Restore runner aggression to standard",
                operator_prompt="restore runner aggression to standard",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="runner_combat_variation_v1",
        title="Test runner combat variation",
        canonical_prompt="make runner faster and more aggressive",
        expected_outcome=(
            "AI-E increases runner speed, then increases runner aggression, so the supported "
            "test scene records a faster chase-oriented combat variation with proof for both bounded steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "make runner faster and more aggressive",
            "try a more aggressive runner",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Increase runner speed",
                operator_prompt="make runner faster",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Increase runner aggression",
                operator_prompt="make runner more aggressive",
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
    generalized_entity = _generalized_entity_label(normalized)
    if (
        "encounter" in normalized
        and (
            "intensity" in normalized
            or "restore encounter to standard" in normalized
            or "easier" in normalized
        )
        and match_predefined_plan(normalized) is None
    ):
        if "restore" in normalized or "standard" in normalized:
            return (
                "AI-E currently supports this bounded encounter restore plan only through the deterministic encounter routes. "
                f"Try something like: {supported_encounter_examples_for_family('restore_plan')}."
            )
        if "easier" in normalized:
            return (
                "AI-E currently supports this bounded encounter easing plan only through the deterministic encounter routes. "
                f"Try something like: {supported_encounter_examples_for_family('easier_plan')}."
            )
        return (
            "AI-E currently supports this bounded encounter intensity plan only through the deterministic encounter routes. "
            f"Try something like: {supported_encounter_examples_for_family('intensity_plan')}."
        )
    if (
        "zombie" not in normalized
        and "runner" not in normalized
        and (
            "dangerous" in normalized
            or "combat variation" in normalized
            or "faster and more aggressive" in normalized
            or "intense" in normalized
            or "more aggressive zombie" in normalized
            or "more aggressive runner" in normalized
        )
    ):
        if generalized_entity:
            return (
                f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                "Name the supported target explicitly. Try something like: "
                f"{supported_entity_examples_for_family('combat_plan')}."
            )
        return (
            "AI-E currently supports this combat variation plan only for the zombie or runner systems in BABYLON. "
            f"Try something like: {supported_entity_examples_for_family('combat_plan')}."
        )
    if (
        (
            "less aggressive" in normalized
            or "safer" in normalized
            or "less dangerous" in normalized
            or "easier" in normalized
            or "restore zombie danger to standard" in normalized
            or "restore runner danger to standard" in normalized
        )
        and "zombie" not in normalized
        and "runner" not in normalized
    ):
        if generalized_entity:
            return (
                f'AI-E supports multiple bounded enemy archetypes in BABYLON and will not guess what "{generalized_entity}" means here. '
                "Name the supported target explicitly. Try something like: "
                "'make zombie easier', 'make runner easier', or 'restore runner danger to standard'."
            )
        if "safer" in normalized:
            return (
                "AI-E currently supports this safety plan only for the zombie system in BABYLON. "
                "Try something like: 'make zombie safer'."
            )
        return (
            "AI-E currently supports this lower-danger plan only for the zombie or runner systems in BABYLON. "
            f"Try something like: '{less_dangerous_prompt('zombie')}', '{less_dangerous_prompt('runner')}', "
            f"or '{restore_standard_danger_prompt('runner')}'."
        )
    if "spawn pressure" in normalized and match_predefined_plan(normalized) is None:
        if "increase" in normalized:
            return (
                "AI-E currently supports bounded spawn pressure tuning only through the encounter routes in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('pressure_high')}."
            )
        if "decrease" in normalized or "reduce" in normalized:
            return (
                "AI-E currently supports bounded spawn pressure tuning only through the encounter routes in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('pressure_low')}."
            )
        if "restore" in normalized or "standard" in normalized:
            return (
                "AI-E currently supports bounded spawn pressure restoration only through the encounter routes in BABYLON. "
                "Try something like: 'restore spawn pressure to standard'."
            )
    if "encounter count" in normalized and match_predefined_plan(normalized) is None:
        if "increase" in normalized:
            return (
                "AI-E currently supports bounded encounter count tuning only through the encounter routes in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('count_high')}."
            )
        if "decrease" in normalized:
            return (
                "AI-E currently supports bounded encounter count tuning only through the encounter routes in BABYLON. "
                f"Try something like: {supported_encounter_examples_for_family('count_low')}."
            )
        if "restore" in normalized or "standard" in normalized:
            return (
                "AI-E currently supports bounded encounter count restoration only through the encounter routes in BABYLON. "
                "Try something like: 'restore encounter count to standard'."
            )
    if "move differently" in normalized and "zombie" not in normalized:
        return (
            "AI-E currently supports this movement variation plan only for the zombie system in BABYLON. "
            "Try something like: 'make zombie move differently'."
        )
    return None


def _generalized_entity_label(normalized_prompt: str) -> str:
    for candidate in ("enemy", "character"):
        if candidate in normalized_prompt:
            return candidate
    return ""


__all__ = [
    "PredefinedPlan",
    "PredefinedPlanStep",
    "match_predefined_plan",
    "unsupported_predefined_plan_message",
]
