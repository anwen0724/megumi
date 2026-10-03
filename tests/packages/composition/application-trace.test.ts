/* A real Coding request must retain the existing diagnostic record of model input and output. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { composeTestApplication } from './compose-test-application';
import { deferred } from '../agent/agent-fixture';

it('records the model request and response under the completed conversation trace', async () => {
  const app = composeTestApplication(['A traced reply.']);
  const ended = deferred();
  const subscription = app.runtime.subscribeRuntimeEvents({ eventTypes: ['run.ended'] }, () => ended.resolve());
  try {
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable.');
    const submitted = await app.runtime.session.sendUserInput({ projectId: opened.project.projectId,
      text: 'Trace this request.', modelSelection: { provider_id: 'test', model_id: 'model' },
    });
    if (submitted.payload.type !== 'agent_run') throw new Error('The conversation did not start.');
    await ended.promise;
    await app.runtime.stop();
    await app.runtime.observability.flush();
    const traces = await app.runtime.observability.listTraces({ traceKind: 'conversation',
      correlation: { executionId: submitted.payload.run.executionId } });
    expect(traces).toMatchObject({ status: 'ok', traces: [expect.objectContaining({ status: 'ok' })] });
    if (traces.status !== 'ok') throw new Error('Trace query failed.');
    const detail = await app.runtime.observability.getTrace({ traceId: traces.traces[0].traceId });
    expect(detail).toMatchObject({ status: 'found', trace: { contents: expect.arrayContaining([
      expect.objectContaining({ kind: 'input.received' }), expect.objectContaining({ kind: 'input.processed' }),
      expect.objectContaining({ kind: 'model.request' }), expect.objectContaining({ kind: 'model.response' }),
    ]), spans: expect.arrayContaining([expect.objectContaining({ name: 'session.message.commit' })]) } });
  } finally {
    subscription.unsubscribe();
    await app.cleanup();
  }
});
