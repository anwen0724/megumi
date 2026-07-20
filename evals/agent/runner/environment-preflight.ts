/* Rejects Evaluation executions whose declared environment cannot satisfy the case safely. */
import type { EvaluationCase } from '../cases/evaluation-case';
import type { EvaluationIsolation, ExecutionProfile } from '../config/execution-profile';

const WORKSPACE_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'glob',
  'search_text',
  'write_file',
  'edit_file',
]);

export type EvaluationPreflightResult =
  | { status: 'ok' }
  | { status: 'setup_failed'; issues: string[] };

export function preflightEvaluationEnvironment(input: {
  evaluationCase: EvaluationCase;
  profile: ExecutionProfile;
  resolvedTools: string[];
  availableIsolation: EvaluationIsolation[];
}): EvaluationPreflightResult {
  const issues: string[] = [];
  const requirements = input.evaluationCase.requirements;
  const resolvedTools = new Set(input.resolvedTools);

  for (const tool of input.profile.enabledTools ?? []) {
    if (!resolvedTools.has(tool)) issues.push(`Explicitly enabled tool was not resolved by Product: ${tool}`);
  }

  for (const tool of requirements?.tools ?? []) {
    if (!resolvedTools.has(tool)) issues.push(`Required tool is unavailable: ${tool}`);
  }

  if (requirements?.networkAccess && networkRank(input.profile.networkAccess) < networkRank(requirements.networkAccess)) {
    issues.push(`Profile network access does not satisfy case requirement: ${requirements.networkAccess}`);
  }

  if (!input.availableIsolation.includes(input.profile.isolation)) {
    issues.push(`Declared isolation is not available in this environment: ${input.profile.isolation}`);
  }

  if (requirements?.minimumIsolation && !isolationSatisfies(input.profile.isolation, requirements.minimumIsolation)) {
    issues.push(`Profile isolation ${input.profile.isolation} does not satisfy ${requirements.minimumIsolation}`);
  }

  if (input.profile.isolation === 'workspace_only') {
    for (const tool of resolvedTools) {
      if (!WORKSPACE_ONLY_TOOLS.has(tool)) {
        issues.push(`Tool ${tool} is not safe under workspace_only isolation`);
      }
    }
    if (input.profile.networkAccess !== 'disabled') {
      issues.push('Network access is not available under workspace_only isolation');
    }
  }

  return issues.length > 0 ? { status: 'setup_failed', issues } : { status: 'ok' };
}

function networkRank(value: 'disabled' | 'controlled' | 'live'): number {
  return { disabled: 0, controlled: 1, live: 2 }[value];
}

function isolationSatisfies(actual: EvaluationIsolation, required: EvaluationIsolation): boolean {
  if (actual === required || required === 'workspace_only') return true;
  if (required === 'os_sandbox') return actual === 'container' || actual === 'vm';
  return false;
}
