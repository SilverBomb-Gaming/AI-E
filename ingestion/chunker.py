"""Text chunking helpers for ingestion."""
from __future__ import annotations


def chunk_text(text: str, chunk_size: int = 500) -> list[str]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero.")
    words = text.split()
    chunks: list[str] = []
    for index in range(0, len(words), chunk_size):
        chunk = " ".join(words[index:index + chunk_size]).strip()
        if chunk:
            chunks.append(chunk)
    return chunks