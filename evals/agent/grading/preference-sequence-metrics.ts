/* Checks deterministic continuous invariants; semantic meaning remains a human review responsibility. */
import { z } from 'zod';
import { PreferenceSequenceRecordSchema, type PreferenceExperiment } from '../contracts/preference-sequence-record';
import type { CaseEvidence } from './record-evidence';
import { digest } from './record-evidence';
import type { MetricResult } from './grading-contract';

const ContextSchema = z.object({ kind: z.literal('recommendation'), material: z.object({
  preferences: z.array(z.object({ preferenceSetId: z.string(), preferences: z.array(z.object({ id: z.string(), origin: z.enum(['learned', 'user']) }).passthrough()) }).passthrough()),
}).passthrough() }).passthrough();
const StatusSchema = z.object({ status: z.string() }).passthrough();

/** Scores explicit checks, returning no denominator when no applicable evidence exists. */
export function preferenceSequenceMetric(metricId: string, evidence: CaseEvidence): MetricResult {
  const parsed = PreferenceSequenceRecordSchema.safeParse(evidence.result.ownerFacts);
  if (evidence.result.schemaVersion !== 3 || !parsed.success || evidence.snapshot.case.type !== 'preference_sequence') return { metricId, status: 'unavailable', reason: 'Version 3 sequence evidence required.' };
  const checks: { check: string; passed: boolean }[] = [];
  const add = (check: string, passed: boolean) => { checks.push({ check, passed }); };
  const protectedStatements = new Map<string, string>();
  const deleted = new Set<string>();
  for (const step of parsed.data.steps) {
    const label = step.stepId;
    if (metricId === 'personalization.lazy_trigger' && step.input.kind !== 'recommend') {
      if (step.traces.some((trace) => !trace.measurements)) return { metricId, status: 'unavailable', reason: `Missing model measurements at ${label}.` };
      add(`${label}: learning calls outside recommendation`, step.traces.filter((trace) => trace.kind === 'preference_learning').every((trace) => trace.measurements?.modelCalls === 0));
    }
    if (step.input.kind === 'edit_preference') protectedStatements.set(step.input.preferenceReferenceId, step.input.statement.trim());
    if (step.input.kind === 'delete_preference') { protectedStatements.delete(step.input.preferenceReferenceId); deleted.add(step.input.preferenceReferenceId); }
    if (metricId === 'personalization.user_control') {
      for (const [id, statement] of protectedStatements) add(`${label}: preserve user ${id}`, step.finalState.preferences.some((p) => p.id === id && p.origin === 'user' && p.statement === statement));
      for (const id of deleted) add(`${label}: deleted ${id} inactive`, !step.finalState.preferences.some((p) => p.id === id && p.status === 'active'));
      for (const [id, statement] of Object.entries(evidence.snapshot.case.expected?.checkpoints[label]?.protectedUserStatements ?? {})) {
        add(`${label}: explicit requirement ${id} preserved`, step.finalState.preferences.some((p) => p.id === id && p.origin === 'user' && p.status === 'active' && p.statement === statement));
      }
    }
    const expected = evidence.snapshot.case.expected?.checkpoints[label];
    if (metricId === 'personalization.input_validity') {
      const effective = new Set(step.finalState.preferences.filter((p) => p.status === 'active').map((p) => p.id));
      for (const id of expected?.retainedPreferenceReferences ?? []) add(`${label}: retained ${id}`, effective.has(id));
      for (const id of expected?.inactivePreferenceReferences ?? []) add(`${label}: inactive ${id}`, !effective.has(id));
      if (expected?.allowedOutcome) { const result = StatusSchema.safeParse(step.operationResult); add(`${label}: outcome`, result.success && expected.allowedOutcome.includes(result.data.status)); }
      for (const trace of step.traces.filter((trace) => trace.kind === 'recommendation')) {
        for (const raw of trace.contexts) {
          const context = ContextSchema.safeParse(raw);
          if (!context.success) return { metricId, status: 'unavailable', reason: `Invalid recommendation Context at ${label}.` };
          for (const set of context.data.material.preferences) for (const p of set.preferences) {
            const stored = step.finalState.preferences.find((entry) => entry.id === p.id);
            const scope = step.finalState.preferenceSets.find((entry) => entry.id === stored?.preferenceSetId);
            const references = step.finalState.preferenceEvidence.filter((entry) => entry.preferenceId === p.id);
            add(`${label}: effective input ${p.id}`, !!stored && stored.status === 'active' && !!scope && (scope.scope === 'exploration' || step.finalState.interests.some((interest) => interest.id === scope.interestId && interest.status === 'active'))
              && (stored.origin === 'user' || (references.some((r) => r.relation === 'support') && references.every((r) => step.finalState.recommendationStates.some((state) => state.recommendationId === r.recommendationId && state.reactionRevision === r.reactionRevision && state.reaction === r.reaction)))));
          }
        }
      }
      if (step.input.kind === 'recommend') {
        for (const rec of step.finalState.recommendations.filter((r) => !step.initialState.recommendations.some((old) => old.id === r.id))) {
          add(`${label}: publication ${rec.id}`, step.finalState.candidates.some((c) => c.id === rec.candidateId && c.status === 'consumed') && step.finalState.recommendationContents.filter((c) => c.recommendationId === rec.id).length === 1 && step.finalState.recommendationStates.filter((s) => s.recommendationId === rec.id).length === 1);
        }
      }
    }
    if (metricId === 'personalization.comparison_integrity' && step.input.kind === 'recommend' && step.input.paired) {
      if (!step.experiments.length) continue;
      const learned = step.experiments.find((arm) => arm.arm === 'learned');
      const omitted = step.experiments.find((arm) => arm.arm === 'omitted');
      add(`${label}: complete paired evidence`, !!learned && !!omitted && comparablePreferenceArms(learned, omitted));
    }
  }
  const numerator = checks.filter((check) => check.passed).length;
  return checks.length ? { metricId, status: 'scored', numerator, denominator: checks.length, value: numerator / checks.length, reason: JSON.stringify(checks) }
    : { metricId, status: 'not_applicable', reason: 'No applicable continuous checks.' };
}

