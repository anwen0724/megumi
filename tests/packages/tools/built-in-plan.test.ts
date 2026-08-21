import { describe, expect, it } from 'vitest';
import {
  createBuiltInToolRegistry,
  createToolRouter,
  updatePlanToolHandler,
} from '@megumi/tools';

function planRouter() {
  const registry = createBuiltInToolRegistry({});
  return createToolRouter({
    scope: {
      executionId: 'run:plan',
      sessionId: 'session:plan',
      workspaceId: 'workspace:plan',
      modelCallId: 'model-call:plan',
    },
    tools: [registry.get('update_plan')!],
  });
}

describe('update_plan built-in Tool', () => {
  it('rejects malformed snapshots before creating a ToolInvocation', () => {
    const router = planRouter();
    expect(router.route({
      toolCallId: 'call:missing', toolName: 'update_plan', input: {},
    })).toMatchObject({ status: 'failed', error: { code: 'invalid_tool_input' } });
    expect(router.route({
      toolCallId: 'call:status',
      toolName: 'update_plan',
      input: { plan: [{ step: 'Inspect', status: 'doing' }] },
    })).toMatchObject({ status: 'failed', error: { code: 'invalid_tool_input' } });
    expect(router.route({
      toolCallId: 'call:extra',
      toolName: 'update_plan',
      input: { plan: [], unexpected: true },
    })).toMatchObject({ status: 'failed', error: { code: 'invalid_tool_input' } });
  });

  it('rejects more than one in_progress step without publishing a notification', async () => {
    const router = planRouter();
    const routed = router.route({
      toolCallId: 'call:multiple',
      toolName: 'update_plan',
      input: {
        plan: [
          { step: 'Inspect', status: 'in_progress' },
          { step: 'Implement', status: 'in_progress' },
        ],
      },
    });
    if (routed.status !== 'routed') throw new Error('Expected schema-valid plan');
    const notifications: unknown[] = [];
    await expect(updatePlanToolHandler.execute({} as never, routed.invocation, {
      onNotification: (notification) => notifications.push(notification),
    })).rejects.toMatchObject({ code: 'invalid_tool_input' });
    expect(notifications).toEqual([]);
  });
});
