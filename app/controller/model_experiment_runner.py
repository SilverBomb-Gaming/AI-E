"""Bounded runner for small local model-adaptation experiments."""
from __future__ import annotations

import json
from pathlib import Path

from .model_advisory import CommandGrammarAdvisoryModel
from .model_dataset_builders import CommandGrammarCorrectionBuilder, ModelDatasetBuilderError
from .model_experiment_models import CommandCorrectionArtifact, ModelExperimentEvaluationRow, ModelExperimentRecord


class ModelExperimentError(RuntimeError):
    """Raised when an experiment cannot be completed."""


class ModelExperimentRunner:
    def __init__(self) -> None:
        self._builder = CommandGrammarCorrectionBuilder()

    def run(
        self,
        *,
        experiment: ModelExperimentRecord,
        dataset_export_path: str | Path,
        artifact_root: str | Path,
        stop_requested: callable | None = None,
    ) -> dict[str, object]:
        stop_callback = stop_requested or (lambda: False)
        try:
            rows = self._load_export_rows(dataset_export_path)
            if stop_callback():
                raise ModelExperimentError("Experiment stop requested before data preparation completed.")
            examples = self._builder.build_examples(export_rows=rows)
            train_examples, eval_examples = self._builder.split_examples(examples=examples)
            if stop_callback():
                raise ModelExperimentError("Experiment stop requested before model fitting completed.")
            artifact = self._fit_artifact(train_examples=train_examples, created_at=experiment.updated_at or experiment.created_at, threshold=experiment.advisory_threshold)
            artifact_paths = self._write_artifacts(
                artifact_root=artifact_root,
                dataset_export_path=dataset_export_path,
                train_examples=train_examples,
                eval_examples=eval_examples,
                artifact=artifact,
            )
            evaluation_rows = self._evaluate(eval_examples=eval_examples, artifact=artifact)
            metrics = self._summarize_metrics(evaluation_rows=evaluation_rows, train_count=len(train_examples), eval_count=len(eval_examples), dataset_rows=len(rows))
            self._write_evaluation_outputs(path=Path(artifact_paths["evaluation_outputs"]), rows=evaluation_rows)
            self._write_metrics(path=Path(artifact_paths["metrics_summary"]), metrics=metrics)
            return {
                "metrics": metrics,
                "artifact_paths": artifact_paths,
                "training_example_count": len(train_examples),
                "evaluation_example_count": len(eval_examples),
                "dataset_record_count": len(rows),
                "builder_name": self._builder.builder_name,
                "status": "evaluated",
                "integration_status": "evaluated",
            }
        except (OSError, ValueError, json.JSONDecodeError, ModelDatasetBuilderError) as exc:
            raise ModelExperimentError(str(exc)) from exc

    @staticmethod
    def _load_export_rows(dataset_export_path: str | Path) -> tuple[dict[str, object], ...]:
        path = Path(dataset_export_path)
        if path.suffix.lower() == ".json":
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, list):
                raise ModelExperimentError("Dataset export JSON payload must be a list.")
            return tuple(item for item in payload if isinstance(item, dict))
        rows: list[dict[str, object]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                rows.append(payload)
        return tuple(rows)

    @staticmethod
    def _fit_artifact(*, train_examples: tuple, created_at: str, threshold: float) -> CommandCorrectionArtifact:
        command_variants: dict[str, list[str]] = {}
        for example in train_examples:
            command_variants.setdefault(example.command_label, []).append(example.malformed_text.split(None, 1)[0].strip().lower())
        normalized = {key: tuple(sorted(set(value))) for key, value in command_variants.items() if key and value}
        if not normalized:
            raise ModelExperimentError("Training examples did not produce any command variants.")
        return CommandCorrectionArtifact(
            task_type="command_grammar_correction",
            adaptation_method="char_bigram_knn_v1",
            created_at=created_at,
            command_variants=normalized,
            advisory_threshold=threshold,
        )

    def _evaluate(self, *, eval_examples: tuple, artifact: CommandCorrectionArtifact) -> tuple[ModelExperimentEvaluationRow, ...]:
        advisory = CommandGrammarAdvisoryModel(artifact)
        rows: list[ModelExperimentEvaluationRow] = []
        for example in eval_examples:
            baseline_prediction = self._baseline_prediction(example.malformed_text)
            adapted_prediction, similarity = advisory.suggest(text=example.malformed_text)
            rows.append(
                ModelExperimentEvaluationRow(
                    input_text=example.malformed_text,
                    target_text=example.target_text,
                    baseline_prediction=baseline_prediction,
                    adapted_prediction=adapted_prediction,
                    baseline_match=baseline_prediction == example.target_text,
                    adapted_match=adapted_prediction == example.target_text,
                    similarity_score=similarity,
                    command_label=example.command_label,
                )
            )
        return tuple(rows)

    @staticmethod
    def _baseline_prediction(text: str) -> str:
        stripped = " ".join(text.split())
        token, _, remainder = stripped.partition(" ")
        supported_commands = (
            "/ask",
            "/askd",
            "/audit",
            "/bundleapprove",
            "/bundlecancel",
            "/bundlestatus",
            "/capabilities",
            "/cancelworkflow",
            "/chaincreate",
            "/chains",
            "/chainstart",
            "/chainstatus",
            "/chat",
            "/clearcontext",
            "/data",
            "/dataset",
            "/datasetcreate",
            "/datasetexport",
            "/datasets",
            "/datasetsummary",
            "/dispatch",
            "/evalcreate",
            "/evalstatus",
            "/file",
            "/help",
            "/mode",
            "/models",
            "/planbuild",
            "/repo",
            "/run",
            "/status",
            "/test",
            "/translate",
            "/web",
            "/workflowstatus",
            "/workflows",
        )
        best = ""
        for command in supported_commands:
            if token.startswith(command) and len(command) > len(best):
                best = command
        if not best:
            return ""
        if remainder:
            return f"{best} {remainder}".strip()
        suffix = token[len(best) :].strip()
        if suffix:
            return f"{best} {suffix}".strip()
        return best

    @staticmethod
    def _summarize_metrics(*, evaluation_rows: tuple[ModelExperimentEvaluationRow, ...], train_count: int, eval_count: int, dataset_rows: int) -> dict[str, float | int | str]:
        baseline_successes = sum(1 for item in evaluation_rows if item.baseline_match)
        adapted_successes = sum(1 for item in evaluation_rows if item.adapted_match)
        baseline_rate = baseline_successes / eval_count if eval_count else 0.0
        adapted_rate = adapted_successes / eval_count if eval_count else 0.0
        return {
            "dataset_rows": dataset_rows,
            "train_examples": train_count,
            "eval_examples": eval_count,
            "baseline_successes": baseline_successes,
            "adapted_successes": adapted_successes,
            "baseline_exact_match": baseline_rate,
            "adapted_exact_match": adapted_rate,
            "exact_match_delta": adapted_rate - baseline_rate,
        }

    @staticmethod
    def _write_artifacts(*, artifact_root: str | Path, dataset_export_path: str | Path, train_examples: tuple, eval_examples: tuple, artifact: CommandCorrectionArtifact) -> dict[str, str]:
        root = Path(artifact_root)
        root.mkdir(parents=True, exist_ok=True)
        config_path = root / "config_snapshot.json"
        train_path = root / "train_examples.jsonl"
        eval_path = root / "eval_examples.jsonl"
        model_path = root / "model_artifact.json"
        metrics_path = root / "metrics_summary.json"
        evaluation_outputs_path = root / "evaluation_outputs.jsonl"
        dataset_copy_path = root / Path(dataset_export_path).name
        dataset_copy_path.write_text(Path(dataset_export_path).read_text(encoding="utf-8"), encoding="utf-8")
        config_path.write_text(json.dumps({"dataset_export_path": str(dataset_export_path), "builder": "command_grammar_correction_v1"}, indent=2, sort_keys=True), encoding="utf-8")
        ModelExperimentRunner._write_example_rows(path=train_path, rows=train_examples)
        ModelExperimentRunner._write_example_rows(path=eval_path, rows=eval_examples)
        model_path.write_text(json.dumps(artifact.to_payload(), indent=2, sort_keys=True), encoding="utf-8")
        return {
            "config_snapshot": str(config_path),
            "dataset_export_copy": str(dataset_copy_path),
            "train_examples": str(train_path),
            "eval_examples": str(eval_path),
            "model_artifact": str(model_path),
            "metrics_summary": str(metrics_path),
            "evaluation_outputs": str(evaluation_outputs_path),
        }

    @staticmethod
    def _write_example_rows(*, path: Path, rows: tuple) -> None:
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row.to_payload(), sort_keys=True))
                handle.write("\n")

    @staticmethod
    def _write_evaluation_outputs(*, path: Path, rows: tuple[ModelExperimentEvaluationRow, ...]) -> None:
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row.to_payload(), sort_keys=True))
                handle.write("\n")

    @staticmethod
    def _write_metrics(*, path: Path, metrics: dict[str, float | int | str]) -> None:
        path.write_text(json.dumps(metrics, indent=2, sort_keys=True), encoding="utf-8")