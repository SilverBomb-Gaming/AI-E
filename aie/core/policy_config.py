from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from .models import (
    ActivePolicyProfile,
    PolicyConfig,
    PolicyConfigSource,
    PolicyConfigStatus,
    PolicyConfigValidationResult,
    PolicyProfileFlags,
    PolicyProfileLimits,
    PolicyProfileName,
)


class PolicyConfigLoader:
    """Load and validate bounded policy profiles from explicit, typed sources."""

    _ALLOWED_FLAG_KEYS = {
        "allow_self_initiated_loop_advance",
        "require_operator_for_gate_approval",
        "allow_operator_reprioritization",
        "allow_select_session_validation",
        "allow_inspection_commands",
        "allow_operator_run_loop",
        "allow_operator_run_single_cycle",
    }
    _ALLOWED_LIMIT_KEYS = {"max_bounded_loop_cycles"}

    _BUILTIN_PROFILES = {
        PolicyProfileName.SAFE_DEFAULT: (
            PolicyProfileLimits(max_bounded_loop_cycles=3),
            PolicyProfileFlags(
                allow_self_initiated_loop_advance=True,
                require_operator_for_gate_approval=True,
                allow_operator_reprioritization=True,
                allow_select_session_validation=True,
                allow_inspection_commands=True,
                allow_operator_run_loop=True,
                allow_operator_run_single_cycle=True,
            ),
        ),
        PolicyProfileName.STANDARD: (
            PolicyProfileLimits(max_bounded_loop_cycles=10),
            PolicyProfileFlags(
                allow_self_initiated_loop_advance=True,
                require_operator_for_gate_approval=True,
                allow_operator_reprioritization=True,
                allow_select_session_validation=True,
                allow_inspection_commands=True,
                allow_operator_run_loop=True,
                allow_operator_run_single_cycle=True,
            ),
        ),
        PolicyProfileName.STRICT: (
            PolicyProfileLimits(max_bounded_loop_cycles=2),
            PolicyProfileFlags(
                allow_self_initiated_loop_advance=False,
                require_operator_for_gate_approval=True,
                allow_operator_reprioritization=False,
                allow_select_session_validation=True,
                allow_inspection_commands=True,
                allow_operator_run_loop=True,
                allow_operator_run_single_cycle=True,
            ),
        ),
        PolicyProfileName.OPERATOR_ONLY: (
            PolicyProfileLimits(max_bounded_loop_cycles=1),
            PolicyProfileFlags(
                allow_self_initiated_loop_advance=False,
                require_operator_for_gate_approval=True,
                allow_operator_reprioritization=True,
                allow_select_session_validation=True,
                allow_inspection_commands=True,
                allow_operator_run_loop=True,
                allow_operator_run_single_cycle=True,
            ),
        ),
    }

    def load_default_profile(self) -> ActivePolicyProfile:
        return self.load_profile(PolicyProfileName.SAFE_DEFAULT)

    def load_profile(
        self,
        profile_name: PolicyProfileName | str,
        *,
        allow_fallback: bool = False,
    ) -> ActivePolicyProfile:
        normalized_name = self._normalize_profile_name(profile_name)
        if normalized_name is None:
            errors = (f"Unsupported policy profile: {profile_name}",)
            if allow_fallback:
                return self._build_fallback_profile(errors, profile_name)
            return self._unsupported_profile(profile_name, PolicyConfigSource.BUILTIN_PROFILE, errors)
        limits, flags = self._BUILTIN_PROFILES[normalized_name]
        validation = PolicyConfigValidationResult(
            profile_name=normalized_name,
            source=PolicyConfigSource.BUILTIN_PROFILE,
            status=PolicyConfigStatus.LOADED,
            effective_limits=limits,
            effective_flags=flags,
            notes=(f"Loaded built-in policy profile {normalized_name.value}.",),
        )
        return self.build_active_profile(validation)

    def load_config(
        self,
        config: PolicyConfig,
        *,
        allow_fallback: bool = False,
    ) -> ActivePolicyProfile:
        validation = self.validate_profile(config)
        if validation.status == PolicyConfigStatus.INVALID and allow_fallback:
            return self._build_fallback_profile(validation.validation_errors, config.profile_name)
        if validation.status == PolicyConfigStatus.UNSUPPORTED and allow_fallback:
            return self._build_fallback_profile(validation.validation_errors, config.profile_name)
        return self.build_active_profile(validation)

    def load_from_mapping(
        self,
        profile_name: PolicyProfileName | str,
        overrides: dict[str, object] | None = None,
        *,
        allow_fallback: bool = False,
    ) -> ActivePolicyProfile:
        overrides = overrides or {}
        normalized_name = self._normalize_profile_name(profile_name)
        unknown_keys = tuple(
            sorted(key for key in overrides if key not in self._ALLOWED_FLAG_KEYS and key not in self._ALLOWED_LIMIT_KEYS)
        )
        if unknown_keys:
            errors = tuple(f"Unsupported policy override field: {key}" for key in unknown_keys)
            if allow_fallback:
                return self._build_fallback_profile(errors, profile_name)
            return self.build_active_profile(
                PolicyConfigValidationResult(
                    profile_name=profile_name,
                    source=PolicyConfigSource.EXPLICIT_MAPPING,
                    status=PolicyConfigStatus.INVALID,
                    validation_errors=errors,
                )
            )

        flag_overrides: dict[str, bool] = {}
        limit_override: int | None = None
        type_errors: list[str] = []
        for key, value in overrides.items():
            if key in self._ALLOWED_FLAG_KEYS:
                if not isinstance(value, bool):
                    type_errors.append(f"Policy override {key} must be a boolean.")
                else:
                    flag_overrides[key] = value
            elif key == "max_bounded_loop_cycles":
                if not isinstance(value, int) or isinstance(value, bool):
                    type_errors.append("Policy override max_bounded_loop_cycles must be an integer.")
                else:
                    limit_override = value
        if type_errors:
            if allow_fallback:
                return self._build_fallback_profile(tuple(type_errors), profile_name)
            return self.build_active_profile(
                PolicyConfigValidationResult(
                    profile_name=profile_name,
                    source=PolicyConfigSource.EXPLICIT_MAPPING,
                    status=PolicyConfigStatus.INVALID,
                    validation_errors=tuple(type_errors),
                )
            )

        if normalized_name is None:
            requested_flags = PolicyProfileFlags(**flag_overrides) if flag_overrides else None
            requested_limits = PolicyProfileLimits(max_bounded_loop_cycles=limit_override) if limit_override is not None else None
        else:
            base_limits, base_flags = self._BUILTIN_PROFILES[normalized_name]
            requested_flags = replace(base_flags, **flag_overrides) if flag_overrides else None
            requested_limits = (
                replace(base_limits, max_bounded_loop_cycles=limit_override)
                if limit_override is not None
                else None
            )
        return self.load_config(
            PolicyConfig(
                profile_name=profile_name,
                source=PolicyConfigSource.EXPLICIT_MAPPING,
                requested_limits=requested_limits,
                requested_flags=requested_flags,
                notes=("Loaded policy configuration from explicit mapping.",),
            ),
            allow_fallback=allow_fallback,
        )

    def validate_profile(self, config: PolicyConfig) -> PolicyConfigValidationResult:
        normalized_name = self._normalize_profile_name(config.profile_name)
        if normalized_name is None:
            return PolicyConfigValidationResult(
                profile_name=config.profile_name,
                source=config.source,
                status=PolicyConfigStatus.UNSUPPORTED,
                validation_errors=(f"Unsupported policy profile: {config.profile_name}",),
            )

        base_limits, base_flags = self._BUILTIN_PROFILES[normalized_name]
        effective_limits = base_limits
        effective_flags = base_flags
        errors: list[str] = []

        if config.requested_limits is not None:
            requested_max = config.requested_limits.max_bounded_loop_cycles
            if requested_max < 1:
                errors.append("Policy max_bounded_loop_cycles must be at least 1.")
            elif requested_max > base_limits.max_bounded_loop_cycles:
                errors.append(
                    "Policy max_bounded_loop_cycles cannot exceed the selected built-in profile cap "
                    f"({base_limits.max_bounded_loop_cycles})."
                )
            else:
                effective_limits = replace(base_limits, max_bounded_loop_cycles=requested_max)

        if config.requested_flags is not None:
            requested_flags = config.requested_flags
            if not requested_flags.require_operator_for_gate_approval:
                errors.append("Policy v1 does not support gate approval without an explicit operator command.")
            if requested_flags.allow_self_initiated_loop_advance and not base_flags.allow_self_initiated_loop_advance:
                errors.append(
                    f"Policy profile {normalized_name.value} does not permit enabling self-initiated loop advance."
                )
            if requested_flags.allow_operator_reprioritization and not base_flags.allow_operator_reprioritization:
                errors.append(
                    f"Policy profile {normalized_name.value} does not permit enabling operator reprioritization."
                )
            if requested_flags.allow_operator_run_loop and not base_flags.allow_operator_run_loop:
                errors.append(
                    f"Policy profile {normalized_name.value} does not permit enabling operator bounded loop execution."
                )
            if requested_flags.allow_operator_run_single_cycle and not base_flags.allow_operator_run_single_cycle:
                errors.append(
                    f"Policy profile {normalized_name.value} does not permit enabling operator single-cycle execution."
                )
            if requested_flags.allow_select_session_validation and not base_flags.allow_select_session_validation:
                errors.append(
                    f"Policy profile {normalized_name.value} does not permit enabling session selection validation."
                )
            if requested_flags.allow_inspection_commands and not base_flags.allow_inspection_commands:
                errors.append(
                    f"Policy profile {normalized_name.value} does not permit enabling inspection commands."
                )
            if requested_flags.allow_operator_run_loop and not requested_flags.allow_operator_run_single_cycle:
                errors.append("Policy cannot allow operator bounded loop execution while blocking operator single-cycle execution.")
            if not errors:
                effective_flags = PolicyProfileFlags(
                    allow_self_initiated_loop_advance=requested_flags.allow_self_initiated_loop_advance,
                    require_operator_for_gate_approval=True,
                    allow_operator_reprioritization=requested_flags.allow_operator_reprioritization,
                    allow_select_session_validation=requested_flags.allow_select_session_validation,
                    allow_inspection_commands=requested_flags.allow_inspection_commands,
                    allow_operator_run_loop=requested_flags.allow_operator_run_loop,
                    allow_operator_run_single_cycle=requested_flags.allow_operator_run_single_cycle,
                )

        if errors:
            return PolicyConfigValidationResult(
                profile_name=normalized_name,
                source=config.source,
                status=PolicyConfigStatus.INVALID,
                validation_errors=tuple(errors),
                effective_limits=effective_limits,
                effective_flags=effective_flags,
                notes=config.notes,
            )

        return PolicyConfigValidationResult(
            profile_name=normalized_name,
            source=config.source,
            status=PolicyConfigStatus.LOADED,
            effective_limits=effective_limits,
            effective_flags=effective_flags,
            notes=config.notes,
        )

    def build_active_profile(self, validation: PolicyConfigValidationResult) -> ActivePolicyProfile:
        if validation.status == PolicyConfigStatus.UNSUPPORTED:
            return ActivePolicyProfile(
                profile_name=PolicyProfileName.SAFE_DEFAULT,
                source=validation.source,
                status=validation.status,
                effective_limits=validation.effective_limits or self._BUILTIN_PROFILES[PolicyProfileName.SAFE_DEFAULT][0],
                effective_flags=validation.effective_flags or self._BUILTIN_PROFILES[PolicyProfileName.SAFE_DEFAULT][1],
                validation_errors=validation.validation_errors,
                loaded_at=self._timestamp(),
                notes=validation.notes,
            )
        profile_name = validation.profile_name if isinstance(validation.profile_name, PolicyProfileName) else PolicyProfileName.SAFE_DEFAULT
        return ActivePolicyProfile(
            profile_name=profile_name,
            source=validation.source,
            status=validation.status,
            effective_limits=validation.effective_limits or self._BUILTIN_PROFILES[profile_name][0],
            effective_flags=validation.effective_flags or self._BUILTIN_PROFILES[profile_name][1],
            validation_errors=validation.validation_errors,
            loaded_at=self._timestamp(),
            notes=validation.notes,
        )

    def _unsupported_profile(
        self,
        profile_name: PolicyProfileName | str,
        source: PolicyConfigSource,
        errors: tuple[str, ...],
    ) -> ActivePolicyProfile:
        return ActivePolicyProfile(
            profile_name=PolicyProfileName.SAFE_DEFAULT,
            source=source,
            status=PolicyConfigStatus.UNSUPPORTED,
            effective_limits=self._BUILTIN_PROFILES[PolicyProfileName.SAFE_DEFAULT][0],
            effective_flags=self._BUILTIN_PROFILES[PolicyProfileName.SAFE_DEFAULT][1],
            validation_errors=errors,
            loaded_at=self._timestamp(),
            notes=(f"Unsupported requested profile: {profile_name}",),
        )

    def _build_fallback_profile(
        self,
        errors: tuple[str, ...],
        requested_profile_name: PolicyProfileName | str,
    ) -> ActivePolicyProfile:
        safe_limits, safe_flags = self._BUILTIN_PROFILES[PolicyProfileName.SAFE_DEFAULT]
        return ActivePolicyProfile(
            profile_name=PolicyProfileName.SAFE_DEFAULT,
            source=PolicyConfigSource.FALLBACK_DEFAULT,
            status=PolicyConfigStatus.FALLBACK_DEFAULT,
            effective_limits=safe_limits,
            effective_flags=safe_flags,
            validation_errors=errors,
            loaded_at=self._timestamp(),
            notes=(f"Fell back to safe_default after invalid policy request for {requested_profile_name}.",),
        )

    @staticmethod
    def _normalize_profile_name(profile_name: PolicyProfileName | str) -> PolicyProfileName | None:
        if isinstance(profile_name, PolicyProfileName):
            return profile_name
        try:
            return PolicyProfileName(profile_name)
        except ValueError:
            return None

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()