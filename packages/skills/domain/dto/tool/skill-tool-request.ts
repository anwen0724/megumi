/* Defines Skills-owned script preparation input without Agent Run execution scope. */

export type PrepareSkillScriptExecutionToolRequest = {
  skillPath: string;
  scriptName: string;
  args: string[];
};
