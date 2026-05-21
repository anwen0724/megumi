import type { SessionMessage } from './session-run-contracts';
import type { RunContext } from './run-context-contracts';
import type { ModelStepId, RunId } from './ids';
import type { ModelId } from './model-contracts';
import type { PermissionModeSnapshot } from './permission-mode-contracts';
import type { ProviderId } from './provider-contracts';
import type { RuntimeContext } from './runtime-context';
import type { ToolDefinition, ToolResult, ToolUse } from './tool-contracts';

export type ProviderStateBlock =
  | {
      type: 'reasoning_content';
      text: string;
    }
  | {
      type: 'thinking';
      text: string;
      signature?: string;
    }
  | {
      type: 'redacted_thinking';
      data: string;
    };

export interface ModelStepProviderState {
  modelStepId: string;
  providerId: ProviderId | string;
  modelId: ModelId | string;
  blocks: ProviderStateBlock[];
}

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
  toolUses?: ToolUse[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  modeSnapshot?: PermissionModeSnapshot;
  modeSnapshotRef?: string;
  runtimeContext?: RuntimeContext;
  createdAt: string;
}
