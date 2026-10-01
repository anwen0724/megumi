// @vitest-environment node
/* Verifies the Instructions owner reads exact AGENTS.md sources with stable scope and failure semantics. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
} from '../../../packages/agent/instructions/src/index';

const temporaryInstructionRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryInstructionRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('InstructionReader', () => {
  it('combines common instructions with the requested execution profile', async () => {
    const contentRoot = createInstructionContentRoot({
      common: 'Shared guidance',
      conversation: 'Conversation guidance',
      recommendation: 'Recommendation guidance',
    });
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      systemContentRoot: contentRoot,
    });
    expect((await reader.getSystemInstructions('conversation')).map(document => document.content))
      .toEqual(['Shared guidance', 'Conversation guidance']);
    expect((await reader.getSystemInstructions('recommendation')).map(document => document.content))
      .toEqual(['Shared guidance', 'Recommendation guidance']);
  });

  it('normalizes BOM and Windows line endings in replaceable instruction files', async () => {
    const contentRoot = createInstructionContentRoot({
      common: '\uFEFFIdentity\r\nline two\r\n',
      conversation: 'Behavior guidelines:\r- one\r\n- two\r\n',
      recommendation: 'Recommendation.\r\n',
    });
    const reader = createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      systemContentRoot: contentRoot,
    });

    await expect(reader.getSystemInstructions('conversation')).resolves.toMatchObject([
      { content: 'Identity\nline two' },
      { content: 'Behavior guidelines:\n- one\n- two' },
    ]);
  });

  it('rejects missing and empty profile instruction files', async () => {
    const missingRoot = createInstructionContentRoot({
      common: 'Identity',
      recommendation: 'Recommendation.',
    });
    const emptyRoot = createInstructionContentRoot({
      common: 'Identity',
      conversation: ' \r\n ',
      recommendation: 'Recommendation.',
    });

    await expect(createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      systemContentRoot: missingRoot,
    }).getSystemInstructions('conversation')).rejects.toThrow('conversation.md');
    await expect(createInstructionReader({
      megumiHomePath: testPath('home', '.megumi'),
      systemContentRoot: emptyRoot,
    }).getSystemInstructions('conversation')).rejects.toThrow('System instruction document is empty');
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

function createInstructionContentRoot(input: {
  readonly common?: string;
  readonly conversation?: string;
  readonly recommendation?: string;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-instruction-content-'));
  temporaryInstructionRoots.push(root);
  for (const [fileName, content] of [
    ['common.md', input.common],
    ['conversation.md', input.conversation],
    ['recommendation.md', input.recommendation],
  ] as const) {
    if (content !== undefined) fs.writeFileSync(path.join(root, fileName), content, 'utf8');
  }
  return root;
}

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
