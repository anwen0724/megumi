/* Defines the Instructions owner API and coordinates fixed profile documents with scoped project instructions. */
import path from 'node:path';
import {
  createNodeInstructionSource,
  loadInstructionFiles,
  type InstructionSource,
} from './instruction-files';
import { loadSystemInstructionDocuments } from './instruction-content-loader';

export type InstructionProfile = 'conversation' | 'daily_discovery';

export interface SystemInstructionDocument {
  readonly instructionId: string;
  readonly sourcePath: string;
  readonly content: string;
}

export interface AgentInstructionSource {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly content: string;
}

export interface EffectiveInstructions {
  readonly sources: AgentInstructionSource[];
}

export interface GetEffectiveInstructionsRequest {
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
}

export interface InstructionOperationOptions {
  readonly signal?: AbortSignal;
}

export type EffectiveInstructionFailure =
  | {
      readonly code: 'working_directory_outside_workspace';
      readonly message: string;
    }
  | {
      readonly code:
        | 'instruction_scope_unavailable'
        | 'instruction_directory_read_failed'
        | 'instruction_source_read_failed'
        | 'instruction_source_outside_scope';
      readonly message: string;
      readonly sourcePath: string;
    };

export type GetEffectiveInstructionsResult =
  | { readonly status: 'ok'; readonly instructions: EffectiveInstructions }
  | { readonly status: 'failed'; readonly failure: EffectiveInstructionFailure }
  | { readonly status: 'cancelled' };

export interface InstructionReader {
  getSystemInstructions(profile: InstructionProfile): Promise<readonly SystemInstructionDocument[]>;
  getEffectiveInstructions(
    request: GetEffectiveInstructionsRequest,
    options?: InstructionOperationOptions,
  ): Promise<GetEffectiveInstructionsResult>;
}

export interface CreateInstructionReaderOptions {
  readonly megumiHomePath: string;
  readonly source?: InstructionSource;
  readonly systemContentRoot?: string;
}

export function createInstructionReader(
  options: CreateInstructionReaderOptions,
): InstructionReader {
  return new DefaultInstructionReader(
    options.megumiHomePath,
    options.source ?? createNodeInstructionSource(),
    options.systemContentRoot ?? path.resolve(process.cwd(), 'packages/agent/instructions/content'),
  );
}

class DefaultInstructionReader implements InstructionReader {
  constructor(
    private readonly megumiHomePath: string,
    private readonly source: InstructionSource,
    private readonly systemContentRoot: string,
  ) {}

  getSystemInstructions(profile: InstructionProfile): Promise<readonly SystemInstructionDocument[]> {
    return loadSystemInstructionDocuments({ contentRoot: this.systemContentRoot, profile });
  }

  async getEffectiveInstructions(
    request: GetEffectiveInstructionsRequest,
    options?: InstructionOperationOptions,
  ): Promise<GetEffectiveInstructionsResult> {
    const result = await loadInstructionFiles({
      megumiHomePath: this.megumiHomePath,
      workspaceRoot: request.workspaceRoot,
      workingDirectory: request.workingDirectory,
      source: this.source,
    }, options);

    return result.status === 'ok'
      ? { status: 'ok', instructions: { sources: result.sources } }
      : result;
  }
}
