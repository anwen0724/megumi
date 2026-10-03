// @vitest-environment node
/* Projects real product approval events into the desktop timeline. */
import { expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/application/contracts';
import { EventSchema } from '@megumi/application/coding/session-events';
import { reduceRuntimeTimelineEvent } from '@megumi/desktop/renderer/features/session-timeline';
import { collectPendingApprovalActivities } from '../../../../../../apps/desktop/src/renderer/features/chat/approval-overlay';
import { composeTestApplication } from '../../../../../packages/composition/compose-test-application';
import { deferred } from '../../../../../packages/agent/agent-fixture';

it('projects a real approval request into a resolvable desktop activity', async () => {
  const app = composeTestApplication([[{ type: 'toolCall', id: 'write:1', name: 'write_file', arguments: { path: 'note.md', content: 'Hello' } }]]);
  const approval = deferred<Extract<AnyEvent, { type: 'approval.requested' }>>();
  const ended = deferred();
  const events: AnyEvent[] = [];
  app.runtime.subscribeRuntimeEvents({}, event => {
    events.push(event);
    if (event.type === 'approval.requested') approval.resolve(event);
    if (event.type === 'run.ended') ended.resolve();
  });
  try {
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable');
    await app.runtime.session.sendUserInput({ requestId: 'write', projectId: opened.project.projectId,
      text: 'Write note.md', permissionMode: 'ask', modelSelection: { provider_id: 'test', model_id: 'model' } });
    expect(EventSchema.safeParse(await approval.promise).success).toBe(true);
    const messages = events.reduce((messages, event) => reduceRuntimeTimelineEvent(messages, event, opened.project!.projectId), []);
    expect(collectPendingApprovalActivities(messages)).toEqual([expect.objectContaining({
      toolCallId: 'write:1', toolName: 'write_file', status: 'awaiting_approval',
      approval: expect.objectContaining({ approvalRequestId: expect.any(String), summary: expect.any(String) }),
    })]);
    await app.runtime.session.cancelUserInput({ requestId: 'write' });
    await ended.promise;
  } finally { await app.cleanup(); }
});
