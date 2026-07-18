import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('context prompt resources', () => {
  it('keeps fixed prompts under packages/prompts', () => {
    const root = process.cwd();
    const systemPrompt = fs.readFileSync(path.join(root, 'packages/prompts/system-prompt.md'), 'utf8');
    const compactionPrompt = fs.readFileSync(path.join(root, 'packages/prompts/context-compaction-prompt.md'), 'utf8');

    expect(systemPrompt.trim().length).toBeGreaterThan(0);
    expect(compactionPrompt).toContain('summary');
    expect(fs.existsSync(path.join(root, 'packages/agent/context/prompts'))).toBe(false);
  });
});
