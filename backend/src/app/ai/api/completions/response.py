"""Assemble native SDK chunks into stable content slots and assistant events."""

import json
from collections.abc import AsyncIterable
from dataclasses import dataclass
from typing import cast

from openai.types.chat import ChatCompletionChunk

from app.ai.messages import JSONValue, TextContent, ThinkingContent, ToolCall, Usage
from app.ai.model import Model
from app.ai.stream import ResponseWriter
from app.ai.tools.arguments import parse_partial_arguments
from app.ai.usage import calculate_usage_cost


async def consume_response(
    chunks: AsyncIterable[ChatCompletionChunk], writer: ResponseWriter, model: Model
) -> None:
    """Read to EOF before settling, retaining a shared partial during assembly."""
    state = ResponseAssembly(writer, model)
    writer.emit({"type": "start", "partial": writer.partial})
    try:
        async for chunk in chunks:
            if isinstance(chunk, ChatCompletionChunk):
                state.feed(cast(dict[str, JSONValue], chunk.model_dump(mode="json")))
        state.finish()
    finally:
        # Also retain replay evidence when iteration fails or is cancelled.
        state.preserve_signature()


@dataclass
class ToolAssembly:
    """Transient native stream identity and raw JSON never enter message persistence."""

    block: ToolCall
    content_index: int
    arguments: str = ""


class ResponseAssembly:
    """Keep parser bookkeeping outside persistable assistant content."""

    def __init__(self, writer: ResponseWriter, model: Model) -> None:
        self.model = model
        self.writer = writer
        self.partial = writer.partial
        self.text: TextContent | None = None
        self.thinking: ThinkingContent | None = None
        self.text_index = -1
        self.thinking_index = -1
        self.details: list[dict[str, JSONValue]] = []
        self.tools_by_index: dict[int, ToolAssembly] = {}
        self.tools_by_id: dict[str, ToolAssembly] = {}

    def feed(self, chunk: dict[str, JSONValue]) -> None:
        """Consume first-choice deltas while preserving response identity."""
        identity, model = chunk.get("id"), chunk.get("model")
        if isinstance(identity, str) and identity:
            self.partial.response_id = self.partial.response_id or identity
        if isinstance(model, str) and model and model != self.partial.model:
            self.partial.response_model = self.partial.response_model or model
        usage = chunk.get("usage")
        if isinstance(usage, dict):
            self.partial.usage = parse_usage(usage, self.model)
        choices = chunk.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            return
        choice = choices[0]
        fallback_usage = choice.get("usage")
        if not isinstance(usage, dict) and isinstance(fallback_usage, dict):
            self.partial.usage = parse_usage(fallback_usage, self.model)
        reason = choice.get("finish_reason")
        if isinstance(reason, str) and reason:
            self.partial.raw_stop_reason = reason
            if reason in ("stop", "end"):
                self.partial.stop_reason = "stop"
            elif reason == "length":
                self.partial.stop_reason = "length"
            elif reason in ("function_call", "tool_calls"):
                self.partial.stop_reason = "tool_use"
            else:
                self.partial.stop_reason = "error"
                self.partial.error_message = f"Provider finish_reason: {reason}"
        delta = choice.get("delta")
        if not isinstance(delta, dict):
            return
        content = delta.get("content")
        if isinstance(content, str) and content:
            if self.text is None:
                self.text = TextContent(text="")
                self.text_index = len(self.partial.content)
                self.partial.content.append(self.text)
                self.writer.emit(
                    {
                        "type": "text_start",
                        "content_index": self.text_index,
                        "partial": self.partial,
                    }
                )
            self.text.text += content
            self.writer.emit(
                {
                    "type": "text_delta",
                    "content_index": self.text_index,
                    "delta": content,
                    "partial": self.partial,
                }
            )
        for field in ("reasoning_content", "reasoning", "reasoning_text"):
            reasoning = delta.get(field)
            if isinstance(reasoning, str) and reasoning:
                block = self.ensure_thinking(field)
                block.thinking += reasoning
                self.writer.emit(
                    {
                        "type": "thinking_delta",
                        "content_index": self.thinking_index,
                        "delta": reasoning,
                        "partial": self.partial,
                    }
                )
                break

        calls = delta.get("tool_calls")
        if isinstance(calls, list):
            for call in calls:
                if isinstance(call, dict):
                    self.feed_tool(call)
        details = delta.get("reasoning_details")
        if isinstance(details, list):
            for detail in details:
                if isinstance(detail, dict) and valid_reasoning_detail(detail):
                    self.ensure_thinking("")
                    append_reasoning_detail(self.details, detail)

    def feed_tool(self, call: dict[str, JSONValue]) -> None:
        """Resolve native index first, ID second, and fill initially absent identity fields."""
        index, identity = call.get("index"), call.get("id")
        function = call.get("function")
        function = function if isinstance(function, dict) else {}
        name = function.get("name")
        state = self.tools_by_index.get(index) if isinstance(index, int) else None
        if state is None and isinstance(identity, str) and identity:
            state = self.tools_by_id.get(identity)
        if state is None:
            block = ToolCall(
                id=identity if isinstance(identity, str) else "",
                name=name if isinstance(name, str) else "",
                arguments={},
            )
            state = ToolAssembly(block, len(self.partial.content))
            self.partial.content.append(block)
            self.writer.emit(
                {
                    "type": "toolcall_start",
                    "content_index": state.content_index,
                    "partial": self.partial,
                }
            )
        if isinstance(index, int):
            self.tools_by_index[index] = state
        if isinstance(identity, str) and identity:
            self.tools_by_id[identity] = state
            state.block.id = state.block.id or identity
        if isinstance(name, str) and name:
            state.block.name = state.block.name or name
        delta = function.get("arguments")
        delta = delta if isinstance(delta, str) else ""
        state.arguments += delta
        state.block.arguments = parse_partial_arguments(state.arguments)
        self.writer.emit(
            {
                "type": "toolcall_delta",
                "content_index": state.content_index,
                "delta": delta,
                "partial": self.partial,
            }
        )

    def preserve_signature(self) -> None:
        """Serialize replay details only at completion or failure, never as visible text."""
        if self.thinking is not None and self.details:
            self.thinking.thinking_signature = json.dumps(
                self.details, ensure_ascii=False, separators=(",", ":")
            )

    def ensure_thinking(self, signature: str) -> ThinkingContent:
        """Allocate one reasoning slot at its first observed position."""
        if self.thinking is None:
            self.thinking = ThinkingContent(thinking="", thinking_signature=signature)
            self.thinking_index = len(self.partial.content)
            self.partial.content.append(self.thinking)
            self.writer.emit(
                {
                    "type": "thinking_start",
                    "content_index": self.thinking_index,
                    "partial": self.partial,
                }
            )
        return self.thinking

    def finish(self) -> None:
        """Finalize content in first-seen order and require a native terminal marker."""
        self.preserve_signature()
        for index, block in enumerate(self.partial.content):
            if isinstance(block, TextContent):
                self.writer.emit(
                    {
                        "type": "text_end",
                        "content_index": index,
                        "content": block.text,
                        "partial": self.partial,
                    }
                )
            elif isinstance(block, ThinkingContent):
                self.writer.emit(
                    {
                        "type": "thinking_end",
                        "content_index": index,
                        "content": block.thinking,
                        "partial": self.partial,
                    }
                )
            elif isinstance(block, ToolCall):
                self.writer.emit(
                    {
                        "type": "toolcall_end",
                        "content_index": index,
                        "tool_call": block,
                        "partial": self.partial,
                    }
                )
        if (
            self.partial.raw_stop_reason is None
            and self.model.compat.supports_finish_reason is False
        ):
            self.partial.stop_reason = (
                "tool_use"
                if any(isinstance(block, ToolCall) for block in self.partial.content)
                else "stop"
            )
        reason = self.partial.stop_reason
        if reason == "error":
            raise ValueError(self.partial.error_message)
        if reason not in ("stop", "length", "tool_use"):
            raise ValueError("Stream ended without finish_reason")
        self.writer.emit({"type": "done", "reason": reason, "message": self.partial})


