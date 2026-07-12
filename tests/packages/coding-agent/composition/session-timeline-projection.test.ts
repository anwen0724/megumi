import { describe, expect, it, vi } from 'vitest';
import {
  finalizeWorkspaceChangesForTerminalRunEvent,
} from '@megumi/coding-agent/composition/compose-coding-agent-runtime';
import {
  createSessionTimelineQuery,
  projectSessionTimelineMessages,
} from '@megumi/coding-agent/projections/timeline';
import type { AgentRun } from '@megumi/coding-agent/agent-run';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import type { SessionMessageWithAttachments } from '@megumi/coding-agent/session';

describe('projectSessionTimelineMessages', () => {
  it('hydrates one complete historical assistant Timeline from semantic Session messages', () => {
    const messages = projectSessionTimelineMessages({
      projectId: 'workspace-1',
      messages: [
        sessionMessage({ message_id: 'U1', conversation: { role: 'user', content: [{ type: 'text', text: 'inspect' }] } }),
        sessionMessage({
          message_id: 'A1',
          conversation: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'need the file' },
              { type: 'text', text: 'I will inspect it.' },
              { type: 'toolCall', id: 'T1', name: 'read_file', argumentsText: '{"path":"README.md"}' },
            ],
          },
        }),
        sessionMessage({
          message_id: 'TR1',
          conversation: {
            role: 'toolResult', toolCallId: 'T1', toolName: 'read_file', status: 'success',
            content: [{ type: 'text', text: 'contents' }],
          },
        }),
        sessionMessage({ message_id: 'A2', conversation: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }),
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      messageId: 'A2', role: 'assistant', runId: 'run-1',
      blocks: [
        {
          kind: 'process_disclosure',
          items: [
            { kind: 'thinking', text: 'need the file' },
            { kind: 'assistant_text', text: 'I will inspect it.' },
            { kind: 'tool_activity', toolCallId: 'T1', status: 'succeeded', resultSummary: 'contents' },
          ],
        },
        { kind: 'answer_text', text: 'Done.' },
      ],
    });
  });

  it('attaches workspace change footer facts to assistant timeline messages by run id', () => {
    const footerProjector = {
      projectRunFooter: vi.fn(() => ({
        runId: 'run-1',
        sessionId: 'session-1',
        updatedAt: '2026-07-09T11:13:00.000Z',
        changeSets: [{
          changeSetId: 'change-set-1',
          changedFileCount: 1,
          files: [{
            changedFileId: 'changed-file-1',
            workspacePath: 'hollow-world.md',
            changeKind: 'created',
          }],
        }],
      })),
    };

    const messages = projectSessionTimelineMessages({
      projectId: 'workspace-1',
      messages: [sessionMessage({
        message_id: 'assistant-message-1',
        conversation: { role: 'assistant', content: [{ type: 'text', text: '文件写好了。' }] },
        run_id: 'run-1',
      })],
      workspaceChangeFooterProjector: footerProjector,
    });

    expect(footerProjector.projectRunFooter).toHaveBeenCalledWith('run-1');
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      runId: 'run-1',
      workspaceChangeFooter: {
        runId: 'run-1',
        changeSets: [{
          changedFileCount: 1,
          files: [{
            workspacePath: 'hollow-world.md',
            changeKind: 'created',
          }],
        }],
      },
    });
  });
});

