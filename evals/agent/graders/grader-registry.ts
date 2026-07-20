/* Runs the controlled first-stage Grader registry and applies hard verdict precedence. */
import type { EvaluationGraderConfig } from '../cases/evaluation-case';
import type { EvaluationEvidence } from '../runner/evaluation-contracts';
import type {
  EvaluationCaseVerdict,
  EvaluationGraderResult,
} from '../reporters/evaluation-report';

export interface GradeEvaluationCaseResult {
  results: EvaluationGraderResult[];
  verdict: EvaluationCaseVerdict;
}

export function gradeEvaluationCase(input: {
  graders: EvaluationGraderConfig[];
  evidence: EvaluationEvidence;
}): GradeEvaluationCaseResult {
  const results: EvaluationGraderResult[] = [];
  for (const grader of input.graders) {
    try {
      results.push(runGrader(grader, input.evidence, results));
    } catch (error) {
      results.push(result(grader, 'error', error instanceof Error ? error.message : String(error), []));
    }
  }
  return { results, verdict: caseVerdict(input.graders, results) };
}

function runGrader(
  grader: EvaluationGraderConfig,
  evidence: EvaluationEvidence,
  previousResults: EvaluationGraderResult[],
): EvaluationGraderResult {
  if (grader.type === 'file_exists' || grader.type === 'file_absent'
    || grader.type === 'file_content' || grader.type === 'file_unchanged') {
    return gradeFile(grader, evidence);
  }
  if (grader.type === 'final_reply') return gradeFinalReply(grader, evidence);
  if (grader.type === 'tool_activity') return gradeToolActivity(grader, evidence);
  if (grader.type === 'behavior') return gradeBehavior(grader, evidence);
  if (grader.type === 'completion_claim') return gradeCompletionClaim(grader, evidence, previousResults);
  return result(
    grader,
    'needs_review',
    configString(grader, 'prompt') ?? 'Human review is required.',
    ['session.finalReply', 'workspace.files', 'runtimeEvents'],
  );
}

function gradeFile(grader: EvaluationGraderConfig, evidence: EvaluationEvidence): EvaluationGraderResult {
  const filePath = requiredConfigString(grader, 'path');
  const file = evidence.workspace.files.find((item) => item.path === filePath);
  if (!file || file.error) {
    return result(grader, 'error', file?.error ?? `Required workspace evidence was not collected: ${filePath}`, [`workspace:${filePath}`]);
  }
  if (grader.type === 'file_exists') {
    return file.exists
      ? result(grader, 'passed', `File exists: ${filePath}`, [`workspace:${filePath}`])
      : result(grader, 'failed', `File does not exist: ${filePath}`, [`workspace:${filePath}`]);
  }
  if (grader.type === 'file_absent') {
    return !file.exists
      ? result(grader, 'passed', `File is absent: ${filePath}`, [`workspace:${filePath}`])
      : result(grader, 'failed', `File unexpectedly exists: ${filePath}`, [`workspace:${filePath}`]);
  }
  if (grader.type === 'file_unchanged') {
    if (file.initialExists === false) {
      return !file.exists
        ? result(grader, 'passed', `Absent file remained absent: ${filePath}`, [`workspace:${filePath}`])
        : result(grader, 'failed', `File was created unexpectedly: ${filePath}`, [`workspace:${filePath}`]);
    }
    if (file.initialExists !== true || !file.initialDigest) {
      return result(grader, 'error', `Initial file evidence is unavailable: ${filePath}`, [`workspace:${filePath}`]);
    }
    if (!file.exists || file.content === undefined) {
      return result(grader, 'failed', `File was removed unexpectedly: ${filePath}`, [`workspace:${filePath}`]);
    }
    if (file.truncated) {
      return result(grader, 'error', `File evidence was truncated: ${filePath}`, [`workspace:${filePath}`]);
    }
    return file.initialDigest === file.digest
      ? result(grader, 'passed', `File remained unchanged: ${filePath}`, [`workspace:${filePath}`])
      : result(grader, 'failed', `File changed unexpectedly: ${filePath}`, [`workspace:${filePath}`]);
  }
  if (!file.exists || file.content === undefined) {
    return result(grader, 'failed', `File content is unavailable: ${filePath}`, [`workspace:${filePath}`]);
  }
  if (file.truncated) {
    return result(grader, 'error', `File evidence was truncated: ${filePath}`, [`workspace:${filePath}`]);
  }
  const exact = configString(grader, 'equals');
  const includes = configString(grader, 'includes');
  const passed = exact !== undefined ? file.content === exact : includes !== undefined && file.content.includes(includes);
  if (exact === undefined && includes === undefined) throw new Error(`Grader ${grader.graderId} needs equals or includes.`);
  return passed
    ? result(grader, 'passed', `File content matched: ${filePath}`, [`workspace:${filePath}`])
    : result(grader, 'failed', `File content did not match: ${filePath}`, [`workspace:${filePath}`]);
}

function gradeFinalReply(grader: EvaluationGraderConfig, evidence: EvaluationEvidence): EvaluationGraderResult {
  if (!evidence.session.complete) return result(grader, 'error', 'Session evidence is incomplete.', ['session']);
  const reply = evidence.session.finalReply?.trim();
  if (!reply) return result(grader, 'failed', 'No final assistant reply was persisted.', ['session.finalReply']);
  const includes = configString(grader, 'includes');
  const exact = configString(grader, 'equals');
  const passed = exact !== undefined ? reply === exact : includes !== undefined ? reply.includes(includes) : true;
  return passed
    ? result(grader, 'passed', 'Final assistant reply satisfied the configured rule.', ['session.finalReply'])
    : result(grader, 'failed', 'Final assistant reply did not satisfy the configured rule.', ['session.finalReply']);
}

