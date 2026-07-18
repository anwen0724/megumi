/*
 * Defines request and result types for the InstructionService business API.
 */

import type { EffectiveAgentInstructions } from '../domain/dto/context/instruction-context-response';

export type GetEffectiveAgentInstructionsRequest = {
  workspaceRoot: string;
  workingDirectory: string;
};

export type GetEffectiveAgentInstructionsResult =
  | { status: 'ok'; instructions: EffectiveAgentInstructions }
  | { status: 'failed'; message: string };
