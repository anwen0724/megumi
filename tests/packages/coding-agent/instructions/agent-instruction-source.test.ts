// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentInstructionSourceService,
  AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
} from '@megumi/coding-agent/instructions';

const loadedAt = '2026-05-28T00:00:00.000Z';
const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'megumi-agent-instruction-'));
  tempDirs.push(dir);
  return dir;
}

async function readDirectory(directoryPath: string): Promise<string[]> {
  return readdir(directoryPath) as Promise<string[]>;
}

function createService(hardCapBytes?: number): AgentInstructionSourceService {
  return new AgentInstructionSourceService({
    readFile: (filePath) => readFile(filePath),
    readDirectory,
    ...(hardCapBytes ? { hardCapBytes } : {}),
  });
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('AgentInstructionSourceService', () => {
  it('returns unavailable when there is no project root', async () => {
    const service = createService();

    await expect(service.loadInstructionSources({ loadedAt })).resolves.toEqual([{
      sourceId: 'project-instruction:no-project-root',
      sourceKind: 'project_instruction',
      status: 'unavailable',
      loadedAt,
      reason: 'agent_instruction_no_project_root',
    }]);
  });

  it('returns missing when project root has no AGENTS.md', async () => {
    const projectRoot = await tempProject();
    const service = createService();

    await expect(service.loadInstructionSources({ projectRoot, loadedAt })).resolves.toEqual([{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'missing',
      sourceUri: 'project-instruction://AGENTS.md',
      relativePath: 'AGENTS.md',
      loadedAt,
      reason: 'agent_instruction_missing',
    }]);
  });

  it('reads project root AGENTS.md as an included source', async () => {
    const projectRoot = await tempProject();
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Rules\nUse tests.\n', 'utf8');
    const service = createService();

    const [snapshot] = await service.loadInstructionSources({ projectRoot, loadedAt });

    expect(snapshot).toMatchObject({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project-instruction://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# Rules\nUse tests.\n',
      loadedAt,
      truncated: false,
      hardCapBytes: AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
    });
    expect(snapshot?.sizeBytes).toBe(Buffer.byteLength('# Rules\nUse tests.\n', 'utf8'));
    expect(snapshot?.includedBytes).toBe(Buffer.byteLength('# Rules\nUse tests.\n', 'utf8'));
  });

  it('loads project root to effective cwd ancestor instructions with fixed candidate ordering', async () => {
    const projectRoot = await tempProject();
    await mkdir(path.join(projectRoot, 'packages', 'core'), { recursive: true });
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Root\nUse tests.\n', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'CLAUDE.md'), '# Packages\nKeep package boundaries.\n', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'core', 'AGENTS.MD'), '# Core AGENTS\nPrefer runtime boundaries.\n', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'core', 'CLAUDE.md'), '# Core CLAUDE\nShould not be selected.\n', 'utf8');
    const service = createService();

    const sources = await service.loadInstructionSources({
      projectRoot,
      effectiveCwd: path.join(projectRoot, 'packages', 'core'),
      loadedAt,
    });

    expect(sources.filter((source) => source.status === 'included').map((source) => ({
      sourceId: source.sourceId,
      relativePath: source.relativePath,
      text: source.text,
    }))).toEqual([
      {
        sourceId: 'project-instruction:AGENTS.md',
        relativePath: 'AGENTS.md',
        text: '# Root\nUse tests.\n',
      },
      {
        sourceId: 'project-instruction:packages/CLAUDE.md',
        relativePath: 'packages/CLAUDE.md',
        text: '# Packages\nKeep package boundaries.\n',
      },
      {
        sourceId: 'project-instruction:packages/core/AGENTS.MD',
        relativePath: 'packages/core/AGENTS.MD',
        text: '# Core AGENTS\nPrefer runtime boundaries.\n',
      },
    ]);
  });

  it('loads global instruction directories before project instructions', async () => {
    const globalDir = await tempProject();
    const projectRoot = await tempProject();
    await writeFile(path.join(globalDir, 'CLAUDE.md'), '# Global\nUse concise answers.\n', 'utf8');
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Project\nUse project rules.\n', 'utf8');
    const service = createService();

    const sources = await service.loadInstructionSources({
      globalInstructionDirs: [globalDir],
      projectRoot,
      loadedAt,
    });

    expect(sources.map((source) => ({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      relativePath: source.relativePath,
      status: source.status,
    }))).toEqual([
      {
        sourceKind: 'global_instruction',
        sourceId: 'global-instruction:CLAUDE.md',
        relativePath: 'CLAUDE.md',
        status: 'included',
      },
      {
        sourceKind: 'project_instruction',
        sourceId: 'project-instruction:AGENTS.md',
        relativePath: 'AGENTS.md',
        status: 'included',
      },
    ]);
  });

  it('deduplicates resolved instruction paths in the project chain', async () => {
    const projectRoot = await tempProject();
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Root\n', 'utf8');
    const service = createService();

    const sources = await service.loadInstructionSources({
      projectRoot,
      effectiveCwd: projectRoot,
      loadedAt,
    });

    expect(sources.filter((source) => source.status === 'included')).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      sourceId: 'project-instruction:AGENTS.md',
      relativePath: 'AGENTS.md',
    });
  });

  it('truncates over hard cap without returning invalid UTF-8 text', async () => {
    const projectRoot = await tempProject();
    const content = `${'a'.repeat(AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES - 1)}콱봤`;
    await writeFile(path.join(projectRoot, 'AGENTS.md'), content, 'utf8');
    const service = createService();

    const [snapshot] = await service.loadInstructionSources({ projectRoot, loadedAt });

    expect(snapshot).toMatchObject({
      status: 'included_truncated',
      reason: 'project_instruction_hard_cap_exceeded',
      truncated: true,
      hardCapBytes: AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
    });
    expect(snapshot?.text).not.toContain('\uFFFD');
    expect(Buffer.byteLength(snapshot?.text ?? '', 'utf8')).toBeLessThanOrEqual(
      AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
    );
  });

  it('uses an injected hard cap for tests and future source policies', async () => {
    const projectRoot = await tempProject();
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'abcdef', 'utf8');
    const service = createService(3);

    await expect(service.loadInstructionSources({ projectRoot, loadedAt })).resolves.toEqual([{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included_truncated',
      sourceUri: 'project-instruction://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: 'abc',
      loadedAt,
      sizeBytes: 6,
      includedBytes: 3,
      hardCapBytes: 3,
      truncated: true,
      reason: 'project_instruction_hard_cap_exceeded',
    }]);
  });

  it('returns read_failed without raw error details when file read throws', async () => {
    const service = new AgentInstructionSourceService({
      readFile: async () => {
        throw new Error('C:/secret/raw-stack');
      },
      readDirectory,
    });

    await expect(service.loadInstructionSources({
      projectRoot: 'C:/project',
      loadedAt,
    })).resolves.toEqual([{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'read_failed',
      sourceUri: 'project-instruction://AGENTS.md',
      relativePath: 'AGENTS.md',
      loadedAt,
      reason: 'agent_instruction_read_failed',
    }]);
  });
});

