import type { RunId } from '@megumi/shared/ids';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export interface AiPortStreamModelStepInput {
  request: ModelStepRuntimeRequest;
  runId: RunId | string;
  stepId: string;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface AiModelStepPort {
  streamModelStep(input: AiPortStreamModelStepInput): AsyncIterable<RuntimeEvent>;
}
