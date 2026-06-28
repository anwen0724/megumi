// Verifies Desktop Main trusted input preprocessing normalization before session runs are created.
import { describe, expect, it } from 'vitest';
import { normalizeSessionMessageInputPreprocessing } from '@megumi/coding-agent/input';

const createdAt = '2026-06-12T00:00:00.000Z';

describe('session message input preprocessing', () => {
  it('normalizes review preprocessing to plan permission with intent-default source', () => {
    const result = normalizeSessionMessageInputPreprocessing({
      rawText: '/review 当前改动',
      requestedPermissionMode: 'default',
      requestedPermissionSource: 'user',
      createdAt,
      preprocessing: {
        originalText: '/review 当前改动',
        effectiveUserText: '当前改动',
        entries: [
          {
            kind: 'intent',
            sourceId: 'input:intent:review',
            sourceName: '/review',
            visibility: 'model_visible',
            instructionText: 'Current input comes from the review intent.',
            intentId: 'review',
            commandName: 'review',
            defaultPermissionMode: 'plan',
            defaultPermissionSource: 'intent_default',
            metadata: {
              intentName: 'code_review',
              argsText: '当前改动',
            },
          },
        ],
        diagnostics: [],
      },
    });

    expect(result.permissionMode).toBe('plan');
    expect(result.permissionSource).toBe('intent_default');
    expect(result.effectiveUserText).toBe('当前改动');
    expect(result.inputPreprocessing.entries).toContainEqual(expect.objectContaining({
      kind: 'input_hook',
      hookId: 'default',
      action: 'continue',
      visibility: 'host_only',
    }));
    expect(result.metadata).toMatchObject({
      inputPreprocessing: {
        originalText: '/review 当前改动',
        effectiveUserText: '当前改动',
      },
    });
  });

  it('keeps summary preprocessing on the selected permission mode', () => {
    const result = normalizeSessionMessageInputPreprocessing({
      rawText: '/summary',
      requestedPermissionMode: 'accept_edits',
      requestedPermissionSource: 'user',
      createdAt,
      preprocessing: {
        originalText: '/summary',
        effectiveUserText: '总结当前会话',
        entries: [
          {
            kind: 'prompt_template',
            sourceId: 'input:prompt-template:summary',
            sourceName: '/summary',
            visibility: 'model_visible',
            instructionText: '请总结当前会话。',
            templateId: 'summary',
            commandName: 'summary',
            templateSource: 'builtin',
          },
        ],
        diagnostics: [],
      },
    });

    expect(result.permissionMode).toBe('accept_edits');
    expect(result.permissionSource).toBe('user');
    expect(result.inputPreprocessing.entries.map((entry) => entry.kind)).toEqual([
      'prompt_template',
      'input_hook',
    ]);
  });

  it('falls back to ordinary user input when preprocessing is absent', () => {
    const result = normalizeSessionMessageInputPreprocessing({
      rawText: '普通消息',
      requestedPermissionMode: 'default',
      requestedPermissionSource: 'user',
      createdAt,
    });

    expect(result.effectiveUserText).toBe('普通消息');
    expect(result.inputPreprocessing).toEqual({
      originalText: '普通消息',
      effectiveUserText: '普通消息',
      entries: [
        {
          kind: 'input_hook',
          sourceId: 'input:hook:default',
          sourceName: 'default input hook',
          visibility: 'host_only',
          hookId: 'default',
          action: 'continue',
          metadata: {
            action: 'continue',
          },
        },
      ],
      diagnostics: [
        {
          code: 'input_hook_continue',
          message: 'Default input hook continued without changes.',
          metadata: {
            hookId: 'default',
          },
        },
      ],
    });
  });

  it('rejects mismatched legacy-free review intent metadata inside preprocessing entries', () => {
    expect(() => normalizeSessionMessageInputPreprocessing({
      rawText: '/review 当前改动',
      requestedPermissionMode: 'default',
      requestedPermissionSource: 'user',
      createdAt,
      preprocessing: {
        originalText: '/review 当前改动',
        effectiveUserText: '当前改动',
        entries: [
          {
            kind: 'intent',
            sourceId: 'input:intent:review',
            sourceName: '/review',
            visibility: 'model_visible',
            instructionText: 'Current input comes from the review intent.',
            intentId: 'review',
            commandName: 'reviewx',
            defaultPermissionMode: 'plan',
            defaultPermissionSource: 'intent_default',
            metadata: {
              intentName: 'code_review',
              argsText: '当前改动',
            },
          },
        ],
        diagnostics: [],
      },
    })).toThrow('Code review input preprocessing must use the review command.');
  });
});
