from __future__ import annotations

import unittest

from app.controller.build_plan_store import BuildPlanStore
from app.controller.build_planner import BuildPlanner
from app.controller.intent_translator import IntentTranslator


class BuildPlanningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.translator = IntentTranslator()
        self.planner = BuildPlanner()
        self.store = BuildPlanStore()

    def test_planbuild_creates_blocked_website_plan_when_key_choices_are_missing(self) -> None:
        session = self.translator.start_session(
            "Build me a landing page for BABYLON with wishlist CTA and email signup.",
            translation_session_id="TR-PLAN01",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        plan = self.planner.build_plan(session, plan_id="BP-AAAAAA")
        self.assertEqual(plan.plan_id, "BP-AAAAAA")
        self.assertEqual(plan.request_type, "website")
        self.assertEqual(plan.state, "blocked")
        self.assertEqual(len(plan.phases), 3)
        self.assertEqual(plan.phases[0].phase_id, "PH-001")
        self.assertEqual(plan.phases[0].task_groups[0].task_group_id, "TG-001-001")
        self.assertIn("Frontend stack is not confirmed.", plan.blockers)
        self.assertIn("Deployment target is not confirmed.", plan.blockers)

    def test_planbuild_creates_desktop_plan_with_packaging_phase(self) -> None:
        session = self.translator.start_session(
            "Make a desktop tool that summarizes design docs and exports milestones.",
            translation_session_id="TR-PLAN02",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        refined = self.translator.refine_session(
            session,
            "Windows first, keep it in Python and PySide6, export markdown and JSON",
            timestamp="2026-04-08T12:05:00+00:00",
        )
        plan = self.planner.build_plan(refined, plan_id="BP-BBBBBB")
        self.assertEqual(plan.request_type, "desktop_app")
        self.assertEqual(plan.phases[-1].name, "Packaging and validation")
        self.assertIn("Target platform: windows", plan.cross_phase_dependencies)
        self.assertIn("Confirmed stack: python + pyside6", plan.cross_phase_dependencies)

    def test_plan_store_clears_active_plan_cleanly(self) -> None:
        session = self.translator.start_session(
            "Build me a landing page for BABYLON",
            translation_session_id="TR-PLAN03",
            timestamp="2026-04-08T12:00:00+00:00",
        )
        plan = self.planner.build_plan(session, plan_id="BP-CCCCCC")
        self.store.set_active(chat_id="chat-1", plan=plan)
        cleared = self.store.clear_active(chat_id="chat-1")
        self.assertIsNotNone(cleared)
        self.assertEqual(cleared.plan_id, "BP-CCCCCC")
        self.assertIsNone(self.store.get_active(chat_id="chat-1"))