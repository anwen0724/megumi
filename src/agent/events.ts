// Defines stable Agent Run events emitted by src/agent without creating UI timeline projections.
import type { AssistantStreamEvent } from '../ai';
import type { JsonObject } from '../shared';
import type { AgentRunStatus } from './types';

export type AgentRunEvent =
  | { type: 'run.started'; runId: string; occurredAt: string; payload: JsonObject }
  | { type: 'turn.started'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'context.ready'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'ai.message.event'; runId: string; turnIndex: number; occurredAt: string; event: AssistantStreamEvent }
  | { type: 'ai.message.completed'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'tool.call.created'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'tool.execution.started'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'tool.execution.completed'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'tool.result.created'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'approval.requested'; runId: string; turnIndex: number; occurredAt: string; payload: JsonObject }
  | { type: 'run.status.changed'; runId: string; occurredAt: string; status: AgentRunStatus; payload: JsonObject };
