"""Call configuration keeps mutable data separate from callbacks and cancellation."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Literal

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
        options.signal,
        options.on_payload,
        options.on_response,
        options.transform_headers,
        options.telemetry_context,
    )
    return deepcopy(options, {id(value): value for value in controls if value is not None})
