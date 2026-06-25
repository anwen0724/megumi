// Coding Agent instruction source service discovers and loads agent instruction files through host ports.
// The service performs discovery only; context priority and budget stay in @megumi/coding-agent/run/context.
import path from 'node:path';
import { TextDecoder } from 'node:util';
import type { AgentInstructionSourceSnapshot } from '@megumi/shared/model';

export const AGENT_INSTRUCTION_SOURCE_FILE = 'AGENTS.md';
export const AGENT_INSTRUCTION_SOURCE_CANDIDATES = [
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
] as const;
export const AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES = 64 * 1024;

export interface AgentInstructionSourceServiceOptions {
  hardCapBytes?: number;
  readFile: (filePath: string) => Promise<Buffer>;
  readDirectory: (directoryPath: string) => Promise<string[]>;
}

export interface LoadInstructionSourcesInput {
  projectRoot?: string;
  effectiveCwd?: string;
  globalInstructionDirs?: string[];
  loadedAt: string;
}

interface InstructionCandidate {
  sourceKind: 'global_instruction' | 'project_instruction';
  directoryPath: string;
  relativeBasePath: string;
  sourceIdPrefix: 'global-instruction' | 'project-instruction';
  sourceUriPrefix: 'global-instruction' | 'project-instruction';
}

export class AgentInstructionSourceService {
  private readonly hardCapBytes: number;
  private readonly readFile: (filePath: string) => Promise<Buffer>;
  private readonly readDirectory: (directoryPath: string) => Promise<string[]>;

  constructor(options: AgentInstructionSourceServiceOptions) {
    this.hardCapBytes = options.hardCapBytes ?? AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES;
    this.readFile = options.readFile;
    this.readDirectory = options.readDirectory;
  }

  async loadInstructionSources(
    input: LoadInstructionSourcesInput,
  ): Promise<AgentInstructionSourceSnapshot[]> {
    const sources: AgentInstructionSourceSnapshot[] = [];
    const seenResolvedPaths = new Set<string>();

    for (const globalDir of input.globalInstructionDirs ?? []) {
      const source = await this.loadFirstReadableCandidate({
        sourceKind: 'global_instruction',
        directoryPath: path.resolve(globalDir),
        relativeBasePath: '',
        sourceIdPrefix: 'global-instruction',
        sourceUriPrefix: 'global-instruction',
      }, input.loadedAt, seenResolvedPaths);
      if (source) {
        sources.push(source);
      }
    }

    if (!input.projectRoot) {
      if (sources.length > 0) {
        return sources;
      }
      return [{
        sourceId: 'project-instruction:no-project-root',
        sourceKind: 'project_instruction',
        status: 'unavailable',
        loadedAt: input.loadedAt,
        reason: 'agent_instruction_no_project_root',
      }];
    }

    const projectRoot = path.resolve(input.projectRoot);
    const effectiveCwd = path.resolve(projectRoot, input.effectiveCwd ?? '.');
    const directories = projectInstructionDirectories(projectRoot, effectiveCwd);
    let includedOrFailedProjectSource = false;

    for (const directoryPath of directories) {
      const relativeBasePath = slashPath(path.relative(projectRoot, directoryPath));
      const source = await this.loadFirstReadableCandidate({
        sourceKind: 'project_instruction',
        directoryPath,
        relativeBasePath,
        sourceIdPrefix: 'project-instruction',
        sourceUriPrefix: 'project-instruction',
      }, input.loadedAt, seenResolvedPaths);
      if (source) {
        includedOrFailedProjectSource = true;
        sources.push(source);
      }
    }

    if (!includedOrFailedProjectSource) {
      sources.push({
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        status: 'missing',
        sourceUri: 'project-instruction://AGENTS.md',
        relativePath: AGENT_INSTRUCTION_SOURCE_FILE,
        loadedAt: input.loadedAt,
        reason: 'agent_instruction_missing',
      });
    }

    return sources;
  }

