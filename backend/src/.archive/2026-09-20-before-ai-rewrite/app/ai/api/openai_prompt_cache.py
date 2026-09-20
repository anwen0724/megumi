"""Clamping the prompt cache key a caller supplies.

Providers accept a bounded cache key and reject a longer one, so a key derived from
arbitrary text is truncated before it is sent. Truncation counts characters as a reader
would see them, not code units, so a key built from non-ASCII text is not cut mid-character.

The key is only required to be stable and distinct, so losing the tail is harmless while
sending an over-long one would fail the request.
"""

from __future__ import annotations

__all__ = ["OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH", "clamp_openai_prompt_cache_key"]

OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64


def clamp_openai_prompt_cache_key(key: str | None) -> str | None:
    """Truncate ``key`` to the length providers accept, leaving a shorter one unchanged."""

    if key is None:
        return None
    characters = list(key)
    if len(characters) <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH:
        return key
    return "".join(characters[:OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH])
