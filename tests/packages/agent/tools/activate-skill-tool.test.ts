import { describe, expect, it, vi } from 'vitest';
import {
  ToolExecutionService,
  ToolRegistryService,
} from '@megumi/agent/tools';
import { createBuiltInToolExecutor, type WorkspaceFileAccess } from '@megumi/agent/tools/built-in-tools';

describe('activate_skill built-in tool', () => {
  it('is registered as an available built-in tool with skillId input', () => {
    const registry = new ToolRegistryService();

    const tool = registry.getRegisteredTool({ toolName: 'activate_skill' });

    expect(tool).toMatchObject({
      type: 'found',
      tool: {
        registeredToolName: 'activate_skill',
        definition: {
          inputSchema: {
            required: ['skillId'],
            additionalProperties: false,
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
        },
      },
    });
  });

  it('executes through ToolExecutionService and returns activated runtime source', async () => {
    const activateSkill = vi.fn(async () => ({
      status: 'ok' as const,
      activatedSkill: {
        skillId: 'superpowers:brainstorming',
        name: 'superpowers:brainstorming',
        description: 'Explore intent before implementation',
        content: 'Ask clarifying questions.',
      },
    }));
    const service = new ToolExecutionService({
      registryService: new ToolRegistryService(),
      builtInTools: createBuiltInToolExecutor({
        workspaceFileAccess: fakeWorkspaceFileAccess(),
        skillService: { activateSkill },
        runContext: {
          runId: 'run:1',
          sessionId: 'session:1',
          workspaceId: 'workspace:1',
        },
      }),
    });

    const result = await service.executeTool({
      toolName: 'activate_skill',
      input: { skillId: 'superpowers:brainstorming' },
    });

    expect(activateSkill).toHaveBeenCalledWith({
      skillId: 'superpowers:brainstorming',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      runId: 'run:1',
      trigger: 'model_tool',
    });
    expect(result).toMatchObject({
      type: 'succeeded',
      toolName: 'activate_skill',
      normalizedResult: {
        kind: 'json',
        isError: false,
      },
      runtimeSources: [{
        source_id: 'skill:superpowers:brainstorming',
        source_kind: 'skill',
        text: 'Ask clarifying questions.',
        persisted: false,
        metadata: {
          skillId: 'superpowers:brainstorming',
          origin_module: 'skills',
        },
      }],
    });
  });

  it('returns a normal tool failure when activation fails', async () => {
    const service = new ToolExecutionService({
      registryService: new ToolRegistryService(),
      builtInTools: createBuiltInToolExecutor({
        workspaceFileAccess: fakeWorkspaceFileAccess(),
        skillService: {
          activateSkill: vi.fn(async () => ({ status: 'not_found' as const, skillId: 'missing' })),
        },
        runContext: {
          runId: 'run:1',
          sessionId: 'session:1',
          workspaceId: 'workspace:1',
        },
      }),
    });

    const result = await service.executeTool({
      toolName: 'activate_skill',
      input: { skillId: 'missing' },
    });

    expect(result).toMatchObject({
      type: 'failed',
      toolName: 'activate_skill',
      normalizedResult: {
        isError: true,
      },
    });
    expect(result.type === 'succeeded' ? result.runtimeSources : undefined).toBeUndefined();
  });

});

function fakeWorkspaceFileAccess(): WorkspaceFileAccess {
  return {
    async readFile() {
      throw new Error('not used');
    },
    async listDirectory() {
      throw new Error('not used');
    },
    async walkFiles() {
      return [];
    },
    async readTextFile() {
      throw new Error('not used');
    },
    async replaceText() {
      throw new Error('not used');
    },
    async writeFile() {
      throw new Error('not used');
    },
    async resolveCommandCwd() {
      return 'C:/workspace';
    },
  };
}
