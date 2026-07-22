/*
 * Defines the Instructions-owned DTOs consumed by Context assembly.
 */

export type SystemInstruction = {
  instructionId: string;
  content: string;
};

export type AgentInstructionSource = {
  sourceId: string;
  sourcePath: string;
  content: string;
};

export type EffectiveAgentInstructions = {
  sources: AgentInstructionSource[];
};
