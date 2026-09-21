"""Keep useful provider failures without saving SDK objects or credentials."""

import json

import httpx2
from openai import BadRequestError

from app.ai.runtime.diagnostics import format_error


def test_error_body_adds_reason_once_and_keeps_status():
    response = httpx2.Response(400, request=httpx2.Request("POST", "https://example.test"))
    body = {"error": {"message": "invalid tool schema"}}
    error = BadRequestError("request failed", response=response, body=body)
    result = format_error(error)
    assert "400" in result and "invalid tool schema" in result
    error = BadRequestError(f"request failed: {json.dumps(body)}", response=response, body=body)
    assert format_error(error).count("invalid tool schema") == 1


def test_supplement_is_bounded_and_unknown_objects_are_not_serialized():
    class Error(Exception):
        pass

    error = Error("failed")
    error.body = "x" * 5000
    assert format_error(error) == "failed\n" + "x" * 4000
    error.body = object()
    assert format_error(error) == "failed"


def test_redact_longer_sensitive_values_before_substrings():
    error = ValueError("Bearer fake-key echoed fake-key")
    assert (
        format_error(error, sensitive_values=["fake-key", "Bearer fake-key"])
        == "[redacted] echoed [redacted]"
    )


def test_secrets_are_redacted_before_body_truncation():
    class Error(Exception):
        pass

    error = Error("failed")
    error.body = "x" * 3995 + "sensitive-secret"
    message = format_error(error, sensitive_values=["sensitive-secret"])
    assert message == "failed\n" + ("x" * 3995 + "[redacted]")[:4000]


def test_known_credential_is_redacted_from_sdk_json_and_repr_forms():
    secret = "fake\\key"
    body = {"error": {"message": secret}}
    for encoded in (json.dumps(body), str(body)):
        result = format_error(ValueError(encoded), sensitive_values=[secret])
        assert "fake" not in result and "[redacted]" in result


def test_appending_diagnostics_preserves_existing_records_and_codec_roundtrip():
    from app.ai import AssistantMessage, AssistantMessageDiagnostic, DiagnosticErrorInfo
    from app.ai.codec import decode_messages, encode_messages
    from app.ai.runtime.diagnostics import append_assistant_message_diagnostic

    first = AssistantMessageDiagnostic(type="provider_note", timestamp=1, details={"id": "r1"})
    second = AssistantMessageDiagnostic(
        type="provider_error",
        timestamp=2,
        error=DiagnosticErrorInfo(message="busy", name="Error", code=429),
    )
    message = AssistantMessage(
        content=[], provider="p", api="a", model="m", timestamp=1, diagnostics=[first]
    )
    append_assistant_message_diagnostic(message, second)
    restored = decode_messages(encode_messages([message]))[0]
    assert restored.diagnostics == [first, second]
    assert first.details == {"id": "r1"}
