"""Encode stateless conversation input for the Responses SDK."""

from app.ai.api.responses.options import ResponsesOptions
from app.ai.messages import JSONValue, Transcript, UserMessage
from app.ai.model import Model


def build_request(
    model: Model, transcript: Transcript, options: ResponsesOptions
) -> dict[str, JSONValue]:
    """Send full history rather than a previous_response_id dependency."""
    return {
        "model": model.id,
        "stream": True,
        "store": False,
        "input": [
            {"role": "user", "content": [{"type": "input_text", "text": message.content}]}
            for message in transcript.messages
            if isinstance(message, UserMessage) and isinstance(message.content, str)
        ],
    }
