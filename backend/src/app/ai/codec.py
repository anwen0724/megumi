"""Encode ordinary message JSON and validate saved records at the boundary."""

import json
from collections.abc import Sequence
from dataclasses import asdict
from decimal import Decimal

from pydantic import TypeAdapter, ValidationError

from app.ai.errors import MessageDecodeError
from app.ai.messages import Message

_adapter: TypeAdapter[list[Message]] = TypeAdapter(list[Message])


def decode_messages(data: str) -> list[Message]:
    """Return independent typed messages; malformed structures raise a boundary error."""
    try:
        return _adapter.validate_json(data, strict=True)
    except ValidationError as exc:
        raise MessageDecodeError(str(exc)) from exc


def _json_default(value: object) -> str:
    """Decimal is the only non-JSON value allowed in the saved data."""
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")


def encode_messages(messages: Sequence[Message]) -> str:
    """Save a plain message array, validating before returning serialized data."""
    encoded = json.dumps(
        [asdict(message) for message in messages],
        ensure_ascii=False,
        default=_json_default,
        allow_nan=False,
    )
    decode_messages(encoded)
    return encoded
