/* Verifies the model-facing use_skill tool delegates to the Run-bound SkillService. */
import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService, ToolRegistryService } from '@megumi/agent/tools';
import { createBuiltInToolExecutor, type WorkspaceFileAccess } from '@megumi/agent/tools/built-in-tools';

describe('use_skill built-in tool', () => {
  it('is registered with exact skillPath input', () => {
    expect(new ToolRegistryService().getRegisteredTool({ toolName: 'use_skill' })).toMatchObject({
      type: 'found',
      tool: { registeredToolName: 'use_skill', definition: { inputSchema: { required: ['skillPath'] } } },
    });
  });

  it('returns a generic runtime source while the visible Tool Result only acknowledges loading', async () => {
    const useSkill = vi.fn(async () => ({
      status: 'ok' as const,
      skill: { name: 'review', skillPath: 'C:/skills/review/SKILL.md', content: 'Review carefully.' },
    }));
    const service = createService({ useSkill });
    const result = await service.executeTool({ toolName: 'use_skill', input: { skillPath: 'C:/skills/review/SKILL.md' } });
    expect(useSkill).toHaveBeenCalledWith({ skillPath: 'C:/skills/review/SKILL.md' });
    expect(result).toMatchObject({
      type: 'succeeded',
      toolName: 'use_skill',
      normalizedResult: { kind: 'json', isError: false },
      runtimeSources: [{
        source_kind: 'skill',
        text: 'Review carefully.',
        persisted: false,
        metadata: { name: 'review', skillPath: 'C:/skills/review/SKILL.md' },
      }],
    });
    if (result.type === 'succeeded') {
      expect(result.normalizedResult.content).not.toContain('Review carefully.');
    }
  });

  it('fails normally for a path outside the current Run snapshot', async () => {
    const service = createService({
      useSkill: vi.fn(async () => ({ status: 'not_found' as const, skillPath: 'C:/other/SKILL.md' })),
    });
    const result = await service.executeTool({ toolName: 'use_skill', input: { skillPath: 'C:/other/SKILL.md' } });
    expect(result).toMatchObject({ type: 'failed', toolName: 'use_skill', normalizedResult: { isError: true } });
  });
});

function createService(skillService: { useSkill: (request: { skillPath: string }) => Promise<unknown> }): ToolExecutionService {
  return new ToolExecutionService({
    registryService: new ToolRegistryService(),
    builtInTools: createBuiltInToolExecutor({
      workspaceFileAccess: fakeWorkspaceFileAccess(),
      skillService: skillService as never,
    }),
  });
}

function fakeWorkspaceFileAccess(): WorkspaceFileAccess {
  return {
    async readFile() { throw new Error('not used'); },
    async listDirectory() { throw new Error('not used'); },
    async walkFiles() { return []; },
    async readTextFile() { throw new Error('not used'); },
    async replaceText() { throw new Error('not used'); },
    async writeFile() { throw new Error('not used'); },
    async resolveCommandCwd() { return 'C:/workspace'; },
  };
}
