import { describe, expect, it } from 'vitest';
import { materializeModelStepOpenAICompatibleRequest } from '@megumi/ai/prompt/message-mapper';
import type { AiModelStepCompletionResult } from '@megumi/ai/types';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import { MemoryExtractionModelClientService } from '@megumi/desktop/main/services/memory/memory-extraction-model-client.service';

class FakeModelStepProvider {
  requests: ModelStepRuntimeRequest[] = [];

  constructor(private readonly result: AiModelStepCompletionResult) {}

  async completeModelStep(request: ModelStepRuntimeRequest): Promise<AiModelStepCompletionResult> {
    this.requests.push(request);
    return this.result;
  }
}

function providerFailure(): AiModelStepCompletionResult {
  return {
    ok: false,
    error: {
      code: 'provider_auth_failed',
      message: 'Provider failed.',
      severity: 'error',
      retryable: false,
      source: 'provider',
    },
  };
}

describe('MemoryExtractionModelClientService', () => {
  it('completes a hidden extraction model step and returns JSON text', async () => {
    const provider = new FakeModelStepProvider({ ok: true, text: '{ "candidates": [] }' });
    const client = new MemoryExtractionModelClientService({
      modelStepProvider: provider,
      ids: {
        requestId: () => 'memory-extraction-request-1',
        contextId: () => 'memory-extraction-context-1',
        traceId: () => 'memory-extraction-trace-1',
      },
      clock: { now: () => '2026-06-13T00:00:00.000Z' },
    });

    const result = await client.extractMemoryCandidates({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      prompt: {
        system: 'Return strict JSON only.',
        user: '{"signals":["explicit_remember"]}',
      },
    });

    expect(result).toEqual({ ok: true, text: '{ "candidates": [] }' });
    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0];
    expect(request).toBeDefined();

    let materialized: ReturnType<typeof materializeModelStepOpenAICompatibleRequest> | undefined;
    expect(() => {
      materialized = materializeModelStepOpenAICompatibleRequest(request!);
    }).not.toThrow();
    expect(materialized?.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user' }),
    ]));

    expect(request).toMatchObject({
      requestId: 'memory-extraction-request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'memory-extraction:run-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      inputContext: {
        contextId: 'memory-extraction-context-1',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'memory-extraction:run-1',
      },
    });
    expect(request?.inputContext.parts).toEqual([
      expect.objectContaining({
        kind: 'instruction',
        instructionKind: 'system',
        text: 'Return strict JSON only.',
        required: true,
      }),
      expect.objectContaining({
        kind: 'current_turn',
        role: 'user',
        text: '{"signals":["explicit_remember"]}',
        required: true,
      }),
    ]);
    expect(JSON.stringify(request)).not.toContain('MemoryRepository');
  });

  it('returns degraded reason when provider target is missing', async () => {
    const provider = new FakeModelStepProvider({ ok: true, text: '{ "candidates": [] }' });
    const client = new MemoryExtractionModelClientService({
      modelStepProvider: provider,
      ids: {
        requestId: () => 'memory-extraction-request-1',
        contextId: () => 'memory-extraction-context-1',
        traceId: () => 'memory-extraction-trace-1',
      },
      clock: { now: () => '2026-06-13T00:00:00.000Z' },
    });

    const result = await client.extractMemoryCandidates({
      runId: 'run-1',
      sessionId: 'session-1',
      prompt: {
        system: 'Return strict JSON only.',
        user: '{}',
      },
    });

    expect(result).toEqual({ ok: false, reason: 'missing_provider_target' });
    expect(provider.requests).toEqual([]);
  });

  it('returns provider failure reason without throwing', async () => {
    const provider = new FakeModelStepProvider(providerFailure());
    const client = new MemoryExtractionModelClientService({
      modelStepProvider: provider,
      ids: {
        requestId: () => 'memory-extraction-request-1',
        contextId: () => 'memory-extraction-context-1',
        traceId: () => 'memory-extraction-trace-1',
      },
      clock: { now: () => '2026-06-13T00:00:00.000Z' },
    });

    const result = await client.extractMemoryCandidates({
      runId: 'run-1',
      sessionId: 'session-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      prompt: {
        system: 'Return strict JSON only.',
        user: '{}',
      },
    });

    expect(result).toEqual({ ok: false, reason: 'provider_auth_failed' });
  });

  it('returns empty output reason when no assistant final text is produced', async () => {
    const provider = new FakeModelStepProvider({ ok: true, text: '   ' });
    const client = new MemoryExtractionModelClientService({
      modelStepProvider: provider,
      ids: {
        requestId: () => 'memory-extraction-request-1',
        contextId: () => 'memory-extraction-context-1',
        traceId: () => 'memory-extraction-trace-1',
      },
      clock: { now: () => '2026-06-13T00:00:00.000Z' },
    });

    const result = await client.extractMemoryCandidates({
      runId: 'run-1',
      sessionId: 'session-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      prompt: {
        system: 'Return strict JSON only.',
        user: '{}',
      },
    });

    expect(result).toEqual({ ok: false, reason: 'empty_extraction_output' });
  });
});
