// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { createBuiltInToolAdapter } from '@megumi/coding-agent/tools/adapters/built-in-tools';
import { createLocalWorkspaceFileAccess } from '@megumi/coding-agent/composition/compose-coding-agent-tool-runtime';

describe('built-in tool adapter file and command execution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-test-'));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('rejects paths outside the project root', async () => {
    const adapter = createBuiltInToolAdapter({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    await expect(adapter.execute({
      toolName: 'read_file',
      input: { path: '../../../etc/passwd' },
    })).rejects.toThrow(/outside the project/i);
  });

  it('reads, writes, and edits files inside the project root', async () => {
    const adapter = createBuiltInToolAdapter({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    await adapter.execute({
      toolName: 'write_file',
      input: { path: 'nested/file.txt', content: 'hello world', overwrite: true },
    });
    const read = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'nested/file.txt' },
    });
    const edit = await adapter.execute({
      toolName: 'edit_file',
      input: { path: 'nested/file.txt', oldText: 'hello', newText: 'hi' },
    });

    expect(read).toMatchObject({
      outputKind: 'file',
      content: 'hello world',
    });
    expect(edit).toMatchObject({
      outputKind: 'json',
      content: expect.objectContaining({ changed: true, replacements: 1 }),
    });
    await expect(fs.readFile(path.join(tmpDir, 'nested', 'file.txt'), 'utf8')).resolves.toBe('hi world');
  });

  it('runs commands through injected spawn with project cwd', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill(): void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('output\n'));
        child.emit('close', 0);
      }, 0);
      return child;
    });
    const adapter = createBuiltInToolAdapter({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
      spawn: spawn as never,
    });

    const result = await adapter.execute({
      toolName: 'run_command',
      input: { command: 'echo hello' },
    });

    expect(result).toMatchObject({
      outputKind: 'command',
      content: expect.objectContaining({
        exitCode: 0,
        stdoutPreview: 'output\n',
      }),
    });
    expect(spawn).toHaveBeenCalledWith('echo hello', [], expect.objectContaining({
      cwd: tmpDir,
      shell: true,
      windowsHide: true,
    }));
  });
});
