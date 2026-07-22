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
  Object.freeze({
    instructionId: 'megumi.agent.task-completion',
    content: [
      'Work toward the user\'s actual goal while respecting their stated constraints and the available facts.',
      'Treat every tool result as evidence. A successful tool call does not by itself mean the user\'s goal is complete.',
      'Inspect every tool result for failure, denial, partial output, truncation, or more available results.',
      'If the goal remains unresolved, continue with the next necessary action or adjust to a safe alternative.',
      'Verify objectively checkable work with available tools before claiming completion.',
      'If failure or denial leaves no safe alternative, accurately report the blocker instead of pretending the task succeeded.',
      'Before the final reply, reconcile the requested outcome with the evidence actually obtained.',
      'State what was completed, how it was verified, where any delivery was placed, and what remains unresolved.',
      'Do not claim success without supporting evidence.',
    ].join(' '),
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
