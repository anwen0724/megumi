// Defines the run operations exposed through the Coding Agent product runtime.
import type {
  RunStartPayload,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type { Run } from '@megumi/shared/session';
import type { ResumeToolApprovalInput } from '../agent-loop/tool-call';

export interface AgentRunPort {
  startRun(payload: RunStartPayload): Promise<{ run: Run; events: RuntimeEvent[] }>;
  sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean;
  resumeApproval(input: ResumeToolApprovalInput): AsyncIterable<RuntimeEvent> | undefined;
  createManualRetryFromRun(input: {
    requestId: string;
    runId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    retryAttempt: unknown;
    retryAttemptSourceEntry: unknown;
    events: RuntimeEvent[];
  };
  createManualRerunFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchMarker: unknown;
    branchMarkerSourceEntry: unknown;
    seedMessage: unknown;
    retryAttempt: unknown;
    retryAttemptSourceEntry: unknown;
    events: RuntimeEvent[];
  };
  cleanupInterruptedRunsOnStartup(): { cleanedRunIds: string[] };
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}
