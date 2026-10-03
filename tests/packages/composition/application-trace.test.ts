/* A real Coding request must retain the existing diagnostic record of model input and output. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { composeTestApplication } from './compose-test-application';
import { deferred } from '../agent/agent-fixture';

it('records every model request and complete reply around a tool call without duplicating transport contents', async () => {
  let requests = 0;
  const fetch: typeof globalThis.fetch = async () => {
    requests += 1;
    const delta = requests === 1
      ? { tool_calls: [{ index: 0, id: 'list:1', type: 'function',
          function: { name: 'list_directory', arguments: '{"path":"."}' } }] }
      : { content: 'A traced reply.' };
    return new Response(`data: ${JSON.stringify({
      id: `reply:${requests}`, choices: [{ index: 0, delta,
        finish_reason: requests === 1 ? 'tool_calls' : 'stop' }],
    })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const api = openAICompletionsApi();
  const app = composeTestApplication([], { modelStreams: { 'openai-completions': {
    stream: (model, context, options) => api.stream(model, context, { ...options, fetch }),
    streamSimple: (model, context, options) => api.streamSimple(model, context, { ...options, fetch }),
  } } });
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
    expect(traces).toMatchObject({ status: 'ok', traces: [expect.objectContaining({
      status: 'ok', diagnostics: 'complete', issueCount: 0,
    })] });
    if (traces.status !== 'ok') throw new Error('Trace query failed.');
    const detail = await app.runtime.observability.getTrace({ traceId: traces.traces[0].traceId });
    expect(detail).toMatchObject({ status: 'found', trace: { contents: expect.arrayContaining([
      expect.objectContaining({ kind: 'input.received' }), expect.objectContaining({ kind: 'input.processed' }),
      expect.objectContaining({ kind: 'model.request' }), expect.objectContaining({ kind: 'model.response' }),
      expect.objectContaining({ kind: 'tool.result' }),
    ]), spans: expect.arrayContaining([expect.objectContaining({ name: 'session.message.commit' })]) } });
    if (detail.status !== 'found') throw new Error('Trace detail unavailable.');
    expect(requests).toBe(2);
    const modelContents = detail.trace.contents.filter(content => content.kind.startsWith('model.'));
    expect(modelContents.map(content => content.kind)).toEqual([
      'model.request', 'model.provider_request', 'model.response',
      'model.request', 'model.provider_request', 'model.response',
    ]);
    const replies = await Promise.all(modelContents.filter(content => content.kind === 'model.response')
      .map(content => app.runtime.observability.getContent({ traceId: detail.trace.summary.traceId, sequence: content.sequence })));
    const messages = replies.map(reply => {
      if (reply.status !== 'available' || reply.content.encoding !== 'json') throw new Error('Model reply unavailable.');
      return JSON.parse(reply.content.json);
    });
    expect(messages).toMatchObject([
      { stopReason: 'toolUse', content: [expect.objectContaining({ type: 'toolCall', name: 'list_directory' })] },
      { stopReason: 'stop', content: [expect.objectContaining({ type: 'text', text: 'A traced reply.' })] },
    ]);
  } finally {
    subscription.unsubscribe();
    await app.cleanup();
  }
});
