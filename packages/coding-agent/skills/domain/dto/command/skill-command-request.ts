/*
 * Defines Command module request DTOs for slash skill entrypoints.
 */

export type ListSkillCommandsRequest = {
  workspaceId?: string;
};

export type ExecuteSkillCommandRequest = {
  skillId: string;
  argumentsInput: string;
  sessionId: string;
  workspaceId?: string;
  runId?: string;
};
