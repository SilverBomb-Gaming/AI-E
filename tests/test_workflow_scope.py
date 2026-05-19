import unittest

from app.controller.workflow_scope import WorkflowScopeAnalyzer


class WorkflowScopeAnalyzerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.analyzer = WorkflowScopeAnalyzer()

    def test_read_only_inspection_requires_no_approval(self) -> None:
        scope = self.analyzer.analyze("Inspect the gameplay loop and explain the likely issue.")

        self.assertEqual(scope.workflow_kind, "inspection")
        self.assertEqual(scope.intent_class, "read_only_inspection")
        self.assertEqual(scope.mutation_risk, "read_only")
        self.assertFalse(scope.approval_required)
        self.assertFalse(scope.runtime_execution_allowed)
        self.assertFalse(scope.mutation_allowed)
        self.assertIn("Boundary: read_only_runtime_response", scope.truth_scope_line)

    def test_mutation_request_is_planning_only_until_approval(self) -> None:
        scope = self.analyzer.analyze("Fix the player controller and patch the file.")

        self.assertEqual(scope.workflow_kind, "mutation_request")
        self.assertEqual(scope.intent_class, "mutation_or_patch_planning")
        self.assertEqual(scope.mutation_risk, "mutation_requested")
        self.assertTrue(scope.approval_required)
        self.assertEqual(scope.approval_requirement, "before_mutation")
        self.assertFalse(scope.runtime_execution_allowed)
        self.assertFalse(scope.mutation_allowed)
        self.assertTrue(scope.validation_required)

    def test_execution_request_is_blocked_until_operator_approval(self) -> None:
        scope = self.analyzer.analyze("Run the tests and push the fix.")

        self.assertEqual(scope.workflow_kind, "execution_request")
        self.assertEqual(scope.intent_class, "execution_escalation_requested")
        self.assertEqual(scope.mutation_risk, "execution_requested")
        self.assertTrue(scope.approval_required)
        self.assertEqual(scope.approval_requirement, "before_execution")
        self.assertFalse(scope.runtime_execution_allowed)
        self.assertFalse(scope.mutation_allowed)
        self.assertTrue(scope.validation_required)

    def test_validation_question_is_read_only_diagnostics_without_false_validation(self) -> None:
        scope = self.analyzer.analyze("Did you validate the gameplay loop?")

        self.assertEqual(scope.workflow_kind, "diagnostics")
        self.assertEqual(scope.intent_class, "read_only_diagnostics")
        self.assertEqual(scope.mutation_risk, "read_only")
        self.assertFalse(scope.approval_required)
        self.assertFalse(scope.validation_required)
        self.assertIn("Boundary: read_only_runtime_response", scope.truth_scope_line)


if __name__ == "__main__":
    unittest.main()
