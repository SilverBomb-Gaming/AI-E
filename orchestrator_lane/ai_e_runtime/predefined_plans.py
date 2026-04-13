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


def _platformer_structure_steps(
    *,
    gap_size_prompt: str,
    gap_size_title: str,
    obstacle_density_prompt: str,
    obstacle_density_title: str,
    enemy_density_prompt: str,
    enemy_density_title: str,
    segment_count_prompt: str,
    segment_count_title: str,
) -> tuple[PredefinedPlanStep, ...]:
    return (
        PredefinedPlanStep(
            step_index=1,
            title=gap_size_title,
            operator_prompt=gap_size_prompt,
            priority=20,
        ),
        PredefinedPlanStep(
            step_index=2,
            title=obstacle_density_title,
            operator_prompt=obstacle_density_prompt,
            priority=22,
        ),
        PredefinedPlanStep(
            step_index=3,
            title=enemy_density_title,
            operator_prompt=enemy_density_prompt,
            priority=24,
        ),
        PredefinedPlanStep(
            step_index=4,
            title=segment_count_title,
            operator_prompt=segment_count_prompt,
            priority=26,
        ),
    )


def _platformer_level_set_steps(
    *,
    jump_height_prompt: str,
    jump_height_title: str,
    gravity_prompt: str,
    gravity_title: str,
    speed_prompt: str,
    speed_title: str,
    gap_size_prompt: str,
    gap_size_title: str,
    obstacle_density_prompt: str,
    obstacle_density_title: str,
    enemy_density_prompt: str,
    enemy_density_title: str,
    segment_count_prompt: str,
    segment_count_title: str,
) -> tuple[PredefinedPlanStep, ...]:
    return (
        PredefinedPlanStep(
            step_index=1,
            title=jump_height_title,
            operator_prompt=jump_height_prompt,
            priority=18,
        ),
        PredefinedPlanStep(
            step_index=2,
            title=gravity_title,
            operator_prompt=gravity_prompt,
            priority=20,
        ),
        PredefinedPlanStep(
            step_index=3,
            title=speed_title,
            operator_prompt=speed_prompt,
            priority=22,
        ),
        PredefinedPlanStep(
            step_index=4,
            title=gap_size_title,
            operator_prompt=gap_size_prompt,
            priority=24,
        ),
        PredefinedPlanStep(
            step_index=5,
            title=obstacle_density_title,
            operator_prompt=obstacle_density_prompt,
            priority=26,
        ),
        PredefinedPlanStep(
            step_index=6,
            title=enemy_density_title,
            operator_prompt=enemy_density_prompt,
            priority=28,
        ),
        PredefinedPlanStep(
            step_index=7,
            title=segment_count_title,
            operator_prompt=segment_count_prompt,
            priority=30,
        ),
    )


