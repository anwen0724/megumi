/*
 * Converts prepared Skill script requests into Tool module command inputs.
 */
import type { SkillScriptExecutionRequest } from '@megumi/skills';
import type { JsonObject } from '../../shared-json';

export type RunCommandToolInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  [RUN_COMMAND_INTERNAL_METADATA]?: JsonObject;
};

export const RUN_COMMAND_INTERNAL_METADATA = Symbol('run-command-internal-metadata');

export function mapSkillScriptExecutionRequestToRunCommandInput(
  request: SkillScriptExecutionRequest,
): RunCommandToolInput {
  return {
    command: [
      quoteCommandArgument(request.scriptPath),
      ...request.args.map(quoteCommandArgument),
    ].join(' '),
    cwd: '.',
    [RUN_COMMAND_INTERNAL_METADATA]: {
      source: 'skill',
      skillPath: request.skillPath,
      scriptName: request.scriptName,
      approvalSummary: request.approvalSummary,
    },
  };
}

function quoteCommandArgument(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