/** Compares captured initial inputs; execution IDs are correlation fields, not decision inputs. */
export function comparablePreferenceArms(learned: PreferenceExperiment, omitted: PreferenceExperiment): boolean {
  if (StatusSchema.safeParse(learned.result).data?.status !== 'published'
    || StatusSchema.safeParse(omitted.result).data?.status !== 'published') return false;
  if (learned.issues.length || omitted.issues.length || learned.configurationDifferences.length || omitted.configurationDifferences.length) return false;
  if ([...learned.traces, ...omitted.traces].some((trace) => trace.kind === 'preference_learning')) return false;
  if (learned.sharedStateDigest !== omitted.sharedStateDigest || digest(learned.initialState) !== learned.sharedStateDigest || digest(omitted.initialState) !== omitted.sharedStateDigest
    || learned.modelConfigDigest !== omitted.modelConfigDigest || learned.clock !== omitted.clock || digest(learned.configuration) !== digest(omitted.configuration)) return false;
  const full = ContextSchema.safeParse(learned.inputSummary[0]);
  const filtered = ContextSchema.safeParse(omitted.inputSummary[0]);
  if (!full.success || !filtered.success) return false;
  const expectedIds = full.data.material.preferences.flatMap((set) => set.preferences.filter((p) => p.origin === 'learned').map((p) => p.id)).sort();
  if (digest(expectedIds) !== digest([...omitted.omittedLearnedIds].sort())) return false;
  if (filtered.data.material.preferences.some((set) => set.preferences.some((p) => p.origin === 'learned'))) return false;
  return digest(normalizeContext(full.data)) === digest(normalizeContext(filtered.data));
}

function normalizeContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((entry) => !isLearned(entry)).map(normalizeContext);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestId' && key !== 'executionId').map(([key, entry]) => [key, normalizeContext(entry)]));
  return value;
}
function isLearned(value: unknown): boolean { return !!value && typeof value === 'object' && 'origin' in value && value.origin === 'learned'; }
