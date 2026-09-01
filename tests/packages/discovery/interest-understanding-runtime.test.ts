/* Verifies Interest Understanding exposes one durable completion and correlated Trace. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeTestApplication,
  type TestApplication,
} from '../composition/compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Interest Understanding Runtime', () => {
  it('settles independently from Conversation and uses the same business id in Trace', async () => {
    application = composeTestApplication([
      'I will remember that interest.',
      '{"evidence":[]}',
    ]);
    await application.runtime.start();
    const opened = await application.runtime.host.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Test Workspace did not open.');
    const submitted = await application.runtime.host.session.sendUserInput({
      projectId: opened.project.projectId,
      text: 'This is only a temporary test instruction.',
      modelSelection: { provider_id: 'test', model_id: 'model' },
      permissionMode: 'full_access',
    });
    if (submitted.payload.type !== 'agent_run') throw new Error('Test Run did not start.');

    const settled = await application.runtime.host.discovery.waitInterestUnderstanding({
      executionId: submitted.payload.run.executionId,
      timeoutMs: 2_000,
    });
    expect(settled.status).toBe('completed');
    if (settled.status !== 'completed') return;
    expect(settled.value).toMatchObject({ status: 'completed', outcome: 'no_durable_evidence' });
    expect(settled.value.executionId).toBe(submitted.payload.run.executionId);

    await application.runtime.host.observability.flush();
    const traces = await application.runtime.host.observability.listTraces({
      traceKind: 'interest_understanding',
      correlation: { interestUnderstandingId: settled.value.interestUnderstandingId },
      limit: 5,
    });
    expect(traces.status).toBe('ok');
    if (traces.status !== 'ok') return;
    expect(traces.traces).toHaveLength(1);
  });
});
