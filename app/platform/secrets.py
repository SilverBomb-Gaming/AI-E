"""Secret storage abstraction with a Windows DPAPI-backed implementation."""
from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path

from .base import BasePlatformAdapter
from .linux import LinuxPlatformAdapter
from .windows import WindowsPlatformAdapter


class SecretStoreError(RuntimeError):
    """Raised when a secret operation fails."""


class SecretStore:
    @property
    def available(self) -> bool:
        raise NotImplementedError

    @property
    def detail(self) -> str:
        raise NotImplementedError

    def put_secret(self, secret_id: str, value: str) -> None:
        raise NotImplementedError

    def get_secret(self, secret_id: str) -> str:
        raise NotImplementedError

    def delete_secret(self, secret_id: str) -> None:
        raise NotImplementedError

    def has_secret(self, secret_id: str) -> bool:
        raise NotImplementedError


class SecretStoreStub(SecretStore):
    @property
    def available(self) -> bool:
        return False

    @property
    def detail(self) -> str:
        return "Secret storage is not available on this platform yet."

    def put_secret(self, secret_id: str, value: str) -> None:
        raise SecretStoreError(self.detail)

    def get_secret(self, secret_id: str) -> str:
        return ""

    def delete_secret(self, secret_id: str) -> None:
        return None

    def has_secret(self, secret_id: str) -> bool:
        return False


class InMemorySecretStore(SecretStore):
    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    @property
    def available(self) -> bool:
        return True

    @property
    def detail(self) -> str:
        return "In-memory secret store."

    def put_secret(self, secret_id: str, value: str) -> None:
        self._values[secret_id] = value

    def get_secret(self, secret_id: str) -> str:
        return self._values.get(secret_id, "")

    def delete_secret(self, secret_id: str) -> None:
        self._values.pop(secret_id, None)

    def has_secret(self, secret_id: str) -> bool:
        return secret_id in self._values


class WindowsDpapiSecretStore(SecretStore):
    """Stores encrypted secrets in a local file using Windows DPAPI."""

    class _DataBlob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.windll.crypt32 if os.name == "nt" else None  # type: ignore[attr-defined]
    _kernel32 = ctypes.windll.kernel32 if os.name == "nt" else None  # type: ignore[attr-defined]

    def __init__(self, storage_path: str | Path) -> None:
        self._storage_path = Path(storage_path)
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        if self._crypt32 is not None:
            self._crypt32.CryptProtectData.argtypes = [
                ctypes.POINTER(self._DataBlob),
                ctypes.c_wchar_p,
                ctypes.c_void_p,
                ctypes.c_void_p,
                ctypes.c_void_p,
                ctypes.c_uint32,
                ctypes.POINTER(self._DataBlob),
            ]
            self._crypt32.CryptProtectData.restype = ctypes.c_bool
            self._crypt32.CryptUnprotectData.argtypes = [
                ctypes.POINTER(self._DataBlob),
                ctypes.c_void_p,
                ctypes.c_void_p,
                ctypes.c_void_p,
                ctypes.c_void_p,
                ctypes.c_uint32,
                ctypes.POINTER(self._DataBlob),
            ]
            self._crypt32.CryptUnprotectData.restype = ctypes.c_bool
            self._kernel32.LocalFree.argtypes = [ctypes.c_void_p]  # type: ignore[union-attr]
            self._kernel32.LocalFree.restype = ctypes.c_void_p  # type: ignore[union-attr]

    @property
    def available(self) -> bool:
        return os.name == "nt"

    @property
    def detail(self) -> str:
        return "Windows DPAPI-backed local secret store."

    def put_secret(self, secret_id: str, value: str) -> None:
        if not self.available:
            raise SecretStoreError("Windows DPAPI secret store is unavailable on this platform.")
        payload = self._read_payload()
        encrypted = self._protect(value.encode("utf-8"))
        payload[secret_id] = base64.b64encode(encrypted).decode("ascii")
        self._write_payload(payload)

    def get_secret(self, secret_id: str) -> str:
        if not self.available:
            return ""
        payload = self._read_payload()
        encoded = payload.get(secret_id, "")
        if not encoded:
            return ""
        encrypted = base64.b64decode(encoded.encode("ascii"))
        return self._unprotect(encrypted).decode("utf-8")

    def delete_secret(self, secret_id: str) -> None:
        payload = self._read_payload()
        if secret_id in payload:
            payload.pop(secret_id)
            self._write_payload(payload)

    def has_secret(self, secret_id: str) -> bool:
        payload = self._read_payload()
        return secret_id in payload

    def _read_payload(self) -> dict[str, str]:
        if not self._storage_path.exists():
            return {}
        try:
            raw = json.loads(self._storage_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, ValueError):
            return {}
        if not isinstance(raw, dict):
            return {}
        return {str(key): str(value) for key, value in raw.items()}

    def _write_payload(self, payload: dict[str, str]) -> None:
        self._storage_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _protect(self, value: bytes) -> bytes:
        blob_in, _ = self._blob_from_bytes(value)
        blob_out = self._DataBlob()
        if not self._crypt32.CryptProtectData(ctypes.byref(blob_in), "AI-E OpenClaw Controller", None, None, None, 0, ctypes.byref(blob_out)):  # type: ignore[union-attr]
            raise SecretStoreError(ctypes.WinError())
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            self._kernel32.LocalFree(blob_out.pbData)  # type: ignore[union-attr]

    def _unprotect(self, value: bytes) -> bytes:
        blob_in, _ = self._blob_from_bytes(value)
        blob_out = self._DataBlob()
        if not self._crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):  # type: ignore[union-attr]
            raise SecretStoreError(ctypes.WinError())
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            self._kernel32.LocalFree(blob_out.pbData)  # type: ignore[union-attr]

    def _blob_from_bytes(self, value: bytes) -> tuple[_DataBlob, ctypes.Array[ctypes.c_char]]:
        buffer = ctypes.create_string_buffer(value)
        blob = self._DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
        return blob, buffer


def get_secret_store(platform_adapter: BasePlatformAdapter | None = None, *, storage_path: str | Path | None = None) -> SecretStore:
    adapter = platform_adapter or (WindowsPlatformAdapter() if os.name == "nt" else LinuxPlatformAdapter())
    if isinstance(adapter, WindowsPlatformAdapter):
        default_path = Path(adapter.controller_state_dir()) / "secrets.json"
        return WindowsDpapiSecretStore(storage_path or default_path)
    return SecretStoreStub()
