from __future__ import annotations

import unittest

from app.controller.web_fetcher import WebFetchError, WebFetchResponse, WebFetcher


class _FakeTransport:
    def __init__(self, *, response: WebFetchResponse | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[tuple[str, float, int, tuple[str, ...]]] = []

    def __call__(self, target_url: str, timeout_seconds: float, max_response_bytes: int, allowed_domains: tuple[str, ...]) -> WebFetchResponse:
        self.calls.append((target_url, timeout_seconds, max_response_bytes, allowed_domains))
        if self.error is not None:
            raise self.error
        if self.response is None:
            raise AssertionError("response must be configured for fake transport")
        return self.response


class WebFetcherTests(unittest.TestCase):
    def test_html_preview_is_extracted_and_sanitized(self) -> None:
        transport = _FakeTransport(
            response=WebFetchResponse(
                final_url="https://docs.openclaw.ai/guide?token=secret",
                status_code=200,
                content_type="text/html; charset=utf-8",
                body=b"<html><body><h1>Docs</h1><p>Hello world.</p></body></html>",
            )
        )
        fetcher = WebFetcher(transport=transport)

        snapshot = fetcher.fetch_text_preview(
            "https://docs.openclaw.ai/guide?token=secret",
            allowed_domains=("docs.openclaw.ai",),
        )

        self.assertEqual(snapshot.domain, "docs.openclaw.ai")
        self.assertEqual(snapshot.content_type, "text/html")
        self.assertEqual(snapshot.display_url, "https://docs.openclaw.ai/guide")
        self.assertIn("Docs", snapshot.preview_text)
        self.assertIn("Hello world.", snapshot.preview_text)
        self.assertNotIn("token=secret", snapshot.display_url)

    def test_json_preview_is_compact_and_key_aware(self) -> None:
        transport = _FakeTransport(
            response=WebFetchResponse(
                final_url="https://platform.openai.com/api/spec",
                status_code=200,
                content_type="application/json",
                body=b'{"title":"AI-E","count":2}',
            )
        )
        fetcher = WebFetcher(transport=transport)

        snapshot = fetcher.fetch_text_preview(
            "https://platform.openai.com/api/spec",
            allowed_domains=("platform.openai.com",),
        )

        self.assertEqual(snapshot.content_type, "application/json")
        self.assertIn("JSON keys: title, count", snapshot.preview_text)
        self.assertIn('"title": "AI-E"', snapshot.preview_text)

    def test_invalid_scheme_is_rejected(self) -> None:
        fetcher = WebFetcher(transport=_FakeTransport())
        with self.assertRaises(WebFetchError) as context:
            fetcher.fetch_text_preview("ftp://platform.openai.com/spec", allowed_domains=("platform.openai.com",))
        self.assertEqual(context.exception.code, "unsupported_url_scheme")

    def test_redirect_to_disallowed_domain_is_rejected(self) -> None:
        transport = _FakeTransport(
            response=WebFetchResponse(
                final_url="https://evil.example/data",
                status_code=200,
                content_type="text/plain",
                body=b"should never be shown",
            )
        )
        fetcher = WebFetcher(transport=transport)
        with self.assertRaises(WebFetchError) as context:
            fetcher.fetch_text_preview("https://docs.openclaw.ai/start", allowed_domains=("docs.openclaw.ai",))
        self.assertEqual(context.exception.code, "redirect_target_not_allowed")

    def test_large_text_response_is_marked_truncated(self) -> None:
        body = ("line for preview\n" * 400).encode("utf-8")
        transport = _FakeTransport(
            response=WebFetchResponse(
                final_url="https://ollama.com/docs",
                status_code=200,
                content_type="text/plain",
                body=body[:1200],
                truncated=True,
            )
        )
        fetcher = WebFetcher(transport=transport)

        snapshot = fetcher.fetch_text_preview("https://ollama.com/docs", allowed_domains=("ollama.com",))

        self.assertTrue(snapshot.truncated)
        self.assertTrue(snapshot.oversized)
        self.assertEqual(snapshot.size_category, "large")


if __name__ == "__main__":
    unittest.main()
