"""Content cleaning helpers for ingestion."""
from __future__ import annotations

from bs4 import BeautifulSoup


def clean_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for element in soup(["script", "style", "noscript"]):
        element.decompose()
    lines = [line.strip() for line in soup.get_text(separator="\n").splitlines() if line.strip()]
    return "\n".join(lines).strip()


def clean_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines).strip()


def clean_content(raw_text: str, *, source: str, source_kind: str) -> str:
    normalized_text = raw_text.lstrip("\ufeff").lstrip("ï»¿")
    lowered = source.lower()
    looks_like_html = source_kind == "url" or lowered.endswith((".html", ".htm")) or "<html" in normalized_text.lower()
    if looks_like_html:
        return clean_html(normalized_text)
    return clean_text(normalized_text)