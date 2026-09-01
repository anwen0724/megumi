/* Verifies injected Provider streams resolve through the same Product model seam. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeModels } from '../../../packages/agent/composition/src/model-composer';
import { createScriptedStreams } from './compose-test-application';

describe('Composition model resolver', () => {
  it('creates a configured model over injected streams without stored credentials', async () => {
    const scripted = createScriptedStreams(['reply']);
    const composition = composeModels({ apiImplementations: { 'openai-completions': scripted.streams } });
    const model = await composition.resolveModel({
      provider_id: 'test',
      model_id: 'model',
      api: 'openai-completions',
      base_url: 'https://example.test/v1',
      display_name: 'Test Model',
      context_window_tokens: 64_000,
      max_output_tokens: 2_048,
      capabilities: { imageInput: false, thinking: false },
    });
    const response = await composition.models.completeSimple(model, {
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 0 }],
    });
    expect(response.content).toEqual([{ type: 'text', text: 'reply' }]);
  });
});
