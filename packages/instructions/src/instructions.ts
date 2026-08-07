/* Defines the Instructions owner API and coordinates policy with an injected source. */
import {
  createNodeInstructionSource,
  loadInstructionFiles,
  type InstructionSource,
} from './instruction-files';
import { getSystemInstructions } from './system-instructions';

/** 指令内容分组：稳定组标识 + 有序条目（条目呈现为段落或 bullet）。 */
export interface InstructionGroup {
  readonly groupId: string;
  readonly items: readonly string[];
}

/** 一条段级指令：稳定标识 + 内容分组（指令 → 组 → 条目三层，便于读取与管理）。 */
export interface SystemInstruction {
  readonly instructionId: string;
  readonly groups: readonly InstructionGroup[];
}

export type SystemInstructions = SystemInstruction[];

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
  getSystemInstructions(): Promise<SystemInstructions>;
  getEffectiveInstructions(
    request: GetEffectiveInstructionsRequest,
    options?: InstructionOperationOptions,
  ): Promise<GetEffectiveInstructionsResult>;
}

export interface CreateInstructionReaderOptions {
  readonly megumiHomePath: string;
  readonly source?: InstructionSource;
}

export function createInstructionReader(
  options: CreateInstructionReaderOptions,
): InstructionReader {
  return new DefaultInstructionReader(
    options.megumiHomePath,
    options.source ?? createNodeInstructionSource(),
  );
}

class DefaultInstructionReader implements InstructionReader {
  constructor(
    private readonly megumiHomePath: string,
    private readonly source: InstructionSource,
  ) {}

  getSystemInstructions(): Promise<SystemInstructions> {
    return getSystemInstructions();
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
