/* Verifies web_fetch tool output and its public-address boundary. */
import { describe, expect, it } from 'vitest';
import {
  createBuiltInToolExecutor,
  isAllowedResolvedAddress,
  isPublicIp,
  type WorkspaceFileAccess,
} from '@megumi/coding-agent/tools/built-in-tools';

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
