/* Checks persisted Trace correlation without making diagnostics an accounting dependency. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { composeObservability } from '@megumi/application/observability/index';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
import { createMemory } from '@megumi/application/memory/memory';
import { ObservabilityMemoryStorage } from '../observability/observability-memory-storage';
import { productionFixture } from './production-fixture';

it('links the generated snapshot to task reads and verified saved usage in actual Trace records', async () => {
  const trace = composeObservability({ rootDirectory: 'memory-p4-trace', storage: new ObservabilityMemoryStorage() });
  const f = productionFixture(trace.observability);
  try {
    await f.user('u1'); f.responses(); const generated = await f.generate();
    await trace.observability.withTrace({ kind: 'conversation', correlation: { executionId: 'task' } }, () => trace.observability.withSpan({ name: 'context.build' }, async () => {
      const task = f.memory.createTaskMemory({ workspaceId: 'w1', workspaceDirectory: f.root, inputBudgetTokens: 30000 });
      task.getPromptMemory('task');
      const evidence = task.evidence();
      f.history.saveAssistantReply({ message_id: 'reply', session_id: 's1', execution_id: 'task', memory_evidence: evidence,
        status: 'completed', content: [{ type: 'text', text: `<memory_citations>${JSON.stringify(evidence.reads)}</memory_citations>` }], completed_at: '2026-10-08T14:00:00Z' });
      f.memory.recordUsage();
    }));
    await trace.flush();
    const summaries = await trace.queries.listTraces();
    const details = await Promise.all(summaries.map(summary => trace.queries.getTrace(summary.traceId)));
    const events = details.flatMap(detail => detail?.spans.flatMap(span => span.events.map(item => item.event)) ?? []);
    const committed = events.find(event => event.type === 'memory.snapshot.committed');
    expect(committed).toMatchObject({ runId: generated.runId, snapshotId: expect.any(String) });
    if (!committed || committed.type !== 'memory.snapshot.committed') throw new Error();
    expect(events).toContainEqual(expect.objectContaining({ type: 'memory.context.read', snapshotId: committed.snapshotId, executionId: 'task' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'memory.usage.validated', replyId: 'reply', executionId: 'task', status: 'valid' }));
    const recorder = createTraceRecorder({ enqueue: () => { throw new Error('Disk full'); } });
    const broken = createMemory({ ...f.options, observability: recorder });
    const before = f.sources.listReplies({ afterCursor: 0, limit: 20 })[0].message.memory_evidence!;
    await recorder.withTrace({ kind: 'conversation' }, () => recorder.withSpan({ name: 'session.message.commit' }, async () => {
      f.history.saveAssistantReply({ message_id: 'second', session_id: 's1', execution_id: 'second', memory_evidence: { ...before, executionId: 'second' },
        status: 'completed', content: [{ type: 'text', text: `<memory_citations>${JSON.stringify(before.reads)}</memory_citations>` }], completed_at: '2026-10-08T14:01:00Z' });
      expect(broken.recordUsage().status).toBe('recorded');
    }));
    expect(broken.listSources()).toMatchObject({ sources: [{ sessionId: 's1', usageCount: 2 }] });
    await broken.shutdown();
  } finally { await f.dispose(); await trace.shutdown(); }
});
