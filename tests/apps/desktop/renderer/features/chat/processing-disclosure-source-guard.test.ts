// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('processing disclosure source guard', () => {
  it('does not expose hidden reasoning or guessed future steps in processing disclosure UI', () => {
    const helper = readSource('apps/desktop/src/renderer/features/chat/processing-disclosure.ts');
    const component = readSource('apps/desktop/src/renderer/features/chat/components/ProcessingDisclosure.tsx');
    const timeline = readSource('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');
    const combined = `${helper}\n${component}\n${timeline}`;

    expect(combined).not.toMatch(/chain-of-thought|hidden reasoning|raw reasoning/i);
    expect(combined).not.toMatch(/思考过程|下一步|next step/i);
  });
});
