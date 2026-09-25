"""Validate durable JSON while preserving existing AI message semantics."""

import json
from uuid import UUID

from pydantic import TypeAdapter, ValidationError

from app.agent.persistence.errors import InvalidRecordError
from app.agent.persistence.operation_state import OperationState
from app.ai import AssistantMessage, JSONValue, Message, decode_messages, encode_messages


def json_encode(value: object) -> str:
    """Encode only plain JSON, rejecting NaN and arbitrary Python objects."""
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
    except (TypeError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def json_decode(text: str) -> JSONValue:
    """Reject corrupt JSON instead of silently ignoring a saved record."""
    try:
        return TypeAdapter(JSONValue).validate_json(text, strict=True)
    except (ValidationError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def identity(value: str) -> str:
    """Require a local UUID, keeping provider IDs inside messages."""
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError) as error:
        raise InvalidRecordError("Expected UUID identity") from error
    return value


def encode_message(message: Message) -> str:
    """Use AI's full codec; pending assistants are not formal history."""
    if isinstance(message, AssistantMessage) and message.stop_reason == "pending":
        raise InvalidRecordError("Pending assistant cannot enter formal history")
    try:
        return json_encode({"message": json.loads(encode_messages([message]))[0]})
    except (TypeError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def decode_message(payload: str) -> Message:
    """Restore the existing AI type, including signatures and precise costs."""
    try:
        data = json.loads(payload)
        return decode_messages(json_encode([data["message"]]))[0]
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def encode_state(state: OperationState) -> str:
    """Validate phase data again because nested caller-owned values can mutate."""
    try:
        encoded = state.model_dump_json()
        TypeAdapter(OperationState).validate_json(encoded, strict=True)
        return encoded
    except (AttributeError, ValidationError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def decode_state(payload: str) -> OperationState:
    """Decode a complete typed phase, rejecting unsupported values."""
    try:
        return TypeAdapter(OperationState).validate_json(payload, strict=True)
    except (ValidationError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error
