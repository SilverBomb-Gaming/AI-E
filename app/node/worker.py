"""Shared-directory worker for bounded node dispatch jobs."""
from __future__ import annotations

import argparse
from datetime import datetime
import time

from ..controller.execution_models import LocalCommandExecutionRequest
from ..controller.execution_runner import ExecutionRunner, ExecutionRunnerError
from ..controller.node_config import NodeConfigStore
from ..controller.node_dispatcher import NodeDispatcher
from ..controller.node_models import NodeDispatchRecord, NodeDescriptor
from ..controller.node_registry import NodeRegistry
from ..controller.profile_store import ControllerConfigStore


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


class NodeWorker:
    def __init__(
        self,
        *,
        controller_config_store: ControllerConfigStore | None = None,
        node_config_store: NodeConfigStore | None = None,
        execution_runner: ExecutionRunner | None = None,
    ) -> None:
        self._controller_store = controller_config_store or ControllerConfigStore()
        self._node_store = node_config_store or NodeConfigStore()
        self._execution_runner = execution_runner or ExecutionRunner()
        self._controller_config = self._controller_store.load()
        self._node_config = self._node_store.load()
        self._registry = NodeRegistry(
            local_node=NodeRegistry.build_configured_local_node(
                controller_config=self._controller_config,
                node_config=self._node_config,
                now_iso=_now_iso(),
                transport_mode="shared_directory",
            ),
            registry_root=self._node_config.registry_root,
            stale_after_seconds=self._node_config.stale_after_seconds,
        )
        self._dispatcher = NodeDispatcher(registry_root=self._node_config.registry_root)
        self._registry.update_local_node(status="online", current_job_id="", last_job_status="idle", last_seen_at=_now_iso())

    def run_once(self) -> NodeDispatchRecord | None:
        node = self._registry.local_node()
        if not self._node_config.enabled:
            self._registry.update_local_node(status="disabled", last_seen_at=_now_iso())
            return None
        self._registry.update_local_node(status="online", last_seen_at=_now_iso(), current_job_id="")
        job = self._dispatcher.claim_next_job(node=node, now_iso=_now_iso())
        if job is None:
            return None
        self._registry.update_local_node(status="busy", current_job_id=job.job_id, last_seen_at=_now_iso(), last_job_id=job.job_id, last_job_status="running")
        try:
            request = self._request_from_payload(job.execution_payload)
            if job.requested_command_label not in self._node_config.declared_capabilities:
                failure = f"Node role {node.role} does not declare {job.requested_command_label}."
                self._dispatcher.refuse_job(job_id=job.job_id, failure_reason=failure, finished_at=_now_iso())
                self._registry.update_local_node(status="online", current_job_id="", last_job_id=job.job_id, last_job_status="refused", last_result_summary=failure, last_seen_at=_now_iso())
                return self._dispatcher.get_job(job.job_id)
            result = self._execution_runner.execute(request)
            status = "completed" if not result.timed_out and result.exit_code == 0 else "failed"
            summary = result.output_summary if status == "completed" else (result.first_issue or result.output_summary)
            if status == "completed":
                self._dispatcher.complete_job(job_id=job.job_id, result_summary=summary, finished_at=result.completed_at or _now_iso())
            else:
                self._dispatcher.fail_job(job_id=job.job_id, failure_reason=summary, finished_at=result.completed_at or _now_iso())
            self._registry.update_local_node(
                status="online",
                current_job_id="",
                last_job_id=job.job_id,
                last_job_status=status,
                last_result_summary=summary,
                last_seen_at=_now_iso(),
            )
            return self._dispatcher.get_job(job.job_id)
        except (ExecutionRunnerError, ValueError) as exc:
            message = str(exc).strip() or "Node worker failed to execute the queued job."
            self._dispatcher.fail_job(job_id=job.job_id, failure_reason=message, finished_at=_now_iso())
            self._registry.update_local_node(status="online", current_job_id="", last_job_id=job.job_id, last_job_status="failed", last_result_summary=message, last_seen_at=_now_iso())
            return self._dispatcher.get_job(job.job_id)

    def run_loop(self) -> None:
        while True:
            self.run_once()
            time.sleep(max(1, int(self._node_config.heartbeat_interval_seconds)))

    @staticmethod
    def _request_from_payload(payload: dict[str, object]) -> LocalCommandExecutionRequest:
        argv = payload.get("argv")
        return LocalCommandExecutionRequest(
            capability_id=str(payload.get("capability_id", "")).strip(),
            command_kind=str(payload.get("command_kind", "run")).strip(),  # type: ignore[arg-type]
            command_family=str(payload.get("command_family", "generic")).strip(),  # type: ignore[arg-type]
            command_text=str(payload.get("command_text", "")).strip(),
            command_summary=str(payload.get("command_summary", "")).strip(),
            working_directory=str(payload.get("working_directory", "")).strip(),
            timeout_seconds=float(payload.get("timeout_seconds", 20.0) or 20.0),
            operator_reason=str(payload.get("operator_reason", "")).strip(),
            expected_scope=str(payload.get("expected_scope", "")).strip(),
            argv=tuple(str(item) for item in (argv or ()) if str(item)),
        )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the bounded AI-E node worker.")
    parser.add_argument("--config-dir", default="", help="Directory containing controller_config.json and node_config.json.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued job, then exit.")
    parser.add_argument("--loop", action="store_true", help="Process jobs continuously.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    config_dir = None
    if args.config_dir:
        from pathlib import Path

        config_dir = Path(args.config_dir).resolve()
    worker = NodeWorker(
        controller_config_store=ControllerConfigStore(config_path=(config_dir / "controller_config.json") if config_dir else None),
        node_config_store=NodeConfigStore(config_path=(config_dir / "node_config.json") if config_dir else None),
    )
    if args.loop:
        worker.run_loop()
        return 0
    worker.run_once()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())