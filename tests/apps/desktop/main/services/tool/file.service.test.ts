// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { readFile, writeFile, editFile, listFiles, runCommand } from '@megumi/desktop/main/services/tool/file.service';
import { EventEmitter } from 'events';

// Mock child_process.spawn for runCommand tests
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';

describe('file.service', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-test-'));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  describe('path sandboxing', () => {
    it('should throw when path escapes workspace root', async () => {
      await expect(readFile(tmpDir, '../../../etc/passwd')).rejects.toThrow('Path escapes workspace root');
    });

    it('should allow paths within workspace root', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'hello', 'utf-8');
      const content = await readFile(tmpDir, 'test.txt');
      expect(content).toBe('hello');
    });
  });

  describe('readFile', () => {
    it('should read file contents', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'hello world', 'utf-8');

      const content = await readFile(tmpDir, 'test.txt');
      expect(content).toBe('hello world');
    });

    it('should throw when file does not exist', async () => {
      await expect(readFile(tmpDir, 'nonexistent.txt')).rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    it('should write file contents', async () => {
      await writeFile(tmpDir, 'output.txt', 'test content');

      const content = await fs.readFile(path.join(tmpDir, 'output.txt'), 'utf-8');
      expect(content).toBe('test content');
    });

    it('should create parent directories if needed', async () => {
      await writeFile(tmpDir, 'nested/deep/file.txt', 'nested content');

      const content = await fs.readFile(path.join(tmpDir, 'nested', 'deep', 'file.txt'), 'utf-8');
      expect(content).toBe('nested content');
    });

    it('should overwrite existing files', async () => {
      await writeFile(tmpDir, 'overwrite.txt', 'original');
      await writeFile(tmpDir, 'overwrite.txt', 'updated');

      const content = await fs.readFile(path.join(tmpDir, 'overwrite.txt'), 'utf-8');
      expect(content).toBe('updated');
    });
  });

  describe('editFile', () => {
    it('should replace matching string in file', async () => {
      await writeFile(tmpDir, 'edit.txt', 'hello world');

      const result = await editFile(tmpDir, 'edit.txt', 'hello', 'hi');
      expect(result).toBe(true);

      const content = await readFile(tmpDir, 'edit.txt');
      expect(content).toBe('hi world');
    });

    it('should return false when oldStr not found', async () => {
      await writeFile(tmpDir, 'edit.txt', 'hello world');

      const result = await editFile(tmpDir, 'edit.txt', 'nonexistent', 'replacement');
      expect(result).toBe(false);

      const content = await readFile(tmpDir, 'edit.txt');
      expect(content).toBe('hello world');
    });

    it('should throw when file does not exist', async () => {
      await expect(editFile(tmpDir, 'nonexistent.txt', 'a', 'b')).rejects.toThrow();
    });
  });

  describe('listFiles', () => {
    it('should list files in a directory', async () => {
      await writeFile(tmpDir, 'a.txt', 'a');
      await writeFile(tmpDir, 'b.txt', 'b');
      await fs.mkdir(path.join(tmpDir, 'subdir'));

      const files = await listFiles(tmpDir, '.');
      expect(files).toContain('a.txt');
      expect(files).toContain('b.txt');
      expect(files).toContain('/subdir');
    });

    it('should return empty array for empty directory', async () => {
      const files = await listFiles(tmpDir, '.');
      expect(files).toEqual([]);
    });

    it('should throw for non-existent directory', async () => {
      await expect(listFiles(tmpDir, 'nonexistent')).rejects.toThrow();
    });
  });

  describe('runCommand', () => {
    it('should resolve with stdout and stderr on success', async () => {
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockImplementation(((
        command: string, opts?: any
      ) => {
        const stdoutEE = new EventEmitter();
        const stderrEE = new EventEmitter();
        const child = new EventEmitter() as any;
        child.stdout = stdoutEE;
        child.stderr = stderrEE;
        // Emit data and close after a short delay to allow listener registration
        setTimeout(() => {
          stdoutEE.emit('data', Buffer.from('output\n'));
          child.emit('close', 0);
        }, 10);
        return child;
      }) as any);

      const result = await runCommand('echo hello');
      expect(result.stdout).toBe('output\n');
      expect(result.stderr).toBe('');
    });

    it('should pass cwd when provided', async () => {
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockImplementation(((
        command: string, opts?: any
      ) => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setTimeout(() => { child.emit('close', 0); }, 10);
        return child;
      }) as any);

      await runCommand('ls', '/some/dir');
      expect(mockSpawn).toHaveBeenCalledWith('ls', {
        cwd: '/some/dir',
        shell: true,
        timeout: 30000,
      });
    });

    it('should reject on non-zero exit code', async () => {
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockImplementation(((
        command: string, opts?: any
      ) => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setTimeout(() => {
          child.stderr.emit('data', Buffer.from('error output'));
          child.emit('close', 1);
        }, 10);
        return child;
      }) as any);

      await expect(runCommand('invalid')).rejects.toThrow('Command exited with code 1');
    });

    it('should include stderr in error on failure', async () => {
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockImplementation(((
        command: string, opts?: any
      ) => {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setTimeout(() => {
          child.stderr.emit('data', Buffer.from('fatal error'));
          child.emit('close', 2);
        }, 10);
        return child;
      }) as any);

      try {
        await runCommand('failing');
      } catch (err: any) {
        expect(err.stderr).toBe('fatal error');
      }
    });
  });
});

