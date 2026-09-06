/* Exercises actual composition, database, tools, and business Owners with a scripted external model. */
// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { createCaseEnvironment } from '../../evals/agent/run/case-environment';
import { executeCase } from '../../evals/agent/run/case-execution';
import { createScriptedStreams } from '../packages/composition/compose-test-application';
import { readFile } from 'node:fs/promises';
import type { AssistantMessage, Context, ProviderStreams } from '@megumi/ai';
import { AssistantMessageEventStream } from '@megumi/ai/utils/event-stream';
import { z } from 'zod';
import { getCaseBusinessState } from '../../evals/agent/run/business-state';
import { collectTraceIntegrity } from '../../evals/agent/run/case-record';

describe('Real evaluation execution', () => {
  it.each(['waiting-feedback', 'failed-recommendation'] as const)('preserves the real business outcome: %s', async (scenario) => {
    const identity = scenario === 'waiting-feedback' ? 'preference-learning.learn-source-preference' : 'recommendation.select-relevant-candidate';
    const resolved = await loadCase({ rootDirectory: path.resolve('evals/agent/datasets'), identity: `controlled/${identity}` });
    const resolvedCase = resolved.case.type === 'preference_learning'
      ? { ...resolved, case: { ...resolved.case, input: { ...resolved.case.input, advanceTimeMs: 0 } } } : resolved;
    const model = testModel();
    const scripted = createScriptedStreams(['No publication.']);
    const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase, candidateModel: model,
      modelStreams: { 'openai-completions': scripted.streams },
    });
    try {
      const result = await executeCase({ evaluationCase: resolvedCase.case, runtime: environment.runtime, initialStateIds: environment.initialStateIds,
        candidateModel: model.config, now: environment.now, advanceTime: environment.advanceTime!, safetyWallClockLimitMs: 5_000,
      });
      await environment.stop();
      if (scenario === 'waiting-feedback') {
        expect(scripted.contexts).toHaveLength(1);
        expect(result).toMatchObject({ terminalState: 'settled', productResult: { completion: { status: 'degraded' } } });
      } else {
        expect(result).toMatchObject({ terminalState: 'settled', productResult: { completion: { status: 'failed' } } });
        expect(await collectTraceIntegrity({ runtime: environment.runtime, targets: result.traceTargets })).toMatchObject({ status: 'complete' });
      }
    } finally { await environment.dispose(); }
  });
  it.each([
    'conversation.create-workspace-note', 'interest-understanding.recognize-explicit-interest',
    'candidate-supply.refill-agent-candidates', 'recommendation.select-relevant-candidate', 'preference-learning.learn-source-preference',
  ])('executes %s with real Owners and records committed business results', async (identity) => {
    const resolved = await loadCase({ rootDirectory: path.resolve('evals/agent/datasets'), identity: `controlled/${identity}` });
    const resolvedCase = resolved;
    const model = testModel();
    const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase, candidateModel: model,
      modelStreams: { 'openai-completions': scriptedBusinessModel(resolved.case.type) },
    });
    try {
      const result = await executeCase({ evaluationCase: resolvedCase.case, runtime: environment.runtime, initialStateIds: environment.initialStateIds,
        candidateModel: model.config, now: environment.now, advanceTime: environment.advanceTime!, safetyWallClockLimitMs: 5_000,
      });
      expect(result.terminalState, JSON.stringify(result)).toBe('settled');
      await environment.stop();
      const facts = getCaseBusinessState(environment.paths.database, environment.initialStateIds.workspaceId);
      const integrity = await collectTraceIntegrity({ runtime: environment.runtime, targets: result.traceTargets });
      const traceId = integrity.targets[0]?.matchedTraceIds[0];
      const detail = traceId ? await environment.runtime.host.observability.getTrace({ traceId }) : undefined;
      expect(integrity, JSON.stringify(detail?.status === 'found' ? detail.trace.issues : integrity)).toMatchObject({ status: 'complete' });
      if (resolved.case.type === 'conversation') {
        expect(await readFile(path.join(environment.paths.workspace, 'notes.md'), 'utf8')).toContain('运行时校验');
        expect(facts.sessions[0]?.messages.some((message) => message.message_kind === 'assistant_reply' && message.status === 'completed')).toBe(true);
      } else if (resolved.case.type === 'interest_understanding') {
        expect(facts.discovery.interests).toHaveLength(1);
        expect(facts.discovery.interestEvidence).toHaveLength(1);
      } else if (resolved.case.type === 'candidate_supply') {
        expect(facts.discovery.candidates).toHaveLength(1);
        expect(facts.discovery.candidates[0]?.contentExcerpt).toContain('reproducible');
      } else if (resolved.case.type === 'recommendation') {
        expect(facts.discovery.recommendations).toHaveLength(1);
        expect(facts.discovery.candidates.filter(({ status }) => status === 'consumed')).toHaveLength(1);
      } else {
        expect(facts.discovery.preferences).toHaveLength(1);
        expect(facts.discovery.recommendationStates[0]?.learnedReactionRevision).toBe(1);
      }
    } finally { await environment.dispose(); }
  });
  it('prepares explicitly after a controlled time advance and records malformed model output', async () => {
    const resolved = await loadCase({ rootDirectory: path.resolve('evals/agent/datasets'), identity: 'controlled/preference-learning.learn-source-preference' });
    if (resolved.case.type !== 'preference_learning') throw new Error('Expected Preference Case');
    const resolvedCase = { ...resolved, case: { ...resolved.case, input: { ...resolved.case.input, advanceTimeMs: 600_000 } } };
    const model = testModel();
    const scripted = createScriptedStreams(['invalid preference JSON']);
    const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase, candidateModel: model, modelStreams: { 'openai-completions': scripted.streams } });
    try {
      const result = await executeCase({ evaluationCase: resolvedCase.case, runtime: environment.runtime, initialStateIds: environment.initialStateIds,
        candidateModel: model.config, now: environment.now, advanceTime: environment.advanceTime!, safetyWallClockLimitMs: 5_000,
      });
      expect(scripted.contexts).toHaveLength(1);
      expect(result).toMatchObject({ terminalState: 'settled', productResult: { completion: { status: 'degraded', failures: [expect.objectContaining({ code: 'preference_learning_failed' })] } }, ownerFacts: { status: 'pending' } });
      expect(environment.now()).toBe('2026-01-15T08:10:00.000Z');
    } finally { await environment.dispose(); }
  });
});

