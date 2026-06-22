// Defines the host execution port used by Coding Agent tool orchestration without importing desktop adapters.
import type { RawToolResult, ToolExecution } from '@megumi/shared/tool';

export interface CodingAgentToolExecutionScope {
  sessionId: string;
  runId: string;
  stepId: string;
}

export interface CodingAgentToolExecutionRunOptions {
  scope?: CodingAgentToolExecutionScope;
  signal?: AbortSignal;
}

export interface CodingAgentToolExecutionHostPort {
  executeToolExecution(
    toolExecution: ToolExecution,
    options?: CodingAgentToolExecutionRunOptions,
  ): Promise<RawToolResult>;
  finalizeWorkspaceChangeSet?(scope: CodingAgentToolExecutionScope): unknown;
}
