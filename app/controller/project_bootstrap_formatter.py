"""Human-readable formatting helpers for explicit bootstrap proposals."""
from __future__ import annotations

from .project_bootstrap_models import ProjectBootstrapProposal


class ProjectBootstrapFormatter:
    """Render bounded bootstrap proposals and results into concise Telegram replies."""

    def format_proposal(self, proposal: ProjectBootstrapProposal, *, heading: str) -> str:
        lines = [
            heading,
            f"Bootstrap: {proposal.bootstrap_id} {proposal.state}",
            f"Type: {proposal.project_type}",
            f"Plan: {proposal.plan_id}",
            f"Summary: {proposal.summary}",
            f"Files: {self._join_paths(file_spec.relative_path for file_spec in proposal.files)}",
        ]
        if proposal.follow_up_commands:
            lines.append(f"Follow-up: {' | '.join(proposal.follow_up_commands[:2])}")
        if proposal.warnings:
            lines.append(f"Warnings: {'; '.join(proposal.warnings[:2])}")
        if proposal.state == "proposed":
            lines.append("Approve: /bootstrapapprove")
            lines.append("Reset: /bootstrapreset")
        elif proposal.state == "completed":
            lines.append(f"Created: {len(proposal.completed_files)}/{len(proposal.files)}")
            lines.append("Next: Inspect files or clear with /bootstrapreset.")
        elif proposal.state == "failed":
            lines.append(f"Created: {len(proposal.completed_files)}/{len(proposal.files)}")
            if proposal.stop_reason:
                lines.append(f"Stop: {proposal.stop_reason}")
            lines.append("Next: Fix the blocking path or reset with /bootstrapreset.")
        else:
            lines.append(f"Next: {proposal.next_step}")
        return "\n".join(lines)

    def format_result(self, proposal: ProjectBootstrapProposal) -> str:
        lines = [
            "Bootstrap result",
            f"Bootstrap: {proposal.bootstrap_id} {proposal.state}",
            f"Type: {proposal.project_type}",
            f"Created: {len(proposal.completed_files)}/{len(proposal.files)}",
            f"Files: {self._join_paths(record.relative_path for record in proposal.completed_files) if proposal.completed_files else self._join_paths(file_spec.relative_path for file_spec in proposal.files)}",
        ]
        if proposal.stop_reason:
            lines.append(f"Stop: {proposal.stop_reason}")
        if proposal.follow_up_commands:
            lines.append(f"Next: {' | '.join(proposal.follow_up_commands[:2])}")
        return "\n".join(lines)

    @staticmethod
    def format_no_active_proposal() -> str:
        return "No active bootstrap proposal.\nNext: Use /bootstrapproject after /planbuild."

    @staticmethod
    def format_reset_reply(proposal: ProjectBootstrapProposal | None) -> str:
        if proposal is None:
            return "No active bootstrap proposal to clear."
        return f"Bootstrap proposal cleared.\nBootstrap: {proposal.bootstrap_id} removed."

    @staticmethod
    def _join_paths(paths) -> str:
        selected = list(paths)
        if not selected:
            return "-"
        visible = selected[:4]
        summary = "; ".join(visible)
        if len(selected) > len(visible):
            return f"{summary}; +{len(selected) - len(visible)} more"
        return summary