import { describe, expect, it } from 'vitest';
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
