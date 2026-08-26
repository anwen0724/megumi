/*
 * Tracks bounded in-process diagnostics failures without becoming business state.
 */
export interface ObservabilityHealthSnapshot {
  readonly droppedRecords: number;
  readonly classifierFailures: number;
  readonly contextFailures: number;
  readonly captureFailures: number;
}

export interface ObservabilityHealth {
  recordDrop(): void;
  recordClassifierFailure(): void;
  recordContextFailure(): void;
  recordCaptureFailure(): void;
  snapshot(): ObservabilityHealthSnapshot;
}

/** Creates the mutable health accumulator owned by one Observability composition. */
export function createObservabilityHealth(): ObservabilityHealth {
  let droppedRecords = 0;
  let classifierFailures = 0;
  let contextFailures = 0;
  let captureFailures = 0;
  return {
    recordDrop: () => { droppedRecords += 1; },
    recordClassifierFailure: () => { classifierFailures += 1; },
    recordContextFailure: () => { contextFailures += 1; },
    recordCaptureFailure: () => { captureFailures += 1; },
    snapshot: () => ({ droppedRecords, classifierFailures, contextFailures, captureFailures }),
  };
}

