import type { SessionMessage } from './session-run-contracts';
import type { RunContext } from './run-context-contracts';
import type { ModelStepId, RunId } from './ids';
import type { ModelId } from './model-contracts';
import type { ModelInputContext } from './model-input-context-contracts';
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
  inputContext?: ModelInputContext;
  toolDefinitions?: ToolDefinition[];
  runtimeContext?: RuntimeContext;
  createdAt: string;

  /**
   * @deprecated Migration-only legacy model input field. Plan 3 must replace
   * callers with inputContext, and Plan 4 must remove this field.
   */
  messages: SessionMessage[];

  /**
   * @deprecated Migration-only legacy model input field. Provider prompt
   * materialization must use inputContext when present.
   */
  context?: RunContext;

  /**
   * @deprecated Migration-only legacy model input field. Tool continuation
   * must move into ModelInputContext ToolContinuationPart in Plan 3.
   */
  toolUses?: ToolUse[];

  /**
   * @deprecated Migration-only legacy model input field. Tool continuation
   * must move into ModelInputContext ToolContinuationPart in Plan 3.
   */
  toolResults?: ToolResult[];

  /**
   * @deprecated Migration-only legacy model input field. Provider state
   * continuation must move into ModelInputContext ToolContinuationPart in Plan 3.
   */
  providerStates?: ModelStepProviderState[];

  /**
   * @deprecated Migration-only legacy model input field. Model-visible runtime
   * constraints must move into ModelInputContext RuntimeConstraintPart.
   */
  modeSnapshot?: PermissionModeSnapshot;
  modeSnapshotRef?: string;
}
