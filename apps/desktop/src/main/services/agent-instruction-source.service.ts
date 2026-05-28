import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import type { AgentInstructionSourceSnapshot } from '@megumi/shared/model-input-context-contracts';

export const AGENT_INSTRUCTION_SOURCE_FILE = 'AGENTS.md';
export const AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES = 64 * 1024;

const AGENT_INSTRUCTION_SOURCE_ID = 'project-instruction:AGENTS.md';
const AGENT_INSTRUCTION_SOURCE_URI = 'project://AGENTS.md';

export interface AgentInstructionSourceServiceOptions {
  hardCapBytes?: number;
  readFile?: (filePath: string) => Promise<Buffer>;
}

export interface LoadInstructionSourcesInput {
  projectRoot?: string;
  loadedAt: string;
}

export class AgentInstructionSourceService {
  private readonly hardCapBytes: number;
  private readonly readFile: (filePath: string) => Promise<Buffer>;

  constructor(options: AgentInstructionSourceServiceOptions = {}) {
    this.hardCapBytes = options.hardCapBytes ?? AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES;
    this.readFile = options.readFile ?? ((filePath) => fs.readFile(filePath));
  }

  async loadInstructionSources(
    input: LoadInstructionSourcesInput,
  ): Promise<AgentInstructionSourceSnapshot[]> {
    if (!input.projectRoot) {
      return [{
        sourceId: 'project-instruction:no-project-root',
        sourceKind: 'project_instruction',
        status: 'unavailable',
        loadedAt: input.loadedAt,
        reason: 'agent_instruction_no_project_root',
      }];
    }

    const filePath = path.join(input.projectRoot, AGENT_INSTRUCTION_SOURCE_FILE);

    try {
      const buffer = await this.readFile(filePath);
      const truncated = buffer.length > this.hardCapBytes;
      const text = truncated
        ? decodeUtf8Prefix(buffer, this.hardCapBytes)
        : buffer.toString('utf8');
      const includedBytes = Buffer.byteLength(text, 'utf8');

      if (truncated) {
        return [{
          sourceId: AGENT_INSTRUCTION_SOURCE_ID,
          sourceKind: 'project_instruction',
          status: 'included_truncated',
          sourceUri: AGENT_INSTRUCTION_SOURCE_URI,
          relativePath: AGENT_INSTRUCTION_SOURCE_FILE,
          text,
          loadedAt: input.loadedAt,
          sizeBytes: buffer.length,
          includedBytes,
          hardCapBytes: this.hardCapBytes,
          truncated: true,
          reason: 'project_instruction_hard_cap_exceeded',
        }];
      }

      return [{
        sourceId: AGENT_INSTRUCTION_SOURCE_ID,
        sourceKind: 'project_instruction',
        status: 'included',
        sourceUri: AGENT_INSTRUCTION_SOURCE_URI,
        relativePath: AGENT_INSTRUCTION_SOURCE_FILE,
        text,
        loadedAt: input.loadedAt,
        sizeBytes: buffer.length,
        includedBytes,
        hardCapBytes: this.hardCapBytes,
        truncated: false,
      }];
    } catch (error) {
      if (isMissingFileError(error)) {
        return [{
          sourceId: AGENT_INSTRUCTION_SOURCE_ID,
          sourceKind: 'project_instruction',
          status: 'missing',
          sourceUri: AGENT_INSTRUCTION_SOURCE_URI,
          relativePath: AGENT_INSTRUCTION_SOURCE_FILE,
          loadedAt: input.loadedAt,
          reason: 'agent_instruction_missing',
        }];
      }

      return [{
        sourceId: AGENT_INSTRUCTION_SOURCE_ID,
        sourceKind: 'project_instruction',
        status: 'read_failed',
        sourceUri: AGENT_INSTRUCTION_SOURCE_URI,
        relativePath: AGENT_INSTRUCTION_SOURCE_FILE,
        loadedAt: input.loadedAt,
        reason: 'agent_instruction_read_failed',
      }];
    }
  }
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
