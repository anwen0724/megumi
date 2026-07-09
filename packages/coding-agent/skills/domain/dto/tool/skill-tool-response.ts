/*
 * Defines Tool and Permission module response DTOs for skill script execution.
 */

export type SkillScriptExecutionRequest = {
  skillId: string;
  scriptName: string;
  scriptPath: string;
  args: string[];
  workspaceId: string;
  sessionId: string;
  runId?: string;
  approvalSummary: string;
};

export type PrepareSkillScriptExecutionToolResponse =
  | { status: 'ok'; request: SkillScriptExecutionRequest }
  | { status: 'not_found'; skillId: string; scriptName?: string }
  | { status: 'unavailable'; skillId: string }
  | { status: 'not_allowed'; skillId: string; scriptName: string; message: string }
  | { status: 'failed'; message: string };
