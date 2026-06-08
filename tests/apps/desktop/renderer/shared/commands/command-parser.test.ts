import { describe, expect, it } from 'vitest';
import { parseSlashCommand } from '@megumi/desktop/renderer/shared/commands';

describe('parseSlashCommand', () => {
  it.each([
    ['/review', { name: 'review', argsText: '' }],
    ['/review 当前改动', { name: 'review', argsText: '当前改动' }],
    [' /review 当前改动 ', { name: 'review', argsText: '当前改动' }],
    ['/review\n当前改动', { name: 'review', argsText: '当前改动' }],
    ['/reviewx 当前改动', { name: 'reviewx', argsText: '当前改动' }],
    ['/Review 当前改动', { name: 'Review', argsText: '当前改动' }],
  ])('parses %s', (rawText, expected) => {
    expect(parseSlashCommand(rawText)).toEqual({
      rawText: rawText.trim(),
      ...expected,
    });
  });

  it.each(['', 'hello', '请 review 当前改动'])('returns null for non-command input %s', (rawText) => {
    expect(parseSlashCommand(rawText)).toBeNull();
  });
});
