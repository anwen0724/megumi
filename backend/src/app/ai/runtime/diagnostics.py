"""Serializable diagnostics contain selected error data, never SDK objects."""

import json
from collections.abc import Iterable, Mapping

from app.ai.messages import AssistantMessage, AssistantMessageDiagnostic


def append_assistant_message_diagnostic(
    message: AssistantMessage, diagnostic: AssistantMessageDiagnostic
) -> None:
    """Append one pi-style diagnostic without discarding existing records."""
    message.diagnostics = [*(message.diagnostics or []), diagnostic]


def format_error(
    error: BaseException, *, sensitive_values: Iterable[str] = (), prefix: str | None = None
) -> str:
    """Map Python SDK fields to pi's body/status display rules without reading streams."""
    sensitive_values = tuple(sensitive_values)
    message = redact_text(str(error) or type(error).__name__, sensitive_values)
    body = getattr(error, "body", None)
    try:
        text = (
            body.strip()
            if isinstance(body, str)
            else json.dumps(body, ensure_ascii=False, separators=(",", ":"))
            if type(body) is dict and body
            else ""
        )
    except (TypeError, ValueError):
        text = ""
    text = redact_text(text, sensitive_values)
    # Python SDK status errors may already include the parsed body's repr.
    carries_body = (
        not text or text in message or redact_text(str(body), sensitive_values) in message
    )
    encoded = text.encode("utf-16-le", errors="surrogatepass")
    units = len(encoded) // 2
    if units > 4000:
        text = encoded[:8000].decode("utf-16-le", errors="surrogatepass")
        text += f"... [truncated {units - 4000} chars]"
    status = getattr(error, "status_code", None)
    if carries_body or type(status) is not int:
        return (
            f"{prefix} ({status}): {message}"
            if prefix is not None and type(status) is int
            else message
        )
    return f"{prefix} ({status}): {text}" if prefix is not None else f"{status}: {text}"


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
