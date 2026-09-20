"""Public configuration API for the Python AI layer; importing performs no I/O."""

from app.ai.auth.memory import InMemoryCredentialStore
from app.ai.auth.types import ApiKeyCredential, AuthOverride, CredentialStore, ResolvedAuth
from app.ai.codec import decode_messages, encode_messages
from app.ai.errors import AuthError, ConfigurationError, LifecycleError
from app.ai.messages import (
    AssistantContent,
    AssistantMessage,
    ImageContent,
    InputContent,
    JsonSchemaSampling,
    JSONValue,
    Message,
    StopReason,
    SystemMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ToolDefinition,
    ToolResultMessage,
    Usage,
    UsageCost,
    UserMessage,
)
from app.ai.model import (
    CatalogSource,
    Model,
    ModelCapabilities,
    ModelCompat,
    Pricing,
    PricingTier,
    clamp_thinking_level,
    get_supported_thinking_levels,
)
from app.ai.models import Models, create_models
from app.ai.provider import Provider
from app.ai.providers.deepseek import deepseek_provider
from app.ai.providers.openai import openai_provider

__all__ = [
    "ApiKeyCredential",
    "AssistantContent",
    "AssistantMessage",
    "AuthError",
    "AuthOverride",
    "CatalogSource",
    "ConfigurationError",
    "CredentialStore",
    "ImageContent",
    "InMemoryCredentialStore",
    "InputContent",
    "JSONValue",
    "JsonSchemaSampling",
    "LifecycleError",
    "Message",
    "Model",
    "ModelCapabilities",
    "ModelCompat",
    "Models",
    "Pricing",
    "PricingTier",
    "Provider",
    "ResolvedAuth",
    "StopReason",
    "SystemMessage",
    "TextContent",
    "ThinkingContent",
    "ToolCall",
    "ToolDefinition",
    "ToolResultMessage",
    "Usage",
    "UsageCost",
    "UserMessage",
    "clamp_thinking_level",
    "create_models",
    "decode_messages",
    "deepseek_provider",
    "encode_messages",
    "get_supported_thinking_levels",
    "openai_provider",
]
