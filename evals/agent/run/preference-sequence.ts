/* Executes continuous user operations in real isolated Products and preserves paired recommendation evidence. */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveryState, PreferenceSetDetail } from '@megumi/discovery';
import type { PreferenceSequenceCase } from '../contracts/evaluation-dataset';
import { PreferenceSequenceRecordSchema, type PreferenceSequenceRecord, type PreferenceExperiment } from '../contracts/preference-sequence-record';
import { digest } from '../evidence-digest';
import type { CaseEnvironment } from './case-environment';
import type { CaseExecutionResult } from './case-execution';
import { getCaseBusinessState } from './business-state';
import { archiveCaseEvidence, collectTraceIntegrity } from './case-record';
import { captureSequenceTraces, sequenceTraceIds } from './sequence-traces';

interface SequenceInput {
  readonly evaluationCase: PreferenceSequenceCase;
  readonly environment: CaseEnvironment;
  readonly modelConfigDigest: string;
  readonly timeoutMs: number;
  readonly createOmitted: (state: DiscoveryState, clock: string, source: (effective: readonly PreferenceSetDetail[]) => readonly PreferenceSetDetail[]) => Promise<CaseEnvironment>;
}

/** Stops on the first failed step and returns the evidence already obtained. */
export async function executePreferenceSequence(input: SequenceInput): Promise<CaseExecutionResult> {
  const env = input.environment;
  const record: PreferenceSequenceRecord = { schemaVersion: 3, steps: [] };
  const deadline = Date.now() + input.timeoutMs;
  let interrupted = false;
  for (const step of input.evaluationCase.input.steps) {
    const before = readState(env);
    const entry: PreferenceSequenceRecord['steps'][number] = { stepId: step.stepId, input: step, startedAt: env.now(), endedAt: env.now(), operationResult: null, initialState: before, finalState: before, traces: [], experiments: [], issues: [] };
    record.steps.push(entry);
    const previous = await sequenceTraceIds(env.runtime);
    try {
      if (Date.now() >= deadline) throw new Error('Sequence reached its execution deadline.');
      entry.operationResult = await executeOperation(input, step, entry, deadline);
    } catch (error) {
      entry.issues.push(error instanceof Error ? error.message : String(error));
      interrupted = Date.now() >= deadline;
      // No late work may mutate the captured final facts.
      await env.stop();
    }
    entry.finalState = readState(env);
    entry.endedAt = env.now();
    try { entry.traces = await captureSequenceTraces(env.runtime, previous); }
    catch (error) { entry.issues.push(error instanceof Error ? error.message : String(error)); }
    if (entry.issues.length) break;
  }
  return { caseType: 'preference_sequence', terminalState: interrupted ? 'interrupted' : 'settled',
    productResult: { status: record.steps.some((step) => step.issues.length) ? 'failed' : 'completed' },
    ownerFacts: PreferenceSequenceRecordSchema.parse(record), businessIds: {}, traceTargets: [],
    ...(interrupted ? { interruption: { source: 'evaluation_safety_guard', limitMs: input.timeoutMs } as const } : {}),
  };
}

