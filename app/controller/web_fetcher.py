"""Safe, bounded web fetching for allowlisted read-only previews."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
import json
import socket
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


_SUPPORTED_SCHEMES = frozenset({"https", "http"})
_USER_AGENT = "WindowsOpenClawOperatorConsole/2.2"


@dataclass(frozen=True)
class WebFetchSnapshot:
    request_url: str
    display_url: str
    final_url: str
    domain: str
    content_type: str
    preview_text: str
    size_bytes: int
    truncated: bool
    oversized: bool
    redirected: bool
    fetched_at: str

    @property
    def size_label(self) -> str:
        if self.size_bytes < 1024:
            return f"{self.size_bytes} B"
        if self.size_bytes < 1024 * 1024:
            return f"{self.size_bytes / 1024:.1f} KB"
        return f"{self.size_bytes / (1024 * 1024):.1f} MB"

    @property
    def size_category(self) -> str:
        if self.oversized:
            return "large"
        return "truncated" if self.truncated else "small"

    @property
    def audit_summary(self) -> str:
        suffix = " | truncated" if self.truncated else ""
        return f"{self.domain} | {self.content_type} | {self.size_label}{suffix}"


class WebFetchError(RuntimeError):
    """Structured, user-safe web fetching error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class WebFetchResponse:
    final_url: str
    status_code: int
    content_type: str
    body: bytes
    truncated: bool = False


_Transport = Callable[[str, float, int, tuple[str, ...]], WebFetchResponse]


