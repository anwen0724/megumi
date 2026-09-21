"""Serializable diagnostics contain selected error data, never SDK objects."""

import json
import time
from collections.abc import Iterable, Mapping

from app.ai.messages import AssistantMessage, AssistantMessageDiagnostic, DiagnosticErrorInfo


def append_cleanup_diagnostic(
    message: AssistantMessage, error: BaseException, *, sensitive_values: Iterable[str] = ()
) -> None:
    """Record cleanup failure before publication without changing the selected outcome."""
    append_assistant_message_diagnostic(
        message,
        AssistantMessageDiagnostic(
            type="cleanup_error",
            timestamp=time.time_ns() // 1_000_000,
            error=DiagnosticErrorInfo(
                name=type(error).__name__,
                message=format_error(error, sensitive_values=sensitive_values),
            ),
        ),
    )


def append_assistant_message_diagnostic(
    message: AssistantMessage, diagnostic: AssistantMessageDiagnostic
) -> None:
    """Append one pi-style diagnostic without discarding existing records."""
    message.diagnostics = [*(message.diagnostics or []), diagnostic]


def format_error(error: BaseException, *, sensitive_values: Iterable[str] = ()) -> str:
    """Include already-read body evidence once, without reading HTTP streams."""
    sensitive_values = tuple(sensitive_values)
    message = str(error) or type(error).__name__
    body = getattr(error, "body", None)
    try:
        text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    except (TypeError, ValueError):
        text = ""
    if body is not None and text and text not in message and str(body) not in message:
        message += "\n" + redact_text(text, sensitive_values)[:4000]
    status = getattr(error, "status_code", None)
    if type(status) is int and str(status) not in message:
        message = f"HTTP {status}: {message}"
    return redact_text(message, sensitive_values)


def redact_text(text: str, sensitive_values: Iterable[str]) -> str:
    """Remove known local secret values, matching complete values before substrings."""
    forms = {
        form
        for value in sensitive_values
        if value
        for form in (
            value,
            json.dumps(value, ensure_ascii=False)[1:-1],
            json.dumps(value, ensure_ascii=True)[1:-1],
            repr(value)[1:-1],
        )
    }
    for value in sorted(forms, key=len, reverse=True):
        if value:
            text = text.replace(value, "[redacted]")
    return text


def sensitive_header_values(headers: Mapping[str, str | None]) -> list[str]:
    """Recognize credential-bearing header values without storing a request diagnostic."""
    values = []
    for name, value in headers.items():
        if value and any(
            part in name.lower()
            for part in ("authorization", "api-key", "token", "secret", "cookie")
        ):
            values.append(value)
            if name.lower() in {"authorization", "proxy-authorization"} and " " in value:
                values.append(value.split(" ", 1)[1])
    return values
