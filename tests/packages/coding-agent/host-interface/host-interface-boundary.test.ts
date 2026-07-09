import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const hostRoot = path.join(root, 'packages/coding-agent/host-interface');

function readFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? readFiles(file) : [file];
  });
}

describe('host-interface boundary', () => {
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

  it('exposes host controllers through the new UI-facing shape', async () => {
    const host = await import('@megumi/coding-agent/host-interface');

    expect(host.createCodingAgentHostInterface({
      workspace: {} as never,
      chat: {} as never,
      skill: {} as never,
      settings: {} as never,
      approval: {} as never,
      artifacts: {} as never,
    })).toEqual(expect.objectContaining({
      workspace: expect.any(Object),
      chat: expect.any(Object),
      skill: expect.any(Object),
      settings: expect.any(Object),
      approval: expect.any(Object),
      artifacts: expect.any(Object),
    }));
  });
});
