// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type {
  ActivateSkillResponse,
  ExecuteSkillCommandRequest,
  ExecuteSkillCommandResponse,
  GetSkillCatalogContextResponse,
  GetSkillCatalogResponse,
  ListSkillsUiResponse,
  PrepareSkillScriptExecutionToolResponse,
  Skill,
  SkillAvailability,
  SkillService,
  SkillUsageRecord,
} from '@megumi/coding-agent/skills';
import { SkillRepository } from '@megumi/coding-agent/skills';
import { SkillServiceImpl } from '@megumi/coding-agent/skills/service/skill-service-impl';

describe('Skill module public contracts', () => {
  it('exports Skill model, entities, DTOs, and service method results', async () => {
    const skill: Skill = {
      skillId: 'superpowers:brainstorming',
      name: 'superpowers:brainstorming',
      description: 'Explore intent before implementation',
      source: { kind: 'system', label: 'System' },
      packagePath: 'C:/skills/brainstorming',
      content: 'Use before creative work.',
      resources: [],
      scripts: [],
      diagnostics: [],
      available: true,
    };
    const availability: SkillAvailability = {
      skillAvailabilityId: 'skill-availability:1',
      skillId: skill.skillId,
      available: true,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    };
    const usage: SkillUsageRecord = {
      skillUsageRecordId: 'skill-usage-record:1',
      skillId: skill.skillId,
      sessionId: 'session:1',
      trigger: 'command',
      createdAt: '2026-07-09T00:00:00.000Z',
    };
    const catalog: GetSkillCatalogResponse = {
      status: 'ok',
      skills: [{ skillId: skill.skillId, name: skill.name, description: skill.description }],
    };
    const activationResponse: ActivateSkillResponse = {
      status: 'ok',
      activatedSkill: {
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        content: skill.content,
      },
    };
    const uiResponse: ListSkillsUiResponse = {
      status: 'ok',
      skills: [{
        skillId: 'checks:test',
        name: 'test',
        description: 'Run project checks',
        sourceLabel: 'Project',
        available: true,
        hasResources: false,
        hasScripts: false,
        diagnostics: [],
      }],
    };
    const commandRequest: ExecuteSkillCommandRequest = {
      skillId: 'checks:test',
      argumentsInput: '--watch',
      sessionId: 'session:1',
    };
    const commandResponse: ExecuteSkillCommandResponse = {
      status: 'agent_run',
      skillId: 'checks:test',
      argumentsInput: '--watch',
      requestedSkillActivation: {
        skillId: 'checks:test',
        trigger: 'command',
      },
    };
    const contextResponse: GetSkillCatalogContextResponse = {
      status: 'ok',
      skills: [{ skillId: 'checks:test', name: 'test', description: 'Run project checks' }],
    };
    const toolResponse: PrepareSkillScriptExecutionToolResponse = {
      status: 'ok',
      request: {
        skillId: 'checks:test',
        scriptName: 'check',
        scriptPath: 'C:/repo/.megumi/skills/test/scripts/check.ps1',
        args: [],
        workspaceId: 'workspace:1',
        sessionId: 'session:1',
        approvalSummary: 'Run skill script check from checks:test',
      },
    };
    const service: SkillService = {
      listSkills: async () => ({ status: 'ok', skills: [] }),
      getSkill: async (request) => ({ status: 'not_found', skillId: request.skillId }),
      enableSkill: async (request) => ({ status: 'not_found', skillId: request.skillId }),
      disableSkill: async (request) => ({ status: 'not_found', skillId: request.skillId }),
      getSkillCatalog: async () => ({ status: 'ok', skills: [] }),
      activateSkill: async (request) => ({ status: 'not_found', skillId: request.skillId }),
      readSkillResource: async (request) => ({
        status: 'not_found',
        skillId: request.skillId,
        resourcePath: request.resourcePath,
      }),
      listSkillScripts: async (request) => ({ status: 'not_found', skillId: request.skillId }),
      prepareSkillScriptExecution: async (request) => ({
        status: 'not_found',
        skillId: request.skillId,
        scriptName: request.scriptName,
      }),
    };

    expect(availability.available).toBe(true);
    expect(usage.trigger).toBe('command');
    expect(catalog.status).toBe('ok');
    expect(activationResponse.status).toBe('ok');
    expect(uiResponse.status).toBe('ok');
    expect(commandRequest.argumentsInput).toBe('--watch');
    expect(commandResponse.requestedSkillActivation.skillId).toBe('checks:test');
    expect(contextResponse.skills).toHaveLength(1);
    expect(toolResponse.request.scriptName).toBe('check');
    await expect(service.getSkillCatalog({})).resolves.toEqual({ status: 'ok', skills: [] });
  });
});

