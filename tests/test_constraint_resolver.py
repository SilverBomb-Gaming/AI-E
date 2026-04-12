from __future__ import annotations

from aie.core.constraint_resolver import ConstraintResolver
from aie.core.request_parser import RequestParser


def test_constraint_resolver_supports_clean_unity_request() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()

    report = resolver.resolve(parser.parse("Create a basic third-person controller in Unity"))

    assert report.supported is True
    assert report.engine_target == "unity"
    assert report.status == "supported_ready"
    assert report.blocked_actions == ()
    assert report.ambiguities == ()
    assert report.missing_inputs == ()


def test_constraint_resolver_downgrades_ambiguous_request_to_bounded_draft() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()

    report = resolver.resolve(parser.parse("Add inventory"))

    assert report.supported is True
    assert report.status == "bounded_draft_only"
    assert "engine_target" in report.missing_inputs
    assert any("Engine target is missing" in item for item in report.ambiguities)
    assert any("draft" in item.lower() for item in report.warnings)


def test_constraint_resolver_returns_clean_unsupported_target() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()

    report = resolver.resolve(parser.parse("Make this work in Unreal"))

    assert report.supported is False
    assert report.engine_target == "unreal"
    assert report.status == "unsupported_target"
    assert any("Unity is the only implemented engine adapter" in item for item in report.warnings)


def test_constraint_resolver_blocks_unsafe_engine_automation() -> None:
    parser = RequestParser()
    resolver = ConstraintResolver()

    report = resolver.resolve(parser.parse("Automatically edit Unity scenes and run the full build pipeline"))

    assert report.supported is False
    assert report.status == "blocked_unsafe"
    assert any("scene mutation" in item.lower() for item in report.blocked_actions)
    assert any("build pipeline" in item.lower() for item in report.blocked_actions)
