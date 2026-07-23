// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { createBuiltInToolExecutor } from '@megumi/agent/tools/built-in-tools';
import { ToolExecutionService, ToolRegistryService } from '@megumi/agent/tools';
import {
  composeAgentToolExecutionService,
  createLocalWorkspaceFileAccess,
} from '@megumi/agent/composition/compose-agent-tool-runtime';

const DOCX_FIXTURE_BASE64 = 'UEsDBAoAAAAIAPAh91x5bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMECgAAAAAA8CH3XAAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgA8CH3XJv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBAoAAAAAAPAh91wAAAAAAAAAAAAAAAAFAAAAd29yZC9QSwMECgAAAAgA8CH3XD2eKt/IAAAAMAEAABEAAAB3b3JkL2RvY3VtZW50LnhtbG2PwU7DMAyGX8XKnaZwmFDVdredd4AHCIlZIzVxsL11fXuScUBCXD7Ltvzp93i8pxVuyBIpT+a56w1g9hRivkzm/e309GpA1OXgVso4mR3FHOdxGwL5a8KsUAVZhm0yi2oZrBW/YHLSUcFcd5/EyWlt+WI34lCYPIpUf1rtS98fbHIxm6b8oLC3Whq4Qefzskv0Aoy32DJCJkUZbds18oPl79mJ2CPg19WtAjWNgMaEAs57XJGdVlX3r0XQ65ntY/ATyP4+O38DUEsBAhQACgAAAAgA8CH3XHluM9foAAAArQEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAADwIfdcAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAAAZAQAAX3JlbHMvUEsBAhQACgAAAAgA8CH3XJv9N+qtAAAAKQEAAAsAAAAAAAAAAAAAAAAAPQEAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAA8CH3XAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAAAAEwIAAHdvcmQvUEsBAhQACgAAAAgA8CH3XD2eKt/IAAAAMAEAABEAAAAAAAAAAAAAAAAANgIAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAC0DAAAAAA==';
const PDF_FIXTURE_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNjQgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgKFBoeXNpY3MgcmV2aXNpb24gbm90ZXMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MTQKJSVFT0Y=';

