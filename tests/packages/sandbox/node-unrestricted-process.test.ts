/* Verifies the explicit POSIX unrestricted backend without treating it as a restricted Sandbox. */
// @vitest-environment node
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeUnrestrictedProcess } from '../../../packages/sandbox/src';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
const posixIt = process.platform === 'win32' ? it.skip : it;

describe('POSIX unrestricted process', () => {
  it('discloses the local shell execution contract', () => {
    expect(createNodeUnrestrictedProcess()).toMatchObject({
      shellKind: 'posix_shell',
      executionMethod: 'shell',
    });
  });

  posixIt('runs outside the Workspace without injecting arbitrary environment secrets', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-posix-unrestricted-'));
    roots.push(cwd);
    process.env.MEGUMI_TEST_SECRET = 'must-not-cross';
    const stdout: string[] = [];
    try {
      const result = await createNodeUnrestrictedProcess().run(
        { cwd, command: "printf 'cwd=%s\\nsecret=%s\\n' \"$PWD\" \"$MEGUMI_TEST_SECRET\"" },
        { signal: new AbortController().signal, onStdout: (chunk) => stdout.push(String(chunk)), onStderr: () => undefined },
      );
      expect(result).toEqual({ exitCode: 0, terminationConfirmed: true });
      expect(stdout.join('')).toContain(`cwd=${cwd}`);
      expect(stdout.join('')).not.toContain('must-not-cross');
    } finally {
      delete process.env.MEGUMI_TEST_SECRET;
    }
  });
});