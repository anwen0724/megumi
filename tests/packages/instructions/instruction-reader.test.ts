// @vitest-environment node
/* Verifies the Instructions owner reads exact AGENTS.md sources with stable scope and failure semantics. */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as PublicInstructions from '../../../packages/instructions/src/index';
import {
  createInstructionReader,
  type InstructionSource,
  type InstructionSourceOperationOptions,
  type ReadInstructionDirectoryRequest,
  type ReadInstructionDirectoryResult,
  type ReadInstructionFileRequest,
  type ReadInstructionFileResult,
  type ResolveInstructionPathRequest,
  type ResolveInstructionPathResult,
} from '../../../packages/instructions/src/index';

const EXPECTED_SYSTEM_INSTRUCTIONS = [
  {
    instructionId: 'megumi.system.identity',
    groups: [
      {
        groupId: 'identity',
        items: [
          'You are Megumi, the user\'s personal agent. Use the provided session context, project instructions, runtime facts, and tool results to continue the user\'s task.',
        ],
      },
    ],
  },
  {
    instructionId: 'megumi.system.guidance',
    groups: [
      {
        groupId: 'task-completion',
        items: [
          'Work toward the user\'s actual goal while respecting their stated constraints and the available facts.',
          'Treat every tool result as evidence. A successful tool call does not by itself mean the user\'s goal is complete.',
          'Inspect every tool result for failure, denial, partial output, truncation, or more available results.',
          'If the goal remains unresolved, continue with the next necessary action or adjust to a safe alternative.',
          'Verify objectively checkable work with available tools before claiming completion.',
          'If failure or denial leaves no safe alternative, accurately report the blocker instead of pretending the task succeeded.',
          'Before the final reply, reconcile the requested outcome with the evidence actually obtained.',
          'State what was completed, how it was verified, where any delivery was placed, and what remains unresolved.',
          'Do not claim success without supporting evidence.',
        ],
      },
      {
        groupId: 'dynamic-plan',
        items: [
          'Use update_plan for complex tasks whose progress benefits from an explicit multi-step plan; do not use it for simple tasks.',
          'Each update must provide the complete current plan snapshot.',
          'While unfinished work remains, exactly one step must be in_progress.',
          'When all work is complete, no step may remain in_progress.',
          'Keep step text concise and update statuses as work advances.',
        ],
      },
      {
        groupId: 'communication',
        items: [
          'Be concise in your responses.',
          'Show file paths clearly when working with files.',
        ],
      },
    ],
  },
] as const;

