"""Models wires real preparation and ownership to protocol collaborators."""

import asyncio
from dataclasses import replace

import httpx2
import pytest

from app.ai import (
    ApiKeyCredential,
    Context,
    InMemoryCredentialStore,
    SimpleOptions,
    TextContent,
    UserMessage,
    create_models,
)
from app.ai.errors import LifecycleError
from app.ai.options import CallOptions


async def create_response_stream(client, payload, request_options):
    """Exercise the real SDK endpoint with a minimal test-only protocol request."""
    return await client.responses.create(
        model="sample", input="hello", stream=True, extra_body=payload, **request_options
    )


class RecordingAdapter:
    options_type = CallOptions

    def __init__(self):
        self.calls = []

    async def stream_simple(self, **call):
        self.calls.append(call)
        writer = call["writer"]
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="synthetic answer"))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    async def stream(self, **call):
        await self.stream_simple(**call)


@pytest.mark.asyncio
async def test_simple_call_prepares_auth_options_and_transcript_before_protocol(provider):
    adapter = RecordingAdapter()
    model = replace(provider.models[0], context_window=16000, sampling_params={"top_p": 0.8})
    models = create_models([replace(provider, models=[model])], adapters={model.api: adapter})
    context = Context(system_prompt="Be concise", messages=[])
    response = models.stream_simple(
        model,
        context,
        SimpleOptions(
            api_key="fake-key",
            sampling_params={"top_p": 0.5},
            tool_choice="none",
            session_id="session",
            env={"MEGUMI_AI_CACHE_RETENTION": "long"},
        ),
    )
    final = await response.result()
    assert final.stop_reason == "stop"
    assert final.content[0].text == "synthetic answer"
    assert [event["type"] async for event in response] == ["start", "done"]
    call = adapter.calls[0]
    assert call["auth"].headers["authorization"] == "Bearer fake-key"
    assert call["transcript"].messages[0].content == "Be concise"
    assert call["options"].sampling_params == {"top_p": 0.5}
    assert call["options"].max_output_tokens == 512
    assert call["options"].cache_retention == "long"
    assert call["options"].tool_choice == "none"
    assert call["options"].session_id == "session"
    assert context.messages == []
    await models.aclose()


@pytest.mark.asyncio
async def test_protocol_and_complete_entries_share_execution_without_second_requests(provider):
    adapter = RecordingAdapter()
    models = create_models([provider], adapters={provider.api: adapter})
    model = provider.models[0]
    context = Context(messages=[])
    response = models.stream(model, context, CallOptions(api_key="fake", temperature=0.2))
    first, second = await asyncio.gather(response.result(), response.result())
    assert first is second and len(adapter.calls) == 1
    assert adapter.calls[0]["options"].temperature == 0.2
    assert (
        await models.complete(model, context, CallOptions(api_key="fake"))
    ).stop_reason == "stop"
    assert (
        await models.complete_simple(model, context, SimpleOptions(api_key="fake"))
    ).stop_reason == "stop"
    assert len(adapter.calls) == 3
    await models.aclose()


@pytest.mark.asyncio
async def test_call_snapshots_precede_auth_wait_and_survive_provider_replacement(provider):
    entered, release = asyncio.Event(), asyncio.Event()
    store = InMemoryCredentialStore()
    await store.set(provider.id, ApiKeyCredential("old-key"))
    adapter = RecordingAdapter()
    models = create_models([provider], credentials=store, adapters={provider.api: adapter})
    headers = {"X-Request": "original"}
    sampling = {"top_p": 0.7}
    context = Context(messages=[UserMessage(content="original", timestamp=1)])
    identity = object()

    async def transform(value):
        entered.set()
        await release.wait()
        return value

    response = models.stream_simple(
        provider.models[0],
        context,
        SimpleOptions(
            headers=headers,
            sampling_params=sampling,
            transform_headers=transform,
            telemetry_context=identity,
        ),
    )
    headers["X-Request"] = "changed"
    sampling["top_p"] = 0.1
    context.messages[0].content = "changed"
    await asyncio.wait_for(entered.wait(), 1)
    models.set_provider(replace(provider, base_url="https://new.test/v1"))
    await store.set(provider.id, ApiKeyCredential("new-key"))
    release.set()
    assert (await response.result()).stop_reason == "stop"
    first = adapter.calls[0]
    assert first["auth"].base_url == "https://example.test/v1"
    assert first["auth"].key == "old-key"
    assert first["auth"].headers["x-request"] == "original"
    assert first["transcript"].messages[0].content == "original"
    assert first["options"].sampling_params == {"top_p": 0.7}
    assert first["options"].telemetry_context is identity
    await models.complete_simple(provider.models[0], Context(messages=[]))
    assert adapter.calls[1]["auth"].key == "new-key"
    assert adapter.calls[1]["auth"].base_url == "https://new.test/v1"
    await models.aclose()


