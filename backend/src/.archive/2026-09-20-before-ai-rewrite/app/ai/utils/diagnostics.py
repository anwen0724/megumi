"""Redacted diagnostics attached to an assistant message.

A provider failure or recovery is worth keeping on the message it affected, but not at the
cost of leaking credentials: only an error's identity, its message, its stack and its code
are recorded. A thrown value that is not an error still gets a diagnostic, marked as such,
so a failure is never silently dropped.
"""

from __future__ import annotations

import time
from typing import Any, Protocol

from app.ai.types import AssistantMessageDiagnostic, DiagnosticErrorInfo

__all__ = [
    "append_assistant_message_diagnostic",
    "create_assistant_message_diagnostic",
    "extract_diagnostic_error",
    "format_thrown_value",
]

MILLISECONDS_PER_SECOND = 1000


class _HasDiagnostics(Protocol):
    """Anything carrying an optional diagnostic list, which is what a message does.

    The attribute is read/write rather than read-only because appending replaces the list
    instead of mutating it in place.
    """

    diagnostics: list[AssistantMessageDiagnostic] | None


def format_thrown_value(value: Any) -> str:
    """Render a thrown value as the text worth keeping from it."""

    if isinstance(value, BaseException):
        message = str(value)
        return message or type(value).__name__
    if isinstance(value, str):
        return value
    return str(value)


def extract_diagnostic_error(error: Any) -> DiagnosticErrorInfo:
    """Describe ``error`` for a diagnostic, keeping only its identifying parts."""

    if not isinstance(error, BaseException):
        return DiagnosticErrorInfo(name="ThrownValue", message=format_thrown_value(error))
    code = getattr(error, "code", None)
    name = getattr(error, "name", None) or type(error).__name__
    message = str(error) or name
    return DiagnosticErrorInfo(
        name=name,
        message=message,
        code=code if isinstance(code, (str, int)) else None,
    )


def create_assistant_message_diagnostic(
    type: str,
    error: Any,
    details: dict[str, Any] | None = None,
) -> AssistantMessageDiagnostic:
    """Build a diagnostic stamped with the moment it was recorded."""

    return AssistantMessageDiagnostic(
        type=type,
        timestamp=time.time_ns() // 1_000_000,
        error=extract_diagnostic_error(error),
        details=details,
    )


def append_assistant_message_diagnostic(
    message: _HasDiagnostics,
    diagnostic: AssistantMessageDiagnostic,
) -> None:
    """Append ``diagnostic`` to ``message``, replacing the list rather than extending it."""

    message.diagnostics = [*(message.diagnostics or []), diagnostic]
