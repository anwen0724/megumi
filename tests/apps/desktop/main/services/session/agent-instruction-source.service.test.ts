// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentInstructionSourceService,
  AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
} from '@megumi/desktop/main/services/session/agent-instruction-source.service';

const loadedAt = '2026-05-28T00:00:00.000Z';
const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'megumi-agent-instruction-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('AgentInstructionSourceService', () => {
  it('returns unavailable when there is no project root', async () => {
    const service = new AgentInstructionSourceService();

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
    const service = new AgentInstructionSourceService();

    await expect(service.loadInstructionSources({ projectRoot, loadedAt })).resolves.toEqual([{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'missing',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      loadedAt,
      reason: 'agent_instruction_missing',
    }]);
  });

  it('reads project root AGENTS.md as an included source', async () => {
    const projectRoot = await tempProject();
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Rules\nUse tests.\n', 'utf8');
    const service = new AgentInstructionSourceService();

    const [snapshot] = await service.loadInstructionSources({ projectRoot, loadedAt });

    expect(snapshot).toMatchObject({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# Rules\nUse tests.\n',
      loadedAt,
      truncated: false,
      hardCapBytes: AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
    });
    expect(snapshot?.sizeBytes).toBe(Buffer.byteLength('# Rules\nUse tests.\n', 'utf8'));
    expect(snapshot?.includedBytes).toBe(Buffer.byteLength('# Rules\nUse tests.\n', 'utf8'));
  });

  it('truncates over hard cap without returning invalid UTF-8 text', async () => {
    const projectRoot = await tempProject();
    const content = `${'a'.repeat(AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES - 1)}콱봤`;
    await writeFile(path.join(projectRoot, 'AGENTS.md'), content, 'utf8');
    const service = new AgentInstructionSourceService();

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
    const service = new AgentInstructionSourceService({ hardCapBytes: 3 });

    await expect(service.loadInstructionSources({ projectRoot, loadedAt })).resolves.toEqual([{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included_truncated',
      sourceUri: 'project://AGENTS.md',
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
    });

    await expect(service.loadInstructionSources({
      projectRoot: 'C:/project',
      loadedAt,
    })).resolves.toEqual([{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'read_failed',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      loadedAt,
      reason: 'agent_instruction_read_failed',
    }]);
  });
});

