import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const hostRoot = path.join(root, 'packages/product/host-interface');

function readFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? readFiles(file) : [file];
  });
}

describe('Product Host Interface boundary', () => {
  it('keeps the approved flat Host module structure', () => {
    expect(fs.readdirSync(hostRoot).sort()).toEqual([
      'approval-host.ts',
      'artifact-host.ts',
      'chat-host.ts',
      'index.ts',
      'plan-host.ts',
      'product-host-interface.ts',
      'settings-host.ts',
      'skill-host.ts',
      'workspace-host.ts',
    ]);
  });

  it('does not depend on desktop or IPC transport', () => {
    const source = readFiles(hostRoot)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toContain('apps/desktop');
    expect(source).not.toContain('electron');
    expect(source).not.toContain('IPC_CHANNELS');
    expect(source).not.toContain(['@megumi', 'shared'].join('/'));
  });

  it('keeps Host factory implementations out of the renderer-safe public entry', async () => {
    const host = await import('@megumi/product/host-interface');

    expect(Object.keys(host).filter((name) => name.startsWith('create'))).toEqual([]);
  });
});
