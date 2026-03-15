"""Action interface definitions for AI-E."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

from .artifacts import iso_timestamp


@dataclass(frozen=True)
class ActionRequest:
    action: str
    payload: Dict[str, Any]
    requested_by: str
    timestamp: str

    @classmethod
    def create(cls, action: str, payload: Optional[Dict[str, Any]] = None, *, operator: str = "operator") -> "ActionRequest":
        return cls(action=action, payload=payload or {}, requested_by=operator, timestamp=iso_timestamp())


@dataclass(frozen=True)
class ActionResult:
    action: str
    status: str
    executed: bool
    message: str = ""


GuardrailHook = Callable[[str, Dict[str, Any]], None]


class ActionInterface:
    """Base interface for command/action layers."""

    name = "action_interface"

    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled
        self._armed = False
        self._log_hook: Optional[GuardrailHook] = None

    def describe(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "enabled": self._enabled,
            "armed": self._armed,
        }

    def bind_logger(self, hook: Optional[GuardrailHook]) -> None:
        self._log_hook = hook

    def _log_guardrail(self, event: str, **fields: Any) -> None:
        if self._log_hook:
            self._log_hook(event, fields)

    def arm(self, *, operator: str, reason: str) -> None:
        context = {"operator": operator, "reason": reason or "unspecified"}
        self._log_guardrail("unlock_attempt", **context)
        if not self._enabled:
            self._log_guardrail("unlock_denied", **{**context, "status": "disabled"})
            raise PermissionError("Action layer is disabled.")
        if not reason:
            self._log_guardrail("unlock_denied", **{**context, "status": "missing_reason"})
            raise ValueError("Reason is required when arming the action interface.")
        self._armed = True
        self._log_guardrail("unlock_success", **context)

    def disarm(self) -> None:
        if self._armed:
            self._log_guardrail("unlock_disarmed", operator="system")
        self._armed = False

    def execute(self, action: str, *, payload: Optional[Dict[str, Any]] = None) -> ActionResult:
        if not self._enabled:
            raise PermissionError("Action layer is disabled.")
        if not self._armed:
            raise PermissionError("Action layer requires explicit arming before execution.")
        return self._execute(ActionRequest.create(action, payload))

    def _execute(self, request: ActionRequest) -> ActionResult:  # pragma: no cover - implementation hook
        raise NotImplementedError


class DisabledActionInterface(ActionInterface):
    """Default action interface that refuses all automation."""

    name = "action_layer_disabled"

    def __init__(self) -> None:
        super().__init__(enabled=False)

    def arm(self, *, operator: str, reason: str) -> None:  # noqa: D401 - explicit override for clarity
        context = {"operator": operator, "reason": reason or "unspecified", "status": "locked"}
        self._log_guardrail("unlock_attempt", **context)
        self._log_guardrail("unlock_denied", **context)
        raise PermissionError("Action layer is locked. Manual approval required.")

    def execute(self, action: str, *, payload: Optional[Dict[str, Any]] = None) -> ActionResult:  # noqa: D401
        raise PermissionError("Action layer is locked. No automated actions are permitted.")


class UnityActionInterface(ActionInterface):
    """Unity-aware action interface placeholder.

    The interface can only be armed when instantiated with enabled=True and still
    performs no automation until custom handlers are wired up.
    """

    name = "unity_action_interface"

    def __init__(self, *, enabled: bool = False) -> None:
        super().__init__(enabled=enabled)

    def _execute(self, request: ActionRequest) -> ActionResult:
        # Placeholder implementation that documents the request without executing it.
        return ActionResult(
            action=request.action,
            status="noop",
            executed=False,
            message="Unity action interface is present but intentionally inert.",
        )
