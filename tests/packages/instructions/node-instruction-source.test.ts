// @vitest-environment node
/* Verifies the default Node adapter without broadening the production source policy. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInstructionReader } from '../../../packages/agent/instructions/src/index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => (
    rm(directoryPath, { recursive: true, force: true })
  )));
});

describe('Node InstructionSource', () => {
  it('reads complete exact AGENTS.md files and ignores legacy candidate names', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'megumi-instructions-'));
    temporaryDirectories.push(root);
    const home = path.join(root, 'home');
    const workspaceRoot = path.join(root, 'workspace');
    const workingDirectory = path.join(workspaceRoot, 'src');
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(workingDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(home, 'AGENTS.md'), 'home rules', 'utf8'),
      writeFile(path.join(workspaceRoot, 'CLAUDE.md'), 'legacy rules', 'utf8'),
      writeFile(path.join(workspaceRoot, 'AGENTS.MD'), 'case alias rules', 'utf8'),
      writeFile(path.join(workingDirectory, 'AGENTS.md'), `${'complete '.repeat(10_000)}rules`, 'utf8'),
    ]);

    const reader = createInstructionReader({ megumiHomePath: home });
    const result = await reader.getEffectiveInstructions({ workspaceRoot, workingDirectory });

    expect(result).toMatchObject({
      status: 'ok',
      instructions: {
        sources: [
          { sourcePath: path.join(home, 'AGENTS.md'), content: 'home rules' },
          { sourcePath: path.join(workingDirectory, 'AGENTS.md') },
        ],
      },
    });
    if (result.status === 'ok') {
      expect(result.instructions.sources[1]?.content.endsWith('rules')).toBe(true);
      expect(result.instructions.sources[1]?.content.length).toBeGreaterThan(64 * 1024);
    }
  });
});
