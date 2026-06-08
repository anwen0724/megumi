import { describe, expect, it } from 'vitest';
import { BUILT_IN_WORKFLOW_COMMANDS } from '@megumi/desktop/renderer/features/workflow-commands';
import { dispatchCommandText, listCommandSuggestions } from '@megumi/desktop/renderer/shared/commands';

describe('command dispatcher', () => {
  it('dispatches /review as a workflow command when a workflow command registry is provided', () => {
    expect(dispatchCommandText('/review 当前改动', BUILT_IN_WORKFLOW_COMMANDS)).toEqual({
      kind: 'workflow',
      rawText: '/review 当前改动',
      argsText: '当前改动',
      command: {
        name: 'review',
        kind: 'workflow',
        description: 'Review code in the current project',
      },
    });
  });

  it.each(['/reviewx 当前改动', '/Review 当前改动', 'hello'])('falls back for %s', (rawText) => {
    expect(dispatchCommandText(rawText, BUILT_IN_WORKFLOW_COMMANDS)).toEqual({
      kind: 'fallback',
      rawText: rawText.trim(),
    });
  });

  it('keeps local and prompt expansion result shapes available for future commands', () => {
    const commands = [
      { name: 'settings', kind: 'local' as const, description: 'Open settings' },
      { name: 'template', kind: 'prompt_expansion' as const, description: 'Expand template' },
    ];

    expect(dispatchCommandText('/settings', commands).kind).toBe('local');
    expect(dispatchCommandText('/template x', commands).kind).toBe('prompt_expansion');
  });

  it('stops command suggestions once arguments start', () => {
    expect(listCommandSuggestions('/review 当前改动', BUILT_IN_WORKFLOW_COMMANDS)).toEqual([]);
  });
});
