"""Assemble native Responses items without mixing protocol bookkeeping into messages."""

import json
from collections.abc import AsyncIterable
from dataclasses import dataclass
from typing import cast

from openai import BaseModel

from app.ai.messages import JSONValue, TextContent, ThinkingContent, ToolCall, Usage
from app.ai.model import Model
from app.ai.stream import ResponseWriter
from app.ai.tools.arguments import parse_partial_arguments
from app.ai.usage import calculate_usage_cost


async def consume_response(
    events: AsyncIterable[object],
    writer: ResponseWriter,
    model: Model,
    request_service_tier: str | None,
) -> None:
    """Consume the SDK iterator completely and require an overall terminal event."""
    assembly = ResponseAssembly(writer, model, request_service_tier)
    writer.emit({"type": "start", "partial": writer.partial})
    async for native in events:
        if isinstance(native, BaseModel):
            assembly.feed(
                cast(
                    dict[str, JSONValue],
                    native.model_dump(mode="json", exclude_unset=True, warnings=False),
                )
            )
    assembly.finish()


@dataclass
class OutputSlot:
    """Keep native item identity separate from persistable content."""

    block: TextContent | ThinkingContent | ToolCall
    content_index: int
    item_id: str
    arguments: str = ""


class ResponseAssembly:
    """Associate interleaved output indices and publish authoritative item completions."""

    def __init__(
        self, writer: ResponseWriter, model: Model, request_service_tier: str | None
    ) -> None:
        self.model = model
        self.request_service_tier = request_service_tier
        self.writer = writer
        self.partial = writer.partial
        self.slots: dict[int, OutputSlot] = {}
        self.by_id: dict[str, OutputSlot] = {}
        self.terminal = False

    def create_slot(self, index: int, item: dict[str, JSONValue]) -> OutputSlot | None:
        """Create supported content on added or done-only item events."""
        if item.get("type") not in ("message", "reasoning", "function_call"):
            return None
        identity = required_string(item, "id")
        block: TextContent | ThinkingContent | ToolCall
        if item["type"] == "reasoning":
            block = ThinkingContent(thinking="")
        elif item["type"] == "function_call":
            namespace = item.get("namespace")
            block = ToolCall(
                id=f"{required_string(item, 'call_id')}|{identity}",
                name=required_string(item, "name"),
                arguments={},
                namespace=namespace if isinstance(namespace, str) else None,
            )
        else:
            block = TextContent(text="")
        slot = OutputSlot(block, len(self.partial.content), identity)
        if isinstance(block, ToolCall):
            arguments = item.get("arguments")
            slot.arguments = arguments if isinstance(arguments, str) else ""
        self.slots[index] = slot
        self.by_id[identity] = slot
        self.partial.content.append(block)
        if isinstance(block, ToolCall):
            self.writer.emit(
                {
                    "type": "toolcall_start",
                    "content_index": slot.content_index,
                    "partial": self.partial,
                }
            )
        else:
            self.writer.emit(
                {
                    "type": "thinking_start"
                    if isinstance(block, ThinkingContent)
                    else "text_start",
                    "content_index": slot.content_index,
                    "partial": self.partial,
                }
            )
        return slot

    def feed(self, event: dict[str, JSONValue]) -> None:
        """Ignore auxiliary events while validating fields of recognized content events."""
        kind = event.get("type")
        response = event.get("response")
        if isinstance(response, dict):
            identity, model = response.get("id"), response.get("model")
            if isinstance(identity, str):
                self.partial.response_id = identity
            if isinstance(model, str) and model != self.partial.model:
                self.partial.response_model = model
        if kind in ("response.output_item.added", "response.output_item.done"):
            item = event.get("item")
            index = event.get("output_index")
            if not isinstance(item, dict) or type(index) is not int:
                raise ValueError("Invalid Responses output item event")
            slot = self.slots.get(index) or self.create_slot(index, item)
            if slot and kind == "response.output_item.done":
                self.end_item(slot, item)
                self.slots.pop(index, None)
            return
        index = event.get("output_index")
        identity = event.get("item_id")
        slot = self.slots.get(index) if type(index) is int else None
        if slot is None and isinstance(identity, str):
            slot = self.by_id.get(identity)
        expected_type = (
            {
                "response.output_text.delta": TextContent,
                "response.output_text.done": TextContent,
                "response.refusal.delta": TextContent,
                "response.refusal.done": TextContent,
                "response.reasoning_summary_text.delta": ThinkingContent,
                "response.reasoning_text.delta": ThinkingContent,
                "response.reasoning_summary_part.done": ThinkingContent,
                "response.function_call_arguments.delta": ToolCall,
                "response.function_call_arguments.done": ToolCall,
            }.get(kind)
            if isinstance(kind, str)
            else None
        )
        if expected_type and (slot is None or not isinstance(slot.block, expected_type)):
            raise ValueError("Invalid Responses content event: missing or incompatible item")
        if (
            kind in ("response.output_text.delta", "response.refusal.delta")
            and slot
            and isinstance(slot.block, TextContent)
        ):
            delta = required_string(event, "delta")
            slot.block.text += delta
            self.writer.emit(
                {
                    "type": "text_delta",
                    "content_index": slot.content_index,
                    "delta": delta,
                    "partial": self.partial,
                }
            )
        elif (
            kind in ("response.output_text.done", "response.refusal.done")
            and slot
            and isinstance(slot.block, TextContent)
        ):
            slot.block.text = required_string(
                event, "text" if kind == "response.output_text.done" else "refusal"
            )
        elif (
            kind
            in (
                "response.reasoning_summary_text.delta",
                "response.reasoning_text.delta",
                "response.reasoning_summary_part.done",
            )
            and slot
            and isinstance(slot.block, ThinkingContent)
        ):
            delta = (
                "\n\n"
                if kind == "response.reasoning_summary_part.done"
                else required_string(event, "delta")
            )
            slot.block.thinking += delta
            self.writer.emit(
                {
                    "type": "thinking_delta",
                    "content_index": slot.content_index,
                    "delta": delta,
                    "partial": self.partial,
                }
            )
        elif (
            kind
            in ("response.function_call_arguments.delta", "response.function_call_arguments.done")
            and slot
            and isinstance(slot.block, ToolCall)
        ):
            if kind.endswith(".delta"):
                delta = required_string(event, "delta")
                slot.arguments += delta
            else:
                arguments = required_string(event, "arguments")
                delta = (
                    arguments[len(slot.arguments) :] if arguments.startswith(slot.arguments) else ""
                )
                slot.arguments = arguments
            slot.block.arguments = parse_partial_arguments(slot.arguments)
            if delta:
                self.writer.emit(
                    {
                        "type": "toolcall_delta",
                        "content_index": slot.content_index,
                        "delta": delta,
                        "partial": self.partial,
                    }
                )
        elif kind in ("response.completed", "response.incomplete", "response.failed"):
            if not isinstance(response, dict):
                raise ValueError("Invalid Responses terminal response")
            self.set_terminal(response)
        elif kind == "error":
            code = event.get("code")
            self.partial.raw_stop_reason = code if isinstance(code, str) else "error"
            raise ValueError(f"Error Code {code}: {required_string(event, 'message')}")

    def end_item(self, slot: OutputSlot, item: dict[str, JSONValue]) -> None:
        """Replace partial text with authoritative content and record replay identity."""
        if isinstance(slot.block, ToolCall):
            arguments = item.get("arguments")
            slot.block.arguments = parse_partial_arguments(
                arguments if isinstance(arguments, str) else slot.arguments
            )
            namespace = item.get("namespace")
            if isinstance(namespace, str):
                slot.block.namespace = namespace
            self.writer.emit(
                {
                    "type": "toolcall_end",
                    "content_index": slot.content_index,
                    "tool_call": slot.block,
                    "partial": self.partial,
                }
            )
            slot.arguments = ""
            return
        if isinstance(slot.block, ThinkingContent):
            summary = item.get("summary")
            content = item.get("content")
            parts = summary if isinstance(summary, list) and summary else content
            if isinstance(parts, list) and parts:
                slot.block.thinking = "\n\n".join(
                    required_string(part, "text") for part in parts if isinstance(part, dict)
                )
            slot.block.thinking_signature = json.dumps(item, separators=(",", ":"))
            self.writer.emit(
                {
                    "type": "thinking_end",
                    "content_index": slot.content_index,
                    "content": slot.block.thinking,
                    "partial": self.partial,
                }
            )
            return
        content = item.get("content")
        if isinstance(content, list):
            slot.block.text = "".join(
                required_string(part, "text" if part.get("type") == "output_text" else "refusal")
                for part in content
                if isinstance(part, dict) and part.get("type") in ("output_text", "refusal")
            )
        signature: dict[str, JSONValue] = {"v": 1, "id": slot.item_id}
        if item.get("phase") in ("commentary", "final_answer"):
            signature["phase"] = item["phase"]
        slot.block.text_signature = json.dumps(signature, separators=(",", ":"))
        self.writer.emit(
            {
                "type": "text_end",
                "content_index": slot.content_index,
                "content": slot.block.text,
                "partial": self.partial,
            }
        )

    def finish(self) -> None:
        """Do not treat item completion or EOF as an overall successful response."""
        if not self.terminal:
            raise ValueError("Responses stream ended without a terminal response event")
        reason = self.partial.stop_reason
        if reason in ("stop", "length", "tool_use"):
            self.writer.emit({"type": "done", "reason": reason, "message": self.partial})
        else:
            self.writer.emit({"type": "error", "reason": "error", "error": self.partial})

    def set_terminal(self, response: dict[str, JSONValue]) -> None:
        """Map overall status independently of whether individual content items finished."""
        raw_usage = response.get("usage")
        if isinstance(raw_usage, dict):
            self.partial.usage = parse_usage(raw_usage, self.model)
            tier = response.get("service_tier")
            self.partial.usage.cost = calculate_usage_cost(
                self.partial.usage,
                self.model.pricing,
                response_service_tier=tier if isinstance(tier, str) else None,
                request_service_tier=self.request_service_tier,
            )
        output = response.get("output")
        if isinstance(output, list):
            for item in output:
                if not isinstance(item, dict) or item.get("type") != "reasoning":
                    continue
                identity, encrypted = item.get("id"), item.get("encrypted_content")
                slot = self.by_id.get(identity) if isinstance(identity, str) else None
                if (
                    slot
                    and isinstance(slot.block, ThinkingContent)
                    and encrypted
                    and slot.block.thinking_signature
                ):
                    saved = json.loads(slot.block.thinking_signature)
                    if not saved.get("encrypted_content"):
                        saved["encrypted_content"] = encrypted
                        slot.block.thinking_signature = json.dumps(saved, separators=(",", ":"))
        status = required_string(response, "status")
        self.terminal = True
        self.partial.raw_stop_reason = status
        if status == "completed":
            self.partial.stop_reason = (
                "tool_use" if any(isinstance(b, ToolCall) for b in self.partial.content) else "stop"
            )
            return
        details = response.get("incomplete_details")
        reason = details.get("reason") if isinstance(details, dict) else None
        if isinstance(reason, str):
            self.partial.raw_stop_reason = reason
        if status == "incomplete" and reason == "max_output_tokens":
            self.partial.stop_reason = "length"
            return
        self.partial.stop_reason = "error"
        error = response.get("error")
        if isinstance(error, dict):
            self.partial.error_message = f"{error.get('code')}: {error.get('message')}"
        elif status == "incomplete":
            self.partial.error_message = (
                f"Response incomplete: {reason}"
                if reason
                else "Response incomplete without a provider reason"
            )
        else:
            self.partial.error_message = f"Response status: {status}"


