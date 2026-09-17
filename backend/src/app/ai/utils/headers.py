"""Header mapping helpers.

Request headers travel as two different shapes: a protocol's own header container, which
is case-insensitive and multi-valued, and the plain mapping the request contract uses,
where a ``None`` value means "suppress the provider's default for this name".
"""

from __future__ import annotations

from collections.abc import Iterable

from app.ai.types import ProviderHeaders

__all__ = ["headersToRecord", "providerHeadersToRecord"]


def headersToRecord(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    """Flatten header name/value pairs into a plain mapping.

    A repeated name keeps its last value, which is what a mapping can represent and what
    the reference produces by overwriting as it iterates.
    """

    result: dict[str, str] = {}
    for key, value in headers:
        result[key] = value
    return result


def providerHeadersToRecord(headers: ProviderHeaders | None) -> dict[str, str] | None:
    """Drop suppressed entries from caller-supplied headers.

    Returns ``None`` rather than an empty mapping when nothing is left, so "the caller
    expressed no preference" stays distinguishable from "the caller suppressed everything".
    """

    if not headers:
        return None
    result = {key: value for key, value in headers.items() if value is not None}
    return result if result else None