describe('createSessionTimelineQuery', () => {
  it('loads the active Session path and returns a Timeline projection', () => {
    const getActiveConversationHistory = vi.fn(() => ({
      status: 'ok' as const,
      messages: [sessionMessage({
        message_id: 'user-message-1',
        conversation: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      })],
    }));
    const query = createSessionTimelineQuery({
      sessionService: { getActiveConversationHistory },
    });

    const result = query.listSessionTimeline({
      workspace_id: 'workspace-1',
      session_id: 'session-1',
    });

    expect(getActiveConversationHistory).toHaveBeenCalledWith({
      session_id: 'session-1',
    });
    expect(result).toMatchObject({
      diagnostics: [],
      messages: [{
        messageId: 'user-message-1',
        projectId: 'workspace-1',
        sessionId: 'session-1',
        role: 'user',
      }],
    });
  });

  it('projects only the requested completed Run for terminal reconciliation', () => {
    const getActiveConversationHistory = vi.fn(() => ({
      status: 'ok' as const,
      messages: [
        sessionMessage({ message_id: 'assistant-message-1', conversation: { role: 'assistant', content: [{ type: 'text', text: 'one' }] }, run_id: 'run-1' }),
        sessionMessage({ message_id: 'assistant-message-2', conversation: { role: 'assistant', content: [{ type: 'text', text: 'two' }] }, run_id: 'run-2' }),
      ],
    }));
    const projectRunFooter = vi.fn(() => undefined);
    const query = createSessionTimelineQuery({
      sessionService: { getActiveConversationHistory },
      workspaceChangeFooterProjector: { projectRunFooter },
    });

    const result = query.listSessionTimeline({
      workspace_id: 'workspace-1',
      session_id: 'session-1',
      run_id: 'run-2',
    });

    expect(result.messages.map((message) => message.role === 'assistant' ? message.runId : undefined)).toEqual(['run-2']);
    expect(projectRunFooter).toHaveBeenCalledTimes(1);
    expect(projectRunFooter).toHaveBeenCalledWith('run-2');
    expect(getActiveConversationHistory).toHaveBeenCalledWith({
      session_id: 'session-1',
      run_id: 'run-2',
    });
  });
});

describe('finalizeWorkspaceChangesForTerminalRunEvent', () => {
  it('finalizes the run workspace changes when an Agent Run reaches a terminal event', () => {
    const finalizeChangeSet = vi.fn(() => ({
      status: 'finalized' as const,
      change_set: {
        change_set_id: 'workspace-change-set-1',
        workspace_id: 'workspace-1',
        session_id: 'session-1',
        run_id: 'run-1',
        status: 'finalized' as const,
        changed_file_count: 1,
        created_at: '2026-07-09T11:13:00.000Z',
        finalized_at: '2026-07-09T11:13:16.000Z',
      },
    }));

    finalizeWorkspaceChangesForTerminalRunEvent({
      event: runtimeEvent('run.completed'),
      agentRuns: {
        getRun: vi.fn(() => agentRun({
          run_id: 'run-1',
          workspace_id: 'workspace-1',
          session_id: 'session-1',
        })),
      },
      workspaceChanges: { finalizeChangeSet },
    });

    expect(finalizeChangeSet).toHaveBeenCalledWith({
      workspace_id: 'workspace-1',
      session_id: 'session-1',
      run_id: 'run-1',
      finalized_at: '2026-07-09T11:13:16.000Z',
    });
  });

  it('ignores non-terminal runtime events', () => {
    const finalizeChangeSet = vi.fn();

    finalizeWorkspaceChangesForTerminalRunEvent({
      event: runtimeEvent('model_call.text_delta'),
      agentRuns: {
        getRun: vi.fn(() => agentRun({
          run_id: 'run-1',
          workspace_id: 'workspace-1',
          session_id: 'session-1',
        })),
      },
      workspaceChanges: { finalizeChangeSet },
    });

    expect(finalizeChangeSet).not.toHaveBeenCalled();
  });
});

function sessionMessage(
  overrides: Partial<SessionMessageWithAttachments['message']>,
): SessionMessageWithAttachments {
  return {
    message: {
      message_id: 'message-1',
      session_id: 'session-1',
      run_id: 'run-1',
      conversation: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      created_at: '2026-07-09T11:13:00.000Z',
      completed_at: '2026-07-09T11:13:01.000Z',
      ...overrides,
    },
    attachments: [],
  };
}

function runtimeEvent(eventType: RuntimeEvent['eventType']): RuntimeEvent {
  return {
    eventId: `event-${eventType}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence: 7,
    createdAt: '2026-07-09T11:13:16.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {},
  } as RuntimeEvent;
}

function agentRun(overrides: Partial<AgentRun>): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: {
      provider_id: 'deepseek',
      model_id: 'deepseek-chat',
    },
    trigger: {
      type: 'user_input',
      user_message_id: 'message-user-1',
    },
    status: 'running',
    created_at: '2026-07-09T11:13:00.000Z',
    started_at: '2026-07-09T11:13:00.000Z',
    ...overrides,
  };
}
