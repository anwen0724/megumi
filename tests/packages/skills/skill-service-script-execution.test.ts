/* Verifies script preparation remains path-based and free of Agent Run scope. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/agent/persistence';
import { applyAgentDatabaseMigrations } from '@megumi/agent/persistence/schema';
import { SkillRepository } from '@megumi/skills';
import { SkillServiceImpl } from '@megumi/skills/service/skill-service-impl';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('Skill script preparation', () => {
  it('returns only validated script facts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skill-script-'));
    const directory = path.join(root, 'runner');
    fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), '---\nname: runner\ndescription: Run helper\n---\nBody\n');
    fs.writeFileSync(path.join(directory, 'scripts', 'run.js'), 'console.log(1)');
    const database = createDatabase();
    applyAgentDatabaseMigrations(database);
    cleanup = () => { database.close(); fs.rmSync(root, { recursive: true, force: true }); };
    const skillPath = fs.realpathSync.native(path.join(directory, 'SKILL.md'));
    const service = new SkillServiceImpl({ repository: new SkillRepository(database), roots: [{ owner: 'user', rootPath: root }] });
    const result = await service.prepareSkillScriptExecution({ skillPath, scriptName: 'run', args: ['--check'] });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.executionRequest).toMatchObject({ skillPath, scriptName: 'run', args: ['--check'] });
    expect(result.executionRequest).not.toHaveProperty('workspaceId');
    expect(result.executionRequest).not.toHaveProperty('sessionId');
    expect(result.executionRequest).not.toHaveProperty('runId');
  });
});
