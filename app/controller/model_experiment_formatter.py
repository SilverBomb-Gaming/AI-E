"""Formatting helpers for local model experiments."""
from __future__ import annotations

from .model_experiment_models import ModelExperimentRecord


class ModelExperimentFormatter:
    def format_experiment_summary_line(self, experiment: ModelExperimentRecord) -> str:
        return (
            f"- {experiment.experiment_id} | {experiment.status} | {experiment.integration_status} | "
            f"{experiment.task_type} | {experiment.title}"
        )

    def format_metrics(self, experiment: ModelExperimentRecord) -> tuple[str, ...]:
        metrics = experiment.metrics
        if not metrics:
            return ("Metrics: none",)
        ordered_keys = (
            "baseline_exact_match",
            "adapted_exact_match",
            "exact_match_delta",
            "baseline_successes",
            "adapted_successes",
        )
        lines: list[str] = []
        for key in ordered_keys:
            if key not in metrics:
                continue
            value = metrics[key]
            if isinstance(value, float):
                lines.append(f"{key}: {value:.3f}")
            else:
                lines.append(f"{key}: {value}")
        for key, value in sorted(metrics.items()):
            if key in ordered_keys:
                continue
            if isinstance(value, float):
                lines.append(f"{key}: {value:.3f}")
            else:
                lines.append(f"{key}: {value}")
        return tuple(lines)

    def format_artifacts(self, experiment: ModelExperimentRecord) -> tuple[str, ...]:
        if not experiment.artifact_paths:
            return ("Artifacts: none",)
        return tuple(f"{key}: {value}" for key, value in sorted(experiment.artifact_paths.items()))