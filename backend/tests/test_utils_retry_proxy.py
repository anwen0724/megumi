"""Tests for the two retry layers and the proxy resolver.

The retry cases pin the two behaviours callers depend on: a deterministic failure is not
retried, and a cancellation that lands during the backoff wait is reported the same way as
one that lands during the request. The proxy cases cover the ``no_proxy`` matching rules,
where an entry scoped to another port must not excuse the host.
"""

from __future__ import annotations

import asyncio
import random

import pytest

from app.ai.types import AssistantMessage, StopReason, Usage, UsageCost
from app.ai.utils.abort import AbortController, AbortError
from app.ai.utils.http_proxy import (
    DEFAULT_PROXY_PORTS,
    UNSUPPORTED_PROXY_PROTOCOL_MESSAGE,
    getProxyEnv,
    getProxyForUrl,
    parseNoProxyEntry,
    parseProxyTargetUrl,
    resolveHttpProxyUrlForTarget,
    shouldProxyHostname,
)
from app.ai.utils.provider_retry import (
    DEFAULT_MAX_RETRY_DELAY_MS,
    ProviderError,
    ProviderRetryOptions,
    retryProviderRequest,
)
from app.ai.utils.retry import (
    DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
    RetryCallbacks,
    RetryPolicy,
    isRetryableAssistantError,
    retryAssistantCall,
    retryDelayMs,
)


def _message(
    stop_reason: StopReason = StopReason.STOP,
    error_message: str | None = None,
) -> AssistantMessage:
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
        stopReason=stop_reason,
        timestamp=0,
        errorMessage=error_message,
    )


