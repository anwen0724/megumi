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
