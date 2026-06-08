import { describe, expect, it } from 'vitest';
import { BUILT_IN_COMMANDS } from '@megumi/desktop/renderer/features/commands/command-registry';
import { dispatchCommandText } from '@megumi/desktop/renderer/features/commands/command-dispatcher';

describe('command dispatcher', () => {
  it('dispatches /review as a workflow command', () => {
    expect(dispatchCommandText('/review 当前改动', BUILT_IN_COMMANDS)).toEqual({
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
    expect(dispatchCommandText(rawText, BUILT_IN_COMMANDS)).toEqual({
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
});
