// Verifies renderer input preprocessing payload construction before trusted runtime validation.
import { describe, expect, it } from 'vitest';
import {
  createInputPreprocessingSubmitPayload,
  listInputCommandSuggestions,
} from '@megumi/desktop/renderer/features/input';

describe('renderer input preprocessing submit payload', () => {
  it('lists review, summary, and write-doc built-in input commands', () => {
    expect(listInputCommandSuggestions('/').map((command) => [
      command.name,
      command.kind,
      command.description,
    ])).toEqual([
      ['review', 'intent', 'Review code in the current project'],
      ['summary', 'prompt_template', 'Summarize the current session'],
      ['write-doc', 'skill', 'Write or update project documentation'],
    ]);

    expect(listInputCommandSuggestions('/su').map((command) => command.name)).toEqual(['summary']);
    expect(listInputCommandSuggestions('/write').map((command) => command.name)).toEqual(['write-doc']);
  });

  it('creates review intent preprocessing without the legacy intent bridge', () => {
    expect(createInputPreprocessingSubmitPayload('/review 当前改动')).toEqual({
      message: '/review 当前改动',
      permissionMode: 'plan',
      permissionSource: 'intent_default',
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
    expect(createInputPreprocessingSubmitPayload('/review 当前改动')).not.toHaveProperty('intent');
  });

  it('creates summary prompt-template preprocessing without overriding permission posture', () => {
    const payload = createInputPreprocessingSubmitPayload('/summary');

    expect(payload).toMatchObject({
      message: '/summary',
      preprocessing: {
        originalText: '/summary',
        effectiveUserText: '总结当前会话',
        entries: [
          {
            kind: 'prompt_template',
            sourceId: 'input:prompt-template:summary',
            sourceName: '/summary',
            visibility: 'model_visible',
            templateId: 'summary',
            commandName: 'summary',
            templateSource: 'builtin',
          },
        ],
        diagnostics: [],
      },
    });
    expect(payload).not.toHaveProperty('intent');
    expect(payload).not.toHaveProperty('permissionSource');
    expect(payload?.preprocessing.entries[0]?.instructionText).toContain('请总结当前会话');
  });

  it('creates summary preprocessing with user-provided scope text', () => {
    const payload = createInputPreprocessingSubmitPayload('/summary 只总结关键决策');

    expect(payload?.preprocessing.effectiveUserText).toBe('只总结关键决策');
    expect(payload?.preprocessing.originalText).toBe('/summary 只总结关键决策');
  });

  it('creates write-doc skill preprocessing without overriding permission posture', () => {
    const payload = createInputPreprocessingSubmitPayload('/write-doc docs/architecture.md');

    expect(payload).toMatchObject({
      message: '/write-doc docs/architecture.md',
      preprocessing: {
        originalText: '/write-doc docs/architecture.md',
        effectiveUserText: 'docs/architecture.md',
        entries: [
          {
            kind: 'skill',
            sourceId: 'input:skill:write-doc',
            sourceName: '/write-doc',
            visibility: 'model_visible',
            skillId: 'write-doc',
            commandName: 'write-doc',
            skillSource: 'builtin',
          },
        ],
        diagnostics: [],
      },
    });
    expect(payload).not.toHaveProperty('intent');
    expect(payload).not.toHaveProperty('permissionSource');
    expect(payload?.preprocessing.entries[0]?.instructionText).toContain('你正在执行文档写作任务');
  });

  it('returns null for unknown slash commands and ordinary user input', () => {
    expect(createInputPreprocessingSubmitPayload('/unknown abc')).toBeNull();
    expect(createInputPreprocessingSubmitPayload('ordinary prompt')).toBeNull();
  });
});
