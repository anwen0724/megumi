"""Builds a string enum schema that providers without ``anyOf`` support accept.

A plain JSON-Schema enum of strings is what the tool-calling APIs in question describe, but
several providers reject the equivalent ``anyOf``/``const`` form. This helper produces the
accepted shape so a caller does not have to remember which form to use.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

__all__ = ["StringEnum"]


def StringEnum(
    values: Sequence[str],
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a string enum schema over ``values``.

    ``options`` may carry ``description`` and ``default``; an absent one leaves the
    corresponding keyword out of the schema rather than emitting it as null.
    """

    schema: dict[str, Any] = {"type": "string", "enum": list(values)}
    if options is not None:
        description = options.get("description")
        if description:
            schema["description"] = description
        default = options.get("default")
        if default:
            schema["default"] = default
    return schema
