"""A deterministic short hash used to derive stable identifiers.

The hash is not cryptographic. It exists so that an identifier arriving from one protocol
can be re-expressed in another protocol's allowed shape without losing identity: the same
input always produces the same short string, so a tool call keeps one identity when a
transcript is replayed to a different provider.

The input is measured in UTF-16 code units, matching the reference implementation's
``charCodeAt`` indexing, so a non-BMP character contributes two units.
"""

from __future__ import annotations

from app.ai.utils.int_math import imul, to_int32, to_uint32, ushr

__all__ = ["shortHash"]

_BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def _base36(value: int) -> str:
    """Render an unsigned integer in base 36, the way ``Number.prototype.toString(36)`` does."""

    number = to_uint32(value)
    if number == 0:
        return "0"
    digits: list[str] = []
    while number > 0:
        number, remainder = divmod(number, 36)
        digits.append(_BASE36_DIGITS[remainder])
    return "".join(reversed(digits))


def _utf16_code_units(text: str) -> list[int]:
    """The UTF-16 code units of ``text``, which is the unit the reference hashes per index."""

    encoded = text.encode("utf-16-le", errors="surrogatepass")
    return [
        encoded[index] | (encoded[index + 1] << 8)
        for index in range(0, len(encoded), 2)
    ]


def shortHash(text: str) -> str:
    """Hash ``text`` into a short, deterministic, lowercase base-36 string."""

    h1 = to_int32(0xDEADBEEF)
    h2 = to_int32(0x41C6CE57)
    for unit in _utf16_code_units(text):
        h1 = imul(h1 ^ unit, 2654435761)
        h2 = imul(h2 ^ unit, 1597334677)
    h1 = imul(h1 ^ ushr(h1, 16), 2246822507) ^ imul(h2 ^ ushr(h2, 13), 3266489909)
    h2 = imul(h2 ^ ushr(h2, 16), 2246822507) ^ imul(h1 ^ ushr(h1, 13), 3266489909)
    return _base36(h2) + _base36(h1)
