import { describe, expect, it } from 'vitest';
import {
  SkillInvocationMetadataSchema,
  SkillSourceSchema,
} from '@megumi/shared/skill';

describe('skill shared contracts', () => {
  it('parses built-in, user, and project skill sources', () => {
    expect(SkillSourceSchema.parse('builtin')).toBe('builtin');
    expect(SkillSourceSchema.parse('user')).toBe('user');
    expect(SkillSourceSchema.parse('project')).toBe('project');
  });

  it('parses write-doc skill invocation metadata', () => {
    expect(SkillInvocationMetadataSchema.parse({
      skillId: 'write-doc',
      skillSource: 'builtin',
      commandName: 'write-doc',
      argsText: 'docs/architecture.md',
    })).toEqual({
      skillId: 'write-doc',
      skillSource: 'builtin',
      commandName: 'write-doc',
      argsText: 'docs/architecture.md',
    });
  });
});
