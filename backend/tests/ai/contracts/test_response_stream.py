"""Response progress and final-result waits are independent consumers."""

import asyncio

import pytest

from app.ai.assistant_message_frames import (
    AssistantMessageFrameEncoder,
    reduce_assistant_message_frames,
)
from app.ai.messages import TextContent
from app.ai.stream import AssistantResponse


@pytest.mark.asyncio
async def test_background_progress_and_result_do_not_need_event_consumption(provider):
    entered = asyncio.Event()
    release = asyncio.Event()

    async def produce(writer):
        writer.emit({"type": "start", "partial": writer.partial})
        entered.set()
        await release.wait()
        writer.partial.content.append(TextContent(text="answer"))
        writer.partial.stop_reason = "stop"
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    response = AssistantResponse(provider.models[0], produce)
    await asyncio.wait_for(entered.wait(), 1)
    first = asyncio.create_task(response.result())
    second = asyncio.create_task(response.result())
    release.set()
    result = await asyncio.wait_for(first, 1)
    assert await second is result
    assert await response.result() is result
    assert result.content[0].text == "answer"
    assert [e["type"] async for e in response] == ["start", "done"]


@pytest.mark.asyncio
async def test_final_snapshot_ignores_late_events_and_mutations(provider):
    async def produce(writer):
        writer.partial.content.append(TextContent(text="first"))
        writer.partial.stop_reason = "stop"
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})
        writer.partial.content[0].text = "changed after done"
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    response = AssistantResponse(provider.models[0], produce)
    result = await asyncio.wait_for(response.result(), 1)
    assert result.content[0].text == "first"
    assert [e["type"] async for e in response] == ["done"]


@pytest.mark.asyncio
async def test_live_partial_and_saved_frame_have_different_lifetimes(provider):
    first = asyncio.Event()
    release = asyncio.Event()

    async def produce(writer):
        writer.emit({"type": "start", "partial": writer.partial})
        writer.partial.content.append(TextContent(text="one"))
        writer.emit({"type": "text_start", "content_index": 0, "partial": writer.partial})
        first.set()
        await release.wait()
        writer.partial.content[0].text += " two"
        writer.emit(
            {"type": "text_delta", "content_index": 0, "delta": " two", "partial": writer.partial}
        )
        writer.partial.stop_reason = "stop"
        writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

    response = AssistantResponse(provider.models[0], produce)
    await first.wait()
    it = aiter(response)
    encoder = AssistantMessageFrameEncoder()
    frames = [encoder.encode(await anext(it)), encoder.encode(await anext(it))]
    saved = reduce_assistant_message_frames([f for f in frames if f is not None])
    reference = response.partial
    release.set()
    await response.result()
    assert reference.content[0].text == "one two"
    assert saved.content[0].text == "one"
    await it.aclose()


@pytest.mark.asyncio
async def test_cleanup_finishes_before_final_and_failure_does_not_change_stop(provider):
    cleaning = asyncio.Event()
    release = asyncio.Event()

    async def cleanup():
        cleaning.set()
        await release.wait()
        raise OSError("close failed")

    async def produce(writer):
        writer.add_cleanup(cleanup)
        writer.partial.stop_reason = "length"
        writer.emit({"type": "done", "reason": "length", "message": writer.partial})

    response = AssistantResponse(provider.models[0], produce)
    result = asyncio.create_task(response.result())
    await asyncio.wait_for(cleaning.wait(), 1)
    assert not result.done()
    response.cancel()
    release.set()
    final = await asyncio.wait_for(result, 1)
    assert final.stop_reason == "length"
    assert final.diagnostics[0]["type"] == "cleanup_error"
    assert final.diagnostics[0]["error"]["message"] == "close failed"
    await response.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("behavior", ["raise", "missing"])
async def test_setup_failure_and_missing_terminal_return_error_without_hanging(provider, behavior):
    async def produce(writer):
        if behavior == "raise":
            raise RuntimeError("setup failed")

    response = AssistantResponse(provider.models[0], produce)
    result = await asyncio.wait_for(response.result(), 1)
    assert result.stop_reason == "error"
    assert ("setup failed" if behavior == "raise" else "terminal") in result.error_message
    assert [e["type"] async for e in response] == ["error"]
