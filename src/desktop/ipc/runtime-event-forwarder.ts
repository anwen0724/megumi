// Forwards AgentRuntimeEvent values to renderer runtime subscribers.
import type { BrowserWindow } from 'electron';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../app';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../mappers/agent-runtime-event-to-renderer-runtime-event.mapper';

export function registerRuntimeEventForwarder(options: {
  agentRuntime: AgentRuntimePort;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  const nextSequenceByRun = new Map<string, number>();

  return options.agentRuntime.subscribe((event) => {
    const explicitSequence = readSequence(event);
    const sequence = explicitSequence ?? nextSequenceFor(event, nextSequenceByRun);
    options.getMainWindow()?.webContents.send(
      'megumi:runtime:event',
      mapAgentRuntimeEventToRendererRuntimeEvent(event, { sequence }),
    );
  });
}

function nextSequenceFor(event: AgentRuntimeEvent, counters: Map<string, number>): number {
  const key = counterKey(event);
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}

function counterKey(event: AgentRuntimeEvent): string {
  const payload = event.payload ?? {};
  const runId = event.runId ?? (typeof payload.runId === 'string' ? payload.runId : 'default-run');
  const sessionId = event.sessionId ?? (typeof payload.sessionId === 'string' ? payload.sessionId : 'default-session');
  return `${sessionId}:${runId}`;
}

function readSequence(event: AgentRuntimeEvent): number | undefined {
  const payload = event.payload ?? {};
  if (typeof payload.sequence === 'number' && Number.isFinite(payload.sequence)) return payload.sequence;
  if (typeof payload.seq === 'number' && Number.isFinite(payload.seq)) return payload.seq;
  return undefined;
}
