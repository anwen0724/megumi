// @vitest-environment node
/*
 * Verifies the Instructions owner preserves source identity and precedence
 * while discovering files only through injected filesystem capabilities.
 */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  composeCodingAgentInstructions,
  type InstructionFileSystem,
} from '@megumi/coding-agent/instructions';

describe('InstructionService', () => {
  it('returns the fixed Megumi coding-agent system instruction by default', () => {
    const service = composeCodingAgentInstructions({
      megumiHomePath: 'C:\\Users\\megumi\\.megumi',
      fileSystem: createFileSystem(new Map()),
    });

    expect(service.getSystemInstructions()).toEqual([{
      instructionId: 'megumi.coding-agent.identity',
      content: 'You are Megumi, a coding agent. Use the provided session context, project instructions, runtime facts, tool results, and memory facts to continue the user\'s coding task.',
    }]);
  });

  it('returns user and workspace AGENTS.md sources from far to near without merging content', async () => {
    const megumiHomePath = 'C:\\Users\\megumi\\.megumi';
    const workspaceRoot = 'C:\\repo\\project';
    const workingDirectory = 'C:\\repo\\project\\packages\\app';
    const files = new Map<string, string>([
      [path.join(megumiHomePath, 'AGENTS.md'), 'user instructions\nwith all details'],
      [path.join(workspaceRoot, 'AGENTS.md'), 'project instructions'],
      [path.join(workspaceRoot, 'packages', 'AGENTS.md'), 'package instructions'],
      [path.join(workingDirectory, 'AGENTS.md'), 'app instructions\nkept independently'],
    ]);
    const fileSystem = createFileSystem(files);
    const service = composeCodingAgentInstructions({
      megumiHomePath,
      fileSystem,
      systemInstructions: [{ instructionId: 'megumi.identity', content: 'You are Megumi.' }],
    });

    const result = await service.getEffectiveAgentInstructions({ workspaceRoot, workingDirectory });

    expect(result).toEqual({
      status: 'ok',
      instructions: {
        sources: [
          {
            sourceId: `agents:${path.join(megumiHomePath, 'AGENTS.md')}`,
            sourcePath: path.join(megumiHomePath, 'AGENTS.md'),
            content: 'user instructions\nwith all details',
          },
          {
            sourceId: `agents:${path.join(workspaceRoot, 'AGENTS.md')}`,
            sourcePath: path.join(workspaceRoot, 'AGENTS.md'),
            content: 'project instructions',
          },
          {
            sourceId: `agents:${path.join(workspaceRoot, 'packages', 'AGENTS.md')}`,
            sourcePath: path.join(workspaceRoot, 'packages', 'AGENTS.md'),
            content: 'package instructions',
          },
          {
            sourceId: `agents:${path.join(workingDirectory, 'AGENTS.md')}`,
            sourcePath: path.join(workingDirectory, 'AGENTS.md'),
            content: 'app instructions\nkept independently',
          },
        ],
      },
    });
    expect(fileSystem.readDirectory).toHaveBeenCalledTimes(4);
    expect(fileSystem.readFile).toHaveBeenCalledTimes(4);
    expect(service.getSystemInstructions()).toEqual([
      { instructionId: 'megumi.identity', content: 'You are Megumi.' },
    ]);
  });
});

function createFileSystem(files: ReadonlyMap<string, string>): InstructionFileSystem {
  return {
    readDirectory: vi.fn(async (directoryPath: string) => {
      const names = [...files.keys()]
        .filter((filePath) => path.dirname(filePath) === directoryPath)
        .map((filePath) => path.basename(filePath));
      return [...new Set(names)];
    }),
    readFile: vi.fn(async (filePath: string) => {
      const content = files.get(filePath);
      if (content === undefined) {
        throw new Error(`Missing test file: ${filePath}`);
      }
      return content;
    }),
  };
}
