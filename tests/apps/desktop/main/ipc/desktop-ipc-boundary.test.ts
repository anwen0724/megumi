import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../../..');
const ipcRoot = path.join(root, 'apps/desktop/src/main/ipc');

function readFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? readFiles(file) : [file];
  });
}

describe('desktop ipc boundary', () => {
  it('owns desktop IPC transport files locally', () => {
    expect(fs.existsSync(path.join(ipcRoot, 'channels.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ipcRoot, 'contracts.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ipcRoot, 'schemas.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ipcRoot, 'create-request-handler.ts'))).toBe(true);
  });

  it('removes old split handler entry files', () => {
    for (const file of [
      'command.handler.ts',
      'session.handler.ts',
      'project.handler.ts',
      'provider.handler.ts',
      'tool.handler.ts',
      'plan.handler.ts',
      'workspace-files.handler.ts',
    ]) {
      expect(fs.existsSync(path.join(ipcRoot, 'handlers', file))).toBe(false);
    }
  });

  it('does not import removed runtime forwarder entry files', () => {
    const source = readFiles(ipcRoot)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toContain('runtime-event-forwarder');
    expect(source).not.toContain('runtime-timeline-event-forwarder');
    expect(source).not.toContain('ipc-operation-name');
  });
});
