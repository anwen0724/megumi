/* Verifies the ContextResolver forms one complete ResolvedContext for Prompt building. */
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@megumi/tools';
import { createContextResolver } from '../../../packages/context/src/context-resolver';
import { history, model, workspaceSource } from './context-test-fixtures';

function dependencies() {
  const workspace = workspaceSource();
  return {
    sessionHistory: {
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: history() })),
    },
    workspaceSource: workspace,
    instructionReader: {
      getSystemInstructions: vi.fn(() => [{ instructionId: 'system', content: 'system' }]),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: {
          sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }],
        },
      })),
    },
    skills: {
      createView: vi.fn(async () => ({ status: 'ok' as const, view: { catalog: [], diagnostics: [] } })),
    },
  };
}

const tools: readonly ToolDefinition[] = [
  { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
];

describe('ContextResolver', () => {
  it('resolves the complete ResolvedContext in one call', async () => {
    const deps = dependencies();
    const resolver = createContextResolver(deps);
    const result = await resolver.resolve({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
      tools,
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.context.activeSessionHistory.map((item) => item.entry.entry_id))
      .toEqual(['entry:user', 'entry:assistant']);
    expect(result.context.expectedActiveEntryId).toBe('entry:assistant');
    expect(result.context.baseInstructions).toEqual([{ instructionId: 'system', content: 'system' }]);
    expect(result.context.effectiveInstructions).toEqual({
      sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }],
    });
    expect(result.context.skillView).toEqual({ catalog: [], diagnostics: [] });
    expect(result.context.executionEnvironment).toEqual({
      workingDirectory: '/workspace/packages/app',
      operatingSystem: 'Linux',
      shell: 'POSIX shell',
    });
    expect(result.context.tools).toEqual(tools);
    expect(result.context.imageInputSupport).toBe(true);
  });

  it('takes the requested Tool Definitions verbatim instead of re-selecting tools', async () => {
    const deps = dependencies();
    const resolver = createContextResolver(deps);
    const result = await resolver.resolve({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
      tools,
    });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.context.tools).toEqual(tools);
  });

  it('resolves imageInputSupport false for a text-only Model', async () => {
    const resolver = createContextResolver(dependencies());
    const result = await resolver.resolve({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model: { ...model, input: ['text'] },
      tools,
    });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.context.imageInputSupport).toBe(false);
  });

  it('keeps Session, Workspace, Instructions and Skills failures under their own owners', async () => {
    const deps = dependencies();
    deps.sessionHistory.getActiveHistory = vi.fn(() => ({
      status: 'failed' as const,
      failure: { code: 'history_unreadable', message: 'unreadable' },
    })) as never;
    expect(await createContextResolver(deps).resolve({
      sessionId: 'session:1', workspaceId: 'workspace:1', model, tools,
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'session_history_failed', cause: { owner: 'session', code: 'history_unreadable' } },
    });

    deps.sessionHistory.getActiveHistory = vi.fn(() => ({ status: 'ok' as const, history: history() }));
    deps.workspaceSource.readWorkspace = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'workspace_not_found', message: 'missing' },
    }));
    expect(await createContextResolver(deps).resolve({
      sessionId: 'session:1', workspaceId: 'workspace:1', model, tools,
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'workspace_failed', cause: { owner: 'workspace', code: 'workspace_not_found' } },
    });

    deps.workspaceSource = workspaceSource();
    deps.instructionReader.getEffectiveInstructions = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'instruction_source_read_failed', message: 'unreadable', sourcePath: '/workspace/AGENTS.md' },
    })) as never;
    expect(await createContextResolver(deps).resolve({
      sessionId: 'session:1', workspaceId: 'workspace:1', model, tools,
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'effective_instructions_failed',
        cause: { owner: 'instructions', code: 'instruction_source_read_failed' },
      },
    });

    deps.instructionReader.getEffectiveInstructions = vi.fn(async () => ({
      status: 'ok' as const,
      instructions: { sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }] },
    }));
    deps.skills.createView = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'skills_unavailable' as const, message: 'broken view' },
    })) as never;
    expect(await createContextResolver(deps).resolve({
      sessionId: 'session:1', workspaceId: 'workspace:1', model, tools,
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'skill_view_failed', cause: { owner: 'skills', code: 'skills_unavailable' } },
    });
  });

  it('returns the stable cancelled failure for an aborted resolution', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = dependencies();
    deps.workspaceSource.readWorkspace = vi.fn(async () => ({ status: 'cancelled' as const }));
    const result = await createContextResolver(deps).resolve({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
      tools,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
  });

  it('validates Execution Environment and Tool Definitions with stable Context codes', async () => {
    const deps = dependencies();
    deps.workspaceSource.readWorkspace = vi.fn(async () => ({
      status: 'ok' as const,
      workspaceRoot: '/workspace',
      environment: { workingDirectory: '', operatingSystem: 'Linux', shell: 'POSIX shell' },
    }));
    expect(await createContextResolver(deps).resolve({
      sessionId: 'session:1', workspaceId: 'workspace:1', model, tools,
    })).toMatchObject({ status: 'failed', failure: { code: 'execution_environment_invalid' } });

    const deps2 = dependencies();
    expect(await createContextResolver(deps2).resolve({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
      tools: [{ name: 'broken' } as never],
    })).toMatchObject({ status: 'failed', failure: { code: 'tool_definitions_invalid' } });
  });
});
