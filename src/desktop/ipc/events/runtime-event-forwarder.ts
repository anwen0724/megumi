// Forwards AgentRuntimeEvent values to renderer runtime subscribers.
import type { BrowserWindow } from 'electron';
import type { AgentRuntimeEvent, AgentRuntimePort } from '../../../app';
import { RuntimeEventSchema } from '../../../shared/renderer-contracts/runtime';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../../renderer-protocol/agent-runtime-event-to-renderer-runtime-event.mapper';

export function registerRuntimeEventForwarder(options: {
  agentRuntime: AgentRuntimePort;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  const nextSequenceByRun = new Map<string, number>();

  return options.agentRuntime.subscribe((event) => {
    const explicitSequence = readSequence(event);
    const sequence = explicitSequence ?? peekNextSequenceFor(event, nextSequenceByRun);
    const rendererEvent = mapAgentRuntimeEventToRendererRuntimeEvent(event, { sequence });
    if (!rendererEvent || !RuntimeEventSchema.safeParse(rendererEvent).success) {
      return;
    }
    if (explicitSequence === undefined) {
      commitSequenceFor(event, sequence, nextSequenceByRun);
    }
    options.getMainWindow()?.webContents.send('megumi:runtime:event', rendererEvent);
  });
}

function peekNextSequenceFor(event: AgentRuntimeEvent, counters: Map<string, number>): number {
  const key = counterKey(event);
  return (counters.get(key) ?? 0) + 1;
}

function commitSequenceFor(event: AgentRuntimeEvent, sequence: number, counters: Map<string, number>): void {
  counters.set(counterKey(event), sequence);
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
