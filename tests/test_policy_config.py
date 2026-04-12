from __future__ import annotations

from aie.core.models import PolicyConfigStatus, PolicyProfileName
from aie.core.policy_config import PolicyConfigLoader


def test_policy_config_loads_builtin_standard_profile() -> None:
    loader = PolicyConfigLoader()

    profile = loader.load_profile(PolicyProfileName.STANDARD)

    assert profile.profile_name == PolicyProfileName.STANDARD
    assert profile.status == PolicyConfigStatus.LOADED
    assert profile.effective_flags.allow_self_initiated_loop_advance is True
    assert profile.effective_limits.max_bounded_loop_cycles == 10


def test_policy_config_rejects_unknown_profile_cleanly() -> None:
    loader = PolicyConfigLoader()

    profile = loader.load_profile("unbounded_everything")

    assert profile.status == PolicyConfigStatus.UNSUPPORTED
    assert profile.validation_errors == ("Unsupported policy profile: unbounded_everything",)


def test_policy_config_rejects_invalid_override_field() -> None:
    loader = PolicyConfigLoader()

    profile = loader.load_from_mapping(
        PolicyProfileName.STANDARD,
        overrides={"launch_missiles": True},
    )

    assert profile.status == PolicyConfigStatus.INVALID
    assert profile.validation_errors == ("Unsupported policy override field: launch_missiles",)


def test_policy_config_rejects_invalid_override_combination() -> None:
    loader = PolicyConfigLoader()

    profile = loader.load_from_mapping(
        PolicyProfileName.STANDARD,
        overrides={"require_operator_for_gate_approval": False},
    )

    assert profile.status == PolicyConfigStatus.INVALID
    assert profile.validation_errors == (
        "Policy v1 does not support gate approval without an explicit operator command.",
    )


def test_policy_config_surfaces_explicit_fallback_default() -> None:
    loader = PolicyConfigLoader()

    profile = loader.load_from_mapping(
        PolicyProfileName.STRICT,
        overrides={"max_bounded_loop_cycles": 99},
        allow_fallback=True,
    )

    assert profile.status == PolicyConfigStatus.FALLBACK_DEFAULT
    assert profile.profile_name == PolicyProfileName.SAFE_DEFAULT
    assert profile.validation_errors == (
        "Policy max_bounded_loop_cycles cannot exceed the selected built-in profile cap (2).",
    )