/*
 * Exposes read-only Agent Run queries required by product projections without
 * leaking the persistence repository through the Coding Agent public seam.
 */
import type { RuntimeEvent } from '../../events';
import type { AgentRun } from './agent-run-contracts';

export interface AgentRunQueries {
  listRunsBySession(sessionId: string): AgentRun[];
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}
