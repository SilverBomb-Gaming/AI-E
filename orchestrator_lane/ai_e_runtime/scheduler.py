from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

from .time_utils import get_current_timestamp
from orchestrator.utils import ensure_dir, read_json_with_status_details, write_json


class Scheduler:
    """Persistent queue reader/writer for continuous runtime sessions."""

    def __init__(self, queue_path: Path, *, max_retries: int = 3) -> None:
        self.queue_path = Path(queue_path)
        self.max_retries = max(1, int(max_retries))
        self._last_load_issue: str | None = None
        self._last_load_issue_details: List[str] = []
        self._last_sanitization_details: List[str] = []
        ensure_dir(self.queue_path.parent)
        if not self.queue_path.exists():
            write_json(self.queue_path, {"tasks": []})

    def last_load_issue(self) -> str | None:
        return self._last_load_issue

    def last_load_issue_details(self) -> List[str]:
        return list(self._last_load_issue_details)

    def last_sanitization_details(self) -> List[str]:
        return list(self._last_sanitization_details)

    def get_next_task(self) -> Dict[str, Any] | None:
        tasks, _ = self._load_tasks()
        completed_ids = {
            self._task_id(task)
            for task in tasks
            if str(task.get("status", "pending")).lower() == "completed"
        }
        pending = [
            task
            for task in tasks
            if str(task.get("status", "pending")).lower() == "pending"
            and self._dependencies_satisfied(task, completed_ids)
        ]
        if not pending:
            return None
        pending.sort(key=self._sort_key)
        return dict(pending[0])

    def all_tasks(self) -> List[Dict[str, Any]]:
        tasks, _ = self._load_tasks()
        return [dict(task) for task in tasks]

    def remaining_count(self) -> int:
        tasks, _ = self._load_tasks()
        done = {"completed", "blocked"}
        return sum(1 for task in tasks if str(task.get("status", "pending")).lower() not in done)

    def pending_count(self) -> int:
        tasks, _ = self._load_tasks()
        return sum(1 for task in tasks if str(task.get("status", "pending")).lower() == "pending")

    def recover_running_tasks(self, session_id: str) -> List[str]:
        tasks, shape = self._load_tasks()
        recovered: List[str] = []
        for task in tasks:
            if str(task.get("status", "")).lower() != "running":
                continue
            if str(task.get("current_session_id") or "") != session_id:
                continue
            task["status"] = "pending"
            task["current_session_id"] = None
            task["last_error"] = "Recovered interrupted running task for supervisor resume."
            recovered.append(self._task_id(task))
        if recovered:
            self._write_tasks(tasks, shape)
        return recovered

    def mark_running(self, task_id: str, *, session_id: str) -> Dict[str, Any]:
        tasks, shape = self._load_tasks()
        task = self._find_task(tasks, task_id)
        task["status"] = "running"
        task["current_session_id"] = session_id
        task["last_attempt_timestamp"] = self._iso_now()
        self._write_tasks(tasks, shape)
        return dict(task)

    def mark_completed(
        self,
        task_id: str,
        *,
        session_id: str,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        tasks, shape = self._load_tasks()
        task = self._find_task(tasks, task_id)
        task["status"] = "completed"
        task["current_session_id"] = None
        task["last_session_id"] = session_id
        task["completed_timestamp"] = self._iso_now()
        task["last_error"] = ""
        task["last_result_status"] = result.get("status", "completed")
        self._write_tasks(tasks, shape)
        return dict(task)

    def mark_blocked(
        self,
        task_id: str,
        *,
        session_id: str,
        reason: str,
        result: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        tasks, shape = self._load_tasks()
        task = self._find_task(tasks, task_id)
        task["status"] = "blocked"
        task["current_session_id"] = None
        task["last_session_id"] = session_id
        task["blocked_timestamp"] = self._iso_now()
        task["last_error"] = reason
        if result is not None:
            task["last_result_status"] = result.get("status", "blocked")
        self._write_tasks(tasks, shape)
        return dict(task)

    def requeue_failed(
        self,
        task_id: str,
        *,
        session_id: str,
        reason: str,
        result: Dict[str, Any] | None = None,
    ) -> Tuple[Dict[str, Any], bool]:
        tasks, shape = self._load_tasks()
        task = self._find_task(tasks, task_id)
        retries = int(task.get("retry_count", 0)) + 1
        task["retry_count"] = retries
        task["current_session_id"] = None
        task["last_session_id"] = session_id
        task["last_error"] = reason
        task["last_retry_timestamp"] = self._iso_now()
        if result is not None:
            task["last_result_status"] = result.get("status", "retryable_failure")
        should_retry = retries < self.max_retries
        task["status"] = "pending" if should_retry else "blocked"
        self._write_tasks(tasks, shape)
        return dict(task), should_retry

    def _load_tasks(self) -> Tuple[List[Dict[str, Any]], str]:
        raw, issue, read_details = read_json_with_status_details(self.queue_path, default={"tasks": []})
        issue_details: List[str] = list(read_details)
        if isinstance(raw, list):
            tasks = raw
            shape = "list"
        elif isinstance(raw, dict):
            nested = raw.get("tasks", [])
            if nested is None:
                issue = issue or "invalid_shape"
                issue_details.append("tasks_null")
                nested = []
            if not isinstance(nested, list):
                issue = issue or "invalid_shape"
                issue_details.append("tasks_not_list")
                tasks = []
            else:
                tasks = nested
            shape = "dict"
        else:
            issue = issue or "invalid_shape"
            issue_details.append("root_not_list_or_object")
            tasks = []
            shape = "dict"
        normalized: List[Dict[str, Any]] = []
        sanitization_details: List[str] = []
        for index, task in enumerate(tasks):
            if not isinstance(task, dict):
                issue = issue or "invalid_shape"
                issue_details.append(f"task_entry_not_object:{index}")
                continue
            normalized_task, task_details = self._normalize_task(task, index=index)
            sanitization_details.extend(task_details)
            if not self._has_task_id(normalized_task):
                issue = issue or "invalid_shape"
                issue_details.append(f"task_missing_identifier:{index}")
                continue
            normalized.append(normalized_task)
        self._last_load_issue = issue if issue not in {None, "missing"} else None
        self._last_load_issue_details = issue_details if self._last_load_issue is not None else []
        self._last_sanitization_details = sorted(dict.fromkeys(sanitization_details))
        return normalized, shape

    def _write_tasks(self, tasks: List[Dict[str, Any]], shape: str) -> None:
        payload: Any = tasks if shape == "list" else {"tasks": tasks}
        write_json(self.queue_path, payload)

    def _normalize_task(self, task: Dict[str, Any], *, index: int) -> Tuple[Dict[str, Any], List[str]]:
        normalized = dict(task)
        details: List[str] = []

        status = normalized.get("status", "pending")
        if isinstance(status, str):
            normalized["status"] = status.lower()
        else:
            normalized["status"] = "pending"
            details.append(f"task_invalid_status:{index}")

        priority, priority_issue = self._coerce_int(normalized.get("priority"), default=1000)
        normalized["priority"] = priority
        if priority_issue:
            details.append(f"task_invalid_priority:{index}")

        retry_count, retry_issue = self._coerce_int(normalized.get("retry_count"), default=0)
        normalized["retry_count"] = max(0, retry_count)
        if retry_issue:
            details.append(f"task_invalid_retry_count:{index}")

        plan_step_index, plan_step_index_issue = self._coerce_int(normalized.get("plan_step_index"), default=0)
        normalized["plan_step_index"] = max(0, plan_step_index)
        if plan_step_index_issue:
            details.append(f"task_invalid_plan_step_index:{index}")

        trust_score, trust_score_issue = self._coerce_int(normalized.get("trust_score"), default=0)
        normalized["trust_score"] = trust_score
        if trust_score_issue:
            details.append(f"task_invalid_trust_score:{index}")

        dependencies, dependencies_issue = self._normalize_string_list(normalized.get("dependencies"))
        normalized["dependencies"] = dependencies
        if dependencies_issue:
            details.append(f"task_invalid_dependencies:{index}")

        current_session_id = normalized.get("current_session_id")
        if current_session_id is not None and isinstance(current_session_id, (dict, list, tuple, set)):
            normalized["current_session_id"] = None
            details.append(f"task_invalid_current_session_id:{index}")

        if "approval_required" in normalized:
            approval_required, approval_required_issue = self._coerce_bool(normalized.get("approval_required"), default=True)
            normalized["approval_required"] = approval_required
            if approval_required_issue:
                details.append(f"task_invalid_approval_required:{index}")

        if "auto_execution_enabled" in normalized:
            auto_execution_enabled, auto_execution_enabled_issue = self._coerce_bool(
                normalized.get("auto_execution_enabled"),
                default=False,
            )
            normalized["auto_execution_enabled"] = auto_execution_enabled
            if auto_execution_enabled_issue:
                details.append(f"task_invalid_auto_execution_enabled:{index}")

        if "rating_locked" in normalized:
            rating_locked, rating_locked_issue = self._coerce_bool(normalized.get("rating_locked"), default=True)
            normalized["rating_locked"] = rating_locked
            if rating_locked_issue:
                details.append(f"task_invalid_rating_locked:{index}")

        if "decision_auto_execute" in normalized:
            decision_auto_execute, decision_auto_execute_issue = self._coerce_bool(
                normalized.get("decision_auto_execute"),
                default=False,
            )
            normalized["decision_auto_execute"] = decision_auto_execute
            if decision_auto_execute_issue:
                details.append(f"task_invalid_decision_auto_execute:{index}")

        if "sandbox_verified" in normalized:
            sandbox_verified, sandbox_verified_issue = self._coerce_bool(normalized.get("sandbox_verified"), default=False)
            normalized["sandbox_verified"] = sandbox_verified
            if sandbox_verified_issue:
                details.append(f"task_invalid_sandbox_verified:{index}")

        if "real_target_verified" in normalized:
            real_target_verified, real_target_verified_issue = self._coerce_bool(
                normalized.get("real_target_verified"),
                default=False,
            )
            normalized["real_target_verified"] = real_target_verified
            if real_target_verified_issue:
                details.append(f"task_invalid_real_target_verified:{index}")

        if "rollback_verified" in normalized:
            rollback_verified, rollback_verified_issue = self._coerce_bool(normalized.get("rollback_verified"), default=False)
            normalized["rollback_verified"] = rollback_verified
            if rollback_verified_issue:
                details.append(f"task_invalid_rollback_verified:{index}")

        if "missing_evidence" in normalized:
            missing_evidence, missing_evidence_issue = self._normalize_string_list(normalized.get("missing_evidence"))
            normalized["missing_evidence"] = missing_evidence
            if missing_evidence_issue:
                details.append(f"task_invalid_missing_evidence:{index}")

        if "requested_content_dimensions" in normalized:
            requested_content_dimensions, requested_content_dimensions_issue = self._normalize_scalar_dict(
                normalized.get("requested_content_dimensions")
            )
            normalized["requested_content_dimensions"] = requested_content_dimensions
            if requested_content_dimensions_issue:
                details.append(f"task_invalid_requested_content_dimensions:{index}")

        if "execution_lane" in normalized:
            execution_lane, execution_lane_issue = self._normalize_optional_string(
                normalized.get("execution_lane"),
                default="approval_required_mutation",
            )
            normalized["execution_lane"] = execution_lane
            if execution_lane_issue:
                details.append(f"task_invalid_execution_lane:{index}")

        if "plan_id" in normalized:
            plan_id, plan_id_issue = self._normalize_optional_string(normalized.get("plan_id"), default=None)
            normalized["plan_id"] = plan_id
            if plan_id_issue:
                details.append(f"task_invalid_plan_id:{index}")

        if "plan_step_title" in normalized:
            plan_step_title, plan_step_title_issue = self._normalize_optional_string(
                normalized.get("plan_step_title"),
                default=None,
            )
            normalized["plan_step_title"] = plan_step_title
            if plan_step_title_issue:
                details.append(f"task_invalid_plan_step_title:{index}")

        if "content_policy_decision" in normalized:
            content_policy_decision, content_policy_decision_issue = self._normalize_optional_string(
                normalized.get("content_policy_decision"),
                default="requires_review",
            )
            normalized["content_policy_decision"] = content_policy_decision
            if content_policy_decision_issue:
                details.append(f"task_invalid_content_policy_decision:{index}")

        if "decision_summary" in normalized:
            decision_summary, decision_summary_issue = self._normalize_optional_string(
                normalized.get("decision_summary"),
                default=None,
            )
            normalized["decision_summary"] = decision_summary
            if decision_summary_issue:
                details.append(f"task_invalid_decision_summary:{index}")

        if "content_policy_summary" in normalized:
            content_policy_summary, content_policy_summary_issue = self._normalize_optional_string(
                normalized.get("content_policy_summary"),
                default=None,
            )
            normalized["content_policy_summary"] = content_policy_summary
            if content_policy_summary_issue:
                details.append(f"task_invalid_content_policy_summary:{index}")

        if "approval_boundary" in normalized:
            approval_boundary, approval_boundary_details = self._normalize_approval_boundary(
                normalized.get("approval_boundary"),
                index=index,
            )
            normalized["approval_boundary"] = approval_boundary
            details.extend(approval_boundary_details)
            if "approval_required" not in normalized:
                normalized["approval_required"] = approval_boundary["approval_required"]
            if "approval_state" not in normalized and approval_boundary["blocked_until_approved"]:
                normalized["approval_state"] = "awaiting_approval"

        if "failure_classification" in normalized:
            failure_classification, failure_classification_details = self._normalize_failure_classification(
                normalized.get("failure_classification"),
                index=index,
            )
            normalized["failure_classification"] = failure_classification
            details.extend(failure_classification_details)

        if "policy_payload" in normalized:
            policy_payload, policy_payload_details = self._normalize_policy_payload(
                normalized.get("policy_payload"),
                index=index,
            )
            normalized["policy_payload"] = policy_payload
            details.extend(policy_payload_details)
            if "content_policy_decision" not in normalized:
                normalized["content_policy_decision"] = self._policy_payload_decision(policy_payload)
            if "content_policy_block" not in normalized:
                normalized["content_policy_block"] = self._policy_payload_is_blocking(policy_payload)

        return normalized, details

    def _coerce_int(self, value: Any, *, default: int) -> Tuple[int, bool]:
        if value is None:
            return default, False
        try:
            return int(value), False
        except (TypeError, ValueError):
            return default, True

    def _coerce_bool(self, value: Any, *, default: bool) -> Tuple[bool, bool]:
        if value is None:
            return default, False
        if isinstance(value, bool):
            return value, False
        return default, True

    def _coerce_float(self, value: Any, *, default: float) -> Tuple[float, bool]:
        if value is None:
            return default, False
        try:
            return float(value), False
        except (TypeError, ValueError):
            return default, True

    def _normalize_string_list(self, value: Any) -> Tuple[List[str], bool]:
        if value is None:
            return [], False
        if not isinstance(value, list):
            return [], True
        normalized = [str(item) for item in value if item is not None and not isinstance(item, (dict, list, tuple, set))]
        return normalized, len(normalized) != len(value)

    def _normalize_scalar_dict(self, value: Any) -> Tuple[Dict[str, Any], bool]:
        if value is None:
            return {}, False
        if not isinstance(value, dict):
            return {}, True
        normalized: Dict[str, Any] = {}
        changed = False
        for key, item in value.items():
            if isinstance(item, (dict, list, tuple, set)):
                changed = True
                continue
            normalized[str(key)] = item
        return normalized, changed

    def _normalize_optional_string(self, value: Any, *, default: str | None) -> Tuple[str | None, bool]:
        if value is None:
            return default, False
        if isinstance(value, (dict, list, tuple, set)):
            return default, True
        return str(value), False

    def _normalize_approval_boundary(self, value: Any, *, index: int) -> Tuple[Dict[str, Any], List[str]]:
        default_reason = "Malformed approval boundary metadata requires review."
        if not isinstance(value, dict):
            return {
                "approval_required": True,
                "approval_reason": default_reason,
                "blocked_until_approved": False,
            }, [f"task_invalid_approval_boundary:{index}"]

        details: List[str] = []
        approval_required_issue = "approval_required" not in value
        approval_required, approval_required_shape_issue = self._coerce_bool(value.get("approval_required"), default=True)
        if approval_required_issue or approval_required_shape_issue:
            details.append(f"task_invalid_approval_boundary_approval_required:{index}")

        blocked_issue = "blocked_until_approved" not in value
        blocked_until_approved, blocked_shape_issue = self._coerce_bool(value.get("blocked_until_approved"), default=False)
        if blocked_issue or blocked_shape_issue:
            details.append(f"task_invalid_approval_boundary_blocked_until_approved:{index}")

        reason_missing = "approval_reason" not in value
        approval_reason, approval_reason_issue = self._normalize_optional_string(
            value.get("approval_reason"),
            default=default_reason,
        )
        if reason_missing or approval_reason_issue:
            details.append(f"task_invalid_approval_boundary_approval_reason:{index}")

        if blocked_until_approved and not approval_required:
            approval_required = True
            details.append(f"task_contradictory_approval_boundary_blocked_until_approved:{index}")

        if details:
            details.insert(0, f"task_invalid_approval_boundary:{index}")

        return {
            "approval_required": approval_required,
            "approval_reason": approval_reason or default_reason,
            "blocked_until_approved": blocked_until_approved,
        }, details

    def _normalize_failure_classification(self, value: Any, *, index: int) -> Tuple[Dict[str, Any], List[str]]:
        if not isinstance(value, dict):
            return {
                "failure_type": "",
                "failure_scope": "",
                "retry_recommended": False,
                "retry_reason": "",
                "escalation_required": False,
                "blocking": False,
            }, [f"task_invalid_failure_classification:{index}"]

        details: List[str] = []
        failure_type, failure_type_issue = self._normalize_optional_string(value.get("failure_type"), default="")
        if "failure_type" not in value or failure_type_issue:
            details.append(f"task_invalid_failure_classification_failure_type:{index}")

        failure_scope, failure_scope_issue = self._normalize_optional_string(value.get("failure_scope"), default="")
        if "failure_scope" not in value or failure_scope_issue:
            details.append(f"task_invalid_failure_classification_failure_scope:{index}")

        retry_recommended, retry_recommended_issue = self._coerce_bool(value.get("retry_recommended"), default=False)
        if "retry_recommended" not in value or retry_recommended_issue:
            details.append(f"task_invalid_failure_classification_retry_recommended:{index}")

        retry_reason, retry_reason_issue = self._normalize_optional_string(value.get("retry_reason"), default="")
        if "retry_reason" not in value or retry_reason_issue:
            details.append(f"task_invalid_failure_classification_retry_reason:{index}")

        escalation_required, escalation_required_issue = self._coerce_bool(
            value.get("escalation_required"),
            default=False,
        )
        if "escalation_required" not in value or escalation_required_issue:
            details.append(f"task_invalid_failure_classification_escalation_required:{index}")

        blocking, blocking_issue = self._coerce_bool(value.get("blocking"), default=False)
        if "blocking" not in value or blocking_issue:
            details.append(f"task_invalid_failure_classification_blocking:{index}")

        if details:
            details.insert(0, f"task_invalid_failure_classification:{index}")

        return {
            "failure_type": failure_type or "",
            "failure_scope": failure_scope or "",
            "retry_recommended": retry_recommended,
            "retry_reason": retry_reason or "",
            "escalation_required": escalation_required,
            "blocking": blocking,
        }, details

    def _normalize_policy_payload(self, value: Any, *, index: int) -> Tuple[Dict[str, Any], List[str]]:
        if not isinstance(value, dict):
            return {
                "allowed": True,
                "risk_score": 0.5,
                "violations": [],
                "verdict": "ASK",
            }, [f"task_invalid_policy_payload:{index}"]

        details: List[str] = []
        allowed_missing = "allowed" not in value
        allowed, allowed_issue = self._coerce_bool(value.get("allowed"), default=True)
        if allowed_missing or allowed_issue:
            details.append(f"task_invalid_policy_payload_allowed:{index}")

        verdict_raw = value.get("verdict")
        verdict_missing = "verdict" not in value
        if verdict_raw is None:
            verdict = "ASK"
            verdict_issue = False
        elif isinstance(verdict_raw, (dict, list, tuple, set)):
            verdict = "ASK"
            verdict_issue = True
        else:
            verdict = str(verdict_raw).upper()
            verdict_issue = verdict not in {"ALLOW", "ASK", "BLOCK"}
            if verdict_issue:
                verdict = "ASK"
        if verdict_missing or verdict_issue:
            details.append(f"task_invalid_policy_payload_verdict:{index}")

        risk_score, risk_score_issue = self._coerce_float(value.get("risk_score"), default=0.5)
        if "risk_score" in value and risk_score_issue:
            details.append(f"task_invalid_policy_payload_risk_score:{index}")

        violations, violations_issue = self._normalize_policy_violations(value.get("violations"))
        if "violations" in value and violations_issue:
            details.append(f"task_invalid_policy_payload_violations:{index}")

        contradiction_details = self._policy_payload_contradiction_details(
            allowed=allowed,
            verdict=verdict,
            risk_score=risk_score,
            violations=violations,
            index=index,
        )
        if contradiction_details:
            allowed = True
            verdict = "ASK"
            risk_score = max(risk_score, 0.5)
            details.extend(contradiction_details)

        if details:
            details.insert(0, f"task_invalid_policy_payload:{index}")

        return {
            "allowed": allowed,
            "risk_score": max(0.0, min(risk_score, 1.0)),
            "violations": violations,
            "verdict": verdict,
        }, details

    def _normalize_policy_violations(self, value: Any) -> Tuple[List[Dict[str, Any]], bool]:
        if value is None:
            return [], False
        if not isinstance(value, list):
            return [], True
        normalized: List[Dict[str, Any]] = []
        changed = False
        for entry in value:
            if not isinstance(entry, dict):
                changed = True
                continue
            payload: Dict[str, Any] = {}
            for key in ("rule", "detail", "evidence", "severity"):
                item = entry.get(key)
                if item is None:
                    continue
                if isinstance(item, (dict, list, tuple, set)):
                    changed = True
                    continue
                payload[key] = str(item)
            if not payload.get("rule") or not payload.get("detail") or not payload.get("evidence"):
                changed = True
                continue
            if payload.get("severity") not in {None, "hard", "soft"}:
                payload["severity"] = "hard"
                changed = True
            normalized.append(payload)
        return normalized, changed

    def _policy_payload_decision(self, policy_payload: Dict[str, Any]) -> str:
        verdict = str(policy_payload.get("verdict") or "ASK").upper()
        allowed = bool(policy_payload.get("allowed", True))
        if verdict == "BLOCK" or not allowed:
            return "blocked"
        if verdict == "ASK":
            return "requires_review"
        return "allowed"

    def _policy_payload_is_blocking(self, policy_payload: Dict[str, Any]) -> bool:
        verdict = str(policy_payload.get("verdict") or "ASK").upper()
        return verdict == "BLOCK" or not bool(policy_payload.get("allowed", True))

    def _policy_payload_contradiction_details(
        self,
        *,
        allowed: bool,
        verdict: str,
        risk_score: float,
        violations: List[Dict[str, Any]],
        index: int,
    ) -> List[str]:
        details: List[str] = []
        hard_violations = any(str(item.get("severity") or "hard") == "hard" for item in violations)
        false_allow_axes = 0
        false_block_axes = 0

        if verdict == "ALLOW" and not allowed:
            details.append(f"task_contradictory_policy_payload_allow_disallowed:{index}")
            false_allow_axes += 1
        if verdict == "ASK" and not allowed:
            details.append(f"task_contradictory_policy_payload_ask_disallowed:{index}")
            false_block_axes += 1
        if verdict == "BLOCK" and allowed:
            details.append(f"task_contradictory_policy_payload_block_allowed:{index}")
            false_block_axes += 1
        if verdict == "ALLOW" and hard_violations:
            details.append(f"task_contradictory_policy_payload_allow_hard_violations:{index}")
            false_allow_axes += 1
        if verdict == "BLOCK" and not hard_violations:
            details.append(f"task_contradictory_policy_payload_block_without_hard_violations:{index}")
            false_block_axes += 1
        if verdict == "ALLOW" and risk_score > 0.3:
            details.append(f"task_contradictory_policy_payload_allow_high_risk:{index}")
            false_allow_axes += 1
        if not allowed and risk_score <= 0.3 and not hard_violations:
            details.append(f"task_contradictory_policy_payload_disallowed_low_risk:{index}")
            false_block_axes += 1
        if verdict == "BLOCK" and risk_score <= 0.3 and not hard_violations:
            details.append(f"task_contradictory_policy_payload_block_low_risk:{index}")
            false_block_axes += 1

        if false_allow_axes >= 2:
            details.append(f"task_contradictory_policy_payload_compound_false_allow:{index}")
        if false_block_axes >= 2:
            details.append(f"task_contradictory_policy_payload_compound_false_block:{index}")

        return details

    def _dependencies_satisfied(self, task: Dict[str, Any], completed_ids: set[str]) -> bool:
        dependencies = task.get("dependencies", [])
        if not isinstance(dependencies, list):
            return True
        return all(str(item) in completed_ids for item in dependencies)

    def _find_task(self, tasks: List[Dict[str, Any]], task_id: str) -> Dict[str, Any]:
        for task in tasks:
            if self._task_id(task) == task_id:
                return task
        raise KeyError(f"Task {task_id} not found in queue {self.queue_path}")

    def _sort_key(self, task: Dict[str, Any]) -> Tuple[int, str]:
        priority = task.get("priority", 1000)
        try:
            priority_value = int(priority)
        except (TypeError, ValueError):
            priority_value = 1000
        return priority_value, self._task_id(task)

    def _task_id(self, task: Dict[str, Any]) -> str:
        for key in ("task_id", "id"):
            value = task.get(key)
            if value:
                return str(value)
        raise KeyError("Queue task is missing task_id/id")

    def _has_task_id(self, task: Dict[str, Any]) -> bool:
        for key in ("task_id", "id"):
            if task.get(key):
                return True
        return False

    def _iso_now(self) -> str:
        return get_current_timestamp()