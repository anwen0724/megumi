/*
 * Composes the Instructions owner with host-provided filesystem capabilities
 * and fixed product system instructions.
 */

import type { SystemInstruction } from '../domain/dto/context/instruction-context-response';
import type { InstructionService } from '../service/instruction-service';
import { InstructionServiceImpl } from '../service/instruction-service-impl';

export interface InstructionFileSystem {
  readFile(filePath: string): Promise<string>;
  readDirectory(directoryPath: string): Promise<readonly string[]>;
}

export const DEFAULT_CODING_AGENT_SYSTEM_INSTRUCTIONS: readonly SystemInstruction[] = [
  {
    instructionId: 'megumi.coding-agent.identity',
    content: 'You are Megumi, a coding agent. Use the provided session context, project instructions, runtime facts, tool results, and memory facts to continue the user\'s coding task.',
  },
];

export function composeCodingAgentInstructions(options: {
  megumiHomePath: string;
  fileSystem: InstructionFileSystem;
  systemInstructions?: readonly SystemInstruction[];
}): InstructionService {
  return new InstructionServiceImpl({
    megumiHomePath: options.megumiHomePath,
    systemInstructions: options.systemInstructions ?? DEFAULT_CODING_AGENT_SYSTEM_INSTRUCTIONS,
    readFile: (filePath) => options.fileSystem.readFile(filePath),
    readDirectory: (directoryPath) => options.fileSystem.readDirectory(directoryPath),
  });
}
