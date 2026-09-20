"""Serializable diagnostics contain selected error data, never SDK objects."""

import json
import time
from collections.abc import Iterable

from app.ai.messages import AssistantMessage, JSONValue


def append_cleanup_diagnostic(
    message: AssistantMessage, error: BaseException, *, sensitive_values: Iterable[str] = ()
) -> None:
    """Record cleanup failure before publication without changing the selected outcome."""
    diagnostic: JSONValue = {
        "type": "cleanup_error",
        "timestamp": time.time_ns() // 1_000_000,
        "error": {
            "name": type(error).__name__,
            "message": format_error(error, sensitive_values=sensitive_values),
        },
    }
    existing = message.diagnostics if isinstance(message.diagnostics, list) else []
    message.diagnostics = [*existing, diagnostic]


def format_error(error: BaseException, *, sensitive_values: Iterable[str] = ()) -> str:
    """Include already-read body evidence once, without reading HTTP streams."""
    message = str(error) or type(error).__name__
    body = getattr(error, "body", None)
    try:
        text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    except (TypeError, ValueError):
        text = ""
    if body is not None and text and text not in message and str(body) not in message:
        message += "\n" + text[:4000]
    status = getattr(error, "status_code", None)
    if type(status) is int and str(status) not in message:
        message = f"HTTP {status}: {message}"
    return redact_text(message, sensitive_values)


def redact_text(text: str, sensitive_values: Iterable[str]) -> str:
    """Remove known local secret values, matching complete values before substrings."""
    for value in sorted(set(sensitive_values), key=len, reverse=True):
        if value:
            text = text.replace(value, "[redacted]")
    return text
