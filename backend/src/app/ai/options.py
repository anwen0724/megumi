"""Call configuration keeps mutable data separate from callbacks and cancellation."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass, field, replace
from typing import Literal, cast

import httpx2

from app.ai.auth.types import AuthOverride
from app.ai.messages import JSONValue
from app.ai.model import Model


@dataclass(frozen=True, kw_only=True)
class ProviderResponse:
    """HTTP status and headers only; no SDK response or request body."""

    status: int
    headers: dict[str, str]


type ReasoningLevel = Literal["off", "minimal", "low", "medium", "high", "xhigh", "max"]

type PayloadHook = Callable[
    [dict[str, JSONValue], Model],
    dict[str, JSONValue] | Awaitable[dict[str, JSONValue] | None] | None,
]
type ResponseHook = Callable[[ProviderResponse, Model], Awaitable[None] | None]


@dataclass(frozen=True, kw_only=True)
class CallOptions(AuthOverride):
    """Common invocation controls; protocol-specific fields belong to adapters."""

    http_client: httpx2.AsyncClient | None = field(default=None, repr=False)
    signal: asyncio.Event | None = field(default=None, repr=False)
    temperature: float | None = None
    max_output_tokens: int | None = None
    sampling_params: dict[str, JSONValue] | None = None
    cache_retention: Literal["none", "short", "long"] | None = None
    session_id: str | None = None
    on_payload: PayloadHook | None = field(default=None, repr=False)
    on_response: ResponseHook | None = field(default=None, repr=False)
    timeout_ms: float | None = None
    max_retries: int = 0
    max_retry_delay_ms: float = 60000
    metadata: dict[str, JSONValue] | None = None
    telemetry_context: object | None = field(default=None, repr=False)


@dataclass(frozen=True, kw_only=True)
class SimpleOptions(CallOptions):
    """Provider-independent reasoning and tool-selection preferences."""

    reasoning: ReasoningLevel | None = None
    tool_choice: Literal["auto", "none"] | None = None
    thinking_budgets: dict[str, int] | None = None


def snapshot_options[T: CallOptions](options: T) -> T:
    """Copy request data while retaining the identity of callbacks and controls."""
    controls = (
        options.http_client,
        options.signal,
        options.on_payload,
        options.on_response,
        options.transform_headers,
        options.telemetry_context,
    )
    return deepcopy(options, {id(value): value for value in controls if value is not None})


@dataclass(frozen=True, kw_only=True)
class RetryPolicy:
    """Whole-assistant retry budget; separate from HTTP establishment retries."""

    enabled: bool
    max_retries: int
    base_delay_ms: float
    max_agent_delay_ms: float = 60000


@dataclass(frozen=True, kw_only=True)
class RetryCallbacks:
    """Awaitable lifecycle hooks; callback exceptions propagate."""

    scheduled: Callable[[int, int, float, str], Awaitable[None] | None] | None = None
    attempt_start: Callable[[], Awaitable[None] | None] | None = None
    finished: Callable[[bool, int, str | None], Awaitable[None] | None] | None = None


def prepare_call_options[T: CallOptions](model: Model, options: T) -> T:
    """Merge copied sampling defaults and resolve the scoped cache preference."""
    result = snapshot_options(options)
    sampling = {**(model.sampling_params or {}), **(result.sampling_params or {})}
    cache_env = (
        result.env.get("PI_CACHE_RETENTION")
        if "PI_CACHE_RETENTION" in result.env
        else os.getenv("PI_CACHE_RETENTION")
    )
    return replace(
        result,
        sampling_params=cast(dict[str, JSONValue], deepcopy(sampling)) if sampling else None,
        cache_retention=result.cache_retention or ("long" if cache_env == "long" else "short"),
    )