def valid_reasoning_detail(value: JSONValue) -> bool:
    """Accept pi's replay metadata shapes while preserving unknown provider fields."""
    if not isinstance(value, dict):
        return False
    if value.get("id") is not None and not isinstance(value["id"], str):
        return False
    if "format" in value and not isinstance(value["format"], str):
        return False
    if "index" in value and type(value["index"]) not in (int, float):
        return False
    kind = value.get("type")
    if kind == "reasoning.summary":
        return isinstance(value.get("summary"), str)
    if kind == "reasoning.encrypted":
        return isinstance(value.get("data"), str)
    return (
        kind == "reasoning.text"
        and isinstance(value.get("text"), str)
        and (value.get("signature") is None or isinstance(value["signature"], str))
    )


def append_reasoning_detail(
    details: list[dict[str, JSONValue]], detail: dict[str, JSONValue]
) -> None:
    """Merge consecutive text/summary fragments; encrypted entries stay opaque and discrete."""
    kind = detail["type"]
    if details and kind in ("reasoning.text", "reasoning.summary") and details[-1]["type"] == kind:
        target = details[-1]
        field = "text" if kind == "reasoning.text" else "summary"
        target[field] = str(target[field]) + str(detail[field])
        for key in ("id", "format", "index", "signature"):
            if (
                target.get(key) is None or (key in ("format", "signature") and not target[key])
            ) and key in detail:
                target[key] = detail[key]
    else:
        details.append(dict(detail))


def token_count(value: JSONValue) -> int | None:
    """Keep absent native counters unknown, including values the SDK defaults to None."""
    return value if type(value) is int else None


def parse_usage(raw: dict[str, JSONValue], model: Model) -> Usage:
    """Subtract cache components from prompt tokens; reasoning is already in output."""
    prompt = raw.get("prompt_tokens_details")
    prompt = prompt if isinstance(prompt, dict) else {}
    completion = raw.get("completion_tokens_details")
    completion = completion if isinstance(completion, dict) else {}
    read = token_count(prompt.get("cached_tokens"))
    if read is None:
        read = token_count(raw.get("prompt_cache_hit_tokens"))
    if read is None:
        read = token_count(raw.get("cached_tokens"))
    write = token_count(prompt.get("cache_write_tokens"))
    if write is None and (
        model.provider in ("openai", "deepseek")
        or any(
            host in (model.base_url or "").lower() for host in ("api.openai.com", "deepseek.com")
        )
    ):
        write = 0
    total_prompt = token_count(raw.get("prompt_tokens"))
    output = token_count(raw.get("completion_tokens"))
    input_count = (
        max(0, total_prompt - read - write)
        if total_prompt is not None and read is not None and write is not None
        else None
    )
    total = (
        input_count + output + read + write
        if input_count is not None and output is not None and read is not None and write is not None
        else None
    )
    usage = Usage(
        input=input_count,
        output=output,
        cache_read=read,
        cache_write=write,
        reasoning=token_count(completion.get("reasoning_tokens")),
        total_tokens=total,
    )
    usage.cost = calculate_usage_cost(usage, model.pricing)
    return usage