@pytest.mark.asyncio
async def test_settings_failures_are_final_but_python_misuse_raises(provider):
    model = replace(provider.models[0], api="openai-responses")
    provider = replace(provider, api="openai-responses", models=[model])
    models = create_models([provider])
    no_auth = models.stream_simple(model, Context(messages=[]))
    assert (await no_auth.result()).stop_reason == "error"
    assert [e["type"] async for e in no_auth] == ["error"]
    from app.ai import ConfigurationError

    with pytest.raises(ConfigurationError, match="Unsupported protocol"):
        models.set_provider(
            replace(provider, api="unimplemented", models=[replace(model, api="unimplemented")])
        )
    unknown = models.stream_simple(replace(model, id="missing"), Context(messages=[]))
    assert "not registered" in (await unknown.result()).error_message
    with pytest.raises(TypeError):
        models.stream_simple(model, Context(messages=[]), CallOptions())
    await models.aclose()


@pytest.mark.asyncio
async def test_cancel_complete_owns_response_and_waits_for_cleanup(provider):
    entered, closing, release, closed = (asyncio.Event() for _ in range(4))

    class BlockingAdapter(RecordingAdapter):
        async def stream_simple(self, **call):
            async def cleanup():
                closing.set()
                await release.wait()
                closed.set()

            call["writer"].add_cleanup(cleanup)
            entered.set()
            await asyncio.Event().wait()

    models = create_models([provider], adapters={provider.api: BlockingAdapter()})
    task = asyncio.create_task(
        models.complete_simple(
            provider.models[0], Context(messages=[]), SimpleOptions(api_key="fake")
        )
    )
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    try:
        await asyncio.wait_for(closing.wait(), 0.2)
        assert not task.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()
    await models.aclose()


@pytest.mark.asyncio
async def test_models_close_drains_active_generation_and_rejects_new_calls(provider):
    entered, cleaned = asyncio.Event(), asyncio.Event()

    class BlockingAdapter(RecordingAdapter):
        async def stream_simple(self, **call):
            async def cleanup():
                cleaned.set()

            call["writer"].add_cleanup(cleanup)
            entered.set()
            await asyncio.Event().wait()

    models = create_models([provider], adapters={provider.api: BlockingAdapter()})
    response = models.stream_simple(
        provider.models[0], Context(messages=[]), SimpleOptions(api_key="fake")
    )
    await asyncio.wait_for(entered.wait(), 1)
    await asyncio.gather(models.aclose(), models.aclose())
    assert cleaned.is_set()
    assert (await response.result()).stop_reason == "aborted"
    with pytest.raises(LifecycleError):
        models.stream_simple(provider.models[0], Context(messages=[]))
    models.set_provider(provider)
    assert models.get_model(provider.id, "small") is not None
    assert (
        await models.resolve_auth(provider.models[0], CallOptions(api_key="fake"))
    ).key == "fake"


