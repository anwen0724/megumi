/* Verifies Coding persists every formed Agent message through the existing session tables. */
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@megumi/ai';
import { createSessionMessageSaver } from '@megumi/application/coding/sessions/session-history';
import { createCodingContext } from '@megumi/application/coding/prepare-context';
import { createSessionAttachmentReader } from '@megumi/application/coding/sessions/session-attachments';
import { createModels } from '@megumi/ai';
import { fixture } from '../agent/agent-fixture';
import { createSessionFixture } from './session-test-fixture';

it('persists reply completion time independently of the model message start timestamp', async () => {
  const session = await createSessionFixture();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const startedAt = Date.parse('2026-10-04T02:50:03.000+08:00');
    const completedAt = '2026-10-03T18:50:07.000Z';
    const save = createSessionMessageSaver({ history: session.history, user: {
      session_id: session.sessionId, display_content: [{ type: 'text', text: 'Hello' }],
      model_content: [{ type: 'text', text: 'Hello' }],
    } });
    vi.setSystemTime(startedAt);
    await save({ runId: 'run:timing', messageId: 'user:timing',
      message: { role: 'user', content: 'Hello', timestamp: startedAt } });
    const reply = fauxAssistantMessage('Hello back', { timestamp: startedAt + 20 });
    vi.setSystemTime(new Date(completedAt));
    await save({ runId: 'run:timing', messageId: 'reply:timing', message: reply });
    const committed = session.history.getCommittedRunMessages({
      sessionId: session.sessionId, executionId: 'run:timing',
    });
    if (committed.status !== 'ok') throw new Error(committed.failure.message);
    expect(committed.messages.at(-1)?.message.completed_at).toBe(completedAt);
  } finally { vi.useRealTimers(); session.cleanup(); }
});

it('keeps user input, intermediate reply, tool result and final reply on the committed branch', async () => {
  const session = await createSessionFixture();
  try {
    const { agent, config, provider } = fixture();
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall('lookup', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('The original port was 3000.'),
    ]);
    const run = agent.startAgent({
      config: { ...config, tools: [{ name: 'lookup', description: 'Read a value', parameters: { type: 'object' },
        operations: () => [], execute: async () => ({ outputKind: 'text', content: 'Original port: 3000' }) }] },
      input: { role: 'user', content: 'Look up the port', timestamp: 1 },
      context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
      saveMessage: createSessionMessageSaver({ history: session.history, user: {
        session_id: session.sessionId, display_content: [{ type: 'text', text: 'Look up the port' }],
        model_content: [{ type: 'text', text: 'Look up the port' }],
      } }),
    });
    expect(await run.completion).toMatchObject({ status: 'completed' });
    const saved = session.history.getActiveHistory({ session_id: session.sessionId });
    if (saved.status !== 'ok') throw new Error(saved.failure.message);
    const messages = saved.history.flatMap(item => item.type === 'message' ? [item.message] : []);
    expect(messages.map(message => message.message_kind)).toEqual(['user_message', 'model_response', 'tool_result', 'assistant_reply']);
    expect(messages[2]).toMatchObject({ content: [{ type: 'text', text: 'Original port: 3000' }] });
    expect(new Set(messages.map(message => message.execution_id))).toEqual(new Set([run.runId]));
  } finally { session.cleanup(); }
});

it('reads each newly committed message without appending the in-memory run history again', async () => {
  const session = await createSessionFixture();
  try {
    const { config } = fixture();
    const context = createCodingContext({
      sessionId: session.sessionId, workspaceId: session.workspaceId,
      config: { ...config, environment: { workingDirectory: session.workspaceRoot, operatingSystem: 'Windows', shell: 'PowerShell' } },
      compactionThresholdRatio: 0.8, history: session.history,
      attachments: createSessionAttachmentReader({ store: session.store, contentStore: session.contentStore }),
      ai: createModels(), megumiHomePath: session.root, instructionDocuments: [],
    });
    const message = { role: 'user' as const, content: 'Remember port 3000', timestamp: 1 };
    const save = createSessionMessageSaver({ history: session.history, user: {
      session_id: session.sessionId, display_content: [{ type: 'text', text: message.content }],
      model_content: [{ type: 'text', text: message.content }],
    } });
    await save({ runId: 'run:context', messageId: 'message:input', message });
    const prepared = await context.prepare({ tools: [], runMessages: [message],
      budget: { contextWindowTokens: 100_000, reservedOutputTokens: 1000, inputTokens: 99_000 }, signal: new AbortController().signal });
    expect(prepared.messages).toMatchObject([{ role: 'user', content: [{ type: 'text', text: 'Remember port 3000' }] }]);
    expect(prepared.messages).toHaveLength(1);
  } finally { session.cleanup(); }
});

it('commits a rolling summary while retaining original messages and recent turns', async () => {
  const session = await createSessionFixture();
  try {
    const { ai, config, provider } = fixture();
    provider.setResponses([fauxAssistantMessage('User requires the original port to remain available.')]);
    for (let turn = 0; turn < 5; turn++) {
      await session.history.saveUserMessage({ session_id: session.sessionId, message_id: `user:${turn}`,
        display_content: [{ type: 'text', text: `Question ${turn}` }], model_content: [{ type: 'text', text: `Question ${turn}: ${'detail '.repeat(4000)}` }],
        created_at: new Date(turn * 2).toISOString() });
      session.history.saveAssistantReply({ session_id: session.sessionId, execution_id: `run:${turn}`, message_id: `answer:${turn}`,
        status: 'completed', content: [{ type: 'text', text: `Answer ${turn}: ${'detail '.repeat(4000)}` }], completed_at: new Date(turn * 2 + 1).toISOString() });
    }
    const context = createCodingContext({ sessionId: session.sessionId, workspaceId: session.workspaceId,
      config: { ...config, model: { ...config.model, contextWindow: 200_000 },
        environment: { workingDirectory: session.workspaceRoot, operatingSystem: 'Windows', shell: 'PowerShell' } },
      ai, history: session.history, compactionThresholdRatio: 0.8, instructionDocuments: [], megumiHomePath: session.root,
      attachments: createSessionAttachmentReader({ store: session.store, contentStore: session.contentStore }),
    });
    const request = { runMessages: [], tools: [], signal: new AbortController().signal,
      budget: { contextWindowTokens: 200_000, reservedOutputTokens: 1000, inputTokens: 199_000 } };
    const before = await context.prepare(request);
    expect(await context.compact?.({ context: before, reason: 'overflow', budget: request.budget, signal: request.signal })).toMatchObject({ status: 'compacted' });
    const after = await context.prepare(request);
    expect(after.messages.length).toBeLessThan(before.messages.length);
    expect(JSON.stringify(after.messages)).toContain('User requires the original port');
    const all = session.history.listMessages({ session_id: session.sessionId });
    if (all.status !== 'ok') throw new Error(all.failure.message);
    expect(all.messages).toHaveLength(10);
  } finally { session.cleanup(); }
});
