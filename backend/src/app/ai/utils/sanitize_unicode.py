"""Removes unpaired Unicode surrogates from text.

Unpaired surrogates (a high surrogate in ``0xD800-0xDBFF`` without a matching low
surrogate in ``0xDC00-0xDFFF``, or the reverse) are not valid UTF-8, so providers reject
payloads containing them. Characters outside the Basic Multilingual Plane, such as emoji,
arrive as a properly paired surrogate pair and are left untouched.
"""

from __future__ import annotations

import re

__all__ = ["sanitizeSurrogates"]

_UNPAIRED_SURROGATE = re.compile(
    "[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]"
)


def sanitizeSurrogates(text: str) -> str:
    """Return ``text`` with every unpaired surrogate removed.

    A string that contains surrogates is not encodable as UTF-8, so callers handle these
    strings with ``surrogatepass`` until they have been sanitized.
    """

    return _UNPAIRED_SURROGATE.sub("", text)
