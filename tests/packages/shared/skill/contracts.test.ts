// Verifies the minimal shared Skill System invocation contracts.
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

  it('parses generic skill invocation metadata', () => {
    expect(SkillInvocationMetadataSchema.parse({
      skillId: 'example-skill',
      skillSource: 'project',
      commandName: 'debug-flow',
      argsText: 'failing test',
    })).toEqual({
      skillId: 'example-skill',
      skillSource: 'project',
      commandName: 'debug-flow',
      argsText: 'failing test',
    });
  });
});
