"""Deterministic builders that turn curated datasets into training-ready experiment examples."""
from __future__ import annotations

from hashlib import sha256

from .chat_command_parser import parse_chat_command
from .model_experiment_models import CommandCorrectionExample


class ModelDatasetBuilderError(RuntimeError):
    """Raised when a dataset cannot be transformed into training examples."""


class CommandGrammarCorrectionBuilder:
    builder_name = "command_grammar_correction_v1"

    def build_examples(self, *, export_rows: tuple[dict[str, object], ...]) -> tuple[CommandCorrectionExample, ...]:
        examples: list[CommandCorrectionExample] = []
        for row in export_rows:
            example_seed = self._build_examples_for_row(row)
            examples.extend(example_seed)
        if len(examples) < 4:
            raise ModelDatasetBuilderError("Need at least four deterministic command-correction examples to run the experiment.")
        return tuple(examples)

    def split_examples(self, *, examples: tuple[CommandCorrectionExample, ...], train_percent: int = 80) -> tuple[tuple[CommandCorrectionExample, ...], tuple[CommandCorrectionExample, ...]]:
        train: list[CommandCorrectionExample] = []
        eval_items: list[CommandCorrectionExample] = []
        for example in sorted(examples, key=lambda item: item.example_id):
            bucket = int(sha256(example.example_id.encode("utf-8")).hexdigest()[:8], 16) % 100
            if bucket < train_percent:
                train.append(example)
            else:
                eval_items.append(example)
        if not train or not eval_items:
            midpoint = max(1, len(examples) - 1)
            ordered = sorted(examples, key=lambda item: item.example_id)
            train = list(ordered[:midpoint])
            eval_items = list(ordered[midpoint:])
        if not train or not eval_items:
            raise ModelDatasetBuilderError("Need at least one training example and one evaluation example after splitting.")
        return tuple(train), tuple(eval_items)

    def _build_examples_for_row(self, row: dict[str, object]) -> tuple[CommandCorrectionExample, ...]:
        record_type = str(row.get("record_type", "")).strip().lower()
        raw_input = str(row.get("raw_input", "")).strip()
        labels = row.get("labels")
        curation_label = ""
        if isinstance(labels, dict):
            curation_label = str(labels.get("curation", "")).strip().lower()
        if record_type != "command" or curation_label != "training":
            return ()
        if not raw_input.startswith("/"):
            return ()
        parts = raw_input.split(None, 1)
        command_token = parts[0].strip().lower()
        if parse_chat_command(text=raw_input, has_text=True).command_label == "parse_failure":
            return ()
        if not command_token.startswith("/") or len(command_token) < 3:
            return ()
        remainder = parts[1].strip() if len(parts) > 1 else ""
        command_label = str(row.get("record_id", "")).strip().upper()
        return self._variants_for_command(record_id=command_label, command_text=raw_input, command_token=command_token, remainder=remainder)

    def _variants_for_command(self, *, record_id: str, command_text: str, command_token: str, remainder: str) -> tuple[CommandCorrectionExample, ...]:
        variants: list[CommandCorrectionExample] = []
        for variant_kind, malformed in self._generate_variants(command_token=command_token, remainder=remainder):
            if malformed == command_text:
                continue
            parsed = parse_chat_command(text=malformed, has_text=True)
            if parsed.command_label != "parse_failure":
                continue
            example_id = sha256(f"{record_id}:{variant_kind}:{malformed}".encode("utf-8")).hexdigest()[:16]
            variants.append(
                CommandCorrectionExample(
                    example_id=example_id,
                    source_record_id=record_id,
                    malformed_text=malformed,
                    target_text=command_text,
                    command_label=command_token,
                    variant_kind=variant_kind,
                    provenance={"record_id": record_id, "variant": variant_kind},
                )
            )
        return tuple(variants)

    @staticmethod
    def _generate_variants(*, command_token: str, remainder: str) -> tuple[tuple[str, str], ...]:
        variants: list[tuple[str, str]] = []
        suffix = f" {remainder}" if remainder else ""
        if remainder:
            variants.append(("missing_space", f"{command_token}{remainder}"))
        letters = list(command_token)
        if len(letters) > 3:
            variants.append(("drop_last", f"{''.join(letters[:-1])}{suffix}"))
        if len(letters) > 4:
            swapped = list(letters)
            swapped[-2], swapped[-1] = swapped[-1], swapped[-2]
            variants.append(("swap_tail", f"{''.join(swapped)}{suffix}"))
        if len(letters) > 3:
            duplicate = f"{command_token[:-1]}{command_token[-1]}{command_token[-1]}{suffix}"
            variants.append(("duplicate_tail", duplicate))
        if len(letters) > 4:
            truncated = f"/{''.join(letters[2:])}{suffix}"
            variants.append(("drop_prefix_char", truncated))
        deduped: list[tuple[str, str]] = []
        seen: set[str] = set()
        for variant in variants:
            if variant[1] not in seen:
                deduped.append(variant)
                seen.add(variant[1])
        return tuple(deduped)