from __future__ import annotations

import unittest

from app.controller.intent_classifier import IntentClassifier
from app.controller.intent_router import IntentRouter
from app.controller.routing_types import NaturalChatContext


def _context(
    *,
    latest_context_id: str = "",
    latest_context_kind: str = "",
    latest_context_source: str = "",
    has_recent_run: bool = False,
    last_run_command_label: str = "",
    last_run_target_root: str = "",
    last_run_entrypoint_path: str = "",
    has_active_generated_project: bool = False,
    active_generated_project_root: str = "",
) -> NaturalChatContext:
    return NaturalChatContext(
        has_active_translation_draft=False,
        has_active_plan=False,
        has_active_step_proposal=False,
        has_active_bundle_proposal=False,
        has_running_bundle=False,
        has_active_generated_project=has_active_generated_project,
        active_generated_project_root=active_generated_project_root,
        has_recent_context=bool(latest_context_id),
        latest_context_id=latest_context_id,
        latest_context_kind=latest_context_kind,
        latest_context_source=latest_context_source,
        has_recent_run=has_recent_run,
        last_run_command_label=last_run_command_label,
        last_run_target_root=last_run_target_root,
        last_run_entrypoint_path=last_run_entrypoint_path,
    )


class NaturalChatRoutingTests(unittest.TestCase):
    def test_classifier_maps_core_intent_categories(self) -> None:
        classifier = IntentClassifier()
        base = _context()

        self.assertEqual(classifier.classify(message="What does this file do?", context=base).intent_label, "explanation")
        self.assertEqual(classifier.classify(message="How should we add CSV export?", context=base).intent_label, "planning")
        self.assertEqual(classifier.classify(message="Add CSV output.", context=base).intent_label, "patch_request")
        self.assertEqual(classifier.classify(message="Run it again.", context=base).intent_label, "execution_request")
        self.assertEqual(classifier.classify(message="What was the last result?", context=base).intent_label, "status_or_context")
        self.assertEqual(classifier.classify(message="maybe", context=base).intent_label, "unknown_or_ambiguous")

    def test_router_prefers_latest_context_for_bounded_patch_and_explanation(self) -> None:
        router = IntentRouter()
        context = _context(latest_context_id="C3", latest_context_kind="file_preview", latest_context_source="generated/GP-7A31C2/src/main.py")
        classifier = IntentClassifier()

        patch_decision = router.route(
            message="Add CSV output.",
            classification=classifier.classify(message="Add CSV output.", context=context),
            context=context,
        )
        explain_decision = router.route(
            message="What does this file do?",
            classification=classifier.classify(message="What does this file do?", context=context),
            context=context,
        )

        self.assertEqual(patch_decision.route_kind, "direct_handler")
        self.assertEqual(patch_decision.route_command, "/askctx")
        self.assertEqual(patch_decision.route_argument, "C3 Add CSV output.")
        self.assertEqual(explain_decision.route_command, "/askctx")
        self.assertEqual(explain_decision.route_argument, "C3 What does this file do?")

    def test_router_uses_last_run_for_run_and_patch_when_context_is_missing(self) -> None:
        router = IntentRouter()
        context = _context(
            has_recent_run=True,
            last_run_command_label="main",
            last_run_target_root="generated/GP-7A31C2",
            last_run_entrypoint_path="generated/GP-7A31C2/src/main.py",
        )
        classifier = IntentClassifier()

        run_decision = router.route(
            message="Run it again.",
            classification=classifier.classify(message="Run it again.", context=context),
            context=context,
        )
        patch_decision = router.route(
            message="Fix the crash.",
            classification=classifier.classify(message="Fix the crash.", context=context),
            context=context,
        )

        self.assertEqual(run_decision.route_command, "/run")
        self.assertEqual(run_decision.route_argument, "main generated/GP-7A31C2")
        self.assertEqual(patch_decision.route_command, "/asklast")
        self.assertEqual(patch_decision.route_argument, "Fix the crash.")

    def test_router_falls_back_safely_when_patch_or_run_target_is_missing(self) -> None:
        router = IntentRouter()
        classifier = IntentClassifier()
        base = _context()

        patch_decision = router.route(
            message="Update this to save logs.",
            classification=classifier.classify(message="Update this to save logs.", context=base),
            context=base,
        )
        run_decision = router.route(
            message="Execute the latest patch.",
            classification=classifier.classify(message="Execute the latest patch.", context=base),
            context=base,
        )

        self.assertEqual(patch_decision.route_kind, "fallback")
        self.assertIn("recent file or run context", patch_decision.fallback_reason)
        self.assertEqual(run_decision.route_kind, "fallback")
        self.assertIn("Execution requests need", run_decision.fallback_reason)


if __name__ == "__main__":
    unittest.main()