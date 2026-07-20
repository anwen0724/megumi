/* Verifies Root-bound SkillService behavior and exact-path use. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/agent/persistence';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema';
import { SkillRepository } from '@megumi/skills';
import { SkillServiceImpl } from '@megumi/skills/service/skill-service-impl';

const tempRoots: string[] = [];
let database: MegumiDatabase | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
  tempRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('SkillServiceImpl', () => {
  it('uses exact skillPath and preserves same-name skills', async () => {
    const root = createRoot();
    const firstPath = writeSkill(root, 'first', 'review', 'First', 'First body');
    const secondPath = writeSkill(root, 'second', 'review', 'Second', 'Second body');
    const service = createService(root);

    const catalog = await service.getSkillCatalog({});
    expect(catalog).toEqual({ status: 'ok', skills: [
      { name: 'review', description: 'First', skillPath: firstPath },
      { name: 'review', description: 'Second', skillPath: secondPath },
    ] });
    expect(await service.useSkill({ skillPath: secondPath })).toEqual({
      status: 'ok', skill: { name: 'review', skillPath: secondPath, content: expect.stringContaining('Second body') },
    });
    expect((await service.useSkill({ skillPath: path.join(root, 'missing', 'SKILL.md') })).status).toBe('not_found');
  });

  it('updates only its own availability view while another instance keeps its snapshot', async () => {
    const root = createRoot();
    const skillPath = writeSkill(root, 'one', 'one', 'One', 'Body');
    const repository = createRepository();
    const first = new SkillServiceImpl({ repository, roots: [{ owner: 'user', rootPath: root }] });
    const second = new SkillServiceImpl({ repository, roots: [{ owner: 'user', rootPath: root }] });
    expect((await first.disableSkill({ skillPath })).status).toBe('ok');
    expect((await first.useSkill({ skillPath })).status).toBe('unavailable');
    expect((await second.useSkill({ skillPath })).status).toBe('ok');
    const third = new SkillServiceImpl({ repository, roots: [{ owner: 'user', rootPath: root }] });
    expect((await third.useSkill({ skillPath })).status).toBe('unavailable');
  });

  it('keeps filesystem discovery fixed for the lifetime of each Root-bound instance', async () => {
    const root = createRoot();
    const firstPath = writeSkill(root, 'first', 'first', 'First', 'First body');
    const repository = createRepository();
    const first = new SkillServiceImpl({ repository, roots: [{ owner: 'user', rootPath: root }] });
    const laterPath = writeSkill(root, 'later', 'later', 'Later', 'Later body');

    const firstList = await first.listSkills({});
    expect(firstList.status === 'ok' ? firstList.skills.map((skill) => skill.skillPath) : []).toEqual([firstPath]);

    const second = new SkillServiceImpl({ repository, roots: [{ owner: 'user', rootPath: root }] });
    const secondList = await second.listSkills({});
    expect(secondList.status === 'ok' ? secondList.skills.map((skill) => skill.skillPath) : []).toEqual([firstPath, laterPath]);
  });
});

function createService(root: string): SkillServiceImpl {
  return new SkillServiceImpl({ repository: createRepository(), roots: [{ owner: 'user', rootPath: root }] });
}

function createRepository(): SkillRepository {
  if (!database) {
    database = createDatabase();
    applyAgentDatabaseMigrations(database);
  }
  return new SkillRepository(database);
}

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skill-service-'));
  tempRoots.push(root);
  return root;
}

function writeSkill(root: string, directory: string, name: string, description: string, content: string): string {
  const packageDirectory = path.join(root, directory);
  fs.mkdirSync(packageDirectory, { recursive: true });
  const skillPath = path.join(packageDirectory, 'SKILL.md');
  fs.writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n${content}\n`);
  return fs.realpathSync.native(skillPath);
}
