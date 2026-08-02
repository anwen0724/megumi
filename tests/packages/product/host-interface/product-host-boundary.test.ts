import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const hostRoot = path.join(root, 'packages/product/src/host');

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
      'chat-contract.ts',
      'chat-host.ts',
      'index.ts',
      'observability-contract.ts',
      'observability-host.ts',
      'product-host.ts',
      'runtime-redaction.ts',
      'settings-contract.ts',
      'settings-host.ts',
      'skills-host.ts',
      'workspace-contract.ts',
      'workspace-host.ts',
    ]);
  });

  it('keeps Host redaction on the browser-safe Observability entry', () => {
    const source = fs.readFileSync(path.join(hostRoot, 'runtime-redaction.ts'), 'utf8');

    expect(source).toContain("from '@megumi/observability/redaction'");
    expect(source).not.toContain("from '@megumi/observability';");
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

  it('keeps stable contracts out of Settings and Workspace Host implementations', () => {
    const settingsContract = fs.readFileSync(path.join(hostRoot, 'settings-contract.ts'), 'utf8');
    const settingsHost = fs.readFileSync(path.join(hostRoot, 'settings-host.ts'), 'utf8');
    const workspaceContract = fs.readFileSync(path.join(hostRoot, 'workspace-contract.ts'), 'utf8');
    const workspaceHost = fs.readFileSync(path.join(hostRoot, 'workspace-host.ts'), 'utf8');

    expect(settingsHost).not.toContain("from 'zod'");
    expect(settingsHost).not.toMatch(/export const \w+Schema/);
    expect(settingsContract).not.toContain('createSettingsHost');
    expect(workspaceHost).not.toContain("from 'zod'");
    expect(workspaceHost).not.toMatch(/export const \w+Schema/);
    expect(workspaceContract).not.toContain('createWorkspaceHost');
  });

  it('keeps Host factory implementations out of the renderer-safe public entry', async () => {
    const host = await import('@megumi/product/host');

    expect(Object.keys(host).filter((name) => name.startsWith('create'))).toEqual([]);
  });
});
