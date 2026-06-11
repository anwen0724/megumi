import type { ModelStepId, RunId } from '../primitives/ids';
import type { ModelId } from '../model/contracts';
import type { ModelInputContext } from '../model/input-context-contracts';
import type { ProviderId } from '../provider/contracts';
import type { RuntimeContext } from '../runtime/context';
import type { ToolDefinition } from '../tool/contracts';

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
  inputContext: ModelInputContext;
  toolDefinitions?: ToolDefinition[];
  runtimeContext?: RuntimeContext;
  createdAt: string;
}

