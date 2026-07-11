// @vitest-environment node
/*
 * Verifies the Instructions owner preserves source identity and precedence
 * while discovering files only through injected filesystem capabilities.
 */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as PublicInstructions from '@megumi/coding-agent/instructions';
import {
  composeCodingAgentInstructions,
  type InstructionFileSystem,
} from '@megumi/coding-agent/instructions';

describe('InstructionService', () => {
  it('does not expose its implementation class from the public module', () => {
    expect(PublicInstructions).not.toHaveProperty('InstructionServiceImpl');
  });

  it('does not expose fixed system instruction storage from the public module', () => {
    expect(PublicInstructions).not.toHaveProperty('DEFAULT_CODING_AGENT_SYSTEM_INSTRUCTIONS');
  });

  it('does not allow composition callers to override fixed system instructions', () => {
    const root = nativeTestRoot();
    const service = composeCodingAgentInstructions({
      megumiHomePath: path.join(root, 'home', '.megumi'),
      fileSystem: createFileSystem(new Map()),
      // @ts-expect-error Fixed product instructions are not a composition input.
      systemInstructions: [{ instructionId: 'caller.override', content: 'Caller override.' }],
    });

    expect(service.getSystemInstructions()).toEqual([{
      instructionId: 'megumi.coding-agent.identity',
      content: 'You are Megumi, a coding agent. Use the provided session context, project instructions, runtime facts, tool results, and memory facts to continue the user\'s coding task.',
    }]);
  });

  it('returns the fixed Megumi coding-agent system instruction by default', () => {
    const root = nativeTestRoot();
    const service = composeCodingAgentInstructions({
      megumiHomePath: path.join(root, 'home', '.megumi'),
      fileSystem: createFileSystem(new Map()),
    });

    expect(service.getSystemInstructions()).toEqual([{
      instructionId: 'megumi.coding-agent.identity',
      content: 'You are Megumi, a coding agent. Use the provided session context, project instructions, runtime facts, tool results, and memory facts to continue the user\'s coding task.',
    }]);
  });

  it('returns user and workspace AGENTS.md sources from far to near without merging content', async () => {
    const root = nativeTestRoot();
    const megumiHomePath = path.join(root, 'home', '.megumi');
    const workspaceRoot = path.join(root, 'project');
    const workingDirectory = path.join(workspaceRoot, 'packages', 'app');
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
  });

  it('rejects a working directory outside the workspace root without reading files', async () => {
    const root = nativeTestRoot();
    const fileSystem = createFileSystem(new Map());
    const service = composeCodingAgentInstructions({
      megumiHomePath: path.join(root, 'home', '.megumi'),
      fileSystem,
    });

    await expect(service.getEffectiveAgentInstructions({
      workspaceRoot: path.join(root, 'workspace'),
      workingDirectory: path.join(root, 'outside'),
    })).resolves.toEqual({
      status: 'failed',
      message: 'The working directory must be within the workspace root.',
    });
    expect(fileSystem.readDirectory).not.toHaveBeenCalled();
    expect(fileSystem.readFile).not.toHaveBeenCalled();
  });

  it('discovers the workspace root once when it is also the working directory', async () => {
    const root = nativeTestRoot();
    const megumiHomePath = path.join(root, 'home', '.megumi');
    const workspaceRoot = path.join(root, 'workspace');
    const workspaceInstructionsPath = path.join(workspaceRoot, 'AGENTS.md');
    const fileSystem = createFileSystem(new Map([
      [workspaceInstructionsPath, 'workspace-only instructions'],
    ]));
    const service = composeCodingAgentInstructions({ megumiHomePath, fileSystem });

    await expect(service.getEffectiveAgentInstructions({
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({
      status: 'ok',
      instructions: {
        sources: [{
          sourceId: `agents:${workspaceInstructionsPath}`,
          sourcePath: workspaceInstructionsPath,
          content: 'workspace-only instructions',
        }],
      },
    });
    expect(fileSystem.readDirectory).toHaveBeenCalledTimes(2);
  });
});

function nativeTestRoot(): string {
  return path.join(path.parse(process.cwd()).root, 'megumi-instruction-service-tests');
}

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
