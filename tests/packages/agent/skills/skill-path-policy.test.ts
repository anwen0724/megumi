import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  validateSkillResourcePath,
  validateSkillScriptPath,
} from '@megumi/agent/skills/service/internal/skill-path-policy';

describe('skill path policy', () => {
  const packagePath = path.resolve('C:/skills/checks');

  it('allows declared text resource paths', () => {
    expect(validateSkillResourcePath({ packagePath, resourcePath: 'SKILL.md' }).status).toBe('ok');
    expect(validateSkillResourcePath({ packagePath, resourcePath: 'references/example.md' }).status).toBe('ok');
  });

  it('rejects path escapes, hidden files, assets, and script reads as text resources', () => {
    expect(validateSkillResourcePath({ packagePath, resourcePath: '../secret.txt' }).status).toBe('not_allowed');
    expect(validateSkillResourcePath({ packagePath, resourcePath: '.env' }).status).toBe('not_allowed');
    expect(validateSkillResourcePath({ packagePath, resourcePath: 'assets/logo.png' }).status).toBe('not_allowed');
    expect(validateSkillResourcePath({ packagePath, resourcePath: 'scripts/run.ps1' }).status).toBe('not_allowed');
  });

  it('validates script paths separately inside the package', () => {
    const accepted = validateSkillScriptPath({ packagePath, scriptPath: 'scripts/check.ps1' });
    const rejected = validateSkillScriptPath({ packagePath, scriptPath: '../scripts/check.ps1' });

    expect(accepted.status).toBe('ok');
    expect(accepted.status === 'ok' ? accepted.absolutePath : '').toBe(path.resolve(packagePath, 'scripts/check.ps1'));
    expect(rejected.status).toBe('not_allowed');
  });
});
