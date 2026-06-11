// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AnswerTextBlockSchema,
  ProcessDisclosureBlockSchema,
  TimelineAssistantMessageSchema,
  TimelineMessageSchema,
  TimelineMessageRoleSchema,
  TimelineUserMessageSchema,
  ToolActivityItemSchema,
} from '@megumi/shared/timeline';
import {
  ANSWER_TEXT_STATUSES,
  PROCESS_DISCLOSURE_STATUSES,
  TIMELINE_MESSAGE_ROLES,
  type TimelineAssistantMessage,
  type TimelineUserMessage,
} from '@megumi/shared/timeline';

const messageBase = {
  messageId: 'message-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  createdAt: '2026-05-24T00:00:00.000Z',
} as const;

describe('timeline message and block contracts', () => {
  it('supports user assistant and branch separator timeline records', () => {
    expect(TIMELINE_MESSAGE_ROLES).toEqual(['user', 'assistant', 'separator']);
    expect(TimelineMessageRoleSchema.parse('user')).toBe('user');
    expect(TimelineMessageRoleSchema.parse('assistant')).toBe('assistant');
    expect(TimelineMessageRoleSchema.parse('separator')).toBe('separator');
    expect(() => TimelineMessageRoleSchema.parse('system')).toThrow();
    expect(() => TimelineMessageRoleSchema.parse('tool')).toThrow();

    const parsed = TimelineMessageSchema.parse({
      messageId: 'separator:branch-marker-1',
      role: 'separator',
      projectId: 'project-1',
      sessionId: 'session-1',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      blocks: [{
        blockId: 'branch-separator:branch-marker-1',
        kind: 'branch_separator',
        branchMarkerId: 'branch-marker-1',
        sourceMessageId: 'message-1',
        label: 'Branch from 07:28',
        createdAt: '2026-06-01T10:00:00.000Z',
      }],
    });

    expect(parsed.role).toBe('separator');
    expect(parsed.blocks[0]).toMatchObject({
      kind: 'branch_separator',
      label: 'Branch from 07:28',
    });
  });

  it('parses user messages with text and attachment blocks', () => {
    const message = {
      ...messageBase,
      role: 'user',
      runId: 'run-1',
      turnOrder: 0,
      clientMessageId: 'client-message-1',
      blocks: [
        {
          blockId: 'block-user-text-1',
          kind: 'user_text',
          text: 'Read the docs directory.',
          format: 'plain',
        },
        {
          blockId: 'block-user-attachment-1',
          kind: 'user_attachment',
          attachmentId: 'attachment-1',
          name: 'screenshot.png',
          mediaType: 'image/png',
          sizeBytes: 1200,
          source: 'screenshot',
        },
      ],
    } satisfies TimelineUserMessage;

    expect(TimelineUserMessageSchema.parse(message)).toEqual(message);
    expect(TimelineMessageSchema.parse(message).role).toBe('user');
  });

  it('parses assistant messages with one process disclosure and one answer text block', () => {
    const message = {
      ...messageBase,
      messageId: 'assistant-message-1',
      role: 'assistant',
      runId: 'run-1',
      turnOrder: 1,
      blocks: [
        {
          blockId: 'process-run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'completed',
          startedAt: '2026-05-24T00:00:00.000Z',
          endedAt: '2026-05-24T00:00:03.000Z',
          items: [
            {
              itemId: 'thinking:thinking-1',
              kind: 'thinking',
              thinkingId: 'thinking-1',
              status: 'completed',
              text: 'I should inspect docs.',
              format: 'plain',
            },
            {
              itemId: 'prelude:text-prelude-1',
              kind: 'assistant_text',
              textId: 'text-prelude-1',
              phase: 'prelude',
              status: 'completed',
              text: 'Let me check.',
              format: 'plain',
            },
            {
              itemId: 'tool:tool-call-1',
              kind: 'tool_activity',
              toolCallId: 'tool-call-1',
              toolExecutionId: 'tool-execution-1',
              toolResultId: 'tool-result-1',
              toolName: 'read_file',
              displayName: 'Read file',
              inputSummary: 'docs/README.md',
              resultSummary: 'Read 20 lines.',
              status: 'succeeded',
            },
            {
              itemId: 'approval:approval-1',
              kind: 'approval_activity',
              approvalId: 'approval-1',
              toolCallId: 'tool-call-1',
              toolExecutionId: 'tool-execution-1',
              scope: 'project',
              status: 'approved',
              title: 'Run command',
              description: 'npm test',
              subjectSummary: 'npm test',
            },
          ],
        },
        {
          blockId: 'answer-run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'streaming',
          text: 'The docs directory contains README.md.',
          format: 'markdown',
        },
      ],
    } satisfies TimelineAssistantMessage;

    const parsed = TimelineAssistantMessageSchema.parse(message);
    expect(parsed.blocks[0]?.kind).toBe('process_disclosure');
    expect(parsed.blocks[1]?.kind).toBe('answer_text');
    expect(TimelineMessageSchema.parse(message).role).toBe('assistant');
  });

  it('parses assistant messages with workspace change footer facts outside process disclosure blocks', () => {
    const parsed = TimelineAssistantMessageSchema.parse({
      messageId: 'assistant:run-1',
      role: 'assistant',
      runId: 'run-1',
      projectId: 'project-1',
      sessionId: 'session-1',
      createdAt: '2026-06-06T10:00:00.000Z',
      blocks: [{
        blockId: 'answer:run-1',
        kind: 'answer_text',
        runId: 'run-1',
        textId: 'answer-text-1',
        status: 'completed',
        text: 'Done.',
        format: 'markdown',
      }],
      workspaceChangeFooter: {
        runId: 'run-1',
        sessionId: 'session-1',
        updatedAt: '2026-06-06T10:00:01.000Z',
        changeSets: [{
          changeSetId: 'workspace-change-set-1',
          changedFileCount: 1,
          restorableCount: 1,
          restoredCount: 0,
          conflictCount: 0,
          failedCount: 0,
          hasRestorableChanges: true,
          files: [{
            changedFileId: 'workspace-changed-file-1',
            projectPath: 'AGENTS.md',
            changeKind: 'modified',
            restoreState: 'restorable',
          }],
        }],
      },
    });

    expect(parsed.workspaceChangeFooter?.changeSets[0]?.files[0]).toMatchObject({
      projectPath: 'AGENTS.md',
      changeKind: 'modified',
    });
    expect(parsed.blocks.map((block) => block.kind)).toEqual(['answer_text']);
  });

  it('allows process completed while answer text is still streaming', () => {
    expect(PROCESS_DISCLOSURE_STATUSES).toContain('completed');
    expect(ANSWER_TEXT_STATUSES).toContain('streaming');

    const process = ProcessDisclosureBlockSchema.parse({
      blockId: 'process-run-2',
      kind: 'process_disclosure',
      runId: 'run-2',
      status: 'completed',
      items: [],
    });
    const answer = AnswerTextBlockSchema.parse({
      blockId: 'answer-run-2',
      kind: 'answer_text',
      runId: 'run-2',
      textId: 'text-answer-2',
      status: 'streaming',
      text: 'Streaming now',
      format: 'markdown',
    });

    expect(process.status).toBe('completed');
    expect(answer.status).toBe('streaming');
  });

  it('parses compaction retry and recovery process items without raw internals', () => {
    const parsed = TimelineMessageSchema.parse({
      messageId: 'assistant:run-1',
      role: 'assistant',
      runId: 'run-1',
      projectId: 'project-1',
      sessionId: 'session-1',
      createdAt: '2026-06-01T10:00:00.000Z',
      blocks: [{
        blockId: 'process:run-1',
        kind: 'process_disclosure',
        runId: 'run-1',
        status: 'completed',
        createdAt: '2026-06-01T10:00:00.000Z',
        items: [
          {
            itemId: 'compaction:compaction-1',
            kind: 'compaction_activity',
            status: 'completed',
            label: 'Compacted context',
            createdAt: '2026-06-01T10:00:01.000Z',
          },
          {
            itemId: 'retry:retry-attempt-1',
            kind: 'retry_activity',
            retryAttemptId: 'retry-attempt-1',
            attemptNumber: 1,
            status: 'failed',
            label: 'Retry attempt 1 failed',
            reason: 'rate_limited',
            createdAt: '2026-06-01T10:00:02.000Z',
          },
          {
            itemId: 'recovery:run-1',
            kind: 'recovery_activity',
            status: 'interrupted',
            label: 'Previous run was interrupted',
            createdAt: '2026-06-01T10:00:03.000Z',
          },
        ],
      }],
    });

    const process = parsed.blocks[0];
    expect(process.kind).toBe('process_disclosure');
    expect(JSON.stringify(process)).not.toContain('providerBody');
    expect(JSON.stringify(process)).not.toContain('sourceEntryId');
  });

  it('keeps partial answer text on failure or cancellation', () => {
    const failed = TimelineAssistantMessageSchema.parse({
      ...messageBase,
      messageId: 'assistant-message-failed',
      role: 'assistant',
      runId: 'run-failed',
      blocks: [
        {
          blockId: 'process-run-failed',
          kind: 'process_disclosure',
          runId: 'run-failed',
          status: 'failed',
          items: [
            {
              itemId: 'error:provider',
              kind: 'error_activity',
              errorCode: 'provider_network_failed',
              errorMessage: 'Provider request failed.',
              recoverable: true,
            },
          ],
        },
        {
          blockId: 'answer-run-failed',
          kind: 'answer_text',
          runId: 'run-failed',
          textId: 'text-answer-failed',
          status: 'failed',
          text: 'Partial answer',
          format: 'markdown',
        },
      ],
    });
    const cancelled = TimelineAssistantMessageSchema.parse({
      ...messageBase,
      messageId: 'assistant-message-cancelled',
      role: 'assistant',
      runId: 'run-cancelled',
      blocks: [
        {
          blockId: 'process-run-cancelled',
          kind: 'process_disclosure',
          runId: 'run-cancelled',
          status: 'cancelled',
          items: [
            {
              itemId: 'cancelled:user',
              kind: 'cancelled_activity',
              reason: 'user_requested',
            },
          ],
        },
        {
          blockId: 'answer-run-cancelled',
          kind: 'answer_text',
          runId: 'run-cancelled',
          textId: 'text-answer-cancelled',
          status: 'cancelled_partial',
          text: 'Partial answer',
          format: 'markdown',
        },
      ],
    });

    expect(failed.blocks[1]).toMatchObject({ kind: 'answer_text', status: 'failed' });
    expect(cancelled.blocks[1]).toMatchObject({ kind: 'answer_text', status: 'cancelled_partial' });
  });

  it('rejects multiple process or answer blocks in one assistant message', () => {
    expect(() => TimelineAssistantMessageSchema.parse({
      ...messageBase,
      messageId: 'assistant-message-invalid-process',
      role: 'assistant',
      runId: 'run-1',
      blocks: [
        { blockId: 'process-1', kind: 'process_disclosure', runId: 'run-1', status: 'running', items: [] },
        { blockId: 'process-2', kind: 'process_disclosure', runId: 'run-1', status: 'running', items: [] },
      ],
    })).toThrow(/ProcessDisclosureBlock/);

    expect(() => TimelineAssistantMessageSchema.parse({
      ...messageBase,
      messageId: 'assistant-message-invalid-answer',
      role: 'assistant',
      runId: 'run-1',
      blocks: [
        {
          blockId: 'answer-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'completed',
          text: 'One',
          format: 'markdown',
        },
        {
          blockId: 'answer-2',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-2',
          status: 'completed',
          text: 'Two',
          format: 'markdown',
        },
      ],
    })).toThrow(/AnswerTextBlock/);
  });

  it('rejects answer phase in process assistant text items', () => {
    expect(() => ProcessDisclosureBlockSchema.parse({
      blockId: 'process-run-3',
      kind: 'process_disclosure',
      runId: 'run-3',
      status: 'running',
      items: [
        {
          itemId: 'text-answer-invalid',
          kind: 'assistant_text',
          textId: 'text-answer-3',
          phase: 'answer',
          status: 'streaming',
          text: 'This belongs in AnswerTextBlock.',
          format: 'markdown',
        },
      ],
    })).toThrow();
  });

  it('rejects final UI copy, ordering fields, raw tool input, and raw provider bodies', () => {
    expect(() => ToolActivityItemSchema.parse({
      itemId: 'tool:tool-call-raw',
      kind: 'tool_activity',
      toolCallId: 'tool-call-raw',
      toolName: 'read_file',
      status: 'succeeded',
      displayText: 'Megumi read docs/README.md',
    })).toThrow();

    expect(() => AnswerTextBlockSchema.parse({
      blockId: 'answer-with-order',
      kind: 'answer_text',
      runId: 'run-1',
      textId: 'text-answer-1',
      status: 'completed',
      text: 'Answer',
      format: 'markdown',
      order: 1,
    })).toThrow();

    expect(() => ToolActivityItemSchema.parse({
      itemId: 'tool:tool-call-input',
      kind: 'tool_activity',
      toolCallId: 'tool-call-input',
      toolName: 'read_file',
      status: 'succeeded',
      input: { path: 'docs/README.md' },
    })).toThrow();

    expect(() => ProcessDisclosureBlockSchema.parse({
      blockId: 'process-run-secret',
      kind: 'process_disclosure',
      runId: 'run-secret',
      status: 'failed',
      items: [
        {
          itemId: 'error:raw-provider',
          kind: 'error_activity',
          errorMessage: 'Provider failed.',
          rawProviderBody: { secret: 'sk-test' },
        },
      ],
    })).toThrow();
  });

  it('rejects legacy toolUseId on process disclosure tool and approval items', () => {
    expect(() => ToolActivityItemSchema.parse({
      itemId: 'tool:tool-use-legacy',
      kind: 'tool_activity',
      toolUseId: 'tool-use-legacy',
      toolName: 'read_file',
      status: 'running',
    })).toThrow();

    expect(() => ProcessDisclosureBlockSchema.parse({
      blockId: 'process-run-legacy',
      kind: 'process_disclosure',
      runId: 'run-legacy',
      status: 'running',
      items: [
        {
          itemId: 'approval:legacy',
          kind: 'approval_activity',
          approvalId: 'approval-legacy',
          toolUseId: 'tool-use-legacy',
          scope: 'project',
          status: 'pending',
          title: 'Run command',
        },
      ],
    })).toThrow();
  });
});

