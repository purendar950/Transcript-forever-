"""Tiny client for the YouTube Transcript API (requires `requests`)."""

from __future__ import annotations

from typing import Any, Iterable

import requests


class TranscriptApiError(RuntimeError):
    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.status = status


class TranscriptClient:
    def __init__(self, base_url: str, api_key: str | None = None, timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        if api_key:
            self.session.headers["X-API-Key"] = api_key

    def _request(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        response = self.session.get(f"{self.base_url}{path}", params=params, timeout=self.timeout)
        body = response.json()
        if not response.ok:
            error = body.get("error", {})
            raise TranscriptApiError(
                error.get("code", "unknown"),
                error.get("message", response.reason),
                response.status_code,
            )
        return body

    def get(
        self,
        video: str,
        fmt: str = "json",
        lang: Iterable[str] = ("en",),
    ) -> dict[str, Any]:
        """Full JSON response: metadata, stats, and transcript."""
        return self._request(
            "/api/transcript",
            {"url": video, "format": fmt, "lang": ",".join(lang)},
        )

    def text(self, video: str, fmt: str = "plain", lang: Iterable[str] = ("en",)) -> str:
        return self.get(video, fmt=fmt, lang=lang)["transcript"]

    def segments(self, video: str, lang: Iterable[str] = ("en",)) -> list[dict[str, Any]]:
        return self.get(video, fmt="json", lang=lang)["transcript"]

    def languages(self, video: str) -> dict[str, Any]:
        return self._request("/api/languages", {"url": video})


if __name__ == "__main__":
    import sys

    client = TranscriptClient(sys.argv[1])
    print(client.text(sys.argv[2]))
