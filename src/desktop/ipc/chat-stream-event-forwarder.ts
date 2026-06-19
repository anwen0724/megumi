// Forwards AppEvent values to renderer chat stream subscribers.
import type { BrowserWindow } from 'electron';
import type { AppApi } from '../../app';
import { mapAppEventToChatStreamEvent } from '../mappers/app-event-to-chat-stream-event.mapper';

export function registerChatStreamEventForwarder(options: {
  appApi: AppApi;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  const nextSeqByStream = new Map<string, number>();

  return options.appApi.subscribe((event) => {
    const explicitSeq = readSeq(event.payload);
    const mapped = explicitSeq === undefined
      ? mapAppEventToChatStreamEvent(event, { seq: nextSeqFor(event.payload, nextSeqByStream) })
      : mapAppEventToChatStreamEvent(event, { seq: explicitSeq });

    if (!mapped && explicitSeq === undefined) {
      rollbackSeqFor(event.payload, nextSeqByStream);
    }
    if (mapped) options.getMainWindow()?.webContents.send('megumi:chat-stream:event', mapped);
  });
}

function nextSeqFor(payload: Record<string, unknown>, counters: Map<string, number>): number {
  const key = counterKey(payload);
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}

function rollbackSeqFor(payload: Record<string, unknown>, counters: Map<string, number>): void {
  const key = counterKey(payload);
  const current = counters.get(key);
  if (current === undefined) return;
  if (current <= 1) {
    counters.delete(key);
    return;
  }
  counters.set(key, current - 1);
}

function counterKey(payload: Record<string, unknown>): string {
  const runId = typeof payload.runId === 'string' ? payload.runId : 'default-run';
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : 'default-session';
  const streamId = typeof payload.streamId === 'string' ? payload.streamId : `chat-stream:${runId}`;
  return `${sessionId}:${runId}:${streamId}`;
}

function readSeq(payload: Record<string, unknown>): number | undefined {
  if (typeof payload.seq === 'number' && Number.isFinite(payload.seq)) return payload.seq;
  if (typeof payload.sequence === 'number' && Number.isFinite(payload.sequence)) return payload.sequence;
  return undefined;
}
