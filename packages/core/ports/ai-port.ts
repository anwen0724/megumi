import type { RunId } from '@megumi/shared/ids';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';

export interface AiPortStreamModelStepInput {
  request: ModelStepRuntimeRequest;
  runId: RunId | string;
  stepId: string;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface AiPortStreamInput {
  request: ChatRuntimeRequest;
  runId: RunId | string;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface AiModelStepPort {
  streamModelStep(input: AiPortStreamModelStepInput): AsyncIterable<RuntimeEvent>;
}

export interface AiChatPort {
  streamChat(input: AiPortStreamInput): AsyncIterable<RuntimeEvent>;
}

export interface AiPort extends Partial<AiModelStepPort>, Partial<AiChatPort> {}
