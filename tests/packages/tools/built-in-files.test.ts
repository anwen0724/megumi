/* Protects the six Workspace-backed built-in Tools and bounded document behavior. */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { createTools, type ToolExecutionResult } from '../../../packages/tools/src';
import { createLocalWorkspaceFileAccess, parsedToolContent } from './tool-test-fixtures';

const DOCX_FIXTURE_BASE64 = 'UEsDBAoAAAAIAPAh91x5bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMECgAAAAAA8CH3XAAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgA8CH3XJv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBAoAAAAAAPAh91wAAAAAAAAAAAAAAAAFAAAAd29yZC9QSwMECgAAAAgA8CH3XD2eKt/IAAAAMAEAABEAAAB3b3JkL2RvY3VtZW50LnhtbG2PwU7DMAyGX8XKnaZwmFDVdredd4AHCIlZIzVxsL11fXuScUBCXD7Ltvzp93i8pxVuyBIpT+a56w1g9hRivkzm/e309GpA1OXgVso4mR3FHOdxGwL5a8KsUAVZhm0yi2oZrBW/YHLSUcFcd5/EyWlt+WI34lCYPIpUf1rtS98fbHIxm6b8oLC3Whq4Qefzskv0Aoy32DJCJkUZbds18oPl79mJ2CPg19WtAjWNgMaEAs57XJGdVlX3r0XQ65ntY/ATyP4+O38DUEsBAhQACgAAAAgA8CH3XHluM9foAAAArQEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAADwIfdcAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAAAZAQAAX3JlbHMvUEsBAhQACgAAAAgA8CH3XJv9N+qtAAAAKQEAAAsAAAAAAAAAAAAAAAAAPQEAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAA8CH3XAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAAAAEwIAAHdvcmQvUEsBAhQACgAAAAgA8CH3XD2eKt/IAAAAMAEAABEAAAAAAAAAAAAAAAAANgIAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAC0DAAAAAA==';
const PDF_FIXTURE_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNjQgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgKFBoeXNpY3MgcmV2aXNpb24gbm90ZXMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MTQKJSVFT0Y=';

