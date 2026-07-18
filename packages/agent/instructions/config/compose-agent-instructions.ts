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

const FIXED_AGENT_SYSTEM_INSTRUCTIONS: readonly SystemInstruction[] = Object.freeze([
  Object.freeze({
    instructionId: 'megumi.agent.identity',
    content: 'You are Megumi, the user\'s personal agent. Use the provided session context, project instructions, runtime facts, tool results, and memory facts to continue the user\'s task.',
  }),
]);

export function composeAgentInstructions(options: {
  megumiHomePath: string;
  fileSystem: InstructionFileSystem;
}): InstructionService {
  return new InstructionServiceImpl({
    megumiHomePath: options.megumiHomePath,
    systemInstructions: FIXED_AGENT_SYSTEM_INSTRUCTIONS,
    readFile: (filePath) => options.fileSystem.readFile(filePath),
    readDirectory: (directoryPath) => options.fileSystem.readDirectory(directoryPath),
  });
}