function scriptedBusinessModel(kind: string): ProviderStreams {
  let step = 0;
  const stream: ProviderStreams['stream'] = (model, context) => {
    const content = response(context);
    const events = new AssistantMessageEventStream();
    const stopReason = content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop';
    const message: AssistantMessage = {
      role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason, timestamp: Date.now(),
    };
    events.push({ type: 'start', partial: { ...message, content: [] } });
    events.push({ type: 'done', reason: stopReason, message });
    return events;
  };
  function response(context: Context): AssistantMessage['content'] {
    const text = (value: string): AssistantMessage['content'] => [{ type: 'text', text: value }];
    const tool = (name: string, args: Record<string, unknown>): AssistantMessage['content'] => [{ type: 'toolCall', id: `call-${step}`, name, arguments: args }];
    if (context.systemPrompt?.startsWith('You identify durable content interests')) {
      return text(JSON.stringify({ evidence: kind === 'interest_understanding' ? [{ description: 'Agent 评估系统设计', effect: 'support', confidence: 'high' }] : [] }));
    }
    if (kind === 'preference_learning') {
      const material = context.messages[0];
      if (material?.role !== 'user' || typeof material.content !== 'string') throw new Error('Missing Preference context');
      const facts = z.object({ currentPreferences: z.array(z.object({ preferenceSetId: z.string(), scope: z.string(), revision: z.number() }).passthrough()), reactionChanges: z.array(z.object({ recommendationId: z.string() }).passthrough()) }).passthrough().parse(JSON.parse(material.content));
      return text(JSON.stringify({ scopes: facts.currentPreferences.map((set) => ({ preferenceSetId: set.preferenceSetId, baseRevision: set.revision,
        outcome: set.scope === 'interest' ? 'changed' : 'insufficient', reviewedPreferenceIds: [],
        changes: set.scope === 'interest' ? [{ kind: 'add', polarity: 'positive', dimension: 'source', statement: '偏好结构清晰的 Agent 评估内容', evidence: facts.reactionChanges.map(({ recommendationId }) => ({ recommendationId, relation: 'support', explanation: 'The user liked this structured article.' })) }] : [],
      })) }));
    }
    if (!context.tools?.length) return text('Done.');
    step += 1;
    if (kind === 'conversation') {
      if (step === 1) return tool('read_file', { path: 'source.md' });
      if (step === 2) return tool('write_file', { path: 'notes.md', content: '外部未知数据必须先进行运行时校验。' });
    }
    if (kind === 'candidate_supply') {
      if (step === 1) return tool('search_content', { sourceId: 'open_web', query: 'Agent', mode: 'relevance', limit: 10, targetInterestIds: ['evaluation:interest:agent-evaluation'] });
      const resultId = JSON.stringify(context.messages).match(/source-result:[a-f0-9-]+/u)?.[0];
      if (!resultId) throw new Error('Source did not return a result ID');
      if (step === 2) return tool('read_source_candidate', { resultId });
      if (step === 3) return tool('submit_candidates', { items: [{ resultId, contentSummary: 'A guide to reproducible Agent evaluation.', matches: [{ interestId: 'evaluation:interest:agent-evaluation', relevance: 'direct', matchReason: 'Explains evaluation datasets and execution records.' }] }] });
    }
    if (kind === 'recommendation' && step === 1) return tool('publish_recommendations', { items: [{ candidateId: 'evaluation:candidate:evaluation-design', recommendationReason: 'Explains the Agent evaluation datasets and execution evidence you follow.' }] });
    return text('Done.');
  }
  return { stream, streamSimple: stream };
}

function testModel() {
  const credential = { type: 'api_key' as const, key: 'test-key' };
  return {
    source: 'explicit' as const,
    config: { providerId: 'test', modelId: 'model', api: 'openai-completions' as const, baseUrl: 'https://example.test/v1', displayName: 'Test model', contextWindowTokens: 64_000, maxOutputTokens: 2_048 },
    credentials: {
      async read() { return credential; }, async list() { return [{ providerId: 'test', type: 'api_key' as const }]; },
      async modify() { throw new Error('read-only'); }, async delete() { throw new Error('read-only'); },
    },
  };
}
