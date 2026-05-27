// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelInputContext } from '@megumi/context-management';
import { mapModelInputContextToOpenAICompatibleMessages } from '@megumi/ai/prompt/model-input-context-mapper';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';

const builtAt = '2026-05-27T00:00:00.000Z';

function sourceRef(sourceId: string, sourceKind: ModelInputContextSourceRef['sourceKind']): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}:${sourceId}`,
    loadedAt: builtAt,
  };
}

function basePart(overrides: Partial<ModelInputContextPart>): ModelInputContextPart {
  const kind = overrides.kind ?? 'current_turn';
  const part = {
    partId: 'part:current-turn:1',
    kind,
    text: 'Continue.',
    sourceRefs: [sourceRef('message:1', 'current_user_message')],
    priority: 90,
    budgetStatus: 'included_full',
    ...overrides,
  };

  if (kind === 'current_turn') {
    return {
      role: 'user',
      ...part,
      kind,
    } as ModelInputContextPart;
  }

  return part as ModelInputContextPart;
}

describe('ModelInputContext OpenAI-compatible mapper', () => {
  it('materializes model input context parts into provider messages in order', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        basePart({
          partId: 'part:instruction:system',
          kind: 'instruction',
          instructionKind: 'system',
          text: 'You are Megumi.',
          sourceRefs: [sourceRef('system:1', 'system_instruction')],
          priority: 100,
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:instruction:project',
          kind: 'instruction',
          instructionKind: 'project',
          text: 'Follow project instructions.',
          sourceRefs: [sourceRef('project-instruction:1', 'project_instruction')],
          priority: 100,
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:current-turn:1',
          kind: 'current_turn',
          role: 'user',
          text: 'Review Plan 2.',
          sourceRefs: [sourceRef('message:1', 'current_user_message')],
          priority: 90,
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:session:1',
          kind: 'session',
          text: 'Earlier, the user confirmed the Model Input Context contract.',
          sourceRefs: [sourceRef('timeline-message:1', 'timeline_message')],
          priority: 60,
          budgetStatus: 'included_reduced',
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:tool-use:1',
          kind: 'tool_continuation',
          text: 'Tool use tool-use:1 requested read_file.',
          sourceRefs: [sourceRef('tool-use:1', 'tool_use')],
          priority: 80,
          toolUseId: 'tool-use:1',
          modelStepId: 'model-step:1',
          toolName: 'read_file',
          toolInput: {
            path: 'package.json',
          },
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:tool-result:1',
          kind: 'tool_continuation',
          text: 'read_file returned the current provider mapper.',
          sourceRefs: [sourceRef('tool-result:1', 'tool_result')],
          priority: 80,
          toolUseId: 'tool-use:1',
          toolResultId: 'tool-result:1',
          toolResultContent: 'read_file returned the current provider mapper.',
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:runtime:1',
          kind: 'runtime_constraint',
          constraintKind: 'permission_mode',
          text: 'Permission mode is plan.',
          sourceRefs: [sourceRef('permission-mode:1', 'permission_mode')],
          priority: 80,
        } as Partial<ModelInputContextPart>),
      ],
    });

    expect(mapModelInputContextToOpenAICompatibleMessages(context)).toEqual([
      {
        role: 'system',
        content: 'You are Megumi.',
      },
      {
        role: 'system',
        content: 'Follow project instructions.',
      },
      {
        role: 'user',
        content: 'Review Plan 2.',
      },
      {
        role: 'system',
        content: 'Earlier, the user confirmed the Model Input Context contract.',
      },
      {
        role: 'system',
        content: 'Permission mode is plan.',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tool-use:1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"package.json"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tool-use:1',
        content: 'read_file returned the current provider mapper.',
      },
    ]);
  });

  it('does not consume tool result parts without structured replay content as native tool messages', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:missing-tool-result-content',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'tool_continuation',
      builtAt,
      parts: [
        basePart({
          partId: 'part:tool-use:missing-result-content',
          kind: 'tool_continuation',
          text: 'Tool use tool-use:missing-result-content requested read_file.',
          sourceRefs: [sourceRef('tool-use:missing-result-content', 'tool_use')],
          toolUseId: 'tool-use:missing-result-content',
          modelStepId: 'model-step:missing-result-content',
          toolName: 'read_file',
          toolInput: {
            path: 'package.json',
          },
        } as Partial<ModelInputContextPart>),
        basePart({
          partId: 'part:tool-result:missing-content',
          kind: 'tool_continuation',
          text: 'Tool result text without structured replay content.',
          sourceRefs: [sourceRef('tool-result:missing-content', 'tool_result')],
          toolUseId: 'tool-use:missing-result-content',
          toolResultId: 'tool-result:missing-content',
        } as Partial<ModelInputContextPart>),
      ],
    });

    const messages = mapModelInputContextToOpenAICompatibleMessages(context);

    expect(messages).toEqual([
      {
        role: 'system',
        content: 'Tool use tool-use:missing-result-content requested read_file.',
      },
      {
        role: 'system',
        content: 'Tool result text without structured replay content.',
      },
    ]);
    expect(messages.some((message) => message.role === 'tool')).toBe(false);
  });

  it('does not materialize trace, budget, source refs, or runtime metadata as prompt content', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:2',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        basePart({
          text: 'Visible user request.',
          metadata: {
            debugOnly: 'must not appear',
          },
        }),
      ],
      excludedSources: [
        {
          sourceRef: sourceRef('timeline-message:old', 'timeline_message'),
          reason: 'outside_recent_window',
        },
      ],
    });

    const messagesJson = JSON.stringify(mapModelInputContextToOpenAICompatibleMessages(context));

    expect(messagesJson).toContain('Visible user request.');
    expect(messagesJson).not.toContain('sourceRefs');
    expect(messagesJson).not.toContain('outside_recent_window');
    expect(messagesJson).not.toContain('must not appear');
    expect(messagesJson).not.toContain('modelContextWindow');
  });
});