async function executeOperation(input: SequenceInput, step: PreferenceSequenceCase['input']['steps'][number], entry: PreferenceSequenceRecord['steps'][number], deadline: number): Promise<unknown> {
  const env = input.environment;
  const host = env.runtime.host.discovery;
  const ids = env.initialStateIds;
  if (step.kind === 'advance_clock') {
    if (!env.advanceTime) throw new Error('A controlled clock is required.');
    await env.advanceTime(step.milliseconds, deadline);
    return { status: 'advanced' };
  }
  if (step.kind === 'feedback') {
    const result = await host.updateRecommendationState({ recommendationId: reference(ids.recommendations, step.recommendationReferenceId), action: 'set_reaction', reaction: step.reaction === 'none' ? null : step.reaction });
    if (result.status === 'not_found') throw new Error('Feedback target is absent.');
    return result;
  }
  if (step.kind === 'inspect') return host.getPreferenceDetails(step.scope.scope === 'interest' ? { scope: 'interest', interestId: reference(ids.interests, step.scope.interestReferenceId) } : { scope: 'exploration' });
  if (step.kind === 'update_interest') {
    const interestId = reference(ids.interests, step.interestReferenceId);
    if (step.action === 'update') {
      if (!step.description) throw new Error('Interest update description missing.');
      return host.changeInterest({ action: 'update', interestId, description: step.description });
    }
    return host.changeInterest({ action: step.action, interestId });
  }
  if (step.kind === 'edit_preference' || step.kind === 'delete_preference') {
    const preference = readState(env).preferences.find(({ id }) => id === step.preferenceReferenceId);
    if (!preference) throw new Error('Preference target is absent.');
    const request = { preferenceId: preference.id, expectedRevision: preference.revision };
    const result = step.kind === 'edit_preference' ? await host.editPreference({ ...request, statement: step.statement }) : await host.deletePreference(request);
    if (result.status === 'not_found' || result.status === 'revision_conflict' || result.status === 'invalid_input') throw new Error(`Preference correction failed: ${result.status}.`);
    return result;
  }
  if (!step.paired) return recommend(env, deadline);
  // Admission must precede explicit learning; blocked recommendation requests remain zero-learning.
  const today = await host.getTodayRecommendation();
  const pool = await host.getCandidatePool();
  if (today.status === 'published' || !pool?.candidates.length) return recommend(env, deadline);
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const learning = await host.preparePreferencesForRecommendation({ requestId: `evaluation:${step.stepId}`, signal });
  const shared = readState(env);
  let omitted: CaseEnvironment | undefined;
  const omittedIds = new Set<string>();
  try {
    omitted = await input.createOmitted(shared, env.now(), (effective) => effective.map((set) => ({ ...set, preferences: set.preferences.filter(({ preference }) => {
      if (preference.origin === 'user') return true;
      omittedIds.add(preference.id); return false;
    }) })));
    // Failed preparation is also a final result for this checkpoint. Neither arm may re-learn it.
    env.reusePreparedPreferences(learning);
    omitted.reusePreparedPreferences(learning);
    entry.experiments.push(await runArm(input, env, shared, step.stepId, 'learned', [], deadline));
    entry.experiments.push(await runArm(input, omitted, shared, step.stepId, 'omitted', omittedIds, deadline));
  } finally {
    if (omitted) {
      await omitted.stop();
      const target = path.join(env.paths.sequence, step.stepId, 'omitted');
      await mkdir(target, { recursive: true });
      const integrity = await collectTraceIntegrity({ runtime: omitted.runtime, targets: [] });
      await archiveCaseEvidence({ destination: target, observabilityRoot: omitted.paths.observability, traceIntegrity: integrity });
      await omitted.dispose();
    }
  }
  return { status: 'paired', learning, learned: entry.experiments[0]?.result };
}

async function runArm(input: SequenceInput, env: CaseEnvironment, shared: DiscoveryState, checkpointId: string, arm: 'learned' | 'omitted', omittedIds: Iterable<string>, deadline: number): Promise<PreferenceExperiment> {
  const before = readState(env);
  const previous = await sequenceTraceIds(env.runtime);
  const result = await recommend(env, deadline);
  const traces = await captureSequenceTraces(env.runtime, previous);
  const configuration = env.details;
  const differences: string[] = [];
  if (digest(before) !== digest(shared)) differences.push('discovery_state');
  if (digest(configuration) !== digest(input.environment.details)) differences.push('configuration');
  const issues = traces.flatMap((trace) => trace.issues);
  if (!traces.some((trace) => trace.kind === 'recommendation' && trace.contexts.length > 0)) issues.push('Recommendation Context missing.');
  return { arm, checkpointId, sharedStateDigest: digest(shared), modelConfigDigest: input.modelConfigDigest,
    initialState: before, finalState: readState(env), clock: env.now(), configuration,
    inputSummary: traces.filter((trace) => trace.kind === 'recommendation').flatMap((trace) => trace.contexts.slice(0, 1)),
    omittedLearnedIds: [...omittedIds], configurationDifferences: differences, result, traces, issues };
}

async function recommend(env: CaseEnvironment, deadline: number): Promise<unknown> {
  if (Date.now() >= deadline) throw new Error('Recommendation reached the sequence deadline.');
  const accepted = await env.runtime.host.discovery.requestRecommendation({ trigger: 'manual' });
  if (accepted.status !== 'started' && accepted.status !== 'in_progress') return accepted;
  const completion = await env.runtime.host.discovery.waitRecommendation({ requestId: accepted.requestId, timeoutMs: Math.min(300_000, Math.max(1, deadline - Date.now())) });
  if (completion.status === 'timed_out') throw new Error('Recommendation did not settle within the sequence deadline.');
  return completion;
}

function readState(env: CaseEnvironment): DiscoveryState { return getCaseBusinessState(env.paths.database, env.initialStateIds.workspaceId).discovery; }
function reference(ids: Readonly<Record<string, string>>, id: string): string {
  const value = ids[id];
  if (!value) throw new Error(`Missing installed reference: ${id}.`);
  return value;
}
