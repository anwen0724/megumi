// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelInputContext } from '@megumi/shared/model-input-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';

const builtAt = '2026-05-27T00:00:00.000Z';

function inputContext(): ModelInputContext {
  return {
    contextId: 'model-input-context:1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    parts: [
      {
        partId: 'part:current-turn:1',
        kind: 'current_turn',
        role: 'user',
        text: 'Hello',
        sourceRefs: [
          {
            sourceId: 'message-1',
            sourceKind: 'current_user_message',
          },
        ],
        priority: 90,
        tokenEstimate: 2,
        budgetStatus: 'included_full',
      },
    ],
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 4096,
      inputTokenEstimate: 2,
      partBudgets: [
        {
          partId: 'part:current-turn:1',
          tokenEstimate: 2,
          budgetStatus: 'included_full',
        },
      ],
    },
    trace: {
      buildReason: 'initial_model_step',
      selectedSources: [
        {
          sourceId: 'message-1',
          reason: 'current_turn',
        },
      ],
      excludedSources: [],
    },
    builtAt,
  };
}

describe('model step contracts', () => {
  it('keeps model step requests portable across core and ai packages', () => {
    const request: ModelStepRuntimeRequest = {
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      inputContext: inputContext(),
      createdAt: '2026-05-17T00:00:00.000Z',
    };

    expect(request.stepId).toBe('step-1');
    expect(request.inputContext.parts[0]?.kind).toBe('current_turn');
    expect(request).not.toHaveProperty('messages');
    expect(request).not.toHaveProperty('context');
  });

  it('keeps ModelStepRuntimeRequest centered on required inputContext', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/shared/model-step-contracts.ts'), 'utf8');

    expect(source).toContain('inputContext: ModelInputContext');
    expect(source).not.toMatch(/\bmessages:\s*SessionMessage\[\]/);
    expect(source).not.toMatch(/\bcontext\?:\s*RunContext/);
    expect(source).not.toMatch(/\btoolUses\?:\s*ToolUse\[\]/);
    expect(source).not.toMatch(/\btoolResults\?:\s*ToolResult\[\]/);
    expect(source).not.toMatch(/\bproviderStates\?:\s*ModelStepProviderState\[\]/);
    expect(source).not.toMatch(/\bmodeSnapshot\?:\s*PermissionModeSnapshot/);
    expect(source).not.toMatch(/\bmodeSnapshotRef\?:\s*string/);
  });
});
