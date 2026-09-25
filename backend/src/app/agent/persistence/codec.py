"""Validate durable JSON while preserving existing AI message semantics."""

import json
from dataclasses import asdict
from decimal import Decimal
from uuid import UUID

from pydantic import TypeAdapter, ValidationError

from app.agent.persistence.errors import InvalidRecordError
from app.agent.persistence.operation_state import OperationState
from app.ai import AssistantMessage, JSONValue, Message, Usage, decode_messages, encode_messages
from app.ai.assistant_message_frames import AssistantMessageFrame


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


def encode_usage(usage: "Usage") -> str:
    """Convert monetary Decimal fields only, preserving unknown counters."""
    data = asdict(usage)
    if data["cost"] is not None:
        for key, value in data["cost"].items():
            if isinstance(value, Decimal):
                data["cost"][key] = str(value)
    encoded = json_encode(data)
    decode_usage(encoded)
    return encoded


def decode_usage(payload: str) -> "Usage":
    """Restore full usage using the existing AI data contract."""
    try:
        return TypeAdapter(Usage).validate_json(payload, strict=True)
    except (ValidationError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def encode_frame(frame: AssistantMessageFrame) -> str:
    """Encode existing AI frames without inventing a second delta format."""
    try:
        adapter: TypeAdapter[AssistantMessageFrame] = TypeAdapter(AssistantMessageFrame)
        encoded = adapter.dump_json(frame, warnings="error").decode("utf-8")
        adapter.validate_json(encoded, strict=True)
        return encoded
    except (ValidationError, TypeError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error


def decode_frame(payload: str) -> AssistantMessageFrame:
    """Restore a complete typed frame, including the initial assistant metadata."""
    try:
        return TypeAdapter(AssistantMessageFrame).validate_json(payload, strict=True)
    except (ValidationError, ValueError) as error:
        raise InvalidRecordError(str(error)) from error
