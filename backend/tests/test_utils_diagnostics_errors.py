"""Tests for diagnostics, provider error normalization, environment lookup, sleep and schemas.

The error-normalization cases cover the problem the module exists for: an SDK that hides a
gateway's response body must not turn a useful message into ``"403 status code (no body)"``.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.ai.types import AssistantMessage, StopReason, Usage, UsageCost
from app.ai.utils.abort import AbortController, AbortError
from app.ai.utils.diagnostics import (
    append_assistant_message_diagnostic,
    create_assistant_message_diagnostic,
    extract_diagnostic_error,
    format_thrown_value,
)
from app.ai.utils.error_body import (
    MAX_PROVIDER_ERROR_BODY_CHARS,
    NormalizedProviderError,
    formatProviderError,
    normalizeProviderError,
    safeJsonStringify,
    truncateErrorText,
)
from app.ai.utils.json_schema import StringEnum
from app.ai.utils.provider_env import getProviderEnvValue
from app.ai.utils.sleep import sleep


class _SdkError(Exception):
    """Stands in for a vendor SDK error object carrying extra fields."""

    def __init__(
        self,
        message: str,
        *,
        statusCode: object = None,
        status: object = None,
        body: object = None,
        error: object = None,
    ) -> None:
        super().__init__(message)
        self.statusCode = statusCode
        self.status = status
        self.body = body
        self.error = error


def _message() -> AssistantMessage:
    return AssistantMessage(
        content=[],
        api="openai-completions",
        provider="openai",
        model="m",
        usage=Usage(
            input=0,
            output=0,
            cacheRead=0,
            cacheWrite=0,
            totalTokens=0,
            cost=UsageCost(input=0.0, output=0.0, cacheRead=0.0, cacheWrite=0.0, total=0.0),
        ),
        stopReason=StopReason.STOP,
        timestamp=0,
    )


class TestDiagnostics:
    def test_formats_an_exception_as_its_message(self) -> None:
        assert format_thrown_value(ValueError("boom")) == "boom"

    def test_falls_back_to_the_exception_type_name(self) -> None:
        assert format_thrown_value(ValueError()) == "ValueError"

    def test_formats_a_string_as_itself(self) -> None:
        assert format_thrown_value("plain") == "plain"

    def test_formats_any_other_value_as_text(self) -> None:
        assert format_thrown_value(42) == "42"

    def test_describes_an_exception(self) -> None:
        error = ValueError("boom")

        info = extract_diagnostic_error(error)

        assert info.name == "ValueError"
        assert info.message == "boom"

    def test_prefers_an_explicit_error_name(self) -> None:
        error = ValueError("boom")
        error.name = "CustomName"  # type: ignore[attr-defined]

        assert extract_diagnostic_error(error).name == "CustomName"

    def test_keeps_a_string_or_numeric_code_only(self) -> None:
        error = ValueError("boom")
        error.code = "rate_limited"  # type: ignore[attr-defined]

        assert extract_diagnostic_error(error).code == "rate_limited"

        error.code = ["not", "a", "code"]  # type: ignore[attr-defined]

        assert extract_diagnostic_error(error).code is None

    def test_marks_a_value_that_is_not_an_error(self) -> None:
        info = extract_diagnostic_error({"kind": "thrown"})

        assert info.name == "ThrownValue"
        assert "thrown" in info.message

    def test_creates_a_stamped_diagnostic(self) -> None:
        before = time.time_ns() // 1_000_000

        diagnostic = create_assistant_message_diagnostic("provider_error", ValueError("boom"))

        after = time.time_ns() // 1_000_000
        assert diagnostic.type == "provider_error"
        assert before <= diagnostic.timestamp <= after
        assert diagnostic.error is not None
        assert diagnostic.error.message == "boom"

    def test_keeps_details_when_supplied(self) -> None:
        diagnostic = create_assistant_message_diagnostic(
            "recovery",
            ValueError("boom"),
            {"attempt": 2},
        )

        assert diagnostic.details == {"attempt": 2}

    def test_appending_replaces_the_list_rather_than_extending_it(self) -> None:
        message = _message()
        first = create_assistant_message_diagnostic("one", ValueError("a"))
        append_assistant_message_diagnostic(message, first)
        existing = message.diagnostics
        second = create_assistant_message_diagnostic("two", ValueError("b"))

        append_assistant_message_diagnostic(message, second)

        assert message.diagnostics == [first, second]
        assert message.diagnostics is not existing


class TestErrorBody:
    def test_normalizes_a_non_error_throw(self) -> None:
        norm = normalizeProviderError({"kind": "thrown"})

        assert norm.status is None
        assert norm.body is None
        assert "thrown" in norm.message

    def test_reads_the_mistral_body_field(self) -> None:
        norm = normalizeProviderError(_SdkError("boom", statusCode=403, body="denied"))

        assert norm.status == 403
        assert norm.body == "denied"

    def test_reads_the_openai_status_and_parsed_body(self) -> None:
        norm = normalizeProviderError(
            _SdkError("bad request", status=400, error={"message": "invalid model"}),
        )

        assert norm.status == 400
        assert norm.body is not None
        assert "invalid model" in norm.body

    def test_reads_the_bedrock_metadata_and_response(self) -> None:
        response = type("Response", (), {"statusCode": 503, "body": "throttled"})()
        metadata = type("Metadata", (), {"httpStatusCode": 503})()
        error = _SdkError("failed")
        # The SDK spells these fields with a leading ``$``, so they are set by name.
        object.__setattr__(error, "$metadata", metadata)
        object.__setattr__(error, "$response", response)

        norm = normalizeProviderError(error)

        assert norm.status == 503
        assert norm.body == "throttled"

    def test_status_field_order_prefers_status_code(self) -> None:
        norm = normalizeProviderError(_SdkError("boom", statusCode=403, status=500))

        assert norm.status == 403

    def test_a_non_numeric_status_is_ignored(self) -> None:
        assert normalizeProviderError(_SdkError("boom", status="403")).status is None

    def test_an_empty_body_is_not_a_body(self) -> None:
        assert normalizeProviderError(_SdkError("boom", status=403, body="   ")).body is None

    def test_an_empty_parsed_object_is_not_a_body(self) -> None:
        assert normalizeProviderError(_SdkError("boom", status=403, error={})).body is None

    def test_a_response_wrapper_is_not_a_body(self) -> None:
        # AWS SDK's response object renders as noise, so it must not replace the message.
        wrapper = type("Wrapper", (), {"_events": "internal"})()
        response = type("Response", (), {"statusCode": 400, "body": wrapper})()
        error = _SdkError("real message")
        object.__setattr__(error, "$response", response)

        norm = normalizeProviderError(error)

        assert norm.body is None
        assert norm.messageCarriesBody is True
        assert formatProviderError(norm) == "real message"

    def test_an_unread_response_stream_is_not_a_body(self) -> None:
        import io

        response = type("Response", (), {"statusCode": 400, "body": io.BytesIO(b"x")})()
        error = _SdkError("boom")
        object.__setattr__(error, "$response", response)

        assert normalizeProviderError(error).body is None

    def test_detects_a_message_that_already_carries_the_body(self) -> None:
        norm = normalizeProviderError(
            _SdkError("403: denied by gateway", status=403, body="denied by gateway"),
        )

        assert norm.messageCarriesBody is True

    def test_detects_a_message_that_lacks_the_body(self) -> None:
        norm = normalizeProviderError(
            _SdkError("403 status code (no body)", status=403, body="denied"),
        )

        assert norm.messageCarriesBody is False

    def test_formats_without_a_prefix(self) -> None:
        norm = NormalizedProviderError(
            message="403 status code (no body)",
            status=403,
            body="denied",
        )

        assert formatProviderError(norm) == "403: denied"

    def test_formats_with_a_prefix(self) -> None:
        norm = NormalizedProviderError(
            message="403 status code (no body)",
            status=403,
            body="denied",
        )

        assert formatProviderError(norm, "OpenAI") == "OpenAI (403): denied"

    def test_formats_a_body_less_error_with_a_prefix(self) -> None:
        norm = NormalizedProviderError(message="invalid model", status=404)

        assert formatProviderError(norm, "OpenAI") == "OpenAI (404): invalid model"

    def test_returns_the_message_when_nothing_extra_is_known(self) -> None:
        assert formatProviderError(NormalizedProviderError(message="boom")) == "boom"

    def test_truncates_with_a_counted_suffix(self) -> None:
        text = "x" * (MAX_PROVIDER_ERROR_BODY_CHARS + 10)

        truncated = truncateErrorText(text, MAX_PROVIDER_ERROR_BODY_CHARS)

        assert truncated == "x" * MAX_PROVIDER_ERROR_BODY_CHARS + "... [truncated 10 chars]"

    def test_leaves_text_under_the_cap_alone(self) -> None:
        assert truncateErrorText("short", 10) == "short"

    def test_safe_json_stringify_serializes_a_serializable_value(self) -> None:
        assert safeJsonStringify({"a": 1}) == '{"a": 1}'

    def test_safe_json_stringify_falls_back_to_text(self) -> None:
        assert safeJsonStringify(object()).startswith("<object object at")


class TestProviderEnv:
    def test_a_scoped_value_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MEGUMI_TEST_ENV", "process")

        assert getProviderEnvValue("MEGUMI_TEST_ENV", {"MEGUMI_TEST_ENV": "scoped"}) == "scoped"

    def test_the_process_environment_is_used_next(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MEGUMI_TEST_ENV", "process")

        assert getProviderEnvValue("MEGUMI_TEST_ENV") == "process"

    def test_an_empty_scoped_value_falls_through(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MEGUMI_TEST_ENV", "process")

        assert getProviderEnvValue("MEGUMI_TEST_ENV", {"MEGUMI_TEST_ENV": ""}) == "process"

    def test_an_unknown_name_is_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("MEGUMI_TEST_MISSING", raising=False)

        assert getProviderEnvValue("MEGUMI_TEST_MISSING") is None


class TestSleep:
    @pytest.mark.asyncio
    async def test_returns_after_the_delay(self) -> None:
        controller = AbortController()

        await sleep(1, controller.signal)

        assert controller.signal.aborted is False

    @pytest.mark.asyncio
    async def test_ends_early_when_the_signal_aborts(self) -> None:
        controller = AbortController()
        waiting = asyncio.ensure_future(sleep(60_000, controller.signal))
        await asyncio.sleep(0)

        controller.abort("cancelled")

        with pytest.raises(AbortError, match="cancelled"):
            await waiting

    @pytest.mark.asyncio
    async def test_fails_immediately_on_an_aborted_signal(self) -> None:
        controller = AbortController()
        controller.abort()

        with pytest.raises(AbortError):
            await sleep(60_000, controller.signal)

    @pytest.mark.asyncio
    async def test_fails_with_the_signals_reason_when_it_is_an_error(self) -> None:
        controller = AbortController()
        reason = RuntimeError("supplied")
        waiting = asyncio.ensure_future(sleep(60_000, controller.signal))
        await asyncio.sleep(0)

        controller.abort(reason)

        with pytest.raises(RuntimeError) as caught:
            await waiting
        assert caught.value is reason

    @pytest.mark.asyncio
    async def test_detaches_its_listener_when_it_completes(self) -> None:
        controller = AbortController()

        await sleep(1, controller.signal)
        # Aborting after a completed sleep must not reach the finished wait.
        controller.abort("late")

        assert controller.signal.aborted is True


class TestStringEnum:
    def test_builds_a_string_enum_schema(self) -> None:
        assert StringEnum(["a", "b"]) == {"type": "string", "enum": ["a", "b"]}

    def test_includes_a_description_when_supplied(self) -> None:
        schema = StringEnum(["a"], {"description": "pick one"})

        assert schema["description"] == "pick one"

    def test_includes_a_default_when_supplied(self) -> None:
        schema = StringEnum(["a"], {"default": "a"})

        assert schema["default"] == "a"

    def test_omits_absent_options(self) -> None:
        schema = StringEnum(["a"], {})

        assert "description" not in schema
        assert "default" not in schema

    def test_copies_the_values(self) -> None:
        values = ["a", "b"]

        schema = StringEnum(values)
        values.append("c")

        assert schema["enum"] == ["a", "b"]
