/*
 * Tracks bounded in-process diagnostics failures without becoming business state.
 */
export type ObservabilityHealthRecordType = 'content' | 'event' | 'lifecycle' | 'runtime';

export interface ObservabilityHealthSnapshot {
  readonly droppedRecords: number;
  readonly recordsDroppedByType: Readonly<Record<ObservabilityHealthRecordType, number>>;
  readonly contentBytesDropped: number;
  readonly writerQueueHighWaterBytes: number;
  readonly journalWriteFailures: number;
  readonly contentWriteFailures: number;
  readonly flushFailures: number;
  readonly rotationFailures: number;
  readonly retentionCleanupFailures: number;
  readonly indexProjectionFailures: number;
  readonly classifierFailures: number;
  readonly contextFailures: number;
  readonly captureFailures: number;
}

export interface ObservabilityHealth {
  /** Counts one dropped Record or Entry and its diagnostic byte cost. */
  recordDrop(type?: ObservabilityHealthRecordType, byteLength?: number): void;
  /** Retains the largest observed queued-byte value across local writers. */
  observeQueueBytes(byteLength: number): void;
  /** Counts one Trace Journal or Runtime Log append failure. */
  recordJournalWriteFailure(): void;
  /** Counts one Content Store verification or persistence failure. */
  recordContentWriteFailure(): void;
  /** Counts one explicit flush that encountered owned write failures. */
  recordFlushFailure(): void;
  /** Counts one segment rotation failure. */
  recordRotationFailure(): void;
  /** Counts one retention scan, decision, or exact-file deletion failure. */
  recordRetentionCleanupFailure(): void;
  /** Counts one Derived Index projection or prune failure. */
  recordIndexProjectionFailure(): void;
  /** Counts a product-result classifier failure. */
  recordClassifierFailure(): void;
  /** Counts an async Trace Context propagation failure. */
  recordContextFailure(): void;
  /** Counts a safe Content capture failure. */
  recordCaptureFailure(): void;
  /** Returns the current bounded process-local health snapshot. */
  snapshot(): ObservabilityHealthSnapshot;
}

/** Creates the mutable health accumulator owned by one Observability composition. */
export function createObservabilityHealth(): ObservabilityHealth {
  let droppedRecords = 0;
  const recordsDroppedByType: Record<ObservabilityHealthRecordType, number> = {
    content: 0,
    event: 0,
    lifecycle: 0,
    runtime: 0,
  };
  let contentBytesDropped = 0;
  let writerQueueHighWaterBytes = 0;
  let journalWriteFailures = 0;
  let contentWriteFailures = 0;
  let flushFailures = 0;
  let rotationFailures = 0;
  let retentionCleanupFailures = 0;
  let indexProjectionFailures = 0;
  let classifierFailures = 0;
  let contextFailures = 0;
  let captureFailures = 0;
  return {
    recordDrop: (type = 'lifecycle', byteLength = 0) => {
      droppedRecords += 1;
      recordsDroppedByType[type] += 1;
      if (type === 'content') contentBytesDropped += Math.max(0, byteLength);
    },
    observeQueueBytes: (byteLength) => {
      writerQueueHighWaterBytes = Math.max(writerQueueHighWaterBytes, byteLength);
    },
    recordJournalWriteFailure: () => { journalWriteFailures += 1; },
    recordContentWriteFailure: () => { contentWriteFailures += 1; },
    recordFlushFailure: () => { flushFailures += 1; },
    recordRotationFailure: () => { rotationFailures += 1; },
    recordRetentionCleanupFailure: () => { retentionCleanupFailures += 1; },
    recordIndexProjectionFailure: () => { indexProjectionFailures += 1; },
    recordClassifierFailure: () => { classifierFailures += 1; },
    recordContextFailure: () => { contextFailures += 1; },
    recordCaptureFailure: () => { captureFailures += 1; },
    snapshot: () => ({
      droppedRecords,
      recordsDroppedByType: { ...recordsDroppedByType },
      contentBytesDropped,
      writerQueueHighWaterBytes,
      journalWriteFailures,
      contentWriteFailures,
      flushFailures,
      rotationFailures,
      retentionCleanupFailures,
      indexProjectionFailures,
      classifierFailures,
      contextFailures,
      captureFailures,
    }),
  };
}
