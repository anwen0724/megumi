import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentLoopInitialModelInputPreparationService,
  createLegacyModelInputContextFromPrompt,
} from '@megumi/coding-agent/context/initial-model-input-preparation';
import type { BuildModelCallInputInput } from '@megumi/coding-agent/context/model-call-input-builder';
import type { BuildModelCallInputResult } from '@megumi/coding-agent/context/model-call-input-builder';
import type { Prompt } from '@megumi/coding-agent/context';

describe('context agent loop compatibility', () => {
  it('maps context Prompt to legacy ModelInputContext outside context core', () => {
    const prompt: Prompt = {
      prompt_id: 'prompt:1',
      purpose: 'agent_response',
      messages: [
        { role: 'system', content: 'You are Megumi' },
        { role: 'user', content: 'fix tests' },
      ],
      source_refs: [],
    };

    const legacy = createLegacyModelInputContextFromPrompt({
      prompt,
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      builtAt: '2026-07-03T00:00:00.000Z',
    });

    expect(legacy.parts.map((part) => part.kind)).toEqual(['instruction', 'current_turn']);
    expect(fs.existsSync(path.join(process.cwd(), 'packages/coding-agent/context/core/legacy-model-input-compatibility.ts'))).toBe(false);
  });

  it('agent-loop initial preparation calls ContextService before building legacy model input', async () => {
    const contextPromptService = {
      getSessionContext: vi.fn(async () => ({
        status: 'ok' as const,
        session_context: {
          session_id: 'session:1',
          sources: [{
            source_id: 'message:current',
            source_kind: 'session_message' as const,
            text: 'fix tests',
            persisted: true,
            metadata: { role: 'user' },
          }],
        },
      })),
      buildPrompt: vi.fn(() => ({
        status: 'ok' as const,
        prompt: {
          prompt_id: 'prompt:1',
          purpose: 'agent_response' as const,
          messages: [
            { role: 'system' as const, content: 'You are Megumi' },
            { role: 'user' as const, content: 'fix tests' },
          ],
          source_refs: [],
        },
      })),
    };
    const modelCallInputBuildService = {
      buildModelCallInput: vi.fn(async (input: BuildModelCallInputInput): Promise<BuildModelCallInputResult> => {
        if (input.contextKind === 'initial') {
          throw new Error('old builder should not be called for initial input');
        }
        return successfulModelStepInputBuild(input);
      }),
    };
    const service = new AgentLoopInitialModelInputPreparationService({
      promptContextService: contextPromptService,
      sessionContextInputService: {
        buildSessionContextInput: vi.fn(() => ({ historyEntries: [], runtimeFacts: [], maxHistoryEntries: 24 })),
      },
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides: vi.fn(() => ({})),
      },
      modelCallInputBuildService,
    });

    const preparation = await service.prepare({
      requestId: 'request:1',
      session: {
        sessionId: 'session:1',
        title: 'Session',
        status: 'active',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
      run: {
        runId: 'run:1',
        sessionId: 'session:1',
        status: 'running',
        createdAt: '2026-07-03T00:00:00.000Z',
      } as any,
      step: {
        stepId: 'step:1',
        runId: 'run:1',
        index: 0,
        status: 'running',
        createdAt: '2026-07-03T00:00:00.000Z',
      } as any,
      userMessage: {
        messageId: 'message:current',
        sessionId: 'session:1',
        role: 'user',
        content: 'fix tests',
        status: 'completed',
        createdAt: '2026-07-03T00:00:00.000Z',
      },
      providerId: 'openai',
      modelId: 'gpt-test',
      permissionMode: 'plan',
      inputPreprocessing: {
        originalText: 'fix tests',
        effectiveUserText: 'fix tests',
        entries: [],
        diagnostics: [],
      },
      createdAt: '2026-07-03T00:00:00.000Z',
    });

    const result = await preparation.buildInitialModelInput();

    expect(contextPromptService.getSessionContext).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'session:1',
      purpose: 'agent_response',
    }));
    expect(contextPromptService.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      current_user_message_id: 'message:current',
    }));
    expect(result.inputContext.parts.map((part) => part.kind)).toEqual(['instruction', 'current_turn']);
    expect(modelCallInputBuildService.buildModelCallInput).not.toHaveBeenCalledWith(expect.objectContaining({
      contextKind: 'initial',
    }));
  });
});

function successfulModelStepInputBuild(input: BuildModelCallInputInput): BuildModelCallInputResult {
  const inputContext = createLegacyModelInputContextFromPrompt({
    prompt: {
      prompt_id: `prompt:${input.contextKind}`,
      purpose: 'agent_response',
      messages: [
        { role: 'system', content: 'You are Megumi' },
        { role: 'user', content: input.currentMessage?.content ?? 'hello' },
      ],
      source_refs: [],
    },
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    builtAt: input.builtAt,
  });

  return {
    buildRequest: {
      requestId: `model-input-build:${input.runId}:${input.stepId}:${input.contextKind}`,
      contextId: inputContext.contextId,
      sessionId: input.sessionId,
      runId: input.runId,
      modelStepId: input.stepId,
      modelTarget: {
        providerId: input.providerId,
        modelId: input.modelId,
      },
      runtimeFacts: [],
      traceId: `trace:${input.contextKind}`,
      builtAt: input.builtAt,
      metadata: { contextKind: input.contextKind },
    },
    inputContext,
    toolDefinitions: input.toolDefinitions ?? [],
    instructionSources: [],
    availableCapabilitySummary: 'Available tools: none.',
  };
}
