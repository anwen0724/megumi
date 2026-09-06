/* Exercises sequence evidence, same-state arms, and offline checks with actual Product Owners. */
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage, ProviderStreams } from '@megumi/ai';
import { AssistantMessageEventStream } from '@megumi/ai/utils/event-stream';
import { runEvaluation } from '../../evals/agent/run/evaluation-runner';
import { EvaluationRunRequestSchema } from '../../evals/agent/contracts/evaluation-run';
import { PreferenceSequenceRecordSchema } from '../../evals/agent/contracts/preference-sequence-record';
import { comparablePreferenceArms } from '../../evals/agent/grading/preference-sequence-metrics';
import { scoreEvaluationRun } from '../../evals/agent/grading/score-run';

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
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

/** Scripted responses validate protocol and isolation, never natural-language recommendation quality. */
function sequenceModel(): ProviderStreams {
  const stream: ProviderStreams['stream'] = (model, context) => {
    let content: AssistantMessage['content'];
    const material = context.messages[0];
    if (material?.role !== 'user' || typeof material.content !== 'string') throw new Error('Missing Context material.');
    if (!context.tools?.length) {
      const facts = z.object({ reviewedPreferenceIds: z.array(z.string()), currentPreferences: z.array(z.object({ preferenceSetId: z.string(), revision: z.number(), preferences: z.array(z.object({ id: z.string(), revision: z.number() }).passthrough()) }).passthrough()), supportingReactions: z.array(z.object({ recommendationId: z.string() }).passthrough()) }).passthrough().parse(JSON.parse(material.content));
      content = [{ type: 'text', text: JSON.stringify({ scopes: facts.currentPreferences.map((set) => ({ preferenceSetId: set.preferenceSetId, baseRevision: set.revision, reviewedPreferenceIds: facts.reviewedPreferenceIds,
        outcome: facts.reviewedPreferenceIds.length ? 'changed' : 'insufficient', changes: set.preferences.filter((p) => facts.reviewedPreferenceIds.includes(p.id)).map((p) => ({ kind: 'update', preferenceId: p.id, expectedRevision: p.revision, statement: '偏好包含对照步骤的教程', polarity: 'positive', dimension: 'expression_quality', evidence: facts.supportingReactions.map((r) => ({ recommendationId: r.recommendationId, relation: 'support', explanation: 'Retained user feedback supports procedural detail.' })) })),
      })) }) }];
    } else if (context.messages.some((message) => message.role === 'toolResult')) content = [{ type: 'text', text: 'Published.' }];
    else {
      content = [{ type: 'toolCall', id: 'publish', name: 'publish_recommendations', arguments: { items: [{ candidateId: 'evaluation:candidate:photo-4', recommendationReason: '提供可执行的步骤和对照解释。' }] } }];
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
