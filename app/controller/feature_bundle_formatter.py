"""Operator-facing formatting for bounded multi-file feature bundles."""
from __future__ import annotations

from .feature_bundle_models import FeatureBundleRecord


class FeatureBundleFormatter:
    def format_proposal(self, bundle: FeatureBundleRecord) -> str:
        lines = [
            "[FEATURE BUNDLE]",
            f"Bundle: {bundle.bundle_id} proposed",
            f"Feature: {bundle.feature_title}",
            f"Outcome: {bundle.intended_outcome}",
            "Files:",
        ]
        for item in bundle.files:
            mode = "edit" if item.editable else "context"
            lines.append(f"- {item.relative_path} [{mode}, {item.scope_confidence:.2f}]")
            lines.append(f"  Reason: {item.inclusion_reason}")
            lines.append(f"  Change: {item.change_summary}")
        if bundle.assumptions:
            lines.append("Assumptions:")
            for assumption in bundle.assumptions:
                lines.append(f"- {assumption}")
        if bundle.risk_notes:
            lines.append("Risks:")
            for risk in bundle.risk_notes:
                lines.append(f"- {risk}")
        if bundle.validation_plan is not None:
            lines.append("Validation:")
            lines.append(f"- {bundle.validation_plan.command_text}")
            lines.append(f"  Why: {bundle.validation_plan.rationale}")
        lines.append("Status:")
        lines.append("- bundle prepared")
        lines.append("- approval required before apply")
        lines.append("Next: Use /featurestatus to inspect or /featureapply to request grouped apply approval.")
        return "\n".join(lines)

    def format_status(self, bundle: FeatureBundleRecord) -> str:
        lines = [
            "[FEATURE BUNDLE]",
            f"Bundle: {bundle.bundle_id} {bundle.state}",
            f"Feature: {bundle.feature_title}",
            f"Validation: {bundle.validation_state}",
        ]
        if bundle.apply_summary:
            lines.append(f"Apply: {bundle.apply_summary}")
        if bundle.validation_summary:
            lines.append(f"Validation summary: {bundle.validation_summary}")
        lines.append("Files:")
        for item in bundle.files:
            mode = "edit" if item.editable else "context"
            lines.append(f"- {item.relative_path} [{mode}] {item.inclusion_reason}")
        if bundle.validation_plan is not None:
            lines.append(f"Validation command: {bundle.validation_plan.command_text}")
        return "\n".join(lines)

    def format_no_active_bundle(self) -> str:
        return "No active feature bundle.\nNext: send a bounded multi-file feature request in natural language."

    def format_apply_success(self, bundle: FeatureBundleRecord) -> str:
        lines = [
            "Feature bundle applied.",
            f"Bundle: {bundle.bundle_id}",
            f"Feature: {bundle.feature_title}",
            f"Applied files: {', '.join(bundle.applied_files) or '-'}",
        ]
        if bundle.validation_plan is not None:
            lines.append(f"Suggested validation: /run {bundle.validation_plan.command_text}")
        return "\n".join(lines)

    def format_apply_failure(self, bundle: FeatureBundleRecord, *, detail: str) -> str:
        return "\n".join(
            (
                "Feature bundle apply failed.",
                f"Bundle: {bundle.bundle_id}",
                f"Reason: {detail}",
                f"Applied files before stop: {', '.join(bundle.applied_files) or '-'}",
            )
        )

    def format_refusal(self, *, reason: str, next_step: str) -> str:
        return f"Couldn't plan that feature bundle.\nReason: {reason}\nNext: {next_step}"