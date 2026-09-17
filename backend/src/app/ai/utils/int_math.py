"""JavaScript 32-bit integer arithmetic.

The reference implementation mixes 32-bit arithmetic into identifiers and hashes, so a
faithful port needs the same wrapping and shift behaviour. JavaScript numbers are doubles,
and its bitwise operators coerce both operands to **32-bit signed** integers and yield a
signed result, while ``>>>`` coerces to **32-bit unsigned** first. Python integers are
arbitrary precision, so every operation that must wrap is masked here explicitly rather
than left to overflow.
"""

from __future__ import annotations

__all__ = ["MASK32", "imul", "to_int32", "to_uint32", "ushr"]

MASK32 = 0xFFFFFFFF


def to_uint32(value: int) -> int:
    """Wrap ``value`` to the unsigned 32-bit range, the way ``value >>> 0`` does."""

    return value & MASK32


def to_int32(value: int) -> int:
    """Wrap ``value`` to the signed 32-bit range, the way ``value | 0`` does."""

    wrapped = value & MASK32
    return wrapped - 0x100000000 if wrapped >= 0x80000000 else wrapped


def imul(left: int, right: int) -> int:
    """Multiply with 32-bit wrapping, the way ``Math.imul`` does.

    The result is signed, so callers that feed it back into a bitwise expression get the
    value JavaScript would produce.
    """

    return to_int32(to_uint32(left) * to_uint32(right))


def ushr(value: int, count: int) -> int:
    """Shift right, filling with zeros, the way ``value >>> count`` does."""

    return to_uint32(value) >> count
