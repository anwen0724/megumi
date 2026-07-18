/*
 * Agent Run lifecycle transition rules.
 * This file owns legal status movement for persisted AgentRun records only.
 */
import type { AgentRun, AgentRunFailure, AgentRunStatus } from '../contracts/agent-run-contracts';

const allowedTransitions: ReadonlyMap<AgentRunStatus, ReadonlySet<AgentRunStatus>> = new Map([
  ['queued', new Set(['running'])],
  ['running', new Set(['waiting_for_approval', 'cancelling', 'completed', 'failed'])],
  ['waiting_for_approval', new Set(['running', 'cancelling', 'failed'])],
  ['cancelling', new Set(['cancelled', 'failed'])],
  ['cancelled', new Set()],
  ['completed', new Set()],
  ['failed', new Set()],
]);

export type TransitionAgentRunStatusRequest = {
  run: AgentRun;
  to: AgentRunStatus;
  changed_at: string;
  failure?: AgentRunFailure;
};

export function assertAgentRunStatusTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!allowedTransitions.get(from)?.has(to)) {
    throw new Error(`Invalid Agent Run status transition: ${from} -> ${to}`);
  }
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed';
}

export function transitionAgentRunStatus(request: TransitionAgentRunStatusRequest): AgentRun {
  assertAgentRunStatusTransition(request.run.status, request.to);

  const transitioned: AgentRun = {
    ...request.run,
    status: request.to,
  };

  if (request.to === 'running' && !transitioned.started_at) {
    transitioned.started_at = request.changed_at;
  }

  if (isTerminalAgentRunStatus(request.to)) {
    transitioned.completed_at = request.changed_at;
  }

  if (request.failure) {
    transitioned.failure = request.failure;
  }

  return transitioned;
}
