// Provides default id factories shared by AgentRunService and composition wiring.
import type { AgentRunServiceIds } from './run-contract';

export function createDefaultAgentRunServiceIds(
  overrides: Partial<AgentRunServiceIds> = {},
): AgentRunServiceIds {
  return {
    sessionId: () => `session:${crypto.randomUUID()}`,
    runId: () => `run:${crypto.randomUUID()}`,
    stepId: () => `step:${crypto.randomUUID()}`,
    actionId: () => `action:${crypto.randomUUID()}`,
    observationId: () => `observation:${crypto.randomUUID()}`,
    checkpointId: () => `checkpoint:${crypto.randomUUID()}`,
    resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
    cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
    retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
    compactionId: () => `compaction:${crypto.randomUUID()}`,
    retryAttemptId: () => `retry-attempt:${crypto.randomUUID()}`,
    sourceEntryId: () => `source-entry:${crypto.randomUUID()}`,
    branchMarkerId: () => `branch-marker:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: () => `debug:${crypto.randomUUID()}`,
    chatStreamEventId: () => `chat-stream-event:${crypto.randomUUID()}`,
    chatStreamId: ({ runId }) => `chat-stream:${runId}:${crypto.randomUUID()}`,
    chatTextId: () => `text:${crypto.randomUUID()}`,
    chatThinkingId: () => `thinking:${crypto.randomUUID()}`,
    ...overrides,
  };
}
