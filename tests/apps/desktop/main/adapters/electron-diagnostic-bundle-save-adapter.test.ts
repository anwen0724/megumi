/* Verifies nested bundle persistence stays inside the user-selected directory. */
// @vitest-environment node
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('electron', () => ({ dialog: { showOpenDialog: mocks.showOpenDialog } }));
vi.mock('node:fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));

import { saveDiagnosticBundle } from '@megumi/desktop/main/adapters/electron-diagnostic-bundle-save-adapter';

describe('saveDiagnosticBundle', () => {
  beforeEach(() => {
    mocks.showOpenDialog.mockReset().mockResolvedValue({
      canceled: false,
      filePaths: [path.resolve('C:/diagnostics')],
    });
    mocks.mkdir.mockReset().mockResolvedValue(undefined);
    mocks.writeFile.mockReset().mockResolvedValue(undefined);
  });

  it('creates nested directories for safe Trace bundle paths', async () => {
    const result = await saveDiagnosticBundle({
      suggestedDirectoryName: 'megumi-trace-1',
      files: [{ relativePath: 'trace/records.jsonl', content: '{}\n' }],
    });

    expect(result).toMatchObject({ status: 'saved' });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join('trace', 'records.jsonl')),
      '{}\n',
      'utf8',
    );
  });

  it('rejects parent traversal before writing bundle Content', async () => {
    const result = await saveDiagnosticBundle({
      suggestedDirectoryName: 'megumi-trace-1',
      files: [{ relativePath: '../outside.txt', content: 'unsafe' }],
    });

    expect(result).toEqual({ status: 'failed', message: 'Invalid diagnostic bundle path.' });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
