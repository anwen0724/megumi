// @vitest-environment node
/* Exercises SkillHost against real Skill files and isolated database storage. */
import { createDatabaseSkillAvailabilityStore } from '@megumi/application/storage/skill-availability-store';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/application/storage/index';
import { createSkills } from '@megumi/agent-runtime/resources/skills/index';
import { createSkillOperations } from '@megumi/application/skill-operations';

let homePath: string;
let database: DatabaseConnection;
let host: ReturnType<typeof createSkillOperations>;

beforeEach(() => {
  homePath = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skill-host-'));
  database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  host = createSkillOperations({ skills: createSkills({ homePath, availabilityStore: createDatabaseSkillAvailabilityStore(database), }) });
});
afterEach(() => {
  database?.close();
  fs.rmSync(homePath, { recursive: true, force: true });
});

function writeSkill(name: string, manifestName = name) {
  const directory = path.join(homePath, 'skills', name);
  fs.mkdirSync(directory, { recursive: true });
  const skillPath = path.join(directory, 'SKILL.md');
  fs.writeFileSync(skillPath, `---
name: ${manifestName}
description: Review code
---
Review carefully.
`);
  return skillPath;
}

describe('SkillHost semantics', () => {
  it('lists readable user Skill facts and diagnostics without exposing diagnostic internals', async () => {
    const skillPath = writeSkill('review', 'review:code');
    const result = await host.listSkills({});
    expect(result).toMatchObject({ status: 'ok', skills: [{
      name: 'review:code', description: 'Review code', sourceLabel: 'User',
      available: true, hasResources: false, hasScripts: false,
      diagnostics: [{ level: 'warning', message: expect.any(String) }],
    }] });
    if (result.status !== 'ok') throw new Error('Skill listing failed');
    expect(path.resolve(result.skills[0]!.skillPath)).toBe(skillPath);
    expect(result.skills[0]!.diagnostics[0]).not.toHaveProperty('code');
  });

  it('returns not_found for an absent Skill path', async () => {
    const skillPath = path.join(homePath, 'skills', 'missing', 'SKILL.md');
    expect(await host.getSkillDetail({ skillPath })).toEqual({ status: 'not_found', skillPath });
  });

  it('makes a newly installed Skill visible after refresh', async () => {
    expect(await host.listSkills({})).toEqual({ status: 'ok', skills: [] });
    writeSkill('review');
    expect(await host.refreshSkills({})).toEqual({ status: 'ok' });
    expect(await host.listSkills({})).toMatchObject({ status: 'ok', skills: [{ name: 'review' }] });
  });
});
