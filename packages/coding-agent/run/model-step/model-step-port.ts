// Defines the model-step port consumed by the platform-independent Agent Runtime.
import type { RunId } from '@megumi/shared/primitives';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';

export interface ModelStepPortStreamInput {
  request: ModelStepRuntimeRequest;
  runId: RunId | string;
  stepId: string;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface ModelStepPort {
  streamModelStep(input: ModelStepPortStreamInput): AsyncIterable<RuntimeEvent>;
}
