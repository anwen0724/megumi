import { describe, expect, it, vi } from 'vitest';
import { built_in_commands } from '@megumi/coding-agent/commands/core/built-in-commands';

describe('built_in_commands', () => {
  it('defines review as the current built-in agent-run command', async () => {
    const review = built_in_commands.find((command) => command.name === 'review');

    expect(review).toBeDefined();
    await expect(review!.execute({
      invocation: {
        name: 'review',
        arguments_input: 'current diff',
        raw_input: '/review current diff',
      },
    })).resolves.toEqual({
      type: 'agent_run',
      input: {
        raw_input: '/review current diff',
        command: {
          name: 'review',
          source: { kind: 'built_in' },
          arguments_input: 'current diff',
        },
      },
    });
  });

  it('defines compact as requiring host session context before compaction can run', async () => {
    const compact = built_in_commands.find((command) => command.name === 'compact');

    expect(compact).toBeDefined();
    await expect(compact!.execute({
      invocation: {
        name: 'compact',
        arguments_input: '',
        raw_input: '/compact',
      },
    })).resolves.toEqual({
      type: 'host_interaction_request',
      request: {
        kind: 'context_compaction',
      },
    });
  });

  it('runs compact through ContextCompactionService when command execution context has a session', async () => {
    const compact = built_in_commands.find((command) => command.name === 'compact');
    const contextCompaction = {
      compact: vi.fn(async () => ({ status: 'completed' as const })),
    };

    const result = await compact!.execute({
      invocation: {
        name: 'compact',
        arguments_input: '',
        raw_input: '/compact',
      },
      execution_context: {
        session_id: 'session:1',
        workspace_id: 'workspace:1',
        services: {
          context_compaction: contextCompaction,
        },
      },
    });

    expect(contextCompaction.compact).toHaveBeenCalledWith({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    });
    expect(result).toMatchObject({ type: 'completed' });
  });
});
