"""Concise formatting helpers for bounded autonomy bundle proposals and run state."""
from __future__ import annotations

from .autonomy_bundle_models import AutonomyBundleProposal, AutonomyBundleRunState


class AutonomyBundleFormatter:
    """Render bounded bundle proposals and status into operator-facing text."""

    def format_proposal(self, proposal: AutonomyBundleProposal) -> str:
        step_lines = [f"{step.step_index}. {step.suggested_entry_command}" for step in proposal.selected_steps]
        lines = [
            "Bundle proposal",
            f"Bundle: {proposal.bundle_id} proposed",
            f"Plan: {proposal.plan_id}",
            f"Steps: {len(proposal.selected_steps)} / max {proposal.max_steps}",
        ]
        lines.extend(step_lines)
        lines.append(f"Stops: fail | budget={proposal.stop_conditions.stop_after_max_steps} | invalidate")
        lines.append("Approve: /bundleapprove")
        return "\n".join(lines)

    def format_no_active_plan(self) -> str:
        return "Couldn't propose a bundle.\nReason: No active build plan exists.\nNext: Use /planbuild after /translate or /refine."

    def format_blocked_plan(self) -> str:
        return "Couldn't propose a bundle.\nReason: The active build plan is blocked.\nNext: Resolve blockers, then rerun /planbuild."

    def format_active_conflict(self) -> str:
        return "Couldn't propose a bundle.\nReason: Another plan step or bundle is already active.\nNext: Finish, cancel, or reset the active work first."

    def format_no_active_bundle(self) -> str:
        return "No active bundle.\nNext: Use /planstepbundle after /planbuild."

    def format_no_proposed_bundle(self) -> str:
        return "Couldn't approve that bundle.\nReason: No proposed bundle exists.\nNext: Use /planstepbundle first."

    def format_status(self, state: AutonomyBundleRunState) -> str:
        lines = [
            "Bundle status",
            f"Bundle: {state.bundle_id} {state.state}",
            f"Plan: {state.plan_id}",
            f"Completed: {len(state.completed_steps)}/{state.proposal.max_steps}",
        ]
        if state.current_step_title:
            lines.append(f"Current: {state.current_step_title}")
        if state.failed_step is not None:
            lines.append(f"Failed: {state.failed_step.title}")
        if state.stop_reason:
            lines.append(f"Stop: {state.stop_reason}")
        lines.append(f"Summary: {state.result_summary}")
        return "\n".join(lines)

    def format_result(self, state: AutonomyBundleRunState) -> str:
        lines = [
            "Bundle result",
            f"Bundle: {state.bundle_id} {state.state}",
            f"Completed: {len(state.completed_steps)}/{state.proposal.max_steps}",
        ]
        if state.failed_step is not None:
            lines.append(f"Failed: {state.failed_step.title} ({state.failed_step.outcome})")
        if state.stop_reason:
            lines.append(f"Stop: {state.stop_reason}")
        lines.append(f"Summary: {state.result_summary}")
        lines.append("Next: Use /bundlestatus, /bundlecancel, /bundlereset, or /planstepbundle.")
        return "\n".join(lines)

    def format_cancel_reply(self, state: AutonomyBundleRunState | None) -> str:
        if state is None:
            return "No active bundle to cancel."
        return f"Bundle cancelled.\nBundle: {state.bundle_id} cancelled."

    def format_reset_reply(self, state: AutonomyBundleRunState | None) -> str:
        if state is None:
            return "No active bundle to reset."
        return f"Bundle reset.\nBundle: {state.bundle_id} cleared."