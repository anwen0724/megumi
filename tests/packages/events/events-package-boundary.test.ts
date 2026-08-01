/* Verifies the Events default entry exposes stable protocols without internal cursors or bridges. */
import { describe, expect, it } from 'vitest';
import * as PublicEvents from '../../../packages/events/src/index';

describe('Events package boundary', () => {
  it('exports the canonical Publisher and Event Bus creation seam', () => {
    expect(PublicEvents.createRuntimeEventBus).toBeTypeOf('function');
    expect(PublicEvents.RuntimeEventSchema).toBeDefined();
    expect(PublicEvents.RuntimeErrorSchema).toBeDefined();
  });

  it('keeps internal sequence, stream, exception, and legacy Service forms private', () => {
    for (const exportName of [
      'RuntimeEventSequenceCursor',
      'coalesceTextDeltaRuntimeEvents',
      'RuntimeException',
      'RuntimeEventBusService',
    ]) {
      expect(PublicEvents).not.toHaveProperty(exportName);
    }
  });
});
