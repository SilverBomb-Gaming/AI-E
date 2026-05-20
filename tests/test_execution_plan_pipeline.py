from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_plan import ExecutionPlan, ExecutionReceipt
from app.controller.execution_receipt_store import ExecutionReceiptStore
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_telegram_commands import _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager


class ExecutionPlanPipelineTests(unittest.TestCase):
    def _make_service(self, tmp_dir: str) -> ControllerService:
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json"),
            secret_store=InMemorySecretStore(),
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        return service

    def test_mutation_prompt_generates_execution_plan_before_approval(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = self._make_service(tmp)

            reply = service.route_conversation_prompt("Increase zombie health after round 3.")

            plan = reply.execution_plan
            self.assertIsInstance(plan, ExecutionPlan)
            assert isinstance(plan, ExecutionPlan)
            self.assertTrue(plan.plan_id.startswith("PLAN-"))
            self.assertEqual(plan.workflow_kind, "mutation_request")
            self.assertEqual(plan.risk_level, "medium")
            self.assertTrue(plan.requires_approval)
            self.assertTrue(plan.dry_run_available)
            self.assertTrue(plan.rollback_possible)
            self.assertIn("Increase zombie health after round 3.", plan.requested_actions)
            self.assertIn("Unknown until bounded executor resolves target files", plan.predicted_files)
            self.assertEqual(plan.predicted_commands, ())
            self.assertIn("Potential file mutation after approval", plan.estimated_impact)
            self.assertIn("Approval Required Before Action", reply.truth_line)

    def test_approval_stores_truthful_receipt_when_executor_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = self._make_service(tmp)
            reply = service.route_conversation_prompt("Increase zombie health after round 3.")
            plan = reply.execution_plan
            assert isinstance(plan, ExecutionPlan)

            receipt = service.approve_execution_plan(plan.plan_id)

            self.assertIsInstance(receipt, ExecutionReceipt)
            self.assertTrue(receipt.receipt_id.startswith("REC-"))
            self.assertEqual(receipt.linked_plan_id, plan.plan_id)
            self.assertTrue(receipt.operator_approved)
            self.assertFalse(receipt.mutation_applied)
            self.assertEqual(receipt.files_changed, ())
            self.assertEqual(receipt.commands_executed, ())
            self.assertEqual(receipt.validation_result, "not_run_no_bounded_executor")
            self.assertFalse(receipt.rollback_available)
            self.assertTrue(receipt.audit_visible)
            self.assertIn("no bounded executor is connected", receipt.execution_summary)

            receipts = ExecutionReceiptStore(root_path=Path(tmp) / "execution_receipts").list_receipts(limit=1)
            self.assertEqual(len(receipts), 1)
            self.assertEqual(receipts[0].receipt_id, receipt.receipt_id)


if __name__ == "__main__":
    unittest.main()