  private async loadFirstReadableCandidate(
    input: InstructionCandidate,
    loadedAt: string,
    seenResolvedPaths: Set<string>,
  ): Promise<AgentInstructionSourceSnapshot | undefined> {
    for (const fileName of AGENT_INSTRUCTION_SOURCE_CANDIDATES) {
      const filePath = path.join(input.directoryPath, fileName);
      const resolvedPath = path.resolve(filePath);
      if (seenResolvedPaths.has(resolvedPath)) {
        continue;
      }

      try {
        const buffer = await this.readFile(filePath);
        const actualFileName = await this.actualDirectoryFileName(input.directoryPath, fileName);
        const relativePath = slashPath(path.join(input.relativeBasePath, actualFileName));
        seenResolvedPaths.add(resolvedPath);
        return this.includedSource({
          sourceKind: input.sourceKind,
          sourceId: `${input.sourceIdPrefix}:${relativePath}`,
          sourceUri: `${input.sourceUriPrefix}://${relativePath}`,
          relativePath,
          buffer,
          loadedAt,
        });
      } catch (error) {
        if (isMissingFileError(error)) {
          continue;
        }
        const relativePath = slashPath(path.join(input.relativeBasePath, fileName));
        seenResolvedPaths.add(resolvedPath);
        return {
          sourceId: `${input.sourceIdPrefix}:${relativePath}`,
          sourceKind: input.sourceKind,
          status: 'read_failed',
          sourceUri: `${input.sourceUriPrefix}://${relativePath}`,
          relativePath,
          loadedAt,
          reason: 'agent_instruction_read_failed',
        };
      }
    }

    return undefined;
  }

  private includedSource(input: {
    sourceKind: 'global_instruction' | 'project_instruction';
    sourceId: string;
    sourceUri: string;
    relativePath: string;
    buffer: Buffer;
    loadedAt: string;
  }): AgentInstructionSourceSnapshot {
    const truncated = input.buffer.length > this.hardCapBytes;
    const text = truncated
      ? decodeUtf8Prefix(input.buffer, this.hardCapBytes)
      : input.buffer.toString('utf8');
    const includedBytes = Buffer.byteLength(text, 'utf8');

    if (truncated) {
      return {
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        status: 'included_truncated',
        sourceUri: input.sourceUri,
        relativePath: input.relativePath,
        text,
        loadedAt: input.loadedAt,
        sizeBytes: input.buffer.length,
        includedBytes,
        hardCapBytes: this.hardCapBytes,
        truncated: true,
        reason: 'project_instruction_hard_cap_exceeded',
      };
    }

    return {
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      status: 'included',
      sourceUri: input.sourceUri,
      relativePath: input.relativePath,
      text,
      loadedAt: input.loadedAt,
      sizeBytes: input.buffer.length,
      includedBytes,
      hardCapBytes: this.hardCapBytes,
      truncated: false,
    };
  }

  private async actualDirectoryFileName(directoryPath: string, candidateName: string): Promise<string> {
    try {
      const entries = await this.readDirectory(directoryPath);
      return entries.find((entry) => entry === candidateName)
        ?? entries.find((entry) => entry.toLowerCase() === candidateName.toLowerCase())
        ?? candidateName;
    } catch {
      return candidateName;
    }
  }
}

function projectInstructionDirectories(projectRoot: string, effectiveCwd: string): string[] {
  const root = path.resolve(projectRoot);
  const cwd = path.resolve(effectiveCwd);
  const relative = path.relative(root, cwd);

  if (!isInsideProjectRelativePath(relative)) {
    return [root];
  }

  const directories = [root];
  const segments = slashPath(relative).split('/').filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    directories.push(current);
  }

  return directories;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT',
  );
}

function decodeUtf8Prefix(buffer: Buffer, maxBytes: number): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });

  for (let end = Math.min(buffer.length, maxBytes); end >= 0; end -= 1) {
    try {
      return decoder.decode(buffer.subarray(0, end));
    } catch {
      continue;
    }
  }

  return '';
}

function slashPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isInsideProjectRelativePath(relativePath: string): boolean {
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}