def required_string(value: dict[str, JSONValue], field: str) -> str:
    """Fail recognized malformed events instead of fabricating missing content."""
    result = value.get(field)
    if not isinstance(result, str):
        raise ValueError(f"Invalid Responses {field}")
    return result


def token_count(value: JSONValue) -> int | None:
    """Absent or non-integer counts remain unknown."""
    return value if type(value) is int else None


def parse_usage(raw: dict[str, JSONValue], model: Model) -> Usage:
    """Subtract known cache components, but retain the supplier's reported total."""
    details = raw.get("input_tokens_details")
    details = details if isinstance(details, dict) else {}
    output_details = raw.get("output_tokens_details")
    output_details = output_details if isinstance(output_details, dict) else {}
    read = token_count(details.get("cached_tokens"))
    write = token_count(details.get("cache_write_tokens"))
    if write is None and (
        model.provider == "openai" or "api.openai.com" in (model.base_url or "").lower()
    ):
        # OpenAI automatic prompt caching has no separately charged cache-write counter.
        write = 0
    input_total = token_count(raw.get("input_tokens"))
    return Usage(
        input=max(0, input_total - read - write)
        if input_total is not None and read is not None and write is not None
        else None,
        output=token_count(raw.get("output_tokens")),
        cache_read=read,
        cache_write=write,
        reasoning=token_count(output_details.get("reasoning_tokens")),
        total_tokens=token_count(raw.get("total_tokens")),
    )
