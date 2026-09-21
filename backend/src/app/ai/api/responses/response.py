"""Assemble native Responses items without mixing protocol bookkeeping into messages."""

import json
from collections.abc import AsyncIterable
from dataclasses import dataclass
from typing import cast

from openai import BaseModel

from app.ai.messages import JSONValue, TextContent, ThinkingContent, ToolCall
from app.ai.stream import ResponseWriter
from app.ai.tools.arguments import parse_partial_arguments


async def consume_response(events: AsyncIterable[object], writer: ResponseWriter) -> None:
    """Consume the SDK iterator completely and require an overall terminal event."""
    assembly = ResponseAssembly(writer)
    writer.emit({"type": "start", "partial": writer.partial})
    async for native in events:
        if isinstance(native, BaseModel):
            assembly.feed(
                cast(dict[str, JSONValue], native.model_dump(mode="json", exclude_unset=True))
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

    def __init__(self, writer: ResponseWriter) -> None:
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
        elif kind == "response.completed":
            self.terminal = True

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
        self.partial.raw_stop_reason = "completed"
        self.writer.emit({"type": "done", "reason": "stop", "message": self.partial})


def required_string(value: dict[str, JSONValue], field: str) -> str:
    """Fail recognized malformed events instead of fabricating missing content."""
    result = value.get(field)
    if not isinstance(result, str):
        raise ValueError(f"Invalid Responses {field}")
    return result
