/* Defines a validated script request that the outer Tool Runtime may execute. */

export type SkillScriptExecutionRequest = {
  skillPath: string;
  scriptName: string;
  scriptPath: string;
  args: string[];
  approvalSummary: string;
};

export type PrepareSkillScriptExecutionToolResponse =
  | { status: 'ok'; request: SkillScriptExecutionRequest }
  | { status: 'not_found'; skillPath: string; scriptName?: string }
  | { status: 'unavailable'; skillPath: string }
  | { status: 'not_allowed'; skillPath: string; scriptName: string; message: string }
  | { status: 'failed'; message: string };
