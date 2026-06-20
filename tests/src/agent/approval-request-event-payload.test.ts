// Verifies Agent approval events carry permission-owned approval facts for renderer projection.
import { describe, expect, it, vi } from 'vitest';
import { AssistantMessageEventStream, type AssistantStreamEvent } from '../../../src/ai';
import { createAgentRunner, type AgentRunEvent } from '../../../src/agent';
import type { ParsedInput } from '../../../src/input';
import { createInMemoryPermissionRepository, type PolicyDecision } from '../../../src/permission';
import { createSessionStateManager, type SessionStateRepository } from '../../../src/session';
import { createToolRegistry, type ToolDefinition } from '../../../src/tools';

function createSessionRepository(): SessionStateRepository {
  const messages = new Map<string, Parameters<SessionStateRepository['insertMessage']>[0]>();
  const sourceEntries = new Map<string, Parameters<SessionStateRepository['insertSourceEntry']>[0]>();
  const runs = new Map<string, Parameters<SessionStateRepository['insertRunRecord']>[0]>();
  const activeLeafBySession = new Map<string, Parameters<SessionStateRepository['insertSourceEntry']>[0]>();

  return {
    transaction(work) {
      return work();
    },
    createSession(session) {
      return session;
    },
    getSession() {
      return undefined;
    },
    listSessions() {
      return [];
    },
    insertMessage(message) {
      messages.set(String(message.id), message);
      return message;
    },
    getMessage(messageId) {
      return messages.get(String(messageId));
    },
    listMessagesForSession(sessionId) {
      return [...messages.values()].filter((message) => String(message.sessionId) === String(sessionId));
    },
    getMessagesForPath(path) {
      const ids = new Set(path.map((entry) => entry.ref.type === 'message' ? String(entry.ref.messageId) : undefined));
      return [...messages.values()].filter((message) => ids.has(String(message.id)));
    },
    insertSourceEntry(entry) {
      sourceEntries.set(String(entry.id), entry);
      return entry;
    },
    getSourceEntry(sourceEntryId) {
      return sourceEntries.get(String(sourceEntryId));
    },
    getActiveLeaf(sessionId) {
      return activeLeafBySession.get(String(sessionId));
    },
    setActiveLeaf(sessionId, sourceEntryId) {
      const entry = sourceEntries.get(String(sourceEntryId));
      if (entry) activeLeafBySession.set(String(sessionId), entry);
    },
    getActivePath(sessionId) {
      const path = [];
      let current = activeLeafBySession.get(String(sessionId));
      while (current) {
        path.unshift(current);
        current = current.parentId ? sourceEntries.get(String(current.parentId)) : undefined;
      }
      return path;
    },
    insertBranchMarker(marker) {
      return marker;
    },
    listBranchMarkers() {
      return [];
    },
    insertRetryAttempt(attempt) {
      return attempt;
    },
    listRetryAttempts() {
      return [];
    },
    insertRunRecord(run) {
      runs.set(String(run.id), run);
      return run;
    },
    updateRunRecord(run) {
      runs.set(String(run.id), run);
      return run;
    },
    getRunRecord(runId) {
      return runs.get(String(runId));
    },
    listRunRecords(sessionId) {
      return [...runs.values()].filter((run) => String(run.sessionId) === String(sessionId));
    },
  };
}

const writeTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write a file',
  inputSchema: { type: 'object' },
  source: { kind: 'builtin', id: 'write_file' },
  sideEffect: 'write',
  execution: {
    executionMode: 'serial',
    mutation: 'mutation',
    requiresPermission: true,
    supportsCancellation: false,
  },
  permission: { operation: 'write' },
};

function parsedInput(): ParsedInput {
  return {
    id: 'input-1',
    rawInputId: 'raw-input-1',
    source: { kind: 'composer' },
    rawKind: 'text',
    kind: 'user_input',
    text: 'Write src/a.ts',
    attachments: [],
    references: [],
    facts: [],
    metadata: { requestId: 'request-1', clientMessageId: 'client-message-1' },
    createdAt: '2026-06-20T00:00:00.000Z',
  };
}

function assistantToolCallStream(): AssistantMessageEventStream {
  const events: AssistantStreamEvent[] = [
    { type: 'message_start', messageId: 'assistant-message-1', role: 'assistant' },
    {
      type: 'content_block_start',
      index: 0,
      block: { type: 'toolCall', id: 'tool-call-1', name: 'write_file', argumentsText: '{"path":"src/a.ts"}' },
    },
    {
      type: 'content_block_end',
      index: 0,
      block: { type: 'toolCall', id: 'tool-call-1', name: 'write_file', argumentsText: '{"path":"src/a.ts"}' },
    },
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'tool-call-1', name: 'write_file', argumentsText: '{"path":"src/a.ts"}' }],
      },
    },
  ];
  return AssistantMessageEventStream.from(events);
}

describe('Agent approval.requested event payload', () => {
  it('includes the full permission approval request fact', async () => {
    const repository = createSessionRepository();
    const sessionManager = createSessionStateManager({
      repository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const toolRegistry = createToolRegistry({ tools: [writeTool] });
    const permissionRepository = createInMemoryPermissionRepository();
    const events: AgentRunEvent[] = [];
    const decision: PolicyDecision = {
      id: 'permission-decision-1',
      kind: 'ask',
      reason: 'write_requires_approval',
      mode: 'default',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      risk: { level: 'sensitive', reasons: ['write_file'] },
      createdAt: '2026-06-20T00:00:00.000Z',
    };
    const runner = createAgentRunner({
      sessionManager,
      sessionRepository: repository,
      permissionRepository,
      permissionEvaluator: { evaluate: vi.fn(() => decision) },
      toolRegistry,
      toolSet: toolRegistry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      toolExecutor: {
        async execute(call, context) {
          return {
            status: 'awaiting_approval',
            toolCallId: call.id,
            toolName: call.name,
            decision,
            approvalRequestId: context.approvalRequestId,
            text: 'Awaiting approval',
          };
        },
      },
      ai: { stream: vi.fn(() => assistantToolCallStream()) },
      model: { providerId: 'test-provider', modelId: 'test-model' },
      aiOptions: {},
      systemInstruction: 'test',
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
      emit: (event) => events.push(event),
    });

    await runner.startRun({
      parsedInput: parsedInput(),
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      options: { maxTurns: 1, maxToolCalls: 1, permissionMode: 'default' },
    });

    const event = events.find((candidate) => candidate.type === 'approval.requested');
    expect(event?.payload).toEqual(expect.objectContaining({
      approvalRequestId: 'approval-tool-call-1',
      toolCallId: 'tool-call-1',
      approvalRequest: expect.objectContaining({
        id: 'approval-tool-call-1',
        runId: 'session-run-run-input-1',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        status: 'pending',
        decisionKind: 'ask',
        policyDecision: expect.objectContaining({
          id: 'permission-decision-1',
          kind: 'ask',
          operation: 'write',
          actionName: 'write_file',
          target: 'src/a.ts',
        }),
      }),
    }));
  });
});