class TestProviderRetry:
    @pytest.mark.asyncio
    async def test_returns_a_successful_result_immediately(self) -> None:
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            return "ok"

        assert await retryProviderRequest(request) == "ok"
        assert calls == 1

    @pytest.mark.asyncio
    async def test_does_not_retry_by_default(self) -> None:
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            raise ProviderError("boom", status=503)

        with pytest.raises(ProviderError):
            await retryProviderRequest(request)
        assert calls == 1

    @pytest.mark.asyncio
    async def test_retries_a_retryable_status_up_to_the_limit(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(random, "random", lambda: 0.0)
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            if calls < 3:
                raise ProviderError("overloaded", status=503)
            return "ok"

        result = await retryProviderRequest(request, ProviderRetryOptions(maxRetries=5))

        assert result == "ok"
        assert calls == 3

    @pytest.mark.asyncio
    async def test_stops_after_the_retry_budget(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(random, "random", lambda: 0.0)
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            raise ProviderError("overloaded", status=503)

        with pytest.raises(ProviderError):
            await retryProviderRequest(request, ProviderRetryOptions(maxRetries=2))
        assert calls == 3

    @pytest.mark.asyncio
    async def test_does_not_retry_a_non_retryable_status(self) -> None:
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            raise ProviderError("bad request", status=400)

        with pytest.raises(ProviderError):
            await retryProviderRequest(request, ProviderRetryOptions(maxRetries=5))
        assert calls == 1

    @pytest.mark.asyncio
    async def test_a_server_header_can_force_a_retry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(random, "random", lambda: 0.0)
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ProviderError("nope", status=400, headers={"x-should-retry": "true"})
            return "ok"

        assert await retryProviderRequest(request, ProviderRetryOptions(maxRetries=1)) == "ok"

    @pytest.mark.asyncio
    async def test_a_server_header_can_forbid_a_retry(self) -> None:
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            raise ProviderError("busy", status=503, headers={"x-should-retry": "false"})

        with pytest.raises(ProviderError):
            await retryProviderRequest(request, ProviderRetryOptions(maxRetries=5))
        assert calls == 1

    @pytest.mark.asyncio
    async def test_a_transport_failure_is_retryable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(random, "random", lambda: 0.0)
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ProviderError("connection refused")
            return "ok"

        assert await retryProviderRequest(request, ProviderRetryOptions(maxRetries=1)) == "ok"

    @pytest.mark.asyncio
    async def test_a_server_delay_beyond_the_cap_fails_instead_of_waiting(self) -> None:
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            raise ProviderError(
                "slow down",
                status=429,
                headers={"retry-after-ms": "600000"},
            )

        with pytest.raises(ProviderError, match="Server requested 600s retry delay"):
            await retryProviderRequest(request, ProviderRetryOptions(maxRetries=5))
        assert calls == 1

    @pytest.mark.asyncio
    async def test_the_delay_cap_can_be_waived(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(random, "random", lambda: 0.0)
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ProviderError("slow down", status=429, headers={"retry-after-ms": "5"})
            return "ok"

        options = ProviderRetryOptions(maxRetries=1, maxRetryDelayMs=0)

        assert await retryProviderRequest(request, options) == "ok"

    @pytest.mark.asyncio
    async def test_aborting_fails_the_request(self) -> None:
        controller = AbortController()
        controller.abort()

        async def request() -> str:
            raise AssertionError("the request should not run")

        with pytest.raises(AbortError):
            await retryProviderRequest(request, ProviderRetryOptions(signal=controller.signal))

    @pytest.mark.asyncio
    async def test_aborting_during_the_backoff_ends_the_request(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(random, "random", lambda: 0.0)
        controller = AbortController()
        calls = 0

        async def request() -> str:
            nonlocal calls
            calls += 1
            raise ProviderError("busy", status=503, headers={"retry-after-ms": "60000"})

        running = asyncio.ensure_future(
            retryProviderRequest(
                request,
                ProviderRetryOptions(maxRetries=5, signal=controller.signal),
            ),
        )
        await asyncio.sleep(0.01)
        controller.abort()

        with pytest.raises(AbortError, match="Request aborted"):
            await running
        assert calls == 1

    def test_default_cap_is_one_minute(self) -> None:
        assert DEFAULT_MAX_RETRY_DELAY_MS == 60_000


class TestAgentRetry:
    def test_delay_doubles_and_is_capped(self) -> None:
        policy = RetryPolicy(enabled=True, maxRetries=5, baseDelayMs=100)

        assert retryDelayMs(policy, 1) == 100
        assert retryDelayMs(policy, 2) == 200
        assert retryDelayMs(policy, 3) == 400

    def test_delay_respects_the_agent_cap(self) -> None:
        policy = RetryPolicy(enabled=True, maxRetries=5, baseDelayMs=100, maxAgentDelayMs=250)

        assert retryDelayMs(policy, 3) == 250

    def test_delay_defaults_to_a_one_minute_cap(self) -> None:
        policy = RetryPolicy(enabled=True, maxRetries=5, baseDelayMs=1000)

        assert retryDelayMs(policy, 20) == DEFAULT_MAX_AGENT_RETRY_DELAY_MS

    @pytest.mark.parametrize(
        "error_message",
        [
            "Overloaded",
            "rate limit exceeded",
            "429 Too Many Requests",
            "502 Bad Gateway",
            "service unavailable",
            "connection refused",
            "fetch failed",
            "socket hang up",
            "stream ended before message_stop",
            "you can retry your request",
        ],
    )
    def test_transient_failures_are_retryable(self, error_message: str) -> None:
        message = _message(StopReason.ERROR, error_message)

        assert isRetryableAssistantError(message) is True

    @pytest.mark.parametrize(
        "error_message",
        [
            "insufficient_quota: you exceeded your current quota",
            "Monthly usage limit reached",
            "out of budget",
            "quota exceeded",
            "please check your billing details",
            "GoUsageLimitError",
        ],
    )
    def test_exhausted_allowances_are_not_retryable(self, error_message: str) -> None:
        message = _message(StopReason.ERROR, error_message)

        assert isRetryableAssistantError(message) is False

    def test_a_successful_message_is_not_retryable(self) -> None:
        assert isRetryableAssistantError(_message()) is False

    def test_an_aborted_message_is_not_retryable(self) -> None:
        assert isRetryableAssistantError(_message(StopReason.ABORTED)) is False

    def test_an_error_without_a_message_is_not_retryable(self) -> None:
        assert isRetryableAssistantError(_message(StopReason.ERROR)) is False

    def test_an_unrecognized_error_is_not_retryable(self) -> None:
        assert isRetryableAssistantError(_message(StopReason.ERROR, "invalid api key")) is False

    @pytest.mark.asyncio
    async def test_returns_a_success_without_retrying(self) -> None:
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            return _message()

        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=0)

        assert (await retryAssistantCall(produce, policy, None)).stopReason == StopReason.STOP
        assert calls == 1

    @pytest.mark.asyncio
    async def test_retries_a_transient_failure(self) -> None:
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            if calls < 2:
                return _message(StopReason.ERROR, "overloaded")
            return _message()

        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=0)

        assert (await retryAssistantCall(produce, policy, None)).stopReason == StopReason.STOP
        assert calls == 2

    @pytest.mark.asyncio
    async def test_a_disabled_policy_never_retries(self) -> None:
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            return _message(StopReason.ERROR, "overloaded")

        policy = RetryPolicy(enabled=False, maxRetries=3, baseDelayMs=0)

        result = await retryAssistantCall(produce, policy, None)

        assert result.stopReason == StopReason.ERROR
        assert calls == 1

    @pytest.mark.asyncio
    async def test_a_non_retryable_failure_fails_fast(self) -> None:
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            return _message(StopReason.ERROR, "insufficient_quota")

        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=0)

        result = await retryAssistantCall(produce, policy, None)

        assert result.stopReason == StopReason.ERROR
        assert calls == 1

    @pytest.mark.asyncio
    async def test_exhausting_the_budget_returns_the_last_failure(self) -> None:
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            return _message(StopReason.ERROR, "overloaded")

        policy = RetryPolicy(enabled=True, maxRetries=2, baseDelayMs=0)

        result = await retryAssistantCall(produce, policy, None)

        assert result.stopReason == StopReason.ERROR
        assert calls == 3

    @pytest.mark.asyncio
    async def test_an_aborted_message_is_returned_without_retrying(self) -> None:
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            return _message(StopReason.ABORTED)

        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=0)

        result = await retryAssistantCall(produce, policy, None)

        assert result.stopReason == StopReason.ABORTED
        assert calls == 1

    @pytest.mark.asyncio
    async def test_an_abort_during_the_backoff_returns_an_aborted_message(self) -> None:
        controller = AbortController()
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            return _message(StopReason.ERROR, "overloaded")

        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=60_000)

        running = asyncio.ensure_future(
            retryAssistantCall(produce, policy, controller.signal),
        )
        await asyncio.sleep(0.01)
        controller.abort()

        result = await running

        assert result.stopReason == StopReason.ABORTED
        assert result.errorMessage is None
        assert calls == 1

    @pytest.mark.asyncio
    async def test_callbacks_report_the_retry_lifecycle(self) -> None:
        scheduled: list[tuple[int, int, int, str]] = []
        starts: list[int] = []
        finished: list[tuple[bool, int, str | None]] = []
        calls = 0

        async def produce() -> AssistantMessage:
            nonlocal calls
            calls += 1
            if calls == 1:
                return _message(StopReason.ERROR, "overloaded")
            return _message()

        callbacks = RetryCallbacks(
            onRetryScheduled=lambda attempt, total, delay, message: scheduled.append(
                (attempt, total, delay, message),
            ),
            onRetryAttemptStart=lambda: starts.append(1),
            onRetryFinished=lambda ok, attempt, final: finished.append((ok, attempt, final)),
        )
        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=0)

        await retryAssistantCall(produce, policy, None, callbacks)

        assert scheduled == [(1, 3, 0, "overloaded")]
        assert starts == [1]
        assert finished == [(True, 1, None)]

    @pytest.mark.asyncio
    async def test_callbacks_report_an_exhausted_budget(self) -> None:
        finished: list[tuple[bool, int, str | None]] = []

        async def produce() -> AssistantMessage:
            return _message(StopReason.ERROR, "overloaded")

        callbacks = RetryCallbacks(
            onRetryFinished=lambda ok, attempt, final: finished.append((ok, attempt, final)),
        )
        policy = RetryPolicy(enabled=True, maxRetries=1, baseDelayMs=0)

        await retryAssistantCall(produce, policy, None, callbacks)

        assert finished == [(False, 1, "overloaded")]

    @pytest.mark.asyncio
    async def test_callbacks_are_not_called_without_a_retry(self) -> None:
        finished: list[tuple[bool, int, str | None]] = []

        async def produce() -> AssistantMessage:
            return _message()

        callbacks = RetryCallbacks(
            onRetryFinished=lambda ok, attempt, final: finished.append((ok, attempt, final)),
        )
        policy = RetryPolicy(enabled=True, maxRetries=3, baseDelayMs=0)

        await retryAssistantCall(produce, policy, None, callbacks)

        assert finished == []