describe('SkillServiceImpl', () => {
  let database: MegumiDatabase;
  let repository: SkillRepository;
  let tempRoot: string;

  beforeEach(() => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
    seedWorkspaceSessionAndRun(database);
    repository = new SkillRepository(database);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skill-service-'));
    writeSkill(tempRoot, 'checks', {
      name: 'checks:test',
      description: 'Run project checks',
      content: 'Use this skill for project checks.',
      files: {
        'references/usage.md': 'Run npm test.',
        'scripts/check.ps1': 'Write-Host ok',
      },
    });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('lists, gets, enables, disables, and catalogs skills through one service', async () => {
    const service = createService(repository, tempRoot);

    await expect(service.listSkills({ workspaceId: 'workspace:1' })).resolves.toMatchObject({
      status: 'ok',
      skills: [{
        skillId: 'checks:test',
        available: true,
      }],
    });
    await expect(service.getSkill({ skillId: 'checks:test', workspaceId: 'workspace:1' })).resolves.toMatchObject({
      status: 'ok',
      skill: {
        content: 'Use this skill for project checks.\n',
      },
    });

    const disabled = await service.disableSkill({ skillId: 'checks:test', workspaceId: 'workspace:1' });
    expect(disabled).toMatchObject({
      status: 'ok',
      availability: { available: false },
    });
    await expect(service.getSkillCatalog({ workspaceId: 'workspace:1' })).resolves.toEqual({
      status: 'ok',
      skills: [],
    });

    const enabled = await service.enableSkill({ skillId: 'checks:test', workspaceId: 'workspace:1' });
    expect(enabled).toMatchObject({
      status: 'ok',
      availability: { available: true },
    });
    await expect(service.getSkillCatalog({ workspaceId: 'workspace:1' })).resolves.toEqual({
      status: 'ok',
      skills: [{ skillId: 'checks:test', name: 'checks:test', description: 'Run project checks' }],
    });
  });

  it('activates available skills, records usage, and returns only activated content', async () => {
    const service = createService(repository, tempRoot);

    const response = await service.activateSkill({
      skillId: 'checks:test',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      runId: 'run:1',
      trigger: 'command',
    });

    expect(response).toEqual({
      status: 'ok',
      activatedSkill: {
        skillId: 'checks:test',
        name: 'checks:test',
        description: 'Run project checks',
        content: 'Use this skill for project checks.\n',
      },
    });
    expect(response).not.toHaveProperty('skillUsageRecordId');
    expect(repository.listUsageRecordsBySession('session:1')).toHaveLength(1);
  });

  it('rejects unavailable activation and reads only allowed resources', async () => {
    const service = createService(repository, tempRoot);
    await service.disableSkill({ skillId: 'checks:test', workspaceId: 'workspace:1' });

    await expect(service.activateSkill({
      skillId: 'checks:test',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      runId: 'run:1',
      trigger: 'model_tool',
    })).resolves.toEqual({ status: 'unavailable', skillId: 'checks:test' });

    await expect(service.readSkillResource({
      skillId: 'checks:test',
      resourcePath: 'references/usage.md',
      workspaceId: 'workspace:1',
    })).resolves.toEqual({
      status: 'ok',
      skillId: 'checks:test',
      resourcePath: 'references/usage.md',
      content: 'Run npm test.',
      contentType: 'text',
    });
    await expect(service.readSkillResource({
      skillId: 'checks:test',
      resourcePath: 'scripts/check.ps1',
      workspaceId: 'workspace:1',
    })).resolves.toMatchObject({
      status: 'not_allowed',
      skillId: 'checks:test',
    });
  });

  it('rejects oversized text resources before reading them into service responses', async () => {
    writeSkill(tempRoot, 'large-reference', {
      name: 'checks:large',
      description: 'Large reference',
      content: 'Use this skill for large reference checks.',
      files: {
        'references/large.md': 'x'.repeat(300_000),
      },
    });
    const service = createService(repository, tempRoot);

    await expect(service.readSkillResource({
      skillId: 'checks:large',
      resourcePath: 'references/large.md',
      workspaceId: 'workspace:1',
    })).resolves.toMatchObject({
      status: 'not_allowed',
      skillId: 'checks:large',
      resourcePath: 'references/large.md',
    });
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

function seedWorkspaceSessionAndRun(database: MegumiDatabase): void {
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
  database.prepare(`
    INSERT INTO agent_runs (
      run_id, workspace_id, session_id, provider_id, model_id,
      trigger_type, trigger_user_message_id, trigger_command_name, status,
      created_at, started_at, completed_at, failure_json
    ) VALUES (
      'run:1', 'workspace:1', 'session:1', 'openai', 'gpt-test',
      'command', NULL, 'skill', 'completed',
      '2026-07-09T00:00:00.000Z', NULL, NULL, NULL
    )
  `).run();
}
