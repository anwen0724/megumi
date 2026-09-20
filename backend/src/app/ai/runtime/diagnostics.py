"""Serializable diagnostics contain selected error data, never SDK objects."""

import time

from app.ai.messages import AssistantMessage, JSONValue


def append_cleanup_diagnostic(message: AssistantMessage, error: BaseException) -> None:
    """Record cleanup failure before publication without changing the selected outcome."""
    diagnostic: JSONValue = {
        "type": "cleanup_error",
        "timestamp": time.time_ns() // 1_000_000,
        "error": {"name": type(error).__name__, "message": str(error) or type(error).__name__},
    }
    existing = message.diagnostics if isinstance(message.diagnostics, list) else []
    message.diagnostics = [*existing, diagnostic]
