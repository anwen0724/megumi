/* Verifies user approval and cancellation through the real composed Coding product. */
// @vitest-environment node
import type { AnyEvent } from '@megumi/application/contracts';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { deferred } from '../../agent/agent-fixture';
import { composeTestApplication } from '../../composition/compose-test-application';

type ApprovalEvent = Extract<AnyEvent, { type: 'approval.requested' }>;

async function startWrite() {
  const app = composeTestApplication([[{
    type: 'toolCall', id: 'write:1', name: 'write_file',
    arguments: { path: 'approved.txt', content: 'Approved content.' }
  }], 'Saved.']);
  const approval = deferred<ApprovalEvent>();
  const ended = deferred();
  const events: AnyEvent[] = [];
  app.runtime.subscribeRuntimeEvents({}, event => {
    events.push(event);
    if (event.type === 'approval.requested') approval.resolve(event);
    if (event.type === 'run.ended') ended.resolve();
  });
  try {
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable.');
    const started = await app.runtime.session.sendUserInput({
      requestId: 'write-request',
      projectId: opened.project.projectId, text: 'Write approved.txt.', permissionMode: 'ask',
      modelSelection: { provider_id: 'test', model_id: 'model' },
    });
    if (started.payload.type !== 'agent_run') throw new Error('Coding did not start.');
    return {
      app, approval: await approval.promise, ended: ended.promise, events,
      sessionId: started.payload.session.id, executionId: started.payload.run.executionId
    };
  } catch (error) {
    await app.cleanup();
    throw error;
  }
}

it('waits for a valid user choice before changing a file and commits the tool result', async () => {
  const fixture = await startWrite();
  const { app, approval } = fixture;
  try {
    const target = path.join(app.workspace, 'approved.txt');
    expect(fs.existsSync(target)).toBe(false);
    expect(await app.runtime.approval.resolve({
      approvalRequestId: approval.payload.approvalRequestId,
      decision: 'approved', optionId: 'unknown-option'
    })).toMatchObject({ payload: { status: 'failed' } });
    expect(fs.existsSync(target)).toBe(false);
    expect(await app.runtime.approval.resolve({
      approvalRequestId: approval.payload.approvalRequestId,
      decision: 'approved', optionId: approval.payload.defaultOptionId
    })).toMatchObject({ payload: { status: 'resumed' } });
    await fixture.ended;
    expect(fs.readFileSync(target, 'utf8')).toBe('Approved content.');
    const history = await app.runtime.session.readCommittedRun({ sessionId: fixture.sessionId, executionId: fixture.executionId });
    expect(history).toMatchObject({
      status: 'ok', messages: expect.arrayContaining([
        expect.objectContaining({ message: expect.objectContaining({ kind: 'toolResult', status: 'success' }) }),
      ])
    });
    const toolEnded = fixture.events.findIndex(event => event.type === 'tool_execution.ended');
    const turnEnded = fixture.events.findIndex(event => event.type === 'turn.ended');
    expect(turnEnded).toBeGreaterThan(toolEnded);
  } finally { await app.cleanup(); }
});

it('saves cancellation without executing the tool and ignores a late approval', async () => {
  const fixture = await startWrite();
  const { app, approval } = fixture;
  try {
    await app.runtime.session.cancelUserInput({ requestId: 'write-request' });
    await fixture.ended;
    expect(await app.runtime.approval.resolve({
      approvalRequestId: approval.payload.approvalRequestId,
      decision: 'approved', optionId: approval.payload.defaultOptionId
    })).toMatchObject({ payload: { status: 'not_waiting' } });
    expect(fs.existsSync(path.join(app.workspace, 'approved.txt'))).toBe(false);
    const history = await app.runtime.session.readCommittedRun({ sessionId: fixture.sessionId, executionId: fixture.executionId });
    expect(history).toMatchObject({
      status: 'ok', messages: expect.arrayContaining([
        expect.objectContaining({ message: expect.objectContaining({ kind: 'toolResult', status: 'cancelled' }) }),
      ])
    });
  } finally { await app.cleanup(); }
});
