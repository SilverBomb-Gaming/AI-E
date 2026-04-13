"""Human-readable formatting helpers for explicit bootstrap proposals."""
from __future__ import annotations

from .project_bootstrap_models import ProjectBootstrapProposal


class ProjectBootstrapFormatter:
    """Render bounded bootstrap proposals and results into concise Telegram replies."""

    def format_proposal(self, proposal: ProjectBootstrapProposal, *, heading: str) -> str:
        lines = [heading, f"Type: {proposal.project_type}", f"Target: {proposal.target_root}", "", "Files:"]
        lines.extend(f"- {file_spec.relative_path}" for file_spec in proposal.files)
        lines.append(f"Purpose: {proposal.summary}")
        if proposal.state == "proposed":
            lines.append("Use /bootstrapapprove to execute")
        elif proposal.state == "completed":
            lines.append("Use /bootstrapreset to clear the active proposal")
        elif proposal.state == "failed":
            lines.append("Use /bootstrapreset to discard the blocked proposal")
        return "\n".join(lines)

    def format_result(self, proposal: ProjectBootstrapProposal) -> str:
        created = tuple(record.relative_path for record in proposal.completed_files)
        lines = ["Bootstrap completed", f"Target: {proposal.target_root}", "Created:"]
        lines.extend(f"- {path}" for path in created)
        return "\n".join(lines)

    @staticmethod
    def format_no_active_proposal() -> str:
        return "No active bootstrap proposal"

    @staticmethod
    def format_reset_reply(proposal: ProjectBootstrapProposal | None) -> str:
        if proposal is None:
            return "No active bootstrap proposal"
        return "Bootstrap proposal cleared"

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