import type { RunId } from '@megumi/shared/primitives';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';

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

