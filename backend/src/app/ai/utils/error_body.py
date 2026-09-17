"""Normalizes provider HTTP error objects into one shape.

A provider reached through a proxy or gateway can answer with a non-2xx response whose body
the vendor SDK cannot fold into the error message. The SDK error still carries the status
and the raw body, but under names that differ per SDK, so a caller that reads only the
message surfaces things like ``"403 status code (no body)"``. This module probes the known
SDK shapes and reports what each one actually holds.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any

__all__ = [
    "MAX_PROVIDER_ERROR_BODY_CHARS",
    "NormalizedProviderError",
    "formatProviderError",
    "normalizeProviderError",
    "safeJsonStringify",
    "truncateErrorText",
]

MAX_PROVIDER_ERROR_BODY_CHARS = 4000


@dataclass(slots=True)
class NormalizedProviderError:
    """What could be recovered from a provider error object.

    ``messageCarriesBody`` records that the message already includes the body, so a caller
    composing a display string does not print the same text twice.
    """

    message: str
    status: int | None = None
    body: str | None = None
    messageCarriesBody: bool = False


def _stringify(value: Any) -> str:
    """Render ``value`` for display, never failing on an unserializable one."""

    try:
        return json.dumps(_to_jsonable(value))
    except (TypeError, ValueError):
        return str(value)


def _to_jsonable(value: Any) -> Any:
    """Replace dataclasses with their field mappings so the value can be serialized."""

    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    return value


def safeJsonStringify(value: Any) -> str:
    """Serialize ``value``, falling back to its text form when it cannot be serialized."""

    return _stringify(value)


def truncateErrorText(text: str, maxChars: int) -> str:
    """Cut ``text`` to ``maxChars`` and say how much was cut."""

    if len(text) <= maxChars:
        return text
    return f"{text[:maxChars]}... [truncated {len(text) - maxChars} chars]"


def _extract_status(error: BaseException) -> int | None:
    """The HTTP status, first numeric hit wins, in SDK field order."""

    for candidate in (
        getattr(error, "statusCode", None),
        getattr(error, "status", None),
    ):
        if isinstance(candidate, int):
            return candidate

    metadata = getattr(error, "$metadata", None)
    if metadata is not None:
        status = getattr(metadata, "httpStatusCode", None)
        if isinstance(status, int):
            return status

    response = getattr(error, "$response", None)
    if response is not None:
        status = getattr(response, "statusCode", None)
        if isinstance(status, int):
            return status

    return None


def _is_readable_stream_like(value: Any) -> bool:
    """Whether ``value`` is an unread response stream rather than a parsed body."""

    return hasattr(value, "read") or hasattr(value, "readline")


def _is_plain_non_empty_object(value: Any) -> bool:
    """Whether ``value`` is a parsed body rather than an SDK wrapper instance.

    Only a plain mapping counts. An SDK error field can hold a class instance — AWS SDK
    ``$response.body`` is a response wrapper — and rendering one produced noise that then
    replaced the error's real message.
    """

    return isinstance(value, dict) and len(value) > 0


def _pick_body_text(error: BaseException) -> str | None:
    """The raw body in its original text form, first usable hit wins, in SDK field order."""

    body = getattr(error, "body", None)
    if isinstance(body, str):
        return body

    error_field = getattr(error, "error", None)
    if _is_plain_non_empty_object(error_field):
        return _stringify(error_field)

    response = getattr(error, "$response", None)
    if response is not None:
        response_body = getattr(response, "body", None)
        if isinstance(response_body, str):
            return response_body
        if _is_readable_stream_like(response_body):
            return None
        if _is_plain_non_empty_object(response_body):
            return _stringify(response_body)

    return None


def _extract_body(error: BaseException) -> str | None:
    """The trimmed, truncated body, or ``None`` when there is nothing usable."""

    body_text = _pick_body_text(error)
    if body_text is None:
        return None
    trimmed = body_text.strip()
    if len(trimmed) == 0:
        return None
    return truncateErrorText(trimmed, MAX_PROVIDER_ERROR_BODY_CHARS)


def normalizeProviderError(error: Any) -> NormalizedProviderError:
    """Describe a provider error object in terms a caller can compose a message from."""

    if not isinstance(error, BaseException):
        return NormalizedProviderError(message=_stringify(error))

    body = _extract_body(error)
    message = str(error)
    return NormalizedProviderError(
        status=_extract_status(error),
        body=body,
        message=message,
        messageCarriesBody=body is None or body in message,
    )


def formatProviderError(norm: NormalizedProviderError, prefix: str | None = None) -> str:
    """Compose a display string, surfacing the status and body when the message lacks them.

    With a prefix the form is ``"<prefix> (<status>): <text>"``; without one it is
    ``"<status>: <text>"``. When nothing extra can be shown, the message stands alone
    unless a status is known and a prefix was supplied.
    """

    if norm.messageCarriesBody or norm.status is None or norm.body is None:
        if prefix is not None and norm.status is not None:
            return f"{prefix} ({norm.status}): {norm.message}"
        return norm.message
    if prefix is not None:
        return f"{prefix} ({norm.status}): {norm.body}"
    return f"{norm.status}: {norm.body}"
