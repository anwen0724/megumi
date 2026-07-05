import { describe, expect, it, vi } from 'vitest';
import { createInputController } from '@megumi/coding-agent/host-interface';
import type { AgentRunService, CancelRunResult, StartRunResult } from '@megumi/coding-agent/agent-run';

describe('host-interface Agent Run input adapter', () => {
  it('maps host send requests to AgentRunService.startRun without assembling run internals', async () => {
    const agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'> = {
      startRun: vi.fn(async (): Promise<StartRunResult> => ({
        status: 'started',
        request_id: 'request-1',
        session_id: 'session-1',
        user_message_id: 'message-1',
        run: {
          run_id: 'run-1',
          workspace_id: 'workspace-1',
          session_id: 'session-1',
          model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
          trigger: { type: 'user_input', user_message_id: 'message-1' },
          status: 'running',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        events: asyncEvents([
          {
            event_id: 'event-1',
            type: 'run.started',
            run_id: 'run-1',
            session_id: 'session-1',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      })),
      cancelRun: vi.fn((): CancelRunResult => ({ status: 'not_found', run_id: 'run-1' })),
    };
    const controller = createInputController({
      agentRunService,
      sessionLookup: {
        getSession: () => ({
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Session',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });

    const result = await controller.send({
      requestId: 'request-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      text: 'hello',
    });

    expect(agentRunService.startRun).toHaveBeenCalledWith({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'hello' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });
    expect(result).toMatchObject({
      type: 'agent_run',
      requestId: 'request-1',
      runId: 'run-1',
      userMessageId: 'message-1',
    });
  });

  it('maps host cancel requests to AgentRunService.cancelRun', () => {
    const agentRunService: Pick<AgentRunService, 'startRun' | 'cancelRun'> = {
      startRun: vi.fn(),
      cancelRun: vi.fn((): CancelRunResult => ({
        status: 'cancelled',
        run: {
          run_id: 'run-1',
          workspace_id: 'workspace-1',
          session_id: 'session-1',
          model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
          trigger: { type: 'user_input', user_message_id: 'message-1' },
          status: 'cancelled',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        events: [],
      })),
    };
    const controller = createInputController({
      agentRunService,
      sessionLookup: { getSession: () => undefined },
    });

    expect(controller.cancel({ targetRequestId: 'run-1' })).toBe(true);
    expect(agentRunService.cancelRun).toHaveBeenCalledWith({ run_id: 'run-1' });
  });
});

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
