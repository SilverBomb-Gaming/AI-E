"""Node-aware router for bounded confirmed command execution."""
from __future__ import annotations

from datetime import datetime

from .execution_models import LocalCommandExecutionRequest
from .execution_runner import ExecutionRunner
from .node_models import NodeCommandExecutionResult, NodeDescriptor


class NodeRoutingError(RuntimeError):
    """Structured node-routing failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class NodeRouter:
    """Route bounded command execution to the selected local or simulated node."""

    def __init__(self, execution_runner: ExecutionRunner) -> None:
        self._execution_runner = execution_runner

    def execute(self, *, node: NodeDescriptor, request: LocalCommandExecutionRequest) -> NodeCommandExecutionResult:
        if not node.supports_bounded_execution:
            raise NodeRoutingError("node_execution_unavailable", f"Node {node.node_id} does not accept bounded execution.")
        if node.status != "online":
            raise NodeRoutingError("node_not_online", f"Node {node.node_id} is {node.status} and cannot execute requests.")
        if node.node_type == "local":
            return self._execute_local(node=node, request=request)
        if node.node_type == "mock":
            return self._execute_mock(node=node, request=request)
        raise NodeRoutingError("node_type_unsupported", f"Node {node.node_id} has an unsupported execution type.")

    def _execute_local(self, *, node: NodeDescriptor, request: LocalCommandExecutionRequest) -> NodeCommandExecutionResult:
        result = self._execution_runner.execute(request)
        return NodeCommandExecutionResult(
            node=node,
            request=result.request,
            exit_code=result.exit_code,
            stdout=result.stdout,
            stderr=result.stderr,
            timed_out=result.timed_out,
            duration_ms=result.duration_ms,
            output_summary=result.output_summary,
            first_issue=result.first_issue,
            completed_at=result.completed_at,
        )

    def _execute_mock(self, *, node: NodeDescriptor, request: LocalCommandExecutionRequest) -> NodeCommandExecutionResult:
        metadata = node.metadata
        timed_out = bool(metadata.get("mock_timeout", False))
        exit_code = -1 if timed_out else int(metadata.get("mock_exit_code", 0))
        output_summary = str(
            metadata.get("mock_output_summary")
            or f"Mock node {node.display_name} simulated {request.command_kind}: {request.command_summary}"
        ).strip()
        first_issue = str(metadata.get("mock_first_issue") or "").strip()
        stdout = str(metadata.get("mock_stdout") or output_summary).strip()
        stderr = str(metadata.get("mock_stderr") or "").strip()
        completed_at = str(metadata.get("mock_completed_at") or datetime.now().astimezone().isoformat(timespec="seconds")).strip()
        duration_ms = max(0, int(metadata.get("mock_duration_ms", 5)))
        return NodeCommandExecutionResult(
            node=node,
            request=request,
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            timed_out=timed_out,
            duration_ms=duration_ms,
            output_summary=output_summary,
            first_issue=first_issue,
            completed_at=completed_at,
        )