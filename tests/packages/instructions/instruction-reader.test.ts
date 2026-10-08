// @vitest-environment node
/* Verifies the Instructions owner reads exact AGENTS.md sources with stable scope and failure semantics. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNodeInstructionSource,
  loadInstructionFiles,
  loadSystemInstructionDocuments,
  type InstructionSource,
  type InstructionSourceOperationOptions,
  type ReadInstructionDirectoryRequest,
  type ReadInstructionDirectoryResult,
  type ReadInstructionFileRequest,
  type ReadInstructionFileResult,
  type ResolveInstructionPathRequest,
  type ResolveInstructionPathResult,
} from '@megumi/agent/resources/load-instructions';

const temporaryInstructionRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryInstructionRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('InstructionReader', () => {
  it('rejects a real directory junction that leaves the workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-instruction-junction-'));
    temporaryInstructionRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'AGENTS.md'), 'Outside rules');
    fs.symlinkSync(outside, path.join(workspace, 'linked'), 'junction');
    const result = await loadInstructionFiles({ megumiHomePath: workspace, workspaceRoot: workspace,
      workingDirectory: path.join(workspace, 'linked'), source: createNodeInstructionSource() });
    expect(result).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(result)).not.toContain('Outside rules');
  });

  it('caps the combined UTF-8 budget at a character boundary and marks the last source', async () => {
    const root = testPath('budget');
    const child = path.join(root, 'child');
    const result = await loadInstructionFiles({ megumiHomePath: root, workspaceRoot: root,
      workingDirectory: child, maxBytes: 5,
      source: new FakeInstructionSource(new Map([
        [path.join(root, 'AGENTS.md'), 'ab'], [path.join(child, 'AGENTS.md'), '汉汉'],
      ])),
    });
    expect(result).toMatchObject({ status: 'ok', sources: [
      { content: 'ab' }, { content: '汉', truncated: true },
    ] });
  });

  it('selects the first nonempty override, default or fallback at each directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-instruction-order-'));
    temporaryInstructionRoots.push(root);
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(root, 'AGENTS.override.md'), 'override');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'default');
    fs.writeFileSync(path.join(nested, 'AGENTS.override.md'), ' \n');
    fs.writeFileSync(path.join(nested, 'AGENTS.md'), '\t');
    fs.writeFileSync(path.join(nested, 'TEAM.md'), 'nested fallback');
    const result = await loadInstructionFiles({
      megumiHomePath: root, workspaceRoot: root, workingDirectory: nested,
      source: createNodeInstructionSource(), fallbackNames: ['TEAM.md'],
    });
    if (result.status !== 'ok') throw new Error(JSON.stringify(result));
    expect(result.sources.map(({ content }) => content)).toEqual(['override', 'nested fallback']);
  });

  it('loads the selected documents in order and normalizes BOM and line endings', async () => {
    const root = createInstructionContentRoot({ common: '\uFEFFIdentity\r\nline two', conversation: 'Behavior\r\n', recommendation: 'Unused' });
    const documents = ['common', 'conversation'].map(name => ({ instructionId: name, sourcePath: path.join(root, `${name}.md`) }));
    expect((await loadSystemInstructionDocuments({ documents })).map(document => document.content))
      .toEqual(['Identity\nline two', 'Behavior']);
  });

  it('rejects missing and empty selected documents', async () => {
    const root = createInstructionContentRoot({ common: ' \r\n ' });
    await expect(loadSystemInstructionDocuments({ documents: [{ instructionId: 'missing', sourcePath: path.join(root, 'missing.md') }] }))
      .rejects.toThrow('missing.md');
    await expect(loadSystemInstructionDocuments({ documents: [{ instructionId: 'empty', sourcePath: path.join(root, 'common.md') }] }))
      .rejects.toThrow('System instruction document is empty');
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
    const request = ({ megumiHomePath: home, source });

    await expect(loadInstructionFiles({ ...request, workspaceRoot, workingDirectory })).resolves.toEqual({
      status: 'ok',
      sources: [
          instruction(path.join(home, 'AGENTS.md'), 'home instructions'),
          instruction(path.join(workspaceRoot, 'AGENTS.md'), 'workspace instructions'),
          instruction(path.join(workspaceRoot, 'packages', 'AGENTS.md'), 'packages instructions'),
          instruction(path.join(workingDirectory, 'AGENTS.md'), 'working instructions'),
      ],
    });
    expect(source.readDirectory).toHaveBeenCalledTimes(4);
    expect(source.readFile).toHaveBeenCalledTimes(4);
  });

  it('treats missing AGENTS.md files as an empty successful result', async () => {
    const workspaceRoot = testPath('workspace');
    const source = new FakeInstructionSource();
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(loadInstructionFiles({ ...request,
      workspaceRoot,
      workingDirectory: path.join(workspaceRoot, 'src'),
    })).resolves.toEqual({ status: 'ok', sources: [] });
    expect(source.readFile).not.toHaveBeenCalled();
  });

  it('deduplicates one real source reached through multiple scopes', async () => {
    const workspaceRoot = testPath('workspace');
    const filePath = path.join(workspaceRoot, 'AGENTS.md');
    const source = new FakeInstructionSource(new Map([[filePath, 'one source']]));
    const request = ({ megumiHomePath: workspaceRoot, source });

    await expect(loadInstructionFiles({ ...request,
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({
      status: 'ok',
      sources: [instruction(filePath, 'one source')],
    });
    expect(source.readFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a lexical working directory outside the Workspace before source access', async () => {
    const source = new FakeInstructionSource();
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(loadInstructionFiles({ ...request,
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
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(loadInstructionFiles({ ...request, workspaceRoot, workingDirectory })).resolves.toMatchObject({
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
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(loadInstructionFiles({ ...request,
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
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(loadInstructionFiles({ ...request,
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
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });

    await expect(loadInstructionFiles({ ...request,
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
    const request = ({
      megumiHomePath: testPath('home', '.megumi'),
      source,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(loadInstructionFiles(
      { ...request, workspaceRoot, workingDirectory: workspaceRoot },
      { signal: controller.signal },
    )).resolves.toEqual({ status: 'cancelled' });
    expect(source.realPath).not.toHaveBeenCalled();

    source.cancelledFiles.add(path.resolve(sourcePath));
    await expect(loadInstructionFiles({ ...request,
      workspaceRoot,
      workingDirectory: workspaceRoot,
    })).resolves.toEqual({ status: 'cancelled' });
  });

  it.runIf(process.platform === 'win32')(
    'treats Windows path casing as the same Workspace boundary',
    async () => {
      const workspaceRoot = 'C:\\MEGUMI-WORKSPACE';
      const source = new FakeInstructionSource();
      const request = ({
        megumiHomePath: 'C:\\MEGUMI-HOME',
        source,
      });

      await expect(loadInstructionFiles({ ...request,
        workspaceRoot,
        workingDirectory: 'c:\\megumi-workspace\\src',
      })).resolves.toEqual({ status: 'ok', sources: [] });
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
