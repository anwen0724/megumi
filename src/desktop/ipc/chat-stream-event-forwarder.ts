// Forwards AgentRuntimeEvent values to renderer chat stream subscribers.
import type { BrowserWindow } from 'electron';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../app';
import { mapAgentRuntimeEventToChatStreamEvent } from '../mappers/agent-runtime-event-to-chat-stream-event.mapper';

export function registerChatStreamEventForwarder(options: {
  agentRuntime: AgentRuntimePort;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  const nextSeqByStream = new Map<string, number>();

  return options.agentRuntime.subscribe((event) => {
    const explicitSeq = readSeq(event);
    const mapped = explicitSeq === undefined
      ? mapAgentRuntimeEventToChatStreamEvent(event, { seq: nextSeqFor(event, nextSeqByStream) })
      : mapAgentRuntimeEventToChatStreamEvent(event, { seq: explicitSeq });

    if (!mapped && explicitSeq === undefined) {
      rollbackSeqFor(event, nextSeqByStream);
    }
    if (mapped) options.getMainWindow()?.webContents.send('megumi:chat-stream:event', mapped);
  });
}

function nextSeqFor(event: AgentRuntimeEvent, counters: Map<string, number>): number {
  const key = counterKey(event);
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}

function rollbackSeqFor(event: AgentRuntimeEvent, counters: Map<string, number>): void {
  const key = counterKey(event);
  const current = counters.get(key);
  if (current === undefined) return;
  if (current <= 1) {
    counters.delete(key);
    return;
  }
  counters.set(key, current - 1);
}

function counterKey(event: AgentRuntimeEvent): string {
  const payload = event.payload ?? {};
  const runId = event.runId ?? (typeof payload.runId === 'string' ? payload.runId : 'default-run');
  const sessionId = event.sessionId ?? (typeof payload.sessionId === 'string' ? payload.sessionId : 'default-session');
  const streamId = typeof payload.streamId === 'string' ? payload.streamId : `chat-stream:${runId}`;
  return `${sessionId}:${runId}:${streamId}`;
}

function readSeq(event: AgentRuntimeEvent): number | undefined {
  const payload = event.payload ?? {};
  if (typeof payload.seq === 'number' && Number.isFinite(payload.seq)) return payload.seq;
  if (typeof payload.sequence === 'number' && Number.isFinite(payload.sequence)) return payload.sequence;
  return undefined;
}
