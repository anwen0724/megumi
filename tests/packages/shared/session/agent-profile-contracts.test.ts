// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AGENT_DESCRIPTIONS, AGENT_LABELS, AGENT_TYPES } from '@megumi/shared/session';

describe('agent contracts', () => {
  it('defines labels and descriptions for every agent type', () => {
    for (const type of AGENT_TYPES) {
      expect(AGENT_LABELS[type]).toBeTruthy();
      expect(AGENT_DESCRIPTIONS[type]).toBeTruthy();
    }
  });
});