describe('Workspace-backed built-in Tools', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-tools-'));
  });

  afterEach(() => fs.removeSync(root));

  it('writes, reads, and edits UTF-8 text through one Executor', async () => {
    const tools = fileTools(root);
    await succeeded(tools.executor.execute({
      toolName: 'write_file',
      input: { path: 'nested/file.txt', content: 'hello world', overwrite: true },
    }));
    const read = await succeeded(tools.executor.execute({
      toolName: 'read_file', input: { path: 'nested/file.txt' },
    }));
    const edit = await succeeded(tools.executor.execute({
      toolName: 'edit_file',
      input: { path: 'nested/file.txt', oldText: 'hello', newText: 'hi' },
    }));
    expect(parsedToolContent(read)).toMatchObject({ content: 'hello world', sizeBytes: 11, hasMore: false });
    expect(parsedToolContent(edit)).toMatchObject({ changed: true, replacements: 1 });
    await expect(fs.readFile(path.join(root, 'nested/file.txt'), 'utf8')).resolves.toBe('hi world');
  });

  it('returns resumable UTF-8 byte pages without splitting a character', async () => {
    await fs.writeFile(path.join(root, 'unicode.txt'), 'ab你cd好ef', 'utf8');
    const tools = fileTools(root);
    const first = await succeeded(tools.executor.execute({
      toolName: 'read_file', input: { path: 'unicode.txt', offset: 0, limit: 5 },
    }));
    const second = await succeeded(tools.executor.execute({
      toolName: 'read_file', input: { path: 'unicode.txt', offset: 5, limit: 5 },
    }));
    expect(parsedToolContent(first)).toMatchObject({ content: 'ab你', bytesReturned: 5, nextOffset: 5 });
    expect(parsedToolContent(second)).toMatchObject({ content: 'cd好', bytesReturned: 5, nextOffset: 10 });
    const invalid = await tools.executor.execute({
      toolName: 'read_file', input: { path: 'unicode.txt', offset: 3, limit: 5 },
    });
    expect(invalid).toMatchObject({ type: 'failed', error: { code: 'tool_execution_failed' } });
  });

  it('lists, globs, and searches with stable ordering and continuation offsets', async () => {
    await fs.outputFile(path.join(root, '.hidden.ts'), 'needle');
    await fs.outputFile(path.join(root, 'a.ts'), 'needle');
    await fs.outputFile(path.join(root, 'nested', 'b.ts'), 'needle\nneedle');
    const tools = fileTools(root);
    const listed = await succeeded(tools.executor.execute({
      toolName: 'list_directory',
      input: { path: '.', maxDepth: 2, includeHidden: false, offset: 1, limit: 1 },
    }));
    const firstGlob = await succeeded(tools.executor.execute({
      toolName: 'glob', input: { pattern: '**/*.ts', cwd: '.', offset: 0, limit: 1 },
    }));
    const secondGlob = await succeeded(tools.executor.execute({
      toolName: 'glob', input: { pattern: '**/*.ts', cwd: '.', offset: 1, limit: 1 },
    }));
    const searched = await succeeded(tools.executor.execute({
      toolName: 'search_text', input: { path: '.', query: 'needle', offset: 1, limit: 1 },
    }));
    expect(parsedToolContent(listed)).toMatchObject({ offset: 1, hasMore: true, nextOffset: 2 });
    expect(parsedToolContent(firstGlob)).toEqual({ matches: ['a.ts'], offset: 0, hasMore: true, nextOffset: 1 });
    expect(parsedToolContent(secondGlob)).toEqual({ matches: ['nested/b.ts'], offset: 1, hasMore: false });
    expect(parsedToolContent(searched)).toEqual({
      matches: [{ path: 'nested/b.ts', line: 1, preview: 'needle' }],
      offset: 1, hasMore: true, nextOffset: 2,
    });
  });

  it('extracts DOCX and page-aware PDF text while refusing structured mutation', async () => {
    await fs.writeFile(path.join(root, 'notes.docx'), Buffer.from(DOCX_FIXTURE_BASE64, 'base64'));
    await fs.writeFile(path.join(root, 'notes.pdf'), Buffer.from(PDF_FIXTURE_BASE64, 'base64'));
    const tools = fileTools(root);
    const docx = await succeeded(tools.executor.execute({
      toolName: 'read_file', input: { path: 'notes.docx' },
    }));
    const pdf = await succeeded(tools.executor.execute({
      toolName: 'read_file', input: { path: 'notes.pdf' },
    }));
    const search = await succeeded(tools.executor.execute({
      toolName: 'search_text', input: { path: 'notes.pdf', query: 'Physics' },
    }));
    expect(parsedToolContent(docx)).toMatchObject({ content: expect.stringContaining('Force equals mass times acceleration.') });
    expect(parsedToolContent(pdf)).toMatchObject({ content: expect.stringContaining('[Page 1]\nPhysics revision notes') });
    expect(parsedToolContent(search)).toMatchObject({ matches: [{ path: 'notes.pdf', page: 1, preview: 'Physics revision notes' }] });
    const mutation = await tools.executor.execute({
      toolName: 'edit_file', input: { path: 'notes.docx', oldText: 'Physics', newText: 'Chemistry' },
    });
    expect(mutation).toMatchObject({
      type: 'failed',
      error: { details: { reason: 'unsupported_structured_document', extension: '.docx' } },
    });
  });

  it('bounds large file results before normalized fallback', async () => {
    await fs.writeFile(path.join(root, 'large.txt'), 'x'.repeat(50_000), 'utf8');
    const result = await succeeded(fileTools(root).executor.execute({
      toolName: 'read_file', input: { path: 'large.txt', limit: 50_000 },
    }));
    const content = parsedToolContent(result) as { hasMore: boolean; nextOffset: number; bytesReturned: number };
    expect(Buffer.byteLength(result.normalizedResult.content, 'utf8')).toBeLessThanOrEqual(12_000);
    expect(content.hasMore).toBe(true);
    expect(content.nextOffset).toBe(content.bytesReturned);
  });

  it('returns safe file failure facts without leaking absolute paths', async () => {
    const result = await fileTools(root).executor.execute({
      toolName: 'read_file', input: { path: 'missing.txt' },
    });
    expect(result).toMatchObject({
      type: 'failed',
      error: { message: 'The requested file or directory was not found.', details: { reason: 'not_found' } },
    });
    expect(result.normalizedResult.content).not.toContain(root);
  });
});

function fileTools(root: string) {
  return createTools({ workspaceFileAccess: createLocalWorkspaceFileAccess(root) });
}

async function succeeded(pending: Promise<ToolExecutionResult>) {
  const result = await pending;
  expect(result.type).toBe('succeeded');
  if (result.type !== 'succeeded') throw new Error(result.error.message);
  return result;
}
