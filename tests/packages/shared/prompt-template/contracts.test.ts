// Verifies the minimal shared Prompt Template System invocation contracts.
import { describe, expect, it } from 'vitest';
import {
  PromptTemplateInvocationMetadataSchema,
  PromptTemplateSourceSchema,
} from '@megumi/shared/prompt-template';

describe('prompt template shared contracts', () => {
  it('parses built-in, user, and project prompt template sources', () => {
    expect(PromptTemplateSourceSchema.parse('builtin')).toBe('builtin');
    expect(PromptTemplateSourceSchema.parse('user')).toBe('user');
    expect(PromptTemplateSourceSchema.parse('project')).toBe('project');
  });

  it('parses summary prompt template invocation metadata', () => {
    expect(PromptTemplateInvocationMetadataSchema.parse({
      templateId: 'summary',
      templateSource: 'builtin',
      commandName: 'summary',
      argsText: '',
    })).toEqual({
      templateId: 'summary',
      templateSource: 'builtin',
      commandName: 'summary',
      argsText: '',
    });
  });
});
