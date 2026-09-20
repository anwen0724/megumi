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


def encode_messages(messages: Sequence[Message]) -> str:
    """Save a validated plain array; only monetary Decimal fields become strings."""
    records = [asdict(message) for message in messages]
    for record in records:
        usage = record.get("usage")
        if isinstance(usage, dict):
            cost = usage.get("cost")
            if isinstance(cost, dict):
                for name in ("input", "output", "cache_read", "cache_write", "total"):
                    amount = cost.get(name)
                    if isinstance(amount, Decimal):
                        cost[name] = str(amount)
    # Do not use a global Decimal encoder: arguments/details must retain JSON types.
    encoded = json.dumps(records, ensure_ascii=False, allow_nan=False)
    decode_messages(encoded)
    return encoded
