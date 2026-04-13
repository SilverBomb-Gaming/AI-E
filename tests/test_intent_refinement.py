from __future__ import annotations

import unittest

from app.controller.intent_store import IntentStore
from app.controller.intent_translator import IntentTranslator


class IntentRefinementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.translator = IntentTranslator()
        self.store = IntentStore()

    def test_translate_creates_draft_session(self) -> None:
        session = self.translator.start_session(
            "Build me a landing page for BABYLON with wishlist CTA and email signup.",
            translation_session_id="TR-AAAAAA",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        self.assertEqual(session.translation_session_id, "TR-AAAAAA")
        self.assertEqual(session.state, "draft")
        self.assertEqual(session.current_spec.request_type, "website")
        self.assertTrue(session.open_questions)
        self.assertIn("request_type", session.resolved_fields)

    def test_refinement_reduces_open_questions_and_updates_confirmed_values(self) -> None:
        session = self.translator.start_session(
            "Build me a landing page for BABYLON with wishlist CTA and email signup.",
            translation_session_id="TR-BBBBBB",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        refined = self.translator.refine_session(
            session,
            "one-page site, dark style, deploy to Vercel, use React",
            timestamp="2026-04-08T12:05:00+00:00",
        )
        self.assertLess(len(refined.open_questions), len(session.open_questions))
        self.assertIn("stack: react", refined.current_spec.confirmed_values)
        self.assertIn("deployment_target: vercel", refined.current_spec.confirmed_values)
        self.assertIn("style_direction: dark", refined.current_spec.confirmed_values)
        self.assertIn("site_scope: one-page", refined.current_spec.confirmed_values)

    def test_conflicting_refinement_replaces_one_page_assumption_with_multi_page_confirmation(self) -> None:
        session = self.translator.start_session(
            "Build me a landing page for BABYLON",
            translation_session_id="TR-CCCCCC",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        refined = self.translator.refine_session(
            session,
            "actually make it multi-page and use React",
            timestamp="2026-04-08T12:05:00+00:00",
        )
        self.assertIn("site_scope: multi-page", refined.current_spec.confirmed_values)
        self.assertNotIn(
            "Assume a one-page marketing site unless a larger sitemap is requested",
            refined.assumptions,
        )
        self.assertIn("Multi-page information architecture", refined.current_spec.functional_requirements)

    def test_handoff_updates_after_refinement(self) -> None:
        session = self.translator.start_session(
            "Make a desktop tool that summarizes my design docs and exports milestones",
            translation_session_id="TR-DDDDDD",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        refined = self.translator.refine_session(
            session,
            "Windows first, keep it in Python and PySide6, export markdown and JSON",
            timestamp="2026-04-08T12:05:00+00:00",
        )
        self.assertNotEqual(session.latest_handoff, refined.latest_handoff)
        self.assertIn("Confirmed values:", refined.latest_handoff)
        self.assertIn("stack: python", refined.latest_handoff)

    def test_store_archives_active_session_cleanly(self) -> None:
        session = self.translator.start_session(
            "Build me a landing page for BABYLON",
            translation_session_id="TR-EEEEEE",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        self.store.set_active(chat_id="chat-1", session=session)
        archived = self.translator.archive_session(session, timestamp="2026-04-08T12:10:00+00:00")
        result = self.store.archive_active(chat_id="chat-1", archived_session=archived)
        self.assertIsNotNone(result)
        self.assertEqual(result.state, "archived")
        self.assertIsNone(self.store.get_active(chat_id="chat-1"))