import type { SessionMessage } from './session-run-contracts';
import type { RunContext } from './run-context-contracts';
import type { ModelStepId, RunId } from './ids';
import type { ModelId } from './model-contracts';
import type { PermissionModeSnapshot } from './permission-mode-contracts';
import type { ProviderId } from './provider-contracts';
import type { RuntimeContext } from './runtime-context';
import type { ToolDefinition, ToolResult } from './tool-contracts';

export interface ModelStepRuntimeRequest {
  requestId: string;
  sessionId: string;
  runId: RunId | string;
  stepId: string;
  modelStepId?: ModelStepId | string;
  providerId: ProviderId;
  modelId: ModelId | string;
  messages: SessionMessage[];
  context?: RunContext;
  toolDefinitions?: ToolDefinition[];
  toolResults?: ToolResult[];
  modeSnapshot?: PermissionModeSnapshot;
  modeSnapshotRef?: string;
  runtimeContext?: RuntimeContext;
  createdAt: string;
}
