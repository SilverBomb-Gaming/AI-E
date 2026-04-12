from __future__ import annotations

import json
from pathlib import Path

from .models import IntentSpec


def _load_unity_rules() -> dict:
    policy_path = Path(__file__).resolve().parents[1] / "policies" / "unity_rules.json"
    return json.loads(policy_path.read_text(encoding="utf-8"))


class RequestParser:
    """Deterministic natural-language parser for bounded engine-aware planning."""

    _PLATFORM_ALIASES = {
        "mobile": ("mobile", "android", "ios"),
        "pc": ("pc", "desktop", "windows"),
        "webgl": ("webgl", "browser", "web"),
        "console": ("console", "xbox", "playstation", "switch"),
    }
    _FEATURE_MARKERS = (
        ("third_person_controller", ("third-person controller", "third person controller")),
        ("first_person_controller", ("first-person controller", "first person controller")),
        ("inventory", ("inventory",)),
        ("camera", ("camera", "camera follow")),
        ("movement", ("movement", "locomotion")),
        ("combat", ("combat",)),
        ("dialogue", ("dialogue",)),
        ("crafting", ("crafting",)),
        ("save_system", ("save system", "saving")),
        ("notes", ("notes",)),
    )

    def __init__(self) -> None:
        self._unity_rules = _load_unity_rules()

    def parse(self, raw_request: str) -> IntentSpec:
        normalized = " ".join(raw_request.strip().lower().split())
        goal = raw_request.strip().rstrip(".") or None
        engine_target = self._parse_engine_target(normalized)
        platform_target = self._parse_platform_target(normalized)
        features = self._parse_features(normalized)
        scope = self._parse_scope(normalized, features)
        tone = self._parse_tone(normalized)
        constraints = self._parse_constraints(raw_request)
        missing_fields = self._parse_missing_fields(engine_target, scope, features)
        return IntentSpec(
            raw_request=raw_request,
            goal=goal,
            engine_target=engine_target,
            platform_target=platform_target,
            scope=scope,
            features=features,
            tone=tone,
            constraints=constraints,
            missing_fields=missing_fields,
        )

    def _parse_engine_target(self, normalized: str) -> str | None:
        for canonical, aliases in self._unity_rules.get("engine_aliases", {}).items():
            if any(alias in normalized for alias in aliases):
                return canonical
        for canonical, aliases in self._unity_rules.get("unsupported_engines", {}).items():
            if any(alias in normalized for alias in aliases):
                return canonical
        return None

    def _parse_platform_target(self, normalized: str) -> str | None:
        for canonical, aliases in self._PLATFORM_ALIASES.items():
            if any(alias in normalized for alias in aliases):
                return canonical
        return None

    def _parse_features(self, normalized: str) -> tuple[str, ...]:
        matches: list[str] = []
        for feature_name, markers in self._FEATURE_MARKERS:
            if any(marker in normalized for marker in markers):
                matches.append(feature_name)
        return tuple(matches)

    def _parse_scope(self, normalized: str, features: tuple[str, ...]) -> str | None:
        if any(marker in normalized for marker in ("simple", "basic", "minimal", "prototype", "scaffold")):
            return "gameplay_scaffold"
        if "controller" in normalized:
            return "gameplay_mechanic"
        if any(feature in features for feature in ("inventory", "combat", "dialogue", "crafting", "save_system")):
            return "gameplay_system"
        if any(marker in normalized for marker in ("ui", "menu", "hud")):
            return "ui_feature"
        return None

    @staticmethod
    def _parse_tone(normalized: str) -> str | None:
        if any(marker in normalized for marker in ("simple", "basic", "minimal")):
            return "minimal"
        if "prototype" in normalized:
            return "prototype"
        if any(marker in normalized for marker in ("polished", "production")):
            return "polished"
        return None

    @staticmethod
    def _parse_constraints(raw_request: str) -> tuple[str, ...]:
        lowered = " ".join(raw_request.strip().lower().split())
        constraints: list[str] = []
        if "without " in lowered:
            tail = lowered.split("without ", 1)[1]
            candidate = tail.split(" and ", 1)[0].split(",", 1)[0].strip()
            if candidate:
                constraints.append(f"without {candidate}")
        if "for mobile" in lowered:
            constraints.append("for mobile")
        if "for webgl" in lowered:
            constraints.append("for webgl")
        return tuple(dict.fromkeys(constraints))

    @staticmethod
    def _parse_missing_fields(
        engine_target: str | None,
        scope: str | None,
        features: tuple[str, ...],
    ) -> tuple[str, ...]:
        missing: list[str] = []
        if engine_target is None:
            missing.append("engine_target")
        if scope is None:
            missing.append("scope")
        if not features:
            missing.append("features")
        return tuple(missing)
