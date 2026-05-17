// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSessionTitleFromPrompt } from '@megumi/desktop/renderer/entities/session/session-title';

describe('createSessionTitleFromPrompt', () => {
  it('uses the trimmed first prompt as the session title', () => {
    expect(createSessionTitleFromPrompt('  Hello world  ')).toBe(
      'Hello world',
    );
  });

  it('collapses whitespace and newlines into a single readable title', () => {
    expect(createSessionTitleFromPrompt('first line\n\nsecond\tline')).toBe(
      'first line second line',
    );
  });

  it('falls back when the prompt has no visible text', () => {
    expect(createSessionTitleFromPrompt('   \n\t   ')).toBe('New session');
  });

  it('keeps short Chinese prompts intact', () => {
    expect(createSessionTitleFromPrompt('你好')).toBe('你好');
  });

  it('truncates long titles to the first 24 visible characters plus an ellipsis', () => {
    expect(createSessionTitleFromPrompt('This is a very long prompt that needs a compact title')).toBe(
      'This is a very long prom...',
    );
  });
});
