/* Verifies web_fetch tool output and its public-address boundary. */
import { describe, expect, it } from 'vitest';
import {
  createBuiltInToolExecutor,
  createWebFetchService,
  isAllowedResolvedAddress,
  isPublicIp,
  type WorkspaceFileAccess,
} from '@megumi/agent/tools/built-in-tools';
import { ToolExecutionService, ToolRegistryService } from '@megumi/agent/tools';

describe('web_fetch built-in tool', () => {
  it('returns a provider-neutral page result from the injected network service', async () => {
    const executor = createBuiltInToolExecutor({
      workspaceFileAccess: unusedWorkspaceFileAccess(),
      webFetchService: {
        async fetch({ url }) {
          return {
            requestedUrl: url,
            finalUrl: 'https://example.com/final',
            title: 'Example',
            contentType: 'text/html',
            content: 'Readable content',
            truncated: false,
          };
        },
      },
    });

    await expect(executor.execute({ toolName: 'web_fetch', input: { url: 'https://example.com' } }))
      .resolves.toMatchObject({
        content: {
          requestedUrl: 'https://example.com',
          finalUrl: 'https://example.com/final',
          content: 'Readable content',
        },
      });
  });

  it.each([
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it('allows proxy synthetic addresses only when they came from hostname resolution', () => {
    expect(isPublicIp('198.18.0.32')).toBe(false);
    expect(isAllowedResolvedAddress('198.18.0.32', 'hostname')).toBe(true);
    expect(isAllowedResolvedAddress('198.18.0.32', 'literal')).toBe(false);
  });

  it('keeps private-address rejection inside the Tool Runtime', async () => {
    await expect(createWebFetchService().fetch({ url: 'http://127.0.0.1/private' }))
      .rejects.toThrow(/private|local|non-public/);
  });

  it('returns a safe structured reason when a non-public target is blocked', async () => {
    const service = new ToolExecutionService({
      registryService: new ToolRegistryService(),
      builtInTools: createBuiltInToolExecutor({
        workspaceFileAccess: unusedWorkspaceFileAccess(),
        webFetchService: createWebFetchService(),
      }),
    });

    const result = await service.executeTool({
      toolName: 'web_fetch',
      input: { url: 'http://127.0.0.1/private' },
    });

    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'tool_execution_failed',
        message: 'web_fetch blocked a private or non-public address.',
        details: { reason: 'blocked_address' },
      },
    });
  });
});

function unusedWorkspaceFileAccess(): WorkspaceFileAccess {
  const unused = async () => { throw new Error('Not used'); };
  return {
    readFile: unused,
    listDirectory: unused,
    walkFiles: unused,
    readTextFile: unused,
    replaceText: unused,
    writeFile: unused,
    resolveCommandCwd: unused,
  } as WorkspaceFileAccess;
}
