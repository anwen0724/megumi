/*
 * Discovers applicable AGENTS.md files through injected capabilities and
 * preserves each source in far-to-near precedence order.
 */

import path from 'node:path';
import type {
  AgentInstructionSource,
  SystemInstruction,
} from '../domain/dto/context/instruction-context-response';
import type { InstructionService } from './instruction-service';
import type {
  GetEffectiveAgentInstructionsRequest,
  GetEffectiveAgentInstructionsResult,
} from './instruction-service-types';

export type CreateInstructionServiceOptions = {
  megumiHomePath: string;
  systemInstructions: readonly SystemInstruction[];
  readFile(filePath: string): Promise<string>;
  readDirectory(directoryPath: string): Promise<readonly string[]>;
};

export class InstructionServiceImpl implements InstructionService {
  constructor(private readonly options: CreateInstructionServiceOptions) {}

  getSystemInstructions(): SystemInstruction[] {
    return this.options.systemInstructions.map((instruction) => ({ ...instruction }));
  }

  async getEffectiveAgentInstructions(
    request: GetEffectiveAgentInstructionsRequest,
  ): Promise<GetEffectiveAgentInstructionsResult> {
    try {
      const directories = instructionDirectories(request);
      if (!directories) {
        return {
          status: 'failed',
          message: 'The working directory must be within the workspace root.',
        };
      }

      const candidateDirectories = [this.options.megumiHomePath, ...directories];
      const sources: AgentInstructionSource[] = [];
      for (const directoryPath of candidateDirectories) {
        const entries = await this.options.readDirectory(directoryPath);
        if (!entries.includes('AGENTS.md')) {
          continue;
        }
        const sourcePath = path.join(directoryPath, 'AGENTS.md');
        sources.push({
          sourceId: `agents:${sourcePath}`,
          sourcePath,
          content: await this.options.readFile(sourcePath),
        });
      }

      return { status: 'ok', instructions: { sources } };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Failed to load agent instructions.',
      };
    }
  }
}

function instructionDirectories(
  request: GetEffectiveAgentInstructionsRequest,
): string[] | undefined {
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const workingDirectory = path.resolve(request.workingDirectory);
  const relativeWorkingDirectory = path.relative(workspaceRoot, workingDirectory);
  if (
    relativeWorkingDirectory === '..'
    || relativeWorkingDirectory.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeWorkingDirectory)
  ) {
    return undefined;
  }

  const directories = [workspaceRoot];
  let currentDirectory = workspaceRoot;
  for (const segment of relativeWorkingDirectory.split(path.sep).filter(Boolean)) {
    currentDirectory = path.join(currentDirectory, segment);
    directories.push(currentDirectory);
  }
  return directories;
}