class TestHttpProxy:
    def test_uses_a_protocol_specific_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")

        assert getProxyForUrl("https://api.test/v1") == "http://proxy.test:8080"

    def test_falls_back_to_the_all_proxy_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("HTTPS_PROXY", raising=False)
        monkeypatch.delenv("https_proxy", raising=False)
        monkeypatch.setenv("ALL_PROXY", "http://proxy.test:8080")

        assert getProxyForUrl("https://api.test/v1") == "http://proxy.test:8080"

    def test_a_bare_host_port_gains_the_target_scheme(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "proxy.test:8080")

        assert getProxyForUrl("https://api.test/v1") == "https://proxy.test:8080"

    def test_no_proxy_excuses_an_exact_host(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")
        monkeypatch.setenv("NO_PROXY", "api.test")

        assert getProxyForUrl("https://api.test/v1") == ""

    def test_no_proxy_excuses_a_suffix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")
        monkeypatch.setenv("NO_PROXY", ".test")

        assert getProxyForUrl("https://api.test/v1") == ""

    def test_no_proxy_wildcard_excuses_everything(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")
        monkeypatch.setenv("NO_PROXY", "*")

        assert getProxyForUrl("https://api.test/v1") == ""

    def test_a_no_proxy_entry_for_another_port_does_not_excuse(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")
        monkeypatch.setenv("NO_PROXY", "api.test:8443")

        # The entry names port 8443, and the target uses 443, so the proxy still applies.
        assert getProxyForUrl("https://api.test/v1") == "http://proxy.test:8080"

    def test_a_no_proxy_entry_for_the_same_port_excuses(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")
        monkeypatch.setenv("NO_PROXY", "api.test:8443")

        assert getProxyForUrl("https://api.test:8443/v1") == ""

    def test_a_scoped_environment_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://process.test:8080")

        assert (
            getProxyForUrl("https://api.test/v1", {"https_proxy": "http://scoped.test:1"})
            == "http://scoped.test:1"
        )

    def test_an_unparseable_target_has_no_proxy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")

        assert getProxyForUrl("not a url") == ""

    def test_an_unsupported_proxy_protocol_is_rejected(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.test:1080")

        with pytest.raises(ValueError, match="Unsupported proxy protocol"):
            resolveHttpProxyUrlForTarget("https://api.test/v1")

    def test_an_invalid_proxy_url_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "://")

        with pytest.raises(ValueError, match="Invalid proxy URL"):
            resolveHttpProxyUrlForTarget("https://api.test/v1")

    def test_no_proxy_configured_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for name in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
            monkeypatch.delenv(name, raising=False)

        assert resolveHttpProxyUrlForTarget("https://api.test/v1") is None

    def test_supported_proxy_protocols_are_returned(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")

        assert (
            resolveHttpProxyUrlForTarget("https://api.test/v1")
            == "http://proxy.test:8080"
        )

    def test_parses_a_target_url(self) -> None:
        parsed = parseProxyTargetUrl("https://api.test:8443/v1")

        assert parsed is not None
        assert parsed.protocol == "https"
        assert parsed.hostname == "api.test"
        assert parsed.port == 8443

    def test_applies_the_default_port_for_the_scheme(self) -> None:
        parsed = parseProxyTargetUrl("wss://api.test/v1")

        assert parsed is not None
        assert parsed.port == DEFAULT_PROXY_PORTS["wss"]

    def test_parses_an_ipv6_no_proxy_entry_with_a_port(self) -> None:
        assert parseNoProxyEntry("[::1]:8080") == ("::1", 8080)

    def test_parses_an_ipv6_no_proxy_entry_without_a_port(self) -> None:
        assert parseNoProxyEntry("[::1]") == ("::1", 0)

    def test_a_bare_ipv6_address_carries_no_port(self) -> None:
        assert parseNoProxyEntry("::1") == ("::1", 0)

    def test_an_entry_without_a_valid_port_is_a_host(self) -> None:
        assert parseNoProxyEntry("api.test:http") == ("api.test:http", 0)

    def test_an_empty_entry_is_ignored(self) -> None:
        assert parseNoProxyEntry("   ") is None

    def test_a_wildcard_prefix_excuses_a_suffix(self) -> None:
        assert shouldProxyHostname("api.test", 443, {"no_proxy": "*.test"}) is False

    def test_an_unrelated_host_is_not_excused(self) -> None:
        assert shouldProxyHostname("api.other", 443, {"no_proxy": "test"}) is True

    def test_proxy_env_reads_either_case(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("NO_PROXY", "upper")

        assert getProxyEnv("no_proxy") == "upper"
        assert getProxyEnv("no_proxy", {"NO_PROXY": "scoped"}) == "scoped"

    def test_the_unsupported_message_names_the_alternative(self) -> None:
        assert "use an HTTP or HTTPS proxy URL" in UNSUPPORTED_PROXY_PROTOCOL_MESSAGE
