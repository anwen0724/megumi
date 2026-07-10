/*
 * Converts prepared Skill script requests into Tool module command inputs.
 */
import type { SkillScriptExecutionRequest } from '../../skills';
import type { JsonObject } from '../../shared-json';

export type RunCommandToolInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envPolicy?: 'default' | 'minimal' | 'none';
  metadata?: JsonObject;
};

export function mapSkillScriptExecutionRequestToRunCommandInput(
  request: SkillScriptExecutionRequest,
): RunCommandToolInput {
  return {
    command: [
      quoteCommandArgument(request.scriptPath),
      ...request.args.map(quoteCommandArgument),
    ].join(' '),
    cwd: '.',
    metadata: {
      source: 'skill',
      skillId: request.skillId,
      scriptName: request.scriptName,
      approvalSummary: request.approvalSummary,
      ...(request.runId ? { runId: request.runId } : {}),
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
    },
  };
}

function quoteCommandArgument(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