_PREDEFINED_PLANS = (
    PredefinedPlan(
        plan_key="platformer_level_set_a_v1",
        title="Use level set a",
        canonical_prompt="use level set a",
        expected_outcome=(
            "AI-E applies deterministic level set a by combining the easy traversal profile with high jump height, low gravity, "
            "and standard movement speed so Super Monkee gets a forgiving bounded variant with explicit proof for each movement and layout step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("use level set a",),
        steps=_platformer_level_set_steps(
            jump_height_prompt="make jump higher",
            jump_height_title="Set jump height to high",
            gravity_prompt="reduce gravity",
            gravity_title="Set gravity to low",
            speed_prompt="restore movement to standard",
            speed_title="Restore movement speed to standard",
            gap_size_prompt="make gaps smaller",
            gap_size_title="Set gap size to small",
            obstacle_density_prompt="reduce obstacle density",
            obstacle_density_title="Set obstacle density to sparse",
            enemy_density_prompt="reduce enemy density",
            enemy_density_title="Set enemy density to low",
            segment_count_prompt="restore segment count to standard",
            segment_count_title="Restore segment count to standard",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_level_set_b_v1",
        title="Use level set b",
        canonical_prompt="use level set b",
        expected_outcome=(
            "AI-E applies deterministic level set b by combining the long sparse run profile with standard jump height, standard gravity, "
            "and fast movement speed so Super Monkee gets a longer bounded run variant with lighter pressure and explicit proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("use level set b",),
        steps=_platformer_level_set_steps(
            jump_height_prompt="restore jump to standard",
            jump_height_title="Restore jump height to standard",
            gravity_prompt="restore gravity to standard",
            gravity_title="Restore gravity to standard",
            speed_prompt="make movement faster",
            speed_title="Set movement speed to fast",
            gap_size_prompt="restore gap size to standard",
            gap_size_title="Restore gap size to standard",
            obstacle_density_prompt="reduce obstacle density",
            obstacle_density_title="Set obstacle density to sparse",
            enemy_density_prompt="reduce enemy density",
            enemy_density_title="Set enemy density to low",
            segment_count_prompt="make level longer",
            segment_count_title="Set segment count to long",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_level_set_c_v1",
        title="Use level set c",
        canonical_prompt="use level set c",
        expected_outcome=(
            "AI-E applies deterministic level set c by combining the challenge traversal profile with low jump height, high gravity, "
            "and fast movement speed so Super Monkee gets a harder bounded variant with explicit proof for each movement and layout step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("use level set c",),
        steps=_platformer_level_set_steps(
            jump_height_prompt="make jump lower",
            jump_height_title="Set jump height to low",
            gravity_prompt="increase gravity",
            gravity_title="Set gravity to high",
            speed_prompt="make movement faster",
            speed_title="Set movement speed to fast",
            gap_size_prompt="make gaps larger",
            gap_size_title="Set gap size to large",
            obstacle_density_prompt="increase obstacle density",
            obstacle_density_title="Set obstacle density to dense",
            enemy_density_prompt="increase enemy density",
            enemy_density_title="Set enemy density to high",
            segment_count_prompt="make level longer",
            segment_count_title="Set segment count to long",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_restore_level_set_standard_v1",
        title="Restore platformer level set to standard",
        canonical_prompt="restore level set to standard",
        expected_outcome=(
            "AI-E restores the deterministic standard level set by combining the balanced traversal profile with standard jump height, "
            "standard gravity, standard movement speed, and standard layout tiers with proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("restore level set to standard",),
        steps=_platformer_level_set_steps(
            jump_height_prompt="restore jump to standard",
            jump_height_title="Restore jump height to standard",
            gravity_prompt="restore gravity to standard",
            gravity_title="Restore gravity to standard",
            speed_prompt="restore movement to standard",
            speed_title="Restore movement speed to standard",
            gap_size_prompt="restore gap size to standard",
            gap_size_title="Restore gap size to standard",
            obstacle_density_prompt="restore obstacle density to standard",
            obstacle_density_title="Restore obstacle density to standard",
            enemy_density_prompt="restore enemy density to standard",
            enemy_density_title="Restore enemy density to standard",
            segment_count_prompt="restore segment count to standard",
            segment_count_title="Restore segment count to standard",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_easy_traversal_v1",
        title="Use easy traversal",
        canonical_prompt="use easy traversal",
        expected_outcome=(
            "AI-E applies the bounded easy traversal profile by setting small gaps, sparse obstacles, low enemy density, "
            "and a standard segment count so Super Monkee gets a more forgiving deterministic run style with proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "use easy traversal",
            "make the level easier",
            "make level easier",
        ),
        steps=_platformer_structure_steps(
            gap_size_prompt="make gaps smaller",
            gap_size_title="Set gap size to small",
            obstacle_density_prompt="reduce obstacle density",
            obstacle_density_title="Set obstacle density to sparse",
            enemy_density_prompt="reduce enemy density",
            enemy_density_title="Set enemy density to low",
            segment_count_prompt="restore segment count to standard",
            segment_count_title="Restore segment count to standard",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_balanced_traversal_v1",
        title="Use balanced traversal",
        canonical_prompt="use balanced traversal",
        expected_outcome=(
            "AI-E applies the bounded balanced traversal profile by restoring gap size, obstacle density, enemy density, "
            "and segment count to their standard deterministic tiers with proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("use balanced traversal",),
        steps=_platformer_structure_steps(
            gap_size_prompt="restore gap size to standard",
            gap_size_title="Restore gap size to standard",
            obstacle_density_prompt="restore obstacle density to standard",
            obstacle_density_title="Restore obstacle density to standard",
            enemy_density_prompt="restore enemy density to standard",
            enemy_density_title="Restore enemy density to standard",
            segment_count_prompt="restore segment count to standard",
            segment_count_title="Restore segment count to standard",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_challenge_traversal_v1",
        title="Use challenge traversal",
        canonical_prompt="use challenge traversal",
        expected_outcome=(
            "AI-E applies the bounded challenge traversal profile by setting large gaps, dense obstacles, high enemy density, "
            "and a long segment count so Super Monkee gets a harder deterministic run style with proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=(
            "use challenge traversal",
            "make the level more challenging",
            "make level more challenging",
        ),
        steps=_platformer_structure_steps(
            gap_size_prompt="make gaps larger",
            gap_size_title="Set gap size to large",
            obstacle_density_prompt="increase obstacle density",
            obstacle_density_title="Set obstacle density to dense",
            enemy_density_prompt="increase enemy density",
            enemy_density_title="Set enemy density to high",
            segment_count_prompt="make level longer",
            segment_count_title="Set segment count to long",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_long_sparse_run_v1",
        title="Use long sparse run",
        canonical_prompt="use long sparse run",
        expected_outcome=(
            "AI-E applies the bounded long sparse run profile by keeping standard gaps, reducing obstacle and enemy density, "
            "and extending segment count so Super Monkee gets a longer deterministic traversal with lighter pressure and proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("use long sparse run",),
        steps=_platformer_structure_steps(
            gap_size_prompt="restore gap size to standard",
            gap_size_title="Restore gap size to standard",
            obstacle_density_prompt="reduce obstacle density",
            obstacle_density_title="Set obstacle density to sparse",
            enemy_density_prompt="reduce enemy density",
            enemy_density_title="Set enemy density to low",
            segment_count_prompt="make level longer",
            segment_count_title="Set segment count to long",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_short_dense_run_v1",
        title="Use short dense run",
        canonical_prompt="use short dense run",
        expected_outcome=(
            "AI-E applies the bounded short dense run profile by keeping standard gaps, increasing obstacle and enemy density, "
            "and shortening segment count so Super Monkee gets a shorter deterministic traversal with concentrated pressure and proof for each step."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("use short dense run",),
        steps=_platformer_structure_steps(
            gap_size_prompt="restore gap size to standard",
            gap_size_title="Restore gap size to standard",
            obstacle_density_prompt="increase obstacle density",
            obstacle_density_title="Set obstacle density to dense",
            enemy_density_prompt="increase enemy density",
            enemy_density_title="Set enemy density to high",
            segment_count_prompt="make level shorter",
            segment_count_title="Set segment count to short",
        ),
    ),
    PredefinedPlan(
        plan_key="platformer_restore_layout_standard_v1",
        title="Restore platformer level structure to standard",
        canonical_prompt="restore level to standard",
        expected_outcome=(
            "AI-E restores platformer gap size, obstacle density, enemy density, and segment count to their "
            "supported standard tiers so the level returns to the baseline bounded structure profile with proof for all steps."
        ),
        execution_mode_label="Sandbox first",
        trigger_prompts=("restore level to standard",),
        steps=_platformer_structure_steps(
            gap_size_prompt="restore gap size to standard",
            gap_size_title="Restore gap size to standard",
            obstacle_density_prompt="restore obstacle density to standard",
            obstacle_density_title="Restore obstacle density to standard",
            enemy_density_prompt="restore enemy density to standard",
            enemy_density_title="Restore enemy density to standard",
            segment_count_prompt="restore segment count to standard",
            segment_count_title="Restore segment count to standard",
        ),
    ),
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
        plan_key="environment_theme_gravel_damaged_v1",
        title="Apply gravel then damaged ground theme",
        canonical_prompt="apply gravel then damaged ground theme",
        expected_outcome=(
            "AI-E applies the reviewed gravel ground theme on Ground first, then applies the reviewed damaged-ground theme "
            "through the same deterministic ground-theme mutation lane. This is bounded reviewed sequential composition only; "
            "it does not authorize freeform material blending, broader terrain realism, or extra scene styling."
        ),
        execution_mode_label="Needs approval",
        trigger_prompts=(
            "apply gravel then damaged ground theme",
            "make the ground gravel and damaged",
            "apply a damaged gravel ground theme",
            "apply damaged gravel ground theme",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Apply gravel ground theme",
                operator_prompt="apply gravel ground theme",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Apply damaged-ground theme",
                operator_prompt="apply damaged-ground theme",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="environment_theme_dirt_damaged_v1",
        title="Apply dirt then damaged ground theme",
        canonical_prompt="apply dirt then damaged ground theme",
        expected_outcome=(
            "AI-E applies the reviewed dirt ground theme on Ground first, then applies the reviewed damaged-ground theme "
            "through the same deterministic ground-theme mutation lane. This is bounded reviewed sequential composition only; "
            "it does not authorize freeform material blending, broader terrain realism, or extra scene styling."
        ),
        execution_mode_label="Needs approval",
        trigger_prompts=(
            "apply dirt then damaged ground theme",
            "apply a dirt and damaged ground theme",
            "apply dirt and damaged ground theme",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Apply dirt ground theme",
                operator_prompt="apply dirt ground theme",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Apply damaged-ground theme",
                operator_prompt="apply damaged-ground theme",
                priority=25,
            ),
        ),
    ),
    PredefinedPlan(
        plan_key="environment_theme_grass_damaged_v1",
        title="Apply grass then damaged ground theme",
        canonical_prompt="apply grass then damaged ground theme",
        expected_outcome=(
            "AI-E applies the reviewed grass ground theme on Ground first, then applies the reviewed damaged-ground theme "
            "through the same deterministic ground-theme mutation lane. This is bounded reviewed sequential composition only; "
            "it does not authorize freeform material blending, broader terrain realism, or extra scene styling."
        ),
        execution_mode_label="Needs approval",
        trigger_prompts=(
            "apply grass then damaged ground theme",
            "make the ground grassy and damaged",
        ),
        steps=(
            PredefinedPlanStep(
                step_index=1,
                title="Apply grass ground theme",
                operator_prompt="apply grass ground theme",
                priority=20,
            ),
            PredefinedPlanStep(
                step_index=2,
                title="Apply damaged-ground theme",
                operator_prompt="apply damaged-ground theme",
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
