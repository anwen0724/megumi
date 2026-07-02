import type { ModelStepId, RunId } from '../primitives/ids';
import type { ModelId } from '../model/contracts';
import type { JsonObject } from '../primitives/json';
import type { ModelInputContext } from '../model/input-context-contracts';
import type { ProviderId } from '../provider/contracts';
import type { RuntimeContext } from '../runtime/context';

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

export interface ModelStructuredOutputTarget {
  name: string;
  schema: JsonObject;
  strict?: boolean;
}

export type ModelToolCapability =
  | 'project_read'
  | 'project_write'
  | 'command_run'
  | 'network_access'
  | 'browser_access'
  | 'mcp_tool'
  | 'secret_read'
  | 'system_integration'
  | 'external_app';

export type ModelToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ModelToolSideEffect =
  | 'none'
  | 'read_external'
  | 'project_file_operation'
  | 'execute_command'
  | 'access_network'
  | 'access_secret'
  | 'modify_external'
  | 'system_change';

export interface ModelToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonObject;
  inputExamples?: JsonObject[];
  outputSchema?: JsonObject;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  capabilities: ModelToolCapability[];
  riskLevel: ModelToolRiskLevel;
  sideEffect: ModelToolSideEffect;
  availability: {
    status: 'available' | 'disabled' | 'unavailable';
    reason?: string;
  };
  executionMode?: 'parallel' | 'serial';
  permissionMetadata?: JsonObject;
  modelFacingDescription?: string;
  metadata?: JsonObject;
}

export interface ModelStepRuntimeRequest {
  requestId: string;
  sessionId: string;
  runId: RunId | string;
  stepId: string;
  modelStepId?: ModelStepId | string;
  providerId: ProviderId;
  modelId: ModelId | string;
  inputContext: ModelInputContext;
  toolDefinitions?: ModelToolDefinition[];
  structuredOutput?: ModelStructuredOutputTarget;
  runtimeContext?: RuntimeContext;
  createdAt: string;
}