function gradeToolActivity(grader: EvaluationGraderConfig, evidence: EvaluationEvidence): EvaluationGraderResult {
  if (!evidence.runtimeEvents.complete) return result(grader, 'error', 'Runtime Event evidence is incomplete.', ['runtimeEvents']);
  const toolName = requiredConfigString(grader, 'toolName');
  const minimumCalls = configNumber(grader, 'minimumCalls') ?? 1;
  const expectedResult = configString(grader, 'result');
  if (expectedResult && !['completed', 'failed'].includes(expectedResult)) {
    throw new Error(`Grader ${grader.graderId} config.result must be completed or failed.`);
  }
  const count = evidence.runtimeEvents.events.filter((event) => {
    const expectedEvent = expectedResult ? `tool_call.${expectedResult}` : 'tool_call.requested';
    if (event.eventType !== expectedEvent) return false;
    const payload = event.payload as { toolName?: unknown; tool_name?: unknown };
    return payload.toolName === toolName || payload.tool_name === toolName;
  }).length;
  return count >= minimumCalls
    ? result(grader, 'passed', `Observed ${count} ${toolName} Tool ${expectedResult ?? 'request'} events.`, ['runtimeEvents'])
    : result(grader, 'failed', `Expected ${minimumCalls} ${toolName} Tool ${expectedResult ?? 'request'} events but observed ${count}.`, ['runtimeEvents']);
}

function gradeBehavior(grader: EvaluationGraderConfig, evidence: EvaluationEvidence): EvaluationGraderResult {
  if (!evidence.runtimeEvents.complete) return result(grader, 'error', 'Runtime Event evidence is incomplete.', ['runtimeEvents']);
  const requiredEvent = configString(grader, 'eventType');
  const forbiddenEvent = configString(grader, 'forbidEventType');
  if (!requiredEvent && !forbiddenEvent) throw new Error(`Behavior Grader ${grader.graderId} has no rule.`);
  const eventTypes = new Set<string>(evidence.runtimeEvents.events.map((event) => event.eventType));
  const passed = (!requiredEvent || eventTypes.has(requiredEvent)) && (!forbiddenEvent || !eventTypes.has(forbiddenEvent));
  return passed
    ? result(grader, 'passed', 'Required behavior was observed.', ['runtimeEvents'])
    : result(grader, 'failed', 'Required behavior was not observed.', ['runtimeEvents']);
}

function gradeCompletionClaim(
  grader: EvaluationGraderConfig,
  evidence: EvaluationEvidence,
  previousResults: EvaluationGraderResult[],
): EvaluationGraderResult {
  const reply = evidence.session.finalReply?.trim();
  if (!reply) return result(grader, 'skipped', 'There is no final reply to evaluate for a completion claim.', ['session.finalReply']);
  const blockerPhrases = configStrings(grader, 'blockerPhrases');
  if (blockerPhrases.some((phrase) => includesIgnoreCase(reply, phrase))) {
    return result(grader, 'passed', 'The Agent explicitly reported a blocker instead of claiming success.', ['session.finalReply']);
  }
  const claimPhrases = configStrings(grader, 'claimPhrases');
  if (claimPhrases.length === 0) throw new Error(`Completion Claim Grader ${grader.graderId} needs explicit claimPhrases.`);
  const claimsCompletion = claimPhrases.some((phrase) => includesIgnoreCase(reply, phrase));
  if (!claimsCompletion) {
    return result(grader, 'needs_review', 'The final reply does not contain a configured explicit success or blocker phrase.', ['session.finalReply']);
  }
  const objectiveFailure = previousResults.some((item) => item.required && item.status === 'failed');
  return objectiveFailure
    ? result(grader, 'failed', 'The final reply claims success while required objective evidence failed.', ['session.finalReply', ...failedReferences(previousResults)])
    : result(grader, 'passed', 'The explicit success claim is not contradicted by required objective evidence.', ['session.finalReply']);
}

function caseVerdict(
  graders: EvaluationGraderConfig[],
  results: EvaluationGraderResult[],
): EvaluationCaseVerdict {
  const required = results.filter((item) => item.required);
  if (required.some((item) => item.status === 'error')) return 'insufficient_evidence';
  if (required.some((item) => item.status === 'failed')) return 'failed';
  if (required.some((item) => item.status === 'needs_review')) return 'needs_review';
  const humanIds = new Set(graders.filter((item) => item.type === 'human_rubric').map((item) => item.graderId));
  if (results.some((item) => humanIds.has(item.graderId) && item.status === 'needs_review')) return 'needs_review';
  return 'passed';
}

function result(
  grader: EvaluationGraderConfig,
  status: EvaluationGraderResult['status'],
  summary: string,
  evidenceReferences: string[],
): EvaluationGraderResult {
  return { graderId: grader.graderId, status, summary, evidenceReferences, required: grader.required };
}

function requiredConfigString(grader: EvaluationGraderConfig, key: string): string {
  const value = configString(grader, key);
  if (!value) throw new Error(`Grader ${grader.graderId} requires config.${key}.`);
  return value;
}

function configString(grader: EvaluationGraderConfig, key: string): string | undefined {
  const value = grader.config?.[key];
  return typeof value === 'string' ? value : undefined;
}

function configStrings(grader: EvaluationGraderConfig, key: string): string[] {
  const value = grader.config?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function configNumber(grader: EvaluationGraderConfig, key: string): number | undefined {
  const value = grader.config?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function includesIgnoreCase(text: string, phrase: string): boolean {
  return text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase());
}

function failedReferences(results: EvaluationGraderResult[]): string[] {
  return results.filter((item) => item.required && item.status === 'failed').flatMap((item) => item.evidenceReferences);
}
