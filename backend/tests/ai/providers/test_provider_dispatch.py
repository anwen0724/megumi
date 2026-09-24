"""Provider composition through the public stream and catalog contract."""

import pytest

from app.ai import AssistantResponse, Model, TextContent, Transcript
from app.ai import provider as provider_module
from app.ai.auth.helpers import env_api_key_auth
from app.ai.auth.types import ProviderAuth


class TextApi:
    def stream(self, model, context, options=None):
        async def produce(writer):
            writer.partial.content.append(TextContent(text=f"{model.provider}:{model.api}"))
            writer.emit({"type": "done", "reason": "stop", "message": writer.partial})

        return AssistantResponse(model, produce)

    def stream_simple(self, model, context, options=None):
        return self.stream(model, context, options)


@pytest.mark.asyncio
async def test_provider_delegates_custom_protocol_without_global_registration():
    model = Model(
        id="small",
        name="Small",
        provider="custom",
        api="custom-wire",
        context_window=4096,
        max_output_tokens=512,
    )
    provider = provider_module.create_provider(
        id="custom",
        name="Custom",
        base_url="https://example.test",
        auth=ProviderAuth(api_key=env_api_key_auth("Custom", ["CUSTOM_KEY"])),
        models=[model],
        api=TextApi(),
    )
    response = provider.stream_simple(model, Transcript(messages=[]))
    assert (await response.result()).content == [TextContent(text="custom:custom-wire")]
    assert provider.get_models() == (model,)
    await response.aclose()


@pytest.mark.asyncio
async def test_models_uses_provider_auth_and_custom_protocol():
    from app.ai import Context, Models
    from app.ai.auth.types import AuthResult

    class CustomAuth:
        name = "Custom credential source"

        async def resolve(self, ctx, credential):
            return AuthResult(key="custom-key", headers={"X-Tenant": "tenant-a"})

    class AuthenticatedApi(TextApi):
        def stream_simple(self, model, context, options=None):
            assert options.headers["authorization"] == "Bearer custom-key"
            assert options.headers["x-tenant"] == "tenant-a"
            assert context.messages[0].content == "system instruction"
            return super().stream_simple(model, context, options)

    model = Model(
        id="small",
        name="Small",
        provider="custom",
        api="custom-wire",
        context_window=4096,
        max_output_tokens=512,
    )
    provider = provider_module.create_provider(
        id="custom",
        base_url="https://example.test",
        auth=ProviderAuth(api_key=CustomAuth()),
        models=[model],
        api=AuthenticatedApi(),
    )
    models = Models([provider])
    try:
        result = await models.complete_simple(
            model, Context(messages=[], system_prompt="system instruction")
        )
        assert result.stop_reason == "stop", result.error_message
        assert result.content == [TextContent(text="custom:custom-wire")]
    finally:
        await models.aclose()


@pytest.mark.asyncio
async def test_delegated_call_keeps_the_initial_partial_reference():
    from app.ai import Context, Models, SimpleOptions

    model = Model(
        id="small",
        name="Small",
        provider="custom",
        api="custom-wire",
        context_window=4096,
        max_output_tokens=512,
    )
    provider = provider_module.create_provider(
        id="custom",
        base_url="https://example.test",
        auth=ProviderAuth(api_key=env_api_key_auth("Custom", ["CUSTOM_KEY"])),
        models=[model],
        api=TextApi(),
    )
    models = Models([provider])
    try:
        response = models.stream_simple(model, Context(messages=[]), SimpleOptions(api_key="fake"))
        partial = response.partial
        final = await response.result()
        assert response.partial is partial
        assert partial.content == final.content == [TextContent(text="custom:custom-wire")]
    finally:
        await models.aclose()
