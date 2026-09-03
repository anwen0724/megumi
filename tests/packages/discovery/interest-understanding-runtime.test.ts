/* Verifies Interest Understanding is observed by Trace while business results stay in Interest tables. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeTestApplication,
  type TestApplication,
} from '../composition/compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Interest Understanding Runtime', () => {
  it('records a terminal outcome and resolves its Interest and Evidence business facts', async () => {
    application = composeTestApplication([
      'I will remember that interest.',
      '{"evidence":[{"description":"Agent architecture","effect":"support","confidence":"high"}]}',
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

    let traces!: Awaited<
      ReturnType<TestApplication['runtime']['host']['observability']['listTraces']>
    >;
    await vi.waitFor(async () => {
      await application!.runtime.host.observability.flush();
      traces = await application!.runtime.host.observability.listTraces({
        traceKind: 'interest_understanding',
        correlation: { executionId: submitted.payload.run.executionId },
        limit: 5,
      });
      expect(traces.status).toBe('ok');
      if (traces.status === 'ok') expect(traces.traces[0]?.status).toBe('ok');
    }, { timeout: 10_000 });
    expect(traces.status).toBe('ok');
    if (traces.status !== 'ok') return;
    expect(traces.traces).toHaveLength(1);
    expect(traces.traces[0]?.correlation).toMatchObject({
      executionId: submitted.payload.run.executionId,
      sessionId: submitted.payload.session.id,
      userMessageId: submitted.payload.userMessageId,
    });

    const detail = await application.runtime.host.observability.getTrace({
      traceId: traces.traces[0]!.traceId,
    });
    expect(detail.status).toBe('found');
    if (detail.status !== 'found') return;
    const checkpoint = detail.trace.contents.find(
      (content) => content.kind === 'interest.understanding.outcome',
    );
    expect(checkpoint).toBeDefined();
    const content = await application.runtime.host.observability.getContent({
      traceId: detail.trace.summary.traceId,
      sequence: checkpoint!.sequence,
    });
    expect(content.status).toBe('available');
    if (content.status !== 'available' || content.content.encoding === 'binary') return;
    const outcome = JSON.parse(
      content.content.encoding === 'json' ? content.content.json : content.content.text,
    ) as { changedInterestIds: string[]; evidenceIds: string[] };
    const facts = await application.runtime.host.discovery.getInterestFacts({
      interestIds: outcome.changedInterestIds,
      evidenceIds: outcome.evidenceIds,
    });
    expect(facts.interests).toMatchObject([{ description: 'Agent architecture' }]);
    expect(facts.evidence).toMatchObject([{ description: 'Agent architecture', status: 'applied' }]);
  });
});
