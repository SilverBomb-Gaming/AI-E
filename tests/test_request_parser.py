from __future__ import annotations

from aie.core.request_parser import RequestParser


def test_request_parser_extracts_explicit_unity_request() -> None:
    parser = RequestParser()

    intent = parser.parse("Create a basic third-person controller in Unity")

    assert intent.goal == "Create a basic third-person controller in Unity"
    assert intent.engine_target == "unity"
    assert intent.scope == "gameplay_scaffold"
    assert intent.features == ("third_person_controller",)
    assert intent.tone == "minimal"
    assert intent.missing_fields == ()


def test_request_parser_keeps_vague_prompt_bounded() -> None:
    parser = RequestParser()

    intent = parser.parse("Add inventory")

    assert intent.engine_target is None
    assert intent.scope == "gameplay_system"
    assert intent.features == ("inventory",)
    assert "engine_target" in intent.missing_fields


def test_request_parser_detects_unsupported_engine_mentions() -> None:
    parser = RequestParser()

    intent = parser.parse("Make this work in Unreal")

    assert intent.engine_target == "unreal"
    assert "scope" in intent.missing_fields


def test_request_parser_extracts_platform_constraints_and_tone() -> None:
    parser = RequestParser()

    intent = parser.parse("Build a polished Unity inventory system for mobile without multiplayer")

    assert intent.engine_target == "unity"
    assert intent.platform_target == "mobile"
    assert intent.features == ("inventory",)
    assert intent.tone == "polished"
    assert "without multiplayer" in intent.constraints
    assert "for mobile" in intent.constraints