class WebFetcher:
    """Fetch bounded previews from allowlisted public web URLs."""

    def __init__(
        self,
        *,
        timeout_seconds: float = 8.0,
        max_response_bytes: int = 180_000,
        max_preview_chars: int = 2_000,
        max_preview_lines: int = 18,
        max_redirects: int = 3,
        transport: _Transport | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes
        self._max_preview_chars = max_preview_chars
        self._max_preview_lines = max_preview_lines
        self._max_redirects = max_redirects
        self._transport = transport or self._default_transport

    def fetch_text_preview(self, target_url: str, *, allowed_domains: tuple[str, ...]) -> WebFetchSnapshot:
        normalized_url = self.normalize_target_url(target_url)
        request_domain = self._domain_from_url(normalized_url)
        if not self._is_allowed_domain(request_domain, allowed_domains):
            raise WebFetchError("target_domain_not_allowed", "URL is not allowed by current web scope.")

        response = self._transport(normalized_url, self._timeout_seconds, self._max_response_bytes, allowed_domains)
        final_url = self.normalize_target_url(response.final_url or normalized_url)
        final_domain = self._domain_from_url(final_url)
        if not self._is_allowed_domain(final_domain, allowed_domains):
            raise WebFetchError("redirect_target_not_allowed", "URL is not allowed by current web scope.")

        content_type = self._normalize_content_type(response.content_type)
        if not self._is_supported_content_type(content_type):
            raise WebFetchError("unsupported_content_type", "Only supported web content types can be previewed.")

        normalized_text = self._content_to_text(response.body, content_type)
        preview_text, preview_truncated = self._build_preview(normalized_text)
        oversized = response.truncated
        truncated = response.truncated or preview_truncated
        return WebFetchSnapshot(
            request_url=normalized_url,
            display_url=self._sanitize_url_for_display(final_url),
            final_url=final_url,
            domain=final_domain,
            content_type=content_type,
            preview_text=preview_text,
            size_bytes=len(response.body),
            truncated=truncated,
            oversized=oversized,
            redirected=self._sanitize_url_for_display(final_url) != self._sanitize_url_for_display(normalized_url),
            fetched_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )

    def _default_transport(
        self,
        target_url: str,
        timeout_seconds: float,
        max_response_bytes: int,
        allowed_domains: tuple[str, ...],
    ) -> WebFetchResponse:
        opener = build_opener(_NoRedirectHandler())
        current_url = target_url
        redirects_followed = 0
        while True:
            request = Request(current_url, method="GET", headers={"User-Agent": _USER_AGENT, "Accept": "text/*,application/json"})
            try:
                with opener.open(request, timeout=timeout_seconds) as response:
                    body = response.read(max_response_bytes + 1)
                    truncated = len(body) > max_response_bytes
                    if truncated:
                        body = body[:max_response_bytes]
                    content_type = response.headers.get_content_type() or "application/octet-stream"
                    final_url = response.geturl() or current_url
                    return WebFetchResponse(
                        final_url=final_url,
                        status_code=getattr(response, "status", response.getcode()),
                        content_type=content_type,
                        body=body,
                        truncated=truncated,
                    )
            except HTTPError as exc:
                if exc.code in {301, 302, 303, 307, 308}:
                    location = exc.headers.get("Location", "").strip()
                    if not location:
                        raise WebFetchError("web_fetch_failed", "Unable to fetch the requested URL.") from exc
                    redirects_followed += 1
                    if redirects_followed > self._max_redirects:
                        raise WebFetchError("redirect_limit_exceeded", "Unable to fetch the requested URL.") from exc
                    redirected_url = self.normalize_target_url(urljoin(current_url, location))
                    redirected_domain = self._domain_from_url(redirected_url)
                    if not self._is_allowed_domain(redirected_domain, allowed_domains):
                        raise WebFetchError("redirect_target_not_allowed", "URL is not allowed by current web scope.") from exc
                    current_url = redirected_url
                    continue
                if exc.code in {401, 403, 404, 410, 429, 500, 502, 503, 504}:
                    raise WebFetchError("web_fetch_failed", "Unable to fetch the requested URL.") from exc
                raise WebFetchError("web_fetch_failed", "Unable to fetch the requested URL.") from exc
            except URLError as exc:
                if isinstance(exc.reason, socket.timeout):
                    raise WebFetchError("web_fetch_timeout", "Web request timed out.") from exc
                raise WebFetchError("web_fetch_failed", "Unable to fetch the requested URL.") from exc
            except TimeoutError as exc:
                raise WebFetchError("web_fetch_timeout", "Web request timed out.") from exc
            except OSError as exc:
                raise WebFetchError("web_fetch_failed", "Unable to fetch the requested URL.") from exc

    def _content_to_text(self, body: bytes, content_type: str) -> str:
        text, _encoding = self._decode_text(body)
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        if content_type == "text/html":
            normalized = self._html_to_text(normalized)
        elif content_type == "application/json":
            normalized = self._json_to_text(normalized)
        return self._normalize_whitespace(normalized)

    def _build_preview(self, text: str) -> tuple[str, bool]:
        lines = text.split("\n")
        preview_lines = lines[: self._max_preview_lines]
        preview = "\n".join(preview_lines).strip("\n")
        truncated = len(lines) > self._max_preview_lines
        if len(preview) > self._max_preview_chars:
            preview = preview[: self._max_preview_chars].rstrip()
            truncated = True
        if not preview:
            preview = "[empty response body]"
        return preview, truncated

    @staticmethod
    def _json_to_text(text: str) -> str:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return text
        if isinstance(payload, dict):
            keys = list(payload.keys())[:8]
            prefix = f"JSON keys: {', '.join(str(key) for key in keys)}"
            compact = json.dumps(payload, ensure_ascii=True, indent=2)
            return f"{prefix}\n{compact}"
        if isinstance(payload, list):
            prefix = f"JSON list length: {len(payload)}"
            compact = json.dumps(payload, ensure_ascii=True, indent=2)
            return f"{prefix}\n{compact}"
        return json.dumps(payload, ensure_ascii=True)

    @staticmethod
    def _html_to_text(text: str) -> str:
        parser = _HtmlTextExtractor()
        parser.feed(text)
        parser.close()
        return parser.to_text()

    @staticmethod
    def _decode_text(body: bytes) -> tuple[str, str]:
        for encoding in ("utf-8-sig", "utf-8"):
            try:
                return body.decode(encoding), encoding
            except UnicodeDecodeError:
                continue
        raise WebFetchError("unsupported_content_type", "Only supported web content types can be previewed.")

    @staticmethod
    def _normalize_content_type(value: str) -> str:
        return value.split(";", 1)[0].strip().lower()

    @staticmethod
    def _is_supported_content_type(content_type: str) -> bool:
        return content_type == "application/json" or content_type.startswith("text/")

    @staticmethod
    def normalize_target_url(target_url: str) -> str:
        value = target_url.strip()
        if not value:
            raise WebFetchError("missing_url", "Use /web <https://allowed-domain/path>.")
        parsed = urlparse(value)
        if parsed.scheme.lower() not in _SUPPORTED_SCHEMES:
            raise WebFetchError("unsupported_url_scheme", "Use an https:// or http:// URL from the allowed web scope.")
        if not parsed.hostname:
            raise WebFetchError("malformed_url", "Use /web <https://allowed-domain/path>.")
        normalized_path = parsed.path or "/"
        normalized = parsed._replace(scheme=parsed.scheme.lower(), netloc=parsed.netloc.lower(), path=normalized_path)
        return urlunparse(normalized)

    @classmethod
    def _domain_from_url(cls, target_url: str) -> str:
        parsed = urlparse(target_url)
        return (parsed.hostname or "").lower()

    @classmethod
    def _sanitize_url_for_display(cls, target_url: str) -> str:
        parsed = urlparse(target_url)
        display = parsed._replace(query="", fragment="", params="")
        return urlunparse(display)

    @staticmethod
    def _normalize_whitespace(value: str) -> str:
        compact_lines = [" ".join(line.split()) for line in value.split("\n")]
        lines = [line for line in compact_lines if line]
        return "\n".join(lines)

    @staticmethod
    def _is_allowed_domain(target_domain: str, allowlist: tuple[str, ...]) -> bool:
        normalized_target = target_domain.strip().lower()
        if not normalized_target:
            return False
        normalized_allowlist = tuple(domain.strip().lower() for domain in allowlist if domain.strip())
        if not normalized_allowlist:
            return False
        for allowed in normalized_allowlist:
            if allowed.startswith("*."):
                suffix = allowed[1:]
                if normalized_target.endswith(suffix) and normalized_target != allowed[2:]:
                    return True
            elif normalized_target == allowed:
                return True
        return False


class _NoRedirectHandler(HTTPRedirectHandler):
    """Return redirect responses to the caller so policy can inspect them first."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401, ANN001
        return None


class _HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag in {"p", "br", "div", "section", "article", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"p", "br", "div", "section", "article", "li", "ul", "ol"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self._parts.append(text)

    def to_text(self) -> str:
        return "".join(self._parts)
