from __future__ import annotations

import unittest

from app.controller.intent_formatter import IntentFormatter
from app.controller.intent_translator import IntentTranslator


class IntentTranslationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.translator = IntentTranslator()
        self.formatter = IntentFormatter()

    def test_landing_page_request_is_classified_and_extracts_obvious_requirements(self) -> None:
        spec = self.translator.translate("Build me a landing page for BABYLON with wishlist CTA and email signup.")
        self.assertEqual(spec.request_type, "website")
        self.assertEqual(spec.delivery_target, "website")
        self.assertIn("Wishlist CTA", spec.functional_requirements)
        self.assertIn("Email signup capture", spec.functional_requirements)
        self.assertIn("Marketing landing page", spec.summary)
        self.assertTrue(any("stack" in item.lower() for item in spec.open_questions))
        self.assertTrue(any("one-page marketing site" in item.lower() for item in spec.assumptions))
        self.assertIn("request_type: website", spec.confirmed_values)
        self.assertIn("Build target: website", spec.execution_handoff)

    def test_game_request_extracts_core_features_and_missing_fields(self) -> None:
        spec = self.translator.translate("I want a cozy survival game with async multiplayer and creature collecting")
        self.assertEqual(spec.request_type, "game")
        self.assertIn("Survival systems", spec.functional_requirements)
        self.assertIn("Asynchronous multiplayer interactions", spec.functional_requirements)
        self.assertIn("Creature collection and progression", spec.functional_requirements)
        self.assertTrue(any("engine" in item.lower() for item in spec.open_questions))
        self.assertTrue(any("prototype" in item.lower() for item in spec.open_questions))
        self.assertTrue(any("genre adjectives" in item.lower() for item in spec.assumptions))

    def test_desktop_tool_request_extracts_capabilities_and_export_questions(self) -> None:
        spec = self.translator.translate("Make a desktop tool that summarizes my design docs and exports milestones")
        self.assertEqual(spec.request_type, "desktop_app")
        self.assertIn("Summarize design documents", spec.functional_requirements)
        self.assertIn("Export milestone summaries", spec.functional_requirements)
        self.assertTrue(any("document formats" in item.lower() for item in spec.open_questions))
        self.assertTrue(any("export formats" in item.lower() for item in spec.open_questions))

    def test_unknown_product_request_fails_gracefully_with_open_questions(self) -> None:
        spec = self.translator.translate("Help me turn this rough idea into a deployable product")
        self.assertEqual(spec.request_type, "unknown")
        self.assertTrue(spec.open_questions)
        self.assertTrue(any("first deliverable" in item.lower() for item in spec.open_questions))
        self.assertTrue(any("product-discovery" in item.lower() for item in spec.assumptions))

    def test_translation_is_deterministic_for_same_request(self) -> None:
        first = self.translator.translate("Build me a landing page for BABYLON with wishlist CTA and email signup.")
        second = self.translator.translate("Build me a landing page for BABYLON with wishlist CTA and email signup.")
        self.assertEqual(first.intent_id, second.intent_id)
        self.assertEqual(first.to_payload(), second.to_payload())

    def test_operator_summary_is_concise_and_actionable(self) -> None:
        spec = self.translator.translate("Build me a landing page for BABYLON with wishlist CTA and email signup.")
        summary = self.formatter.format_operator_summary(spec)
        self.assertIn("Translation", summary)
        self.assertIn("Type: website", summary)
        self.assertIn("Confirmed:", summary)
        self.assertIn("Open questions:", summary)
        self.assertIn("Next:", summary)
        self.assertLessEqual(len(summary), 900)