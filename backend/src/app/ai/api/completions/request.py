"""Encode prepared transcripts for the Chat Completions SDK."""

from app.ai.messages import JSONValue, Transcript, UserMessage
from app.ai.model import Model


def build_request(model: Model, transcript: Transcript) -> dict[str, JSONValue]:
    """Encode the model and conversation into a streaming request."""
    return {
        "model": model.id,
        "stream": True,
        "messages": [
            {"role": "user", "content": message.content}
            for message in transcript.messages
            if isinstance(message, UserMessage) and isinstance(message.content, str)
        ],
    }
