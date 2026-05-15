import { create } from 'zustand';
import type {
  AgentContext,
  ContextSourceRef,
} from '@megumi/shared/agent-context-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

interface AgentContextState {
  baselineByRun: Record<string, AgentContext>;
  sourcesByRun: Record<string, ContextSourceRef[]>;
  contextEventsByRun: Record<string, RuntimeEvent[]>;
  activeContextRunId: string | null;
  lastError: string | null;
  setBaseline: (runId: string, context: AgentContext) => void;
  setSources: (runId: string, sources: ContextSourceRef[]) => void;
  applyRuntimeEvent: (event: RuntimeEvent) => void;
  clearContext: () => void;
}

function isContextEvent(event: RuntimeEvent): boolean {
  return event.eventType.startsWith('context.');
}

function upsertEvent(events: RuntimeEvent[], event: RuntimeEvent): RuntimeEvent[] {
  if (events.some((item) => item.eventId === event.eventId || item.sequence === event.sequence)) {
    return events;
  }

  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

export const useAgentContextStore = create<AgentContextState>((set) => ({
  baselineByRun: {},
  sourcesByRun: {},
  contextEventsByRun: {},
  activeContextRunId: null,
  lastError: null,
  setBaseline: (runId, context) => set((state) => ({
    activeContextRunId: runId,
    baselineByRun: {
      ...state.baselineByRun,
      [runId]: context,
    },
  })),
  setSources: (runId, sources) => set((state) => ({
    activeContextRunId: runId,
    sourcesByRun: {
      ...state.sourcesByRun,
      [runId]: sources,
    },
  })),
  applyRuntimeEvent: (event) => set((state) => {
    if (!event.runId || !isContextEvent(event)) {
      return state;
    }

    return {
      activeContextRunId: event.runId,
      contextEventsByRun: {
        ...state.contextEventsByRun,
        [event.runId]: upsertEvent(state.contextEventsByRun[event.runId] ?? [], event),
      },
    };
  }),
  clearContext: () => set({
    baselineByRun: {},
    sourcesByRun: {},
    contextEventsByRun: {},
    activeContextRunId: null,
    lastError: null,
  }),
}));