class TransportAdapter(RecordingAdapter):
    async def stream_simple(self, **call):
        self.calls.append(call)
        writer = call["writer"]
        stream = await call["clients"].open_stream(
            create_response_stream,
            {"source": "adapter", "stream": True},
            model=call["model"],
            auth=call["auth"],
            options=call["options"],
            writer=writer,
        )
        writer.emit({"type": "start", "partial": writer.partial})
        async for item in stream:
            writer.partial.content.append(TextContent(text=str(item.text)))
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["mutate", "replace"])
async def test_payload_and_response_hooks_wrap_shared_retry_once(provider, mode):
    order, bodies = [], []

    async def payload_hook(payload, model):
        order.append("payload")
        if mode == "mutate":
            payload["source"] = "hook"
            return None
        return {"source": "replacement", "stream": True}

    async def response_hook(response, model):
        order.append("response")
        assert response.status == 200 and response.headers["x-check"] == "ok"

    def handle(request):
        import json

        bodies.append(json.loads(request.content))
        order.append("request")
        if len(bodies) == 1:
            return httpx2.Response(
                429, headers={"retry-after-ms": "0"}, json={"error": {"message": "busy"}}
            )
        return httpx2.Response(
            200, headers={"x-check": "ok"}, content=b'data: {"text": "answer"}\n\ndata: [DONE]\n\n'
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        models = create_models([provider], adapters={provider.api: TransportAdapter()})
        response = models.stream_simple(
            provider.models[0],
            Context(messages=[]),
            SimpleOptions(
                api_key="fake",
                http_client=http,
                on_payload=payload_hook,
                on_response=response_hook,
                max_retries=1,
            ),
        )
        async for event in response:
            order.append(event["type"])
        assert (await response.result()).stop_reason == "stop"
        assert order == ["payload", "request", "request", "response", "start", "done"]
        assert [body["source"] for body in bodies] == [
            ("hook" if mode == "mutate" else "replacement")
        ] * 2
        await models.aclose()
        assert not http.is_closed


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["payload", "response"])
async def test_hook_failure_stops_before_start_and_closes_acquired_response(provider, stage):
    responses = []

    class UnreadBody(httpx2.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            pytest.fail("body consumed before on_response")
            yield b"unused"

        async def aclose(self):
            self.closed = True

    body = UnreadBody()

    def handle(request):
        response = httpx2.Response(200, stream=body)
        responses.append(response)
        return response

    def fail(*args):
        raise ValueError("hook failed")

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        models = create_models([provider], adapters={provider.api: TransportAdapter()})
        response = models.stream_simple(
            provider.models[0],
            Context(messages=[]),
            SimpleOptions(
                api_key="fake",
                http_client=http,
                max_retries=3,
                on_payload=fail if stage == "payload" else None,
                on_response=fail if stage == "response" else None,
            ),
        )
        assert (await response.result()).error_message == "hook failed"
        assert [e["type"] async for e in response] == ["error"]
        assert len(responses) == (0 if stage == "payload" else 1)
        if responses:
            assert body.closed and responses[0].is_closed
        await models.aclose()


@pytest.mark.asyncio
async def test_protocol_option_type_and_api_identity_not_supplier_id(provider):
    from dataclasses import dataclass

    @dataclass(frozen=True, kw_only=True)
    class NativeOptions(CallOptions):
        native: str = "default"

    class NativeAdapter(RecordingAdapter):
        options_type = NativeOptions

    adapter = NativeAdapter()
    second_model = replace(provider.models[0], provider="other")
    second = replace(provider, id="other", models=[second_model])
    models = create_models([provider, second], adapters={provider.api: adapter})
    with pytest.raises(TypeError):
        models.stream(provider.models[0], Context(messages=[]), CallOptions(api_key="fake"))
    await models.complete(
        provider.models[0], Context(messages=[]), NativeOptions(api_key="fake", native="chosen")
    )
    await models.complete(second_model, Context(messages=[]), NativeOptions(api_key="fake"))
    assert [call["model"].provider for call in adapter.calls] == ["sample", "other"]
    assert adapter.calls[0]["options"].native == "chosen"
    await models.aclose()


@pytest.mark.asyncio
async def test_explicit_protocol_options_also_merge_model_defaults(provider):
    adapter = RecordingAdapter()
    model = replace(provider.models[0], sampling_params={"top_p": 0.9, "seed": 10})
    models = create_models([replace(provider, models=[model])], adapters={model.api: adapter})
    await models.complete(
        model,
        Context(messages=[]),
        CallOptions(
            api_key="fake",
            sampling_params={"top_p": 0.2},
            env={"MEGUMI_AI_CACHE_RETENTION": "long"},
        ),
    )
    assert adapter.calls[0]["options"].sampling_params == {"top_p": 0.2, "seed": 10}
    assert adapter.calls[0]["options"].cache_retention == "long"
    await models.aclose()


@pytest.mark.asyncio
async def test_auth_transform_error_does_not_echo_stored_credentials(provider):
    store = InMemoryCredentialStore()
    await store.set(provider.id, ApiKeyCredential("stored-secret"))

    def transform(headers):
        raise ValueError("bad key stored-secret")

    models = create_models([provider], credentials=store)
    final = await models.complete_simple(
        provider.models[0], Context(messages=[]), SimpleOptions(transform_headers=transform)
    )
    assert final.error_message == "bad key [redacted]"
    await models.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["authentication", "establishment", "backoff"])
