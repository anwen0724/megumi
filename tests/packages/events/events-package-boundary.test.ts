/* Verifies the Events default entry exposes stable protocols without internal cursors or bridges. */
import { describe, expect, it } from 'vitest';
import * as PublicEvents from '../../../packages/events/src/index';

describe('Events package boundary', () => {
  it('exports the canonical bus creation seam and schema', () => {
    expect(PublicEvents.createEventBus).toBeTypeOf('function');
    expect(PublicEvents.EventSchema).toBeDefined();
    // The runtime error protocol moved to @megumi/runtime-protocol.
    expect(PublicEvents).not.toHaveProperty('RuntimeErrorSchema');
  });

  it('keeps internal sequence, stream, exception, and legacy Service forms private', () => {
    for (const exportName of [
      'RuntimeEventSequenceCursor',
      'coalesceTextDeltaRuntimeEvents',
      'RuntimeException',
      'RuntimeEventBusService',
      'createRuntimeEventBus',
    ]) {
      expect(PublicEvents).not.toHaveProperty(exportName);
    }
  });
});
