import type { SessionMessage } from './session-run-contracts';
import type { RunContext } from './run-context-contracts';
import type { RunId } from './ids';
import type { ModelId } from './model-contracts';
import type { ProviderId } from './provider-contracts';
import type { RuntimeContext } from './runtime-context';

export interface ModelStepRuntimeRequest {
  requestId: string;
  sessionId: string;
  runId: RunId | string;
  stepId: string;
  providerId: ProviderId;
  modelId: ModelId | string;
  messages: SessionMessage[];
  context?: RunContext;
  runtimeContext?: RuntimeContext;
  createdAt: string;
}