async def test_signal_interrupts_call_preparation_and_transport_waits(provider, monkeypatch, stage):
    import app.ai.runtime.retry as retry

    entered, exited = asyncio.Event(), asyncio.Event()
    requests = []

    async def wait_here(*args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            exited.set()

    class BlockingStore(InMemoryCredentialStore):
        async def read(self, provider_id):
            await wait_here()

    async def handle(request):
        requests.append(request)
        if stage == "establishment":
            await wait_here()
        return httpx2.Response(
            429, headers={"retry-after-ms": "1"}, json={"error": {"message": "busy"}}
        )

    if stage == "backoff":
        monkeypatch.setattr(retry, "_sleep", wait_here)
    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        store = BlockingStore() if stage == "authentication" else InMemoryCredentialStore()
        models = create_models(
            [provider], credentials=store, adapters={provider.api: TransportAdapter()}
        )
        signal = asyncio.Event()
        response = models.stream_simple(
            provider.models[0],
            Context(messages=[]),
            SimpleOptions(
                api_key=None if stage == "authentication" else "fake",
                http_client=http,
                signal=signal,
                max_retries=3,
            ),
        )
        await asyncio.wait_for(entered.wait(), 1)
        signal.set()
        final = await asyncio.wait_for(response.result(), 1)
        assert final.stop_reason == "aborted" and exited.is_set()
        assert len(requests) == (0 if stage == "authentication" else 1)
        await models.aclose()


@pytest.mark.asyncio
async def test_omitted_explicit_options_use_protocol_defaults(provider, monkeypatch):
    from dataclasses import dataclass

    @dataclass(frozen=True, kw_only=True)
    class NativeOptions(CallOptions):
        native: bool = True

    class NativeAdapter(RecordingAdapter):
        options_type = NativeOptions

    monkeypatch.setenv(provider.env_var, "fake-env")
    adapter = NativeAdapter()
    models = create_models([provider], adapters={provider.api: adapter})
    final = await models.complete(provider.models[0], Context(messages=[]))
    assert final.stop_reason == "stop"
    assert adapter.calls[0]["options"].native is True
    await models.aclose()


@pytest.mark.asyncio
async def test_frames_and_result_waiters_share_generation_before_cleanup_finishes(provider):
    from app.ai import AssistantMessageFrameEncoder, reduce_assistant_message_frames

    progress, release, cleanup_entered, finish_cleanup = (asyncio.Event() for _ in range(4))

    class FramedAdapter(RecordingAdapter):
        async def stream_simple(self, **call):
            writer = call["writer"]

            async def cleanup():
                cleanup_entered.set()
                await finish_cleanup.wait()

            writer.add_cleanup(cleanup)
            writer.emit({"type": "start", "partial": writer.partial})
            writer.partial.content.append(TextContent(text="one"))
            writer.emit({"type": "text_start", "content_index": 0, "partial": writer.partial})
            writer.emit(
                {
                    "type": "text_delta",
                    "content_index": 0,
                    "delta": "one",
                    "partial": writer.partial,
                }
            )
            progress.set()
            await release.wait()
            writer.partial.content[0].text += " two"
            writer.emit(
                {
                    "type": "text_delta",
                    "content_index": 0,
                    "delta": " two",
                    "partial": writer.partial,
                }
            )
            writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    models = create_models([provider], adapters={provider.api: FramedAdapter()})
    response = models.stream_simple(
        provider.models[0], Context(messages=[]), SimpleOptions(api_key="fake")
    )
    await asyncio.wait_for(progress.wait(), 1)
    iterator, encoder = aiter(response), AssistantMessageFrameEncoder()
    frames = [encoder.encode(await anext(iterator)), encoder.encode(await anext(iterator))]
    catch_up = encoder.encode(await anext(iterator))
    assert catch_up is None
    before = reduce_assistant_message_frames(frames)
    cancelled = asyncio.create_task(response.result())
    surviving = asyncio.create_task(response.result())
    await asyncio.sleep(0)
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    release.set()
    await asyncio.wait_for(cleanup_entered.wait(), 1)
    final = await asyncio.wait_for(surviving, 1)
    assert final.stop_reason == "stop"
    assert before.content[0].text == "one"
    assert response.partial.content[0].text == "one two"
    frames.append(encoder.encode(await anext(iterator)))
    assert reduce_assistant_message_frames(frames).content[0].text == "one two"
    finish_cleanup.set()
    await response.aclose()
    assert await response.result() is final
    assert (await anext(iterator))["message"] is final
    await models.aclose()


@pytest.mark.asyncio
async def test_models_close_survives_cancelled_waiter_and_drains_different_waits(
    provider, monkeypatch
):
    import app.ai.runtime.retry as retry

    authenticating, reading, backing_off, cleanup_entered, release = (
        asyncio.Event() for _ in range(5)
    )
    ended = set()

    async def wait_at(name, entered):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            ended.add(name)

    class Store(InMemoryCredentialStore):
        async def read(self, provider_id):
            await wait_at("auth", authenticating)

    class Body(httpx2.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            await wait_at("body", reading)
            yield b"unused"

        async def aclose(self):
            cleanup_entered.set()
            await release.wait()
            self.closed = True

    body = Body()

    async def sleep(delay):
        await wait_at("backoff", backing_off)

    monkeypatch.setattr(retry, "_sleep", sleep)

    def handle(request):
        if request.headers["authorization"] == "Bearer retry-key":
            return httpx2.Response(
                429, headers={"retry-after-ms": "1"}, json={"error": {"message": "busy"}}
            )
        return httpx2.Response(200, stream=body)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        models = create_models(
            [provider], credentials=Store(), adapters={provider.api: TransportAdapter()}
        )
        calls = [
            models.stream_simple(
                provider.models[0],
                Context(messages=[]),
                SimpleOptions(api_key=key, http_client=http, max_retries=2),
            )
            for key in [None, "stream-key", "retry-key"]
        ]
        await asyncio.wait_for(
            asyncio.gather(authenticating.wait(), reading.wait(), backing_off.wait()), 1
        )
        closing = asyncio.create_task(models.aclose())
        await asyncio.wait_for(cleanup_entered.wait(), 1)
        with pytest.raises(LifecycleError):
            models.stream_simple(provider.models[0], Context(messages=[]))
        closing.cancel()
        with pytest.raises(asyncio.CancelledError):
            await closing
        release.set()
        await asyncio.wait_for(models.aclose(), 1)
        assert ended == {"auth", "body", "backoff"} and body.closed
        assert [(await call.result()).stop_reason for call in calls] == ["aborted"] * 3
        assert not http.is_closed


@pytest.mark.asyncio
async def test_models_close_keeps_finished_cleanup_errors_and_drains_all_resources(
    provider, monkeypatch
):
    import app.ai.runtime.clients as clients

    release, cleaning = asyncio.Event(), asyncio.Event()
    http = httpx2.AsyncClient(
        transport=httpx2.MockTransport(
            lambda request: httpx2.Response(
                200, content=b'data: {"text": "answer"}\n\ndata: [DONE]\n\n'
            )
        )
    )
    monkeypatch.setattr(clients, "DefaultAsyncHttpxClient", lambda: http)

    class CleanupAdapter(TransportAdapter):
        async def stream_simple(self, **call):
            wait = call["options"].metadata["wait"]

            async def cleanup():
                if wait:
                    cleaning.set()
                    await release.wait()
                raise OSError("second close" if wait else "first close")

            call["writer"].add_cleanup(cleanup)
            await super().stream_simple(**call)

    models = create_models([provider], adapters={provider.api: CleanupAdapter()})
    first = models.stream_simple(
        provider.models[0],
        Context(messages=[]),
        SimpleOptions(api_key="fake", metadata={"wait": False}),
    )
    assert (await first.result()).stop_reason == "stop"
    with pytest.raises(ExceptionGroup):
        await first.aclose()
    second = models.stream_simple(
        provider.models[0],
        Context(messages=[]),
        SimpleOptions(api_key="fake", metadata={"wait": True}),
    )
    assert (await second.result()).stop_reason == "stop"
    await asyncio.wait_for(cleaning.wait(), 1)
    closing = asyncio.create_task(models.aclose())
    await asyncio.sleep(0)
    assert not closing.done() and not http.is_closed
    release.set()
    with pytest.raises(ExceptionGroup) as caught:
        await closing

    def leaves(error):
        if isinstance(error, BaseExceptionGroup):
            return [text for child in error.exceptions for text in leaves(child)]
        return [str(error)]

    assert sorted(leaves(caught.value)) == ["OSError: first close", "OSError: second close"]
    assert http.is_closed
    assert (await first.result()).stop_reason == (await second.result()).stop_reason == "stop"
    assert models.get_model(provider.id, "small") is not None


@pytest.mark.asyncio
async def test_complete_cancellation_still_propagates_when_cleanup_fails(provider):
    entered = asyncio.Event()

    class FailingCloseAdapter(RecordingAdapter):
        async def stream_simple(self, **call):
            async def cleanup():
                raise OSError("close failed during cancellation")

            call["writer"].add_cleanup(cleanup)
            entered.set()
            await asyncio.Event().wait()

    models = create_models([provider], adapters={provider.api: FailingCloseAdapter()})
    task = asyncio.create_task(
        models.complete_simple(
            provider.models[0], Context(messages=[]), SimpleOptions(api_key="fake")
        )
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    with pytest.raises(ExceptionGroup) as caught:
        await models.aclose()
    assert "close failed during cancellation" in str(caught.value.exceptions[0])
