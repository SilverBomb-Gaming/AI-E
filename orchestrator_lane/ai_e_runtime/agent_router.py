from __future__ import annotations

import subprocess
from pathlib import Path
from time import sleep
from typing import Any, Callable, Dict

from .level_0001_entity_transform_mutation import run_level_0001_entity_transform_mutation
from .level_0001_grass_mutation import run_level_0001_grass_mutation
from orchestrator.entity_runner import run_monitored_powershell_step


AgentCallable = Callable[[Dict[str, Any]], Dict[str, Any]]


class AgentRouter:
    """Unified runtime entrypoint for minimal continuous-session agent execution."""

    def __init__(self) -> None:
        self._stop_requested: Callable[[], bool] = lambda: False
        self._stop_reason: Callable[[], str | None] = lambda: None
        self._agents: Dict[str, AgentCallable] = {
            "copilot_coder_agent": self._run_copilot_coder_agent,
            "read_only_inspector_agent": self._run_read_only_inspector_agent,
            "external_process_agent": self._run_external_process_agent,
            "level_0001_grass_mutation_agent": run_level_0001_grass_mutation,
            "level_0001_entity_transform_mutation_agent": run_level_0001_entity_transform_mutation,
            "validator_agent": self._run_validator_agent,
            "unity_control_agent": self._run_unity_control_agent,
            "artifact_summarizer_agent": self._run_artifact_summarizer_agent,
        }

    def configure_runtime_controls(
        self,
        *,
        stop_requested: Callable[[], bool] | None = None,
        stop_reason: Callable[[], str | None] | None = None,
    ) -> None:
        if stop_requested is not None:
            self._stop_requested = stop_requested
        if stop_reason is not None:
            self._stop_reason = stop_reason

    def register(self, agent_type: str, runner: AgentCallable) -> None:
        self._agents[str(agent_type)] = runner

    def run(self, task: Dict[str, Any]) -> Dict[str, Any]:
        agent_type = self.resolve_agent_type(task)
        runner = self._agents.get(agent_type)
        if runner is None:
            raise KeyError(f"Unsupported agent type: {agent_type}")
        result = runner(dict(task))
        result.setdefault("agent_type", agent_type)
        return result

    def validate(self, result: Dict[str, Any], *, task: Dict[str, Any] | None = None) -> Dict[str, Any]:
        validator_task = {
            "agent_type": "validator_agent",
            "result": dict(result),
            "task": dict(task or {}),
        }
        return self.run(validator_task)

    def resolve_agent_type(self, task: Dict[str, Any]) -> str:
        explicit = task.get("agent_type")
        if explicit:
            return str(explicit)
        agents = task.get("agents")
        if isinstance(agents, list):
            for entry in agents:
                candidate = str(entry)
                if candidate in self._agents:
                    return candidate
        if task.get("contract_type") == "read_only_capability":
            return "read_only_inspector_agent"
        return "copilot_coder_agent"

    def _run_copilot_coder_agent(self, task: Dict[str, Any]) -> Dict[str, Any]:
        self._sleep_if_requested(task)
        outcome = str(task.get("simulated_outcome", "completed"))
        title = task.get("title") or task.get("task_id") or task.get("id") or "task"
        payload = dict(task.get("result_payload") or {})
        if outcome == "blocked":
            return {
                "status": "blocked",
                "summary": f"copilot_coder_agent blocked {title}",
                "details": payload,
                "error": str(task.get("error") or "Task was blocked by agent logic."),
            }
        if outcome in {"retryable_failure", "failed", "retryable"}:
            return {
                "status": "retryable_failure",
                "summary": f"copilot_coder_agent needs retry for {title}",
                "details": payload,
                "error": str(task.get("error") or "Retryable failure requested by task payload."),
                "retryable": True,
            }
        return {
            "status": "completed",
            "summary": f"copilot_coder_agent completed {title}",
            "details": payload,
            "artifacts": list(task.get("artifacts") or []),
        }

    def _run_read_only_inspector_agent(self, task: Dict[str, Any]) -> Dict[str, Any]:
        self._sleep_if_requested(task)
        title = task.get("title") or task.get("task_id") or task.get("id") or "task"
        return {
            "status": "completed",
            "summary": f"read_only_inspector_agent inspected {title}",
            "details": dict(task.get("result_payload") or {}),
            "artifacts": list(task.get("artifacts") or []),
        }

    def _run_external_process_agent(self, task: Dict[str, Any]) -> Dict[str, Any]:
        title = task.get("title") or task.get("task_id") or task.get("id") or "task"
        command = task.get("external_command")
        if not isinstance(command, list) or not command:
            return {
                "status": "blocked",
                "summary": f"external_process_agent blocked {title}",
                "error": "external_process_agent requires non-empty external_command list.",
            }

        normalized_command = [str(part) for part in command]
        working_directory = task.get("external_working_directory")
        cwd = Path(str(working_directory)) if working_directory else None
        if cwd is not None and not cwd.exists():
            return {
                "status": "blocked",
                "summary": f"external_process_agent blocked {title}",
                "error": f"external working directory does not exist: {cwd}",
            }

        stdout_path = self._optional_output_path(task.get("external_stdout_path"))
        stderr_path = self._optional_output_path(task.get("external_stderr_path"))
        poll_interval = self._poll_interval_seconds(task)

        return self._run_monitored_process(
            title=title,
            command=normalized_command,
            cwd=cwd,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            poll_interval=poll_interval,
            interrupted_status="interrupted_external_process",
            interrupted_summary=f"external_process_agent interrupted {title}",
            failure_summary=f"external_process_agent failed {title}",
            completed_summary=f"external_process_agent completed {title}",
        )

    def _run_validator_agent(self, task: Dict[str, Any]) -> Dict[str, Any]:
        result = dict(task.get("result") or {})
        result_status = str(result.get("status", "completed"))
        error = str(result.get("error") or "").strip()
        if result_status == "completed":
            return {
                "status": "completed",
                "validation_state": "passed",
                "queue_action": "complete",
                "note": str(result.get("summary") or "Validation passed."),
            }
        if result_status == "retryable_failure":
            return {
                "status": "retryable_failure",
                "validation_state": "retryable_failure",
                "queue_action": "retry",
                "note": error or "Validation requested a retry.",
            }
        return {
            "status": "blocked",
            "validation_state": "blocked",
            "queue_action": "block",
            "note": error or "Validation blocked the task.",
        }

    def _run_unity_control_agent(self, task: Dict[str, Any]) -> Dict[str, Any]:
        title = task.get("title") or task.get("task_id") or task.get("id") or "task"
        script_path_value = task.get("unity_control_script") or task.get("unity_script_path")
        if not script_path_value:
            return {
                "status": "blocked",
                "summary": f"unity_control_agent blocked {title}",
                "error": "unity_control_agent requires unity_control_script.",
            }

        script_path = Path(str(script_path_value))
        if not script_path.exists():
            return {
                "status": "blocked",
                "summary": f"unity_control_agent blocked {title}",
                "error": f"unity control script does not exist: {script_path}",
            }

        raw_arguments = task.get("unity_control_args") or task.get("unity_arguments") or []
        if not isinstance(raw_arguments, list):
            return {
                "status": "blocked",
                "summary": f"unity_control_agent blocked {title}",
                "error": "unity_control_agent requires unity_control_args as a list when provided.",
            }

        working_directory = task.get("unity_working_directory") or task.get("target_repo") or task.get("project_path")
        cwd = Path(str(working_directory)) if working_directory else None
        if cwd is not None and not cwd.exists():
            return {
                "status": "blocked",
                "summary": f"unity_control_agent blocked {title}",
                "error": f"unity working directory does not exist: {cwd}",
            }

        stdout_path = self._optional_output_path(task.get("unity_stdout_path") or task.get("external_stdout_path"))
        stderr_path = self._optional_output_path(task.get("unity_stderr_path") or task.get("external_stderr_path"))
        poll_interval = self._poll_interval_seconds(task, key="unity_poll_interval_seconds")
        raw_environment = task.get("unity_environment") or task.get("unity_env") or {}
        if raw_environment is None:
            raw_environment = {}
        if not isinstance(raw_environment, dict):
            return {
                "status": "blocked",
                "summary": f"unity_control_agent blocked {title}",
                "error": "unity_control_agent requires unity_environment as an object when provided.",
            }
        command_result, returncode = run_monitored_powershell_step(
            name=str(task.get("unity_step_name") or title),
            script_path=script_path,
            arguments=[str(item) for item in raw_arguments],
            cwd=cwd or Path.cwd(),
            logs_dir=(stdout_path.parent if stdout_path is not None else (stderr_path.parent if stderr_path is not None else Path.cwd())),
            timeout=int(task.get("unity_timeout_seconds", task.get("timeout_seconds", 900)) or 900),
            command_type=str(task.get("unity_command_type") or "test"),
            stop_requested=self._stop_requested,
            stop_reason=self._stop_reason,
            poll_interval_seconds=poll_interval,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            environment={str(key): str(value) for key, value in raw_environment.items()},
        )
        details = dict(command_result)
        details["unity_script_path"] = str(script_path)
        if command_result.get("interrupted"):
            return {
                "status": "interrupted_unity_process",
                "summary": f"unity_control_agent interrupted {title}",
                "details": details,
            }
        if command_result.get("timed_out"):
            timeout_seconds = int(task.get("unity_timeout_seconds", task.get("timeout_seconds", 900)) or 900)
            return {
                "status": "timed_out_unity_process",
                "summary": f"unity_control_agent timed out {title}",
                "error": f"Unity/tool runner timed out after {timeout_seconds} seconds.",
                "details": details,
            }
        if self._unity_launcher_timed_out(command_result):
            timeout_seconds = int(task.get("unity_timeout_seconds", task.get("timeout_seconds", 900)) or 900)
            details["timed_out"] = True
            details["returncode"] = -1
            return {
                "status": "timed_out_unity_process",
                "summary": f"unity_control_agent timed out {title}",
                "error": f"Unity/tool runner timed out after {timeout_seconds} seconds.",
                "details": details,
            }
        unity_exit_code = str(command_result.get("unity_exit_code") or "")
        retry_on_failure = bool(task.get("unity_retry_on_failure") or task.get("unity_retry_on_unexpected_exit"))
        if returncode not in {0, None} or unity_exit_code not in {"0", ""}:
            failure_error = (
                f"Unity wrapper reported exit code {unity_exit_code}."
                if unity_exit_code not in {"", "0"}
                else f"Unity/tool runner exited with code {returncode}."
            )
            if retry_on_failure:
                return {
                    "status": "retryable_failure",
                    "summary": f"unity_control_agent needs retry for {title}",
                    "error": failure_error,
                    "details": details,
                    "retryable": True,
                }
            return {
                "status": "blocked",
                "summary": f"unity_control_agent failed {title}",
                "error": failure_error,
                "details": details,
            }
        return {
            "status": "completed",
            "summary": f"unity_control_agent completed {title}",
            "details": details,
        }

    def _unity_launcher_timed_out(self, command_result: Dict[str, Any]) -> bool:
        timeout_markers = (
            "unity process exceeded timeout",
            "unity/tool runner timed out after",
        )
        for key in ("stdout_log", "stderr_log"):
            path_value = command_result.get(key)
            if not path_value:
                continue
            path = Path(str(path_value))
            if not path.exists():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace").lower()
            except OSError:
                continue
            if any(marker in text for marker in timeout_markers):
                return True
        return False

    def _run_artifact_summarizer_agent(self, task: Dict[str, Any]) -> Dict[str, Any]:
        artifacts = list(task.get("artifacts") or [])
        return {
            "status": "completed",
            "summary": f"artifact_summarizer_agent processed {len(artifacts)} artifacts",
            "details": {"artifact_count": len(artifacts)},
            "artifacts": artifacts,
        }

    def _sleep_if_requested(self, task: Dict[str, Any]) -> None:
        try:
            delay_seconds = float(task.get("simulated_delay_seconds", 0) or 0)
        except (TypeError, ValueError):
            delay_seconds = 0.0
        if delay_seconds > 0:
            sleep(delay_seconds)

    def _optional_output_path(self, value: Any) -> Path | None:
        if not value:
            return None
        path = Path(str(value))
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _write_output(self, path: Path | None, text: str) -> None:
        if path is None:
            return
        path.write_text(text, encoding="utf-8")

    def _poll_interval_seconds(self, task: Dict[str, Any], *, key: str = "external_poll_interval_seconds") -> float:
        try:
            poll_interval = float(task.get(key, 0.05) or 0.05)
        except (TypeError, ValueError):
            poll_interval = 0.05
        return max(0.01, poll_interval)

    def _run_monitored_process(
        self,
        *,
        title: str,
        command: list[str],
        cwd: Path | None,
        stdout_path: Path | None,
        stderr_path: Path | None,
        poll_interval: float,
        interrupted_status: str,
        interrupted_summary: str,
        failure_summary: str,
        completed_summary: str,
        details_extra: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        try:
            process = subprocess.Popen(
                command,
                cwd=str(cwd) if cwd is not None else None,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except OSError as exc:
            return {
                "status": "blocked",
                "summary": failure_summary.replace("failed", "failed to start"),
                "error": str(exc),
                "details": {
                    "command": command,
                    "working_directory": str(cwd) if cwd is not None else None,
                    **dict(details_extra or {}),
                },
            }

        interrupted = False
        while process.poll() is None:
            if self._stop_requested():
                interrupted = True
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                break
            sleep(poll_interval)

        stdout_text, stderr_text = process.communicate()
        self._write_output(stdout_path, stdout_text or "")
        self._write_output(stderr_path, stderr_text or "")

        details = {
            "command": command,
            "working_directory": str(cwd) if cwd is not None else None,
            "returncode": process.returncode,
            "stdout_path": str(stdout_path) if stdout_path is not None else None,
            "stderr_path": str(stderr_path) if stderr_path is not None else None,
            **dict(details_extra or {}),
        }
        if interrupted:
            details["interrupted"] = True
            details["interrupt_reason"] = self._stop_reason() or "operator_interrupt"
            return {
                "status": interrupted_status,
                "summary": interrupted_summary,
                "details": details,
            }
        if process.returncode not in {0, None}:
            return {
                "status": "blocked",
                "summary": failure_summary,
                "error": f"Command exited with code {process.returncode}.",
                "details": details,
            }
        return {
            "status": "completed",
            "summary": completed_summary,
            "details": details,
        }

