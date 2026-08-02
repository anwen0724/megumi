import { describe, expect, it } from 'vitest';
import { createTools, type BuiltInToolName } from '@megumi/tools';

describe('Tools Run registration', () => {
  it('keeps one Run registration stable while later availability queries change', () => {
    const disabled = new Set<BuiltInToolName>();
    const tools = createTools({
      settings: {
        resolveWebSearch: () => ({ status: 'ok', settings: {} }),
        readWebSearchApiKey: () => ({ status: 'missing' }),
      },
      workspaces: {
        getWorkspace: ({ workspace_id }) => ({
          status: 'found',
          workspace: { root_path: `C:/workspace/${workspace_id}`, status: 'available' },
        }),
      },
      workspaceChanges: {
        trackToolExecution: ({ execute }) => execute(),
      },
      skills: {
        createSkillService: () => ({
          useSkill: async () => ({ status: 'failed', failure: { code: 'skill_not_found', message: 'Not used.' } }),
        } as never),
      },
      sandbox: {
        capabilities: () => ({
          platform: 'win32',
          workspaceEffectObservation: true,
          fileReadBoundary: true,
          fileWriteBoundary: true,
          environmentIsolation: true,
          networkIsolation: true,
          processTreeTermination: true,
          timeLimit: true,
          outputLimit: true,
          processCountLimit: true,
          cpuLimit: false,
          memoryLimit: false,
        }),
        open: async () => ({ status: 'unavailable', reason: 'Not used.' }),
      },
      executionPolicy: {
        maxExecutionTimeMs: 1_000,
        maxOutputBytes: 20_000,
        maxProcessCount: 4,
      },
      builtInToolAvailability: {
        isAvailable: ({ toolName }) => !disabled.has(toolName),
      },
    });

    const first = tools.resolveRunTools({
      runId: 'run:1', sessionId: 'session:1', workspaceId: 'workspace:1',
    });
    expect(first.status).toBe('resolved');
    disabled.add('read_file');

    expect(tools.preflightToolCall({
      runId: 'run:1',
      toolName: 'read_file',
      input: { path: 'notes.md' },
    }).status).toBe('ready');
    expect(tools.listAvailableTools().tools.map((tool) => tool.registeredToolName))
      .not.toContain('read_file');

    const second = tools.resolveRunTools({
      runId: 'run:2', sessionId: 'session:1', workspaceId: 'workspace:1',
    });
    expect(second.status).toBe('resolved');
    if (second.status === 'resolved') {
      expect(second.registeredTools.map((tool) => tool.registeredToolName))
        .not.toContain('read_file');
    }

    tools.releaseRunTools({ runId: 'run:1' });
    expect(tools.preflightToolCall({
      runId: 'run:1',
      toolName: 'read_file',
      input: { path: 'notes.md' },
    })).toMatchObject({ status: 'failed', error: { code: 'tool_execution_failed' } });
  });
});
