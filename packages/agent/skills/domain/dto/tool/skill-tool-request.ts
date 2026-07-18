/*
 * Defines Tool and Permission module request DTOs for skill script execution.
 */

export type PrepareSkillScriptExecutionToolRequest = {
  skillId: string;
  scriptName: string;
  args: string[];
  workspaceId: string;
  sessionId: string;
  runId?: string;
};
