// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { SkillRepository } from '@megumi/coding-agent/skills';
import { SkillServiceImpl } from '@megumi/coding-agent/skills/service/skill-service-impl';

describe('SkillServiceImpl script execution boundary', () => {
  let database: MegumiDatabase;
  let repository: SkillRepository;
  let tempRoot: string;

  beforeEach(() => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
    seedWorkspaceSession(database);
    repository = new SkillRepository(database);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skill-script-'));
    writeSkill(tempRoot, 'checks', {
      name: 'checks:test',
      description: 'Run project checks',
      content: 'Use this skill.',
      files: {
        'scripts/check.ps1': 'Set-Content should-not-run.txt yes',
      },
    });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('lists script metadata and prepares execution request without running the script', async () => {
    const service = createService(repository, tempRoot);

    await expect(service.listSkillScripts({
      skillId: 'checks:test',
      workspaceId: 'workspace:1',
    })).resolves.toMatchObject({
      status: 'ok',
      skillId: 'checks:test',
      scripts: [{ name: 'check', scriptPath: 'scripts/check.ps1' }],
    });

    const prepared = await service.prepareSkillScriptExecution({
      skillId: 'checks:test',
      scriptName: 'check',
      args: ['--watch'],
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      runId: 'run:1',
    });

    expect(prepared).toMatchObject({
      status: 'ok',
      executionRequest: {
        skillId: 'checks:test',
        scriptName: 'check',
        args: ['--watch'],
        workspaceId: 'workspace:1',
        sessionId: 'session:1',
        runId: 'run:1',
        approvalSummary: 'Run skill script check from checks:test',
      },
    });
    expect(prepared.status === 'ok' ? prepared.executionRequest.scriptPath : '').toBe(path.join(tempRoot, 'checks', 'scripts', 'check.ps1'));
    expect(fs.existsSync(path.join(tempRoot, 'checks', 'should-not-run.txt'))).toBe(false);
  });

  it('rejects script execution preparation for unavailable skills', async () => {
    const service = createService(repository, tempRoot);
    await service.disableSkill({ skillId: 'checks:test', workspaceId: 'workspace:1' });

    await expect(service.prepareSkillScriptExecution({
      skillId: 'checks:test',
      scriptName: 'check',
      args: [],
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
    })).resolves.toEqual({ status: 'unavailable', skillId: 'checks:test' });
  });
});

function createService(repository: SkillRepository, rootPath: string): SkillServiceImpl {
  return new SkillServiceImpl({
    repository,
    rootResolver: {
      resolveSkillRoots: () => [{ kind: 'project', rootPath }],
    },
    clock: { now: () => '2026-07-09T00:00:00.000Z' },
    ids: {
      skillAvailabilityId: () => 'skill-availability:generated',
      skillUsageRecordId: () => 'skill-usage-record:generated',
    },
  });
}

function writeSkill(root: string, packageName: string, input: {
  name: string;
  description: string;
  content: string;
  files?: Record<string, string>;
}): void {
  const packagePath = path.join(root, packageName);
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(path.join(packagePath, 'SKILL.md'), [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    '---',
    '',
    input.content,
    '',
  ].join('\n'));
  for (const [relativePath, content] of Object.entries(input.files ?? {})) {
    const filePath = path.join(packagePath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function seedWorkspaceSession(database: MegumiDatabase): void {
  database.prepare(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:1', 'Workspace', 'C:/workspace', 'c:/workspace', 'active',
      '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z'
    )
  `).run();
  database.prepare(`
    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id,
      created_at, updated_at, archived_at
    ) VALUES (
      'session:1', 'workspace:1', 'Session', 'active', NULL,
      '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z', NULL
    )
  `).run();
}
