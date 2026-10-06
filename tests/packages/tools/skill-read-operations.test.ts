/* Skill files use the ordinary file permission path. */
import { expect, it } from 'vitest';
import { readFileTool } from '@megumi/agent';

it('describes a Skill read as an ordinary workspace read without special authority', () => {
  expect(readFileTool.operations({ path: 'C:/skills/review/SKILL.md' })).toEqual([
    { action: 'workspace.read', resource: { type: 'workspace.path', id: 'C:/skills/review/SKILL.md' } },
  ]);
});
