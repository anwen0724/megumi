/* Verifies the text-model call boundary validates results and classifies failures. */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider } from '@megumi/ai';
import { callTextModel } from '@megumi/application/recommendation/call-text-model';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ResultSchema = z.object({ summary: z.string().min(1) }).strict();

function textModelClient() {
  const faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel(faux.provider.id, 'faux-supply');
  if (!model) throw new Error('expected the faux model to be registered');

  return {
    faux,
    models,
    model,
  };
}

const request = {
  systemPrompt: 'Analyze one content.',
  prompt: 'content text',
  schema: ResultSchema,
  maxOutputTokens: 256,
};

describe('text model call boundary', () => {
  it('returns the validated business result with its usage record', async () => {
    const { faux, models, model } = textModelClient();
    faux.setResponses([fauxAssistantMessage('```json\n{"summary":"材料可用"}\n```')]);

    const result = await callTextModel(models, {
      model,
      ...request,
    });

    expect(result.status).toBe('ok');

    if (result.status !== 'ok') throw new Error('expected a validated result');

    expect(result.result).toEqual({ summary: '材料可用' });
    expect(result.record.usage.totalTokens).toBeGreaterThan(0);
  });

  it('reports a structurally invalid answer instead of accepting partial data', async () => {
    const { faux, models, model } = textModelClient();
    faux.setResponses([fauxAssistantMessage('{"summary":""}')]);

    const result = await callTextModel(models, {
      model,
      ...request,
    });

    expect(result.status).toBe('failed');

    if (result.status !== 'failed') throw new Error('expected a failure');

    expect(result.code).toBe('INVALID_RESULT');
  });

  it('reports an interrupted request as a transport failure', async () => {
    const { faux, models, model } = textModelClient();
    faux.setResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'upstream 500',
      }),
    ]);

    const result = await callTextModel(models, {
      model,
      ...request,
    });

    expect(result.status).toBe('failed');

    if (result.status !== 'failed') throw new Error('expected a failure');

    expect(result.code).toBe('TRANSPORT');
  });

  it('reports an answer cut off at the output limit as a context overflow', async () => {
    const { faux, models, model } = textModelClient();
    faux.setResponses([fauxAssistantMessage('{"summary":"x"}', { stopReason: 'length' })]);

    const result = await callTextModel(models, {
      model,
      ...request,
    });

    expect(result.status).toBe('failed');

    if (result.status !== 'failed') throw new Error('expected a failure');

    expect(result.code).toBe('CONTEXT_OVERFLOW');
  });
});
