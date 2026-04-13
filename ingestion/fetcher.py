"""Fetch input source content for the ingestion pipeline."""
from __future__ import annotations

import codecs
from pathlib import Path
import time

import requests

from .policy_check import DEFAULT_ROOT, is_url


def fetch_url(url: str, *, timeout_seconds: int = 10, rate_limit_seconds: float = 1.0) -> str:
    time.sleep(max(rate_limit_seconds, 0.0))
    response = requests.get(url, timeout=timeout_seconds)
    response.raise_for_status()
    if response.content.startswith(codecs.BOM_UTF8):
        return response.content.decode("utf-8-sig")

    if response.encoding:
        return response.content.decode(response.encoding, errors="replace")

    if response.apparent_encoding:
        return response.content.decode(response.apparent_encoding, errors="replace")

    return response.content.decode("utf-8", errors="replace")


def fetch_local_file(path: str, *, root_path: str | Path | None = None) -> str:
    root = Path(root_path or DEFAULT_ROOT)
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = (root / candidate).resolve()
    return candidate.read_text(encoding="utf-8-sig")


def fetch_source(source: str, *, root_path: str | Path | None = None, timeout_seconds: int = 10, rate_limit_seconds: float = 1.0) -> tuple[str, str]:
    if is_url(source):
        return fetch_url(source, timeout_seconds=timeout_seconds, rate_limit_seconds=rate_limit_seconds), "url"
    return fetch_local_file(source, root_path=root_path), "file"