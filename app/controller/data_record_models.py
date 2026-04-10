"""Unified durable data-record models for reusable training and evaluation traces."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


DataRecordType = Literal["command", "evaluation_run", "chain_step", "feature_bundle"]
DataRecordLabel = Literal["training-eligible", "evaluation-only", "discarded"]


@dataclass(frozen=True)
class DataRecord:
    record_id: str
    record_type: DataRecordType
    label: DataRecordLabel
    training_eligible: bool
    captured_at: str
    title: str
    summary: str
    outcome: str
    source: str
    input_text: str = ""
    output_text: str = ""
    request_id: str = ""
    session_id: str = ""
    chain_id: str = ""
    step_id: str = ""
    run_id: str = ""
    bundle_id: str = ""
    chat_id: str = ""
    capability_id: str = ""
    command_label: str = ""
    normalized_input: dict[str, object] = field(default_factory=dict)
    context_payload: dict[str, object] = field(default_factory=dict)
    result_payload: dict[str, object] = field(default_factory=dict)
    provenance_payload: dict[str, object] = field(default_factory=dict)
    tags: tuple[str, ...] = field(default_factory=tuple)
    artifact_refs: tuple[str, ...] = field(default_factory=tuple)

    def to_payload(self) -> dict[str, object]:
        return {
            "record_id": self.record_id,
            "record_type": self.record_type,
            "label": self.label,
            "training_eligible": self.training_eligible,
            "captured_at": self.captured_at,
            "title": self.title,
            "summary": self.summary,
            "outcome": self.outcome,
            "source": self.source,
            "input_text": self.input_text,
            "output_text": self.output_text,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "chain_id": self.chain_id,
            "step_id": self.step_id,
            "run_id": self.run_id,
            "bundle_id": self.bundle_id,
            "chat_id": self.chat_id,
            "capability_id": self.capability_id,
            "command_label": self.command_label,
            "normalized_input": dict(self.normalized_input),
            "context_payload": dict(self.context_payload),
            "result_payload": dict(self.result_payload),
            "provenance_payload": dict(self.provenance_payload),
            "tags": list(self.tags),
            "artifact_refs": list(self.artifact_refs),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> DataRecord:
        normalized_input = payload.get("normalized_input")
        context_payload = payload.get("context_payload")
        result_payload = payload.get("result_payload")
        provenance_payload = payload.get("provenance_payload")
        tags = payload.get("tags")
        artifact_refs = payload.get("artifact_refs")
        return DataRecord(
            record_id=str(payload.get("record_id", "")).strip(),
            record_type=str(payload.get("record_type", "command")).strip().lower() or "command",  # type: ignore[arg-type]
            label=str(payload.get("label", "evaluation-only")).strip().lower() or "evaluation-only",  # type: ignore[arg-type]
            training_eligible=bool(payload.get("training_eligible", False)),
            captured_at=str(payload.get("captured_at", "")).strip(),
            title=str(payload.get("title", "")).strip(),
            summary=str(payload.get("summary", "")).strip(),
            outcome=str(payload.get("outcome", "")).strip(),
            source=str(payload.get("source", "")).strip(),
            input_text=str(payload.get("input_text", "")).strip(),
            output_text=str(payload.get("output_text", "")).strip(),
            request_id=str(payload.get("request_id", "")).strip(),
            session_id=str(payload.get("session_id", "")).strip().upper(),
            chain_id=str(payload.get("chain_id", "")).strip().upper(),
            step_id=str(payload.get("step_id", "")).strip().upper(),
            run_id=str(payload.get("run_id", "")).strip().upper(),
            bundle_id=str(payload.get("bundle_id", "")).strip(),
            chat_id=str(payload.get("chat_id", "")).strip(),
            capability_id=str(payload.get("capability_id", "")).strip(),
            command_label=str(payload.get("command_label", "")).strip(),
            normalized_input=dict(normalized_input) if isinstance(normalized_input, dict) else {},
            context_payload=dict(context_payload) if isinstance(context_payload, dict) else {},
            result_payload=dict(result_payload) if isinstance(result_payload, dict) else {},
            provenance_payload=dict(provenance_payload) if isinstance(provenance_payload, dict) else {},
            tags=tuple(str(item).strip() for item in tags or () if str(item).strip()),
            artifact_refs=tuple(str(item).strip() for item in artifact_refs or () if str(item).strip()),
        )