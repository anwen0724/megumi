import { describe, expect, it } from 'vitest';
import {
  createAgentRunService,
  type CreateAgentRunServiceOptions,
} from '@megumi/coding-agent/agent-run';
import { collectEvents, createInMemoryAgentRunRepository, createMessageFlowDependencies } from './agent-run-test-helpers';

describe('Agent Run command flow', () => {
  it('returns host interaction command results without creating a run', async () => {
    const repository = createInMemoryAgentRunRepository();
    const deps = createMessageFlowDependencies({
      repository,
      commandResult: { type: 'host_interaction_request', request: { kind: 'status_panel' } },
    });
    const service = createAgentRunService(deps as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun(commandRequest('/status'));

    expect(result).toEqual({
      status: 'host_interaction_required',
      request_id: 'request-1',
      session_id: 'session-1',
      interaction: { kind: 'status_panel' },
    });
    expect(deps.session_service.saveUserMessage).not.toHaveBeenCalled();
    expect(repository.listInterruptedRuns()).toEqual([]);
  });

  it('returns completed and failed command results without starting ordinary runs', async () => {
    const completedDeps = createMessageFlowDependencies({
      commandResult: { type: 'completed', message: 'done' },
    });
    const completed = await createAgentRunService(completedDeps as unknown as CreateAgentRunServiceOptions)
      .startRun(commandRequest('/compact'));
    expect(completed).toMatchObject({ status: 'completed', request_id: 'request-1', message: 'done' });
    expect(completedDeps.model_call_service.modelCall).not.toHaveBeenCalled();

    const failedDeps = createMessageFlowDependencies({
      commandResult: { type: 'error', message: 'bad command' },
    });
    const failed = await createAgentRunService(failedDeps as unknown as CreateAgentRunServiceOptions)
      .startRun(commandRequest('/broken'));
    expect(failed).toMatchObject({
      status: 'failed',
      request_id: 'request-1',
      failure: { code: 'command_failed', message: 'bad command' },
    });
    expect(failedDeps.model_call_service.modelCall).not.toHaveBeenCalled();
  });

  it('continues not_command and agent_run command results into ordinary run execution', async () => {
    const notCommandDeps = createMessageFlowDependencies({
      commandResult: { type: 'not_command', raw_input: '/unknown hello' },
    });
    const notCommand = await createAgentRunService(notCommandDeps as unknown as CreateAgentRunServiceOptions)
      .startRun(commandRequest('/unknown hello'));
    expect(notCommand.status).toBe('started');
    if (notCommand.status === 'started') {
      await collectEvents(notCommand.events);
      expect(notCommand.run.trigger).toEqual({ type: 'user_input', user_message_id: 'message-1' });
    }

    const agentRunDeps = createMessageFlowDependencies({
      commandResult: {
        type: 'agent_run',
        input: {
          raw_input: '/ask explain',
          command: {
            name: 'ask',
            source: { kind: 'built_in' },
            arguments_input: 'explain',
          },
        },
      },
    });
    const agentRun = await createAgentRunService(agentRunDeps as unknown as CreateAgentRunServiceOptions)
      .startRun(commandRequest('/ask explain'));
    expect(agentRun.status).toBe('started');
    if (agentRun.status === 'started') {
      await collectEvents(agentRun.events);
      expect(agentRun.run.trigger).toEqual({
        type: 'command',
        command_name: 'ask',
        user_message_id: 'message-1',
      });
    }
  });
});

function commandRequest(text: string) {
  return {
    request_id: 'request-1',
    workspace_id: 'workspace-1',
    session: { type: 'existing' as const, session_id: 'session-1' },
    user_input: { text },
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    permission_mode: 'default' as const,
  };
}
