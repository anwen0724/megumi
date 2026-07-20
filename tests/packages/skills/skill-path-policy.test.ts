/* Verifies resource and script containment derived from the exact SKILL.md path. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSkillResourcePath, validateSkillScriptPath } from '@megumi/skills/service/internal/skill-path-policy';

const skillPath = path.resolve('fixture/skill/SKILL.md');

describe('Skill path policy', () => {
  it('allows documented resource and script directories', () => {
    expect(validateSkillResourcePath({ skillPath, resourcePath: 'references/guide.md' }).status).toBe('ok');
    expect(validateSkillResourcePath({ skillPath, resourcePath: 'SKILL.md' }).status).toBe('ok');
    expect(validateSkillScriptPath({ skillPath, scriptPath: 'scripts/run.js' }).status).toBe('ok');
  });

  it('rejects escapes, hidden paths, and unrelated files', () => {
    expect(validateSkillResourcePath({ skillPath, resourcePath: '../secret.txt' }).status).toBe('not_allowed');
    expect(validateSkillResourcePath({ skillPath, resourcePath: 'references/.secret' }).status).toBe('not_allowed');
    expect(validateSkillResourcePath({ skillPath, resourcePath: 'scripts/run.js' }).status).toBe('not_allowed');
    expect(validateSkillScriptPath({ skillPath, scriptPath: '../run.js' }).status).toBe('not_allowed');
  });
});
