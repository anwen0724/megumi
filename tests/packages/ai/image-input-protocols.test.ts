/* Verifies provider-neutral Base64 images map only at protocol adapter boundaries. */
import { describe, expect, it } from 'vitest';
import { createAnthropicProtocolAdapter, createOpenAICompatibleProtocolAdapter } from '@megumi/ai';
import type { ProtocolAdapterRequest } from '@megumi/ai/protocols/protocol-adapter-request';

const request: ProtocolAdapterRequest = {
  model: { providerId: 'provider', protocol: 'openai-compatible', modelId: 'model', baseUrl: 'https://example.com' },
  context: {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AQID' } },
      ],
    }],
  },
};

describe('image input protocol materialization', () => {
  it('maps Base64 images to OpenAI image_url data URLs', () => {
    const adapter = createOpenAICompatibleProtocolAdapter({ fetch: async () => new Response() });
    expect(adapter.materialize?.(request)).toMatchObject({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ],
      }],
    });
  });

  it('maps Base64 images to Anthropic image source blocks', () => {
    const adapter = createAnthropicProtocolAdapter();
    expect(adapter.materialize?.({ ...request, model: { ...request.model, protocol: 'anthropic' } })).toMatchObject({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
        ],
      }],
    });
  });
});