describe('InstructionReader', () => {
  it('exports only stable contracts and creation entries', () => {
    expect(PublicInstructions).not.toHaveProperty('DefaultInstructionReader');
    expect(PublicInstructions).not.toHaveProperty('loadInstructionFiles');
    expect(PublicInstructions).not.toHaveProperty('SYSTEM_INSTRUCTIONS');
  });

  it('preserves the current fixed System Instructions verbatim and returns fresh values', async () => {
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source: new FakeInstructionSource(),
    });

    const first = await reader.getSystemInstructions();
    const second = await reader.getSystemInstructions();

    expect(first).toEqual(EXPECTED_SYSTEM_INSTRUCTIONS);
    expect(second).toEqual(EXPECTED_SYSTEM_INSTRUCTIONS);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('reads Home, Workspace, and nested exact AGENTS.md sources from far to near', async () => {
    const home = testPath('home', '.megumi');
    const workspaceRoot = testPath('workspace');
    const workingDirectory = path.join(workspaceRoot, 'packages', 'app');
    const source = new FakeInstructionSource(new Map([
      [path.join(home, 'AGENTS.md'), 'home instructions'],
      [path.join(home, 'CLAUDE.md'), 'must be ignored'],
      [path.join(workspaceRoot, 'AGENTS.md'), 'workspace instructions'],
      [path.join(workspaceRoot, 'packages', 'AGENTS.md'), 'packages instructions'],
      [path.join(workspaceRoot, 'packages', 'CLAUDE.md'), 'must be ignored'],
      [path.join(workingDirectory, 'AGENTS.MD'), 'must be ignored'],
      [path.join(workingDirectory, 'AGENTS.md'), 'working instructions'],
    ]));
    const reader = createInstructionReader({ megumiHomePath: home, source });

    await expect(reader.getEffectiveInstructions({ workspaceRoot, workingDirectory })).resolves.toEqual({
      status: 'ok',
      instructions: {
        sources: [
          instruction(path.join(home, 'AGENTS.md'), 'home instructions'),
          instruction(path.join(workspaceRoot, 'AGENTS.md'), 'workspace instructions'),
          instruction(path.join(workspaceRoot, 'packages', 'AGENTS.md'), 'packages instructions'),
          instruction(path.join(workingDirectory, 'AGENTS.md'), 'working instructions'),
        ],
      },
    });
    expect(source.readDirectory).toHaveBeenCalledTimes(4);
    expect(source.readFile).toHaveBeenCalledTimes(4);
  });

  it('treats missing AGENTS.md files as an empty successful result', async () => {
    const workspaceRoot = testPath('workspace');
    const source = new FakeInstructionSource();
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(reader.getEffectiveInstructions({
      workspaceRoot,
      workingDirectory: path.join(workspaceRoot, 'src'),
    })).resolves.toEqual({ status: 'ok', instructions: { sources: [] } });
    expect(source.readFile).not.toHaveBeenCalled();
  });

  it('deduplicates one real source reached through multiple scopes', async () => {
    const workspaceRoot = testPath('workspace');
    const filePath = path.join(workspaceRoot, 'AGENTS.md');
    const source = new FakeInstructionSource(new Map([[filePath, 'one source']]));
    const reader = createInstructionReader({ megumiHomePath: workspaceRoot, source });

    await expect(reader.getEffectiveInstructions({
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({
      status: 'ok',
      instructions: { sources: [instruction(filePath, 'one source')] },
    });
    expect(source.readFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a lexical working directory outside the Workspace before source access', async () => {
    const source = new FakeInstructionSource();
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(reader.getEffectiveInstructions({
      workspaceRoot: testPath('workspace'),
      workingDirectory: testPath('outside'),
    })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'working_directory_outside_workspace',
        message: 'The working directory must be within the Workspace.',
      },
    });
    expect(source.realPath).not.toHaveBeenCalled();
  });

  it('rejects a Working Directory whose real path escapes through a symbolic link', async () => {
    const workspaceRoot = testPath('workspace');
    const workingDirectory = path.join(workspaceRoot, 'linked');
    const source = new FakeInstructionSource();
    source.realPaths.set(path.resolve(workingDirectory), testPath('outside'));
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(reader.getEffectiveInstructions({ workspaceRoot, workingDirectory })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'working_directory_outside_workspace' },
    });
    expect(source.readDirectory).not.toHaveBeenCalled();
  });

  it('rejects an AGENTS.md symbolic link whose real path escapes its scope', async () => {
    const workspaceRoot = testPath('workspace');
    const sourcePath = path.join(workspaceRoot, 'AGENTS.md');
    const source = new FakeInstructionSource(new Map([[sourcePath, 'outside contents']]));
    source.realPaths.set(path.resolve(sourcePath), testPath('outside', 'AGENTS.md'));
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(reader.getEffectiveInstructions({
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'instruction_source_outside_scope',
        message: 'An Instructions source resolves outside its allowed scope.',
        sourcePath,
      },
    });
    expect(source.readFile).not.toHaveBeenCalled();
  });

  it('returns a stable failure when an exact discovered source cannot be read', async () => {
    const workspaceRoot = testPath('workspace');
    const sourcePath = path.join(workspaceRoot, 'AGENTS.md');
    const source = new FakeInstructionSource(new Map([[sourcePath, 'unreadable']]));
    source.failedFiles.add(path.resolve(sourcePath));
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(reader.getEffectiveInstructions({
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'instruction_source_read_failed',
        message: 'An Instructions source could not be read.',
        sourcePath,
      },
    });
  });

  it('returns a stable failure when an instruction directory cannot be read', async () => {
    const workspaceRoot = testPath('workspace');
    const source = new FakeInstructionSource();
    source.failedDirectories.add(path.resolve(workspaceRoot));
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(reader.getEffectiveInstructions({
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'instruction_directory_read_failed',
        message: 'An Instructions directory could not be read.',
        sourcePath: workspaceRoot,
      },
    });
  });

  it('preserves pre-aborted and in-flight cancellation as cancellation', async () => {
    const workspaceRoot = testPath('workspace');
    const sourcePath = path.join(workspaceRoot, 'AGENTS.md');
    const source = new FakeInstructionSource(new Map([[sourcePath, 'cancelled']]));
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(reader.getEffectiveInstructions(
      { workspaceRoot, workingDirectory: workspaceRoot },
      { signal: controller.signal },
    )).resolves.toEqual({ status: 'cancelled' });
    expect(source.realPath).not.toHaveBeenCalled();

    source.cancelledFiles.add(path.resolve(sourcePath));
    await expect(reader.getEffectiveInstructions({
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({ status: 'cancelled' });
  });

  it.runIf(process.platform === 'win32')(
    'treats Windows path casing as the same Workspace boundary',
    async () => {
      const workspaceRoot = 'C:\\MEGUMI-WORKSPACE';
      const source = new FakeInstructionSource();
      const reader = createInstructionReader({
        megumiHomePath: 'C:\\MEGUMI-HOME',
        source,
      });

      await expect(reader.getEffectiveInstructions({
        workspaceRoot,
        workingDirectory: 'c:\\megumi-workspace\\src',
      })).resolves.toEqual({ status: 'ok', instructions: { sources: [] } });
    },
  );
});

class FakeInstructionSource implements InstructionSource {
  readonly realPaths = new Map<string, string>();
  readonly failedDirectories = new Set<string>();
  readonly failedFiles = new Set<string>();
  readonly cancelledFiles = new Set<string>();

  constructor(private readonly files: ReadonlyMap<string, string> = new Map()) {}

  readonly realPath = vi.fn(async (
    request: ResolveInstructionPathRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ResolveInstructionPathResult> => {
    if (options?.signal?.aborted) return { status: 'cancelled' };
    const resolved = path.resolve(request.path);
    return { status: 'resolved', path: this.realPaths.get(resolved) ?? resolved };
  });

  readonly readDirectory = vi.fn(async (
    request: ReadInstructionDirectoryRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ReadInstructionDirectoryResult> => {
    if (options?.signal?.aborted) return { status: 'cancelled' };
    const directoryPath = path.resolve(request.directoryPath);
    if (this.failedDirectories.has(directoryPath)) return { status: 'failed' };
    const entries = [...this.files.keys()]
      .filter((filePath) => path.dirname(path.resolve(filePath)) === directoryPath)
      .map((filePath) => path.basename(filePath));
    return { status: 'read', entries: [...new Set(entries)] };
  });

  readonly readFile = vi.fn(async (
    request: ReadInstructionFileRequest,
    options?: InstructionSourceOperationOptions,
  ): Promise<ReadInstructionFileResult> => {
    if (options?.signal?.aborted) return { status: 'cancelled' };
    const filePath = path.resolve(request.filePath);
    if (this.cancelledFiles.has(filePath)) return { status: 'cancelled' };
    if (this.failedFiles.has(filePath)) return { status: 'failed' };
    const entry = [...this.files.entries()].find(([candidate]) => path.resolve(candidate) === filePath);
    return entry ? { status: 'read', content: entry[1] } : { status: 'missing' };
  });
}

function instruction(sourcePath: string, content: string) {
  return { sourceId: `agents:${sourcePath}`, sourcePath, content };
}

function testPath(...segments: string[]): string {
  return path.join(path.parse(process.cwd()).root, 'megumi-instruction-reader-tests', ...segments);
}
