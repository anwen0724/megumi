"""Time-ordered UUIDv7 generation.

A UUIDv7 embeds a millisecond timestamp in its leading bits, so identifiers sort by
creation time. Two properties matter to callers: a value generated later never sorts
before one generated earlier, even when the clock does not advance or moves backwards,
and a caller-supplied timestamp is preserved exactly so that a follower identifier can
belong to whichever operation is being recorded.

The remaining bits carry a monotonic counter seeded from random bytes, which keeps two
identifiers generated in the same millisecond distinct.
"""

from __future__ import annotations

import os
import threading
import time
from uuid import UUID

__all__ = ["uuidv7"]

MAX_UUID_V7_TIMESTAMP = 0xFFFFFFFFFFFF
MAX_SEQUENCE = (1 << 74) - 1

_LOCK = threading.Lock()
_last_ordinary_timestamp = -1
_sequence: int | None = None


def _random_bytes() -> bytes:
    """Sixteen random bytes, the entropy source for the counter and the low bits."""

    return os.urandom(16)


def _next_sequence() -> int:
    """The counter to embed, seeded once from random bytes and incremented thereafter."""

    global _sequence
    if _sequence is None:
        seed = _random_bytes()
        _sequence = (
            (seed[1] << 32)
            | (seed[2] << 24)
            | (seed[3] << 16)
            | (seed[4] << 8)
            | seed[5]
        )
    else:
        if _sequence == MAX_SEQUENCE:
            raise ValueError("UUIDv7 generator sequence exhausted")
        _sequence += 1
    return _sequence


def uuidv7(timestampMs: int | None = None) -> str:
    """Generate a time-ordered UUIDv7.

    Without ``timestampMs`` the identifier uses the current time and is guaranteed not to
    sort before the previous ordinary identifier. With one, that timestamp is used as
    given and the monotonic clock is left alone, so recording a follower identifier does
    not disturb later ordinary identifiers.
    """

    global _last_ordinary_timestamp
    requested = int(time.time() * 1000) if timestampMs is None else timestampMs
    if not isinstance(requested, int) or requested < 0 or requested > MAX_UUID_V7_TIMESTAMP:
        raise ValueError(
            f"UUIDv7 timestamp must be an integer between 0 and {MAX_UUID_V7_TIMESTAMP}",
        )

    with _LOCK:
        effective = requested
        if timestampMs is None:
            effective = max(requested, _last_ordinary_timestamp)
            _last_ordinary_timestamp = effective

        bytes_out = bytearray(_random_bytes())
        sequence = _next_sequence()

        for index in range(5, -1, -1):
            bytes_out[index] = (effective >> ((5 - index) * 8)) & 0xFF
        bytes_out[6] = 0x70 | ((sequence >> 37) & 0x0F)
        bytes_out[7] = (sequence >> 29) & 0xFF
        bytes_out[8] = 0x80 | ((sequence >> 23) & 0x3F)
        bytes_out[9] = (sequence >> 15) & 0xFF
        bytes_out[10] = (sequence >> 7) & 0xFF
        bytes_out[11] = ((sequence & 0x7F) << 1) | (bytes_out[11] & 0x01)

    return str(UUID(bytes=bytes(bytes_out)))