describe('built-in tool adapter file and command execution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-test-'));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('executes the original path without consuming Permission authorization data', async () => {
    const outsideFile = path.join(os.tmpdir(), `megumi-tool-input-${Date.now()}.txt`);
    await fs.writeFile(outsideFile, 'outside content', 'utf8');
    try {
      const service = composeAgentToolExecutionService({ projectRoot: tmpDir });
      const result = await service.executeTool({
        toolName: 'read_file',
        input: { path: outsideFile },
      });
      expect(result).toMatchObject({
        type: 'succeeded',
        normalizedResult: { kind: 'json', isError: false },
      });
      expect(result.type === 'succeeded' ? JSON.parse(result.normalizedResult.content).content : null)
        .toBe('outside content');
    } finally {
      await fs.remove(outsideFile);
    }
  });

  it('reads, writes, and edits files inside the project root', async () => {
    const adapter = createBuiltInToolExecutor({
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
      outputKind: 'json',
      content: {
        path: 'nested/file.txt',
        content: 'hello world',
        offset: 0,
        bytesReturned: 11,
        sizeBytes: 11,
        hasMore: false,
      },
    });
    expect(edit).toMatchObject({
      outputKind: 'json',
      content: expect.objectContaining({ changed: true, replacements: 1 }),
    });
    await expect(fs.readFile(path.join(tmpDir, 'nested', 'file.txt'), 'utf8')).resolves.toBe('hi world');
  });

  it('reads DOCX and PDF text through read_file and locates PDF matches through search_text', async () => {
    await fs.writeFile(path.join(tmpDir, 'notes.docx'), Buffer.from(DOCX_FIXTURE_BASE64, 'base64'));
    await fs.writeFile(path.join(tmpDir, 'notes.pdf'), Buffer.from(PDF_FIXTURE_BASE64, 'base64'));
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    const docxRead = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'notes.docx' },
    });
    const pdfRead = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'notes.pdf' },
    });
    const pdfSearch = await adapter.execute({
      toolName: 'search_text',
      input: { path: 'notes.pdf', query: 'Physics' },
    });

    expect(docxRead).toMatchObject({
      outputKind: 'json',
      content: { content: expect.stringContaining('Force equals mass times acceleration.') },
    });
    expect(pdfRead).toMatchObject({
      outputKind: 'json',
      content: { content: expect.stringContaining('[Page 1]\nPhysics revision notes') },
    });
    expect(pdfSearch).toMatchObject({
      outputKind: 'json',
      content: {
        matches: [{
          path: 'notes.pdf',
          page: 1,
          preview: 'Physics revision notes',
        }],
      },
    });

    await expect(adapter.execute({
      toolName: 'edit_file',
      input: {
        path: 'notes.docx',
        oldText: 'Physics',
        newText: 'Chemistry',
      },
    })).rejects.toThrow('DOCX structured editing is not supported by text file tools.');
    await expect(fs.readFile(path.join(tmpDir, 'notes.docx'))).resolves.toEqual(
      Buffer.from(DOCX_FIXTURE_BASE64, 'base64'),
    );
  });

  it('returns safe structured file failure facts without exposing host paths', async () => {
    const service = composeAgentToolExecutionService({ projectRoot: tmpDir });
    const result = await service.executeTool({
      toolName: 'read_file',
      input: { path: 'missing.txt' },
    });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_execution_failed',
        message: 'The requested file or directory was not found.',
        details: { reason: 'not_found', operation: 'read' },
      },
    });
    expect(result.normalizedResult.content).not.toContain(tmpDir);
  });

  it('reads text in resumable UTF-8 byte pages without splitting characters', async () => {
    await fs.writeFile(path.join(tmpDir, 'unicode.txt'), 'ab你cd好ef', 'utf8');
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    const first = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'unicode.txt', offset: 0, limit: 5 },
    });
    const second = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'unicode.txt', offset: 5, limit: 5 },
    });
    const last = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'unicode.txt', offset: 10, limit: 5 },
    });
    const eof = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'unicode.txt', offset: 12, limit: 5 },
    });

    expect(first.content).toEqual({
      path: 'unicode.txt', content: 'ab你', offset: 0, bytesReturned: 5,
      sizeBytes: 12, hasMore: true, nextOffset: 5,
    });
    expect(second.content).toEqual({
      path: 'unicode.txt', content: 'cd好', offset: 5, bytesReturned: 5,
      sizeBytes: 12, hasMore: true, nextOffset: 10,
    });
    expect(last.content).toEqual({
      path: 'unicode.txt', content: 'ef', offset: 10, bytesReturned: 2,
      sizeBytes: 12, hasMore: false,
    });
    expect(eof.content).toEqual({
      path: 'unicode.txt', content: '', offset: 12, bytesReturned: 0,
      sizeBytes: 12, hasMore: false,
    });
    await expect(adapter.execute({
      toolName: 'read_file',
      input: { path: 'unicode.txt', offset: 3, limit: 5 },
    })).rejects.toThrow('UTF-8 character boundary');
  });

  it('bounds the final serialized read page before normalization fallback', async () => {
    await fs.writeFile(path.join(tmpDir, 'large.txt'), 'x'.repeat(50_000), 'utf8');
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    const result = await adapter.execute({
      toolName: 'read_file',
      input: { path: 'large.txt', limit: 50_000 },
    });
    const content = result.content as {
      bytesReturned: number;
      nextOffset: number;
      hasMore: boolean;
    };

    expect(Buffer.byteLength(JSON.stringify(content, null, 2), 'utf8')).toBeLessThanOrEqual(12_000);
    expect(content.hasMore).toBe(true);
    expect(content.nextOffset).toBe(content.bytesReturned);
  });

  it('lists recursively with hidden filtering, stable ordering, and entry offsets', async () => {
    await fs.outputFile(path.join(tmpDir, '.hidden.txt'), 'hidden');
    await fs.outputFile(path.join(tmpDir, 'b.txt'), 'b');
    await fs.outputFile(path.join(tmpDir, 'nested', 'a.txt'), 'a');
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    const result = await adapter.execute({
      toolName: 'list_directory',
      input: { path: '.', maxDepth: 2, includeHidden: false, offset: 1, limit: 1 },
    });

    expect(result.content).toEqual({
      path: '.',
      entries: [{ name: 'nested', kind: 'directory', path: 'nested' }],
      offset: 1,
      hasMore: true,
      nextOffset: 2,
    });
  });

  it('paginates only glob matches and honors hidden-file filtering', async () => {
    await fs.outputFile(path.join(tmpDir, '.hidden.ts'), 'hidden');
    await fs.outputFile(path.join(tmpDir, 'a.ts'), 'a');
    await fs.outputFile(path.join(tmpDir, 'nested', 'b.ts'), 'b');
    await fs.outputFile(path.join(tmpDir, 'nested', 'skip.js'), 'skip');
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    const first = await adapter.execute({
      toolName: 'glob',
      input: { pattern: '**/*.ts', cwd: '.', includeHidden: false, offset: 0, limit: 1 },
    });
    const second = await adapter.execute({
      toolName: 'glob',
      input: { pattern: '**/*.ts', cwd: '.', includeHidden: false, offset: 1, limit: 1 },
    });

    expect(first.content).toEqual({ matches: ['a.ts'], offset: 0, hasMore: true, nextOffset: 1 });
    expect(second.content).toEqual({ matches: ['nested/b.ts'], offset: 1, hasMore: false });
  });

  it('performs literal text search with stable resumable result offsets', async () => {
    await fs.outputFile(path.join(tmpDir, 'b.txt'), 'needle (literal)\nneedle (literal)');
    await fs.outputFile(path.join(tmpDir, 'a.txt'), 'needle (literal)');
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
    });

    const result = await adapter.execute({
      toolName: 'search_text',
      input: { query: 'needle (literal)', path: '.', offset: 1, limit: 1 },
    });

    expect(result.content).toEqual({
      matches: [{ path: 'b.txt', line: 1, preview: 'needle (literal)' }],
      offset: 1,
      hasMore: true,
      nextOffset: 2,
    });
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
    const adapter = createBuiltInToolExecutor({
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

  it('bounds command stream capture while continuing to consume output', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('x'.repeat(100_000)));
        child.stderr.emit('data', Buffer.from('y'.repeat(100_000)));
        child.emit('close', 0);
      });
      return child;
    });
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
      spawn: spawn as never,
    });

    const result = await adapter.execute({ toolName: 'run_command', input: { command: 'large-output' } });
    const content = result.content as { stdoutPreview: string; stderrPreview: string; truncated: boolean };

    expect(Buffer.byteLength(content.stdoutPreview, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(content.stderrPreview, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(content.truncated).toBe(true);
  });

  it('reports non-zero command exit as a structured tool failure', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('compile failed'));
        child.emit('close', 2);
      });
      return child;
    });
    const adapter = createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
      spawn: spawn as never,
    });

    const result = await adapter.execute({ toolName: 'run_command', input: { command: 'compile' } });

    expect(result).toMatchObject({
      isError: true,
      error: {
        code: 'tool_execution_failed',
        message: 'Command exited with code 2.',
        details: { reason: 'non_zero_exit', exitCode: 2 },
      },
    });
  });

  it('reports command timeout without exposing process internals', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      return child;
    });
    const service = new ToolExecutionService({
      registryService: new ToolRegistryService(),
      builtInTools: createBuiltInToolExecutor({
        workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
        spawn: spawn as never,
      }),
    });

    const result = await service.executeTool({
      toolName: 'run_command',
      input: { command: 'hang', timeoutMs: 1 },
    });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_execution_failed',
        message: 'Command timed out after 1ms.',
        details: { reason: 'timeout', timeoutMs: 1 },
      },
    });
  });

  it('reports spawn failure without exposing the host error', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => child.emit('error', new Error(`spawn failed at ${tmpDir}`)));
      return child;
    });
    const service = new ToolExecutionService({
      registryService: new ToolRegistryService(),
      builtInTools: createBuiltInToolExecutor({
        workspaceFileAccess: createLocalWorkspaceFileAccess({ projectRoot: tmpDir }),
        spawn: spawn as never,
      }),
    });

    const result = await service.executeTool({ toolName: 'run_command', input: { command: 'missing' } });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        message: 'Command process could not be started.',
        details: { reason: 'spawn_failed' },
      },
    });
    expect(result.normalizedResult.content).not.toContain(tmpDir);
  });
});
