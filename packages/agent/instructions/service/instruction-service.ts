/*
 * Defines the public business interface for fixed and workspace instructions.
 */

import type { SystemInstruction } from '../domain/dto/context/instruction-context-response';
import type {
  GetEffectiveAgentInstructionsRequest,
  GetEffectiveAgentInstructionsResult,
} from './instruction-service-types';

export interface InstructionService {
  getSystemInstructions(): SystemInstruction[];
  getEffectiveAgentInstructions(
    request: GetEffectiveAgentInstructionsRequest,
  ): Promise<GetEffectiveAgentInstructionsResult>;
}
