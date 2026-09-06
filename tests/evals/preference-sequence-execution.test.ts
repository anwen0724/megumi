/* Exercises sequence evidence, same-state arms, and offline checks with actual Product Owners. */
// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage, ProviderStreams } from '@megumi/ai';
import { AssistantMessageEventStream } from '@megumi/ai/utils/event-stream';
import { runEvaluation } from '../../evals/agent/run/evaluation-runner';
import { CaseRunResultSchema, EvaluationRunRequestSchema } from '../../evals/agent/contracts/evaluation-run';
import { PreferenceSequenceRecordSchema } from '../../evals/agent/contracts/preference-sequence-record';
import { comparablePreferenceArms } from '../../evals/agent/grading/preference-sequence-metrics';
import { scoreEvaluationRun } from '../../evals/agent/grading/score-run';
import { ReviewSchema } from '../../evals/agent/grading/grading-contract';

it('runs paired recommendations from equal learned state and detects tampered comparison inputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-sequence-test-'));
  try {
    const result = await runEvaluation({ repositoryRoot: process.cwd(), evaluationRoot: root, datasetRoot: path.resolve('evals/agent/datasets'),
      request: EvaluationRunRequestSchema.parse({ caseIds: ['controlled/preference-sequence.photo-partial-support'], candidateModel: { source: 'explicit', providerId: 'test', modelId: 'model', api: 'openai-completions', baseUrl: 'https://example.test/v1', contextWindowTokens: 64000, maxOutputTokens: 2048, credentialEnvironmentVariable: 'EVAL_TEST_KEY' }, safetyWallClockLimitMs: 10000 }),
      environment: { EVAL_TEST_KEY: 'test' }, dependencies: { modelStreams: { 'openai-completions': sequenceModel() } },
    });
    expect(result.caseResults[0].recordStatus, JSON.stringify(PreferenceSequenceRecordSchema.parse(result.caseResults[0].ownerFacts).steps.flatMap((step) => step.traces.flatMap((trace) => trace.issues)))).toBe('recorded');
    const record = PreferenceSequenceRecordSchema.parse(result.caseResults[0].ownerFacts);
    expect(record.steps.flatMap((step) => step.issues)).toEqual([]);
    const learned = record.steps[1].experiments[0];
    const omitted = record.steps[1].experiments[1];
    expect(learned?.result, JSON.stringify(learned?.result)).toMatchObject({ status: 'published' });
    expect(omitted?.result).toMatchObject({ status: 'published' });
    expect(comparablePreferenceArms(learned, omitted), JSON.stringify({ learned: learned.inputSummary, omitted: omitted.inputSummary, issues: [learned.issues, omitted.issues] })).toBe(true);
    expect(comparablePreferenceArms(learned, { ...omitted, clock: 'different' })).toBe(false);
    expect(comparablePreferenceArms(learned, { ...omitted, result: { status: 'failed' } })).toBe(false);
    expect(omitted.omittedLearnedIds).toEqual(['photo-depth']);
    const score = await scoreEvaluationRun({ runDirectory: result.runDirectory, outputDirectory: path.join(root, 'scored'), profile: {
      schemaVersion: 1, profileId: 'sequence', revision: 1, metrics: [
        ...['lazy_trigger', 'user_control', 'input_validity', 'comparison_integrity'].map((id) => ({ metricId: `personalization.${id}`, method: 'rule', direction: 'higher', threshold: 1 })),
        { metricId: 'personalization.semantic_quality', method: 'human', direction: 'higher', rubric: 'Human review of actual recommendations.' },
      ],
    } });
    expect(score.status, JSON.stringify(score)).toBe('incomplete');
    expect(score.cases[0].metrics.filter((metric) => metric.status === 'scored').every((metric) => metric.value === 1)).toBe(true);
    expect(score.cases[0].metrics.at(-1)?.status).toBe('needs_review');
    const cost = z.object({ cases: z.array(z.object({ checkpoints: z.array(z.object({
      mainPath: z.object({ modelCalls: z.number() }), sharedLearning: z.object({ modelCalls: z.number() }),
      recommendations: z.array(z.object({ cost: z.object({ modelCalls: z.number() }), unexpectedLearning: z.object({ modelCalls: z.number() }) })),
    })) })) }).parse(JSON.parse(await readFile(path.join(root, 'scored', 'preference-cost.json'), 'utf8')));
    const checkpoint = cost.cases[0].checkpoints[0];
    expect(checkpoint.mainPath.modelCalls).toBe(checkpoint.sharedLearning.modelCalls + checkpoint.recommendations[0].cost.modelCalls);
    expect(checkpoint.recommendations.every((arm) => arm.unexpectedLearning.modelCalls === 0)).toBe(true);
    const template = ReviewSchema.parse(JSON.parse(await readFile(path.join(root, 'scored', 'review-template.json'), 'utf8')));
    expect(template.entries.map((entry) => entry.arm)).toEqual(['shared', 'learned', 'omitted']);
    const reviewed = template.entries.map((entry) => ({ ...entry, decision: 'scored', numerator: 1, denominator: 1, reviewer: 'test-fixture', reason: 'Protocol fixture; no semantic quality claim.' }));
    const partial = await scoreEvaluationRun({ runDirectory: result.runDirectory, outputDirectory: path.join(root, 'partial'), profile: score.profile, review: { ...template, entries: reviewed.slice(0, 1) } });
    expect(partial.cases[0].metrics.at(-1)?.status).toBe('needs_review');
    await expect(scoreEvaluationRun({ runDirectory: result.runDirectory, outputDirectory: path.join(root, 'invalid'), profile: score.profile, review: { ...template, entries: [{ ...reviewed[0], checkpointId: 'absent' }] } })).rejects.toThrow('checkpoint');
    const complete = await scoreEvaluationRun({ runDirectory: result.runDirectory, outputDirectory: path.join(root, 'reviewed'), profile: score.profile, review: { ...template, entries: reviewed } });
    expect(complete.cases[0].metrics.at(-1)?.status).toBe('scored');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

it('shares one failed preparation across both arms without repeating model learning', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-sequence-degraded-'));
  let calls = 0;
  try {
    const result = await runEvaluation({ repositoryRoot: process.cwd(), evaluationRoot: root, datasetRoot: path.resolve('evals/agent/datasets'),
      request: EvaluationRunRequestSchema.parse({ caseIds: ['controlled/preference-sequence.photo-partial-support'], candidateModel: { source: 'explicit', providerId: 'test', modelId: 'model', api: 'openai-completions', baseUrl: 'https://example.test/v1', contextWindowTokens: 64000, maxOutputTokens: 2048, credentialEnvironmentVariable: 'EVAL_TEST_KEY' }, safetyWallClockLimitMs: 15000 }),
      environment: { EVAL_TEST_KEY: 'test' }, dependencies: { modelStreams: { 'openai-completions': sequenceModel(() => { calls++; return 'invalid JSON'; }) } },
    });
    const record = PreferenceSequenceRecordSchema.parse(result.caseResults[0].ownerFacts);
    expect(CaseRunResultSchema.safeParse({ ...result.caseResults[0], schemaVersion: 2 }).success).toBe(false);
    expect(PreferenceSequenceRecordSchema.safeParse({ ...record, steps: [record.steps[0], record.steps[0]] }).success).toBe(false);
    expect(record.steps.flatMap((step) => step.issues)).toEqual([]);
    expect(calls).toBe(1);
    const [learned, omitted] = record.steps[1].experiments;
    expect(learned.result).toMatchObject({ status: 'published' });
    expect(omitted.result).toMatchObject({ status: 'published' });
    expect(learned.traces.every((trace) => trace.kind === 'recommendation')).toBe(true);
    expect(omitted.traces.every((trace) => trace.kind === 'recommendation')).toBe(true);
    expect(comparablePreferenceArms(learned, omitted)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 25000);

it('retains inconclusive feedback through two real recommendation cycles', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-sequence-history-'));
  try {
    const result = await runEvaluation({ repositoryRoot: process.cwd(), evaluationRoot: root, datasetRoot: path.resolve('evals/agent/datasets'),
      request: EvaluationRunRequestSchema.parse({ caseIds: ['controlled/preference-sequence.photo-accumulation'], candidateModel: { source: 'explicit', providerId: 'test', modelId: 'model', api: 'openai-completions', baseUrl: 'https://example.test/v1', contextWindowTokens: 64000, maxOutputTokens: 2048, credentialEnvironmentVariable: 'EVAL_TEST_KEY' }, safetyWallClockLimitMs: 15000 }),
      environment: { EVAL_TEST_KEY: 'test' }, dependencies: { modelStreams: { 'openai-completions': sequenceModel() } },
    });
    const record = PreferenceSequenceRecordSchema.parse(result.caseResults[0].ownerFacts);
    expect(record.steps.flatMap((step) => step.issues)).toEqual([]);
    const checkpoints = record.steps.filter((step) => step.input.kind === 'recommend');
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].operationResult).toMatchObject({ status: 'published' });
    expect(checkpoints[1].experiments.every((arm) => z.object({ status: z.literal('published') }).safeParse(arm.result).success)).toBe(true);
    const learning = checkpoints[1].traces.find((trace) => trace.kind === 'preference_learning');
    const context = z.object({ material: z.object({ reactionChanges: z.array(z.object({ recommendationId: z.string(), learnedReactionRevision: z.number() })) }) }).parse(learning?.contexts[0]);
    expect(context.material.reactionChanges).toEqual(expect.arrayContaining([
      { recommendationId: 'evaluation:recommendation:r1', learnedReactionRevision: 1 },
      { recommendationId: 'evaluation:recommendation:r2', learnedReactionRevision: 0 },
    ]));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 25000);

/** Scripted responses validate protocol and isolation, never natural-language recommendation quality. */
function sequenceModel(learningResponse?: () => string): ProviderStreams {
  const stream: ProviderStreams['stream'] = (model, context) => {
    let content: AssistantMessage['content'];
    const material = context.messages[0];
    if (material?.role !== 'user' || typeof material.content !== 'string') throw new Error('Missing Context material.');
    if (!context.tools?.length) {
      const facts = z.object({ reviewedPreferenceIds: z.array(z.string()), currentPreferences: z.array(z.object({ preferenceSetId: z.string(), revision: z.number(), preferences: z.array(z.object({ id: z.string(), revision: z.number() }).passthrough()) }).passthrough()), supportingReactions: z.array(z.object({ recommendationId: z.string() }).passthrough()) }).passthrough().parse(JSON.parse(material.content));
      content = [{ type: 'text', text: JSON.stringify({ scopes: facts.currentPreferences.map((set) => ({ preferenceSetId: set.preferenceSetId, baseRevision: set.revision, reviewedPreferenceIds: facts.reviewedPreferenceIds,
        outcome: facts.reviewedPreferenceIds.length ? 'changed' : 'insufficient', changes: set.preferences.filter((p) => facts.reviewedPreferenceIds.includes(p.id)).map((p) => ({ kind: 'update', preferenceId: p.id, expectedRevision: p.revision, statement: '偏好包含对照步骤的教程', polarity: 'positive', dimension: 'expression_quality', evidence: facts.supportingReactions.map((r) => ({ recommendationId: r.recommendationId, relation: 'support', explanation: 'Retained user feedback supports procedural detail.' })) })),
      })) }) }];
      if (learningResponse) content = [{ type: 'text', text: learningResponse() }];
    } else if (context.messages.some((message) => message.role === 'toolResult')) content = [{ type: 'text', text: 'Published.' }];
    else {
      const encoded = material.content.match(/<candidates>([\s\S]*?)<\/candidates>/u)?.[1];
      const candidates = z.array(z.object({ candidateId: z.string() }).passthrough()).nonempty().parse(JSON.parse(encoded ?? 'null'));
      content = [{ type: 'toolCall', id: 'publish', name: 'publish_recommendations', arguments: { items: [{ candidateId: candidates[0].candidateId, recommendationReason: '提供可执行的步骤和对照解释。' }] } }];
    }
    const stopReason = content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop';
    const message: AssistantMessage = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(),
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = new AssistantMessageEventStream();
    events.push({ type: 'start', partial: { ...message, content: [] } });
    events.push({ type: 'done', reason: stopReason, message });
    return events;
  };
  return { stream, streamSimple: stream };
}
