import { expect, it } from 'vitest';
import { updatePlanTool } from '@megumi/agent';
import { executeToolThroughAgent } from './built-in-test-harness';

it.each([
  {}, { plan: [{ step: 'Inspect', status: 'doing' }] }, { plan: [], unexpected: true },
  { plan: [{ step: 'Inspect', status: 'in_progress' }, { step: 'Implement', status: 'in_progress' }] },
])('rejects invalid plan snapshots without publishing them', async input => {
  const notifications: unknown[] = [];
  const result = await executeToolThroughAgent(updatePlanTool, input, {
    onEvent: event => { if (event.type === 'tool_notification') notifications.push(event.notification); },
  });
  expect(result).toMatchObject({ type: 'failed', error: { code: 'invalid_tool_input' } });
  expect(notifications).toEqual([]);
});

it('publishes the complete plan snapshot without requiring workspace access or approval', async () => {
  const notifications: unknown[] = [];
  const plan = [{ step: 'Inspect', status: 'completed' }, { step: 'Implement', status: 'in_progress' }];
  const result = await executeToolThroughAgent(updatePlanTool, { plan }, {
    onEvent: event => { if (event.type === 'tool_notification') notifications.push(event.notification); },
  });
  expect(result.type).toBe('succeeded');
  expect(notifications).toEqual([{ type: 'plan_updated', plan }]);
});
