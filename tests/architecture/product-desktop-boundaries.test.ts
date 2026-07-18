// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Product and Desktop final boundaries', () => {
  it('removes legacy owner and shadow-service directories', () => {
    for (const relativePath of [
      'packages/home',
      'packages/agent/host-interface',
      'apps/desktop/src/main/services',
      'apps/desktop/src/main/shell',
      'tests/apps/desktop/main/services',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    }
  });

  it('keeps product rules out of Desktop production source', () => {
    const desktop = readTree('apps/desktop/src');
    expect(desktop).not.toContain('runtime.jsonl');
    expect(desktop).not.toContain('DEFAULT_WORKSPACE_FILE_IGNORE_NAMES');
    expect(desktop).not.toContain('workspace:default');
    expect(desktop).not.toContain('createSessionTitleFromPrompt');
    expect(desktop).not.toContain('replacement_input');
  });

  it('keeps Product imports on Agent public module entries', () => {
    const product = readTree('packages/product');
    expect(product).not.toMatch(/agent\/(core|repositories|services|domain)\//);
  });
});

function readTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
