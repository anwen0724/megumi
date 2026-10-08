/* Summarizes recorded calls and builds a separate human-review worksheet without changing trial evidence. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Usage } from '@megumi/ai';
import type { EffectFixture } from './effect-fixtures';
import { checkEffectAnswer } from './effect-scoring';
import { summarizeHumanReview, type EffectReview } from './effect-review';

const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the experiment output directory.');
const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = read('manifest.json') as { fixtures: EffectFixture[]; conditions: string[]; repeats: number };
const rows = read('results.json') as { fixtureId: string; condition: string; repeat: number; directory?: string; calls?: { phase: 'task' | 'extract' | 'consolidate'; usage?: Usage }[]; taskDurationMs?: number; productionDurationMs?: number; mechanicalPass?: boolean; status?: string; outcome?: { status: string }; error?: string }[];
const byCondition = Object.fromEntries(manifest.conditions.map((condition: string) => [condition, {
  planned: manifest.fixtures.length * manifest.repeats, recorded: 0, mechanicalPass: 0, serviceOrHarnessFailures: 0,
  task: { modelCalls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, durationMs: 0 },
  extract: { modelCalls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  consolidate: { modelCalls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  productionDurationMs: 0,
}]));
for (const row of rows) {
  const totals = byCondition[row.condition];
  totals.recorded++;
  totals.mechanicalPass += Number(row.mechanicalPass === true);
  totals.serviceOrHarnessFailures += Number(row.status === 'failed' || row.outcome?.status !== 'completed');
  totals.task.durationMs += row.taskDurationMs ?? 0;
  totals.productionDurationMs += row.productionDurationMs ?? 0;
  for (const call of row.calls ?? []) {
    const phase = totals[call.phase];
    phase.modelCalls++;
    for (const key of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) phase[key] += call.usage?.[key] ?? 0;
  }
}
const worksheet = [];
for (const fixture of manifest.fixtures) for (const condition of manifest.conditions) for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
  const row = rows.find(item => item.fixtureId === fixture.id && item.condition === condition && item.repeat === repeat);
  const resultPath = path.join(row?.directory ?? path.join(root, `${fixture.id}-${condition}-${repeat}`), 'result.json');
  const detail = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : undefined;
  const judgments = detail?.knowledgeReview ?? checkEffectAnswer(fixture, '');
  worksheet.push({ id: `${fixture.id}/${condition}/${repeat}`, evidence: resultPath,
    requests: path.join(path.dirname(resultPath), 'requests.jsonl'),
    category: fixture.category, answer: detail?.answer, citations: detail?.citations,
    ...judgments, forbidden: judgments.forbidden.map((item: object) => ({ ...item, usedAsCurrentFact: null })),
    additionalKnowledgeReviewed: null, additionalUsedKnowledge: [],
    failure: row?.error ?? (!row ? 'This planned trial has not been recorded.' : undefined),
    instructions: 'Inspect task-phase system/tool messages for recalled facts, then answer for actual use. Do not count extraction/production files as task recall. memoryRequired=false labels are current-task facts/calculations and excluded from memory metrics. Record all extra used knowledge, including wrong or unsupported claims. Mark forbidden values usedAsCurrentFact only when asserted as current, not quoted as obsolete. Evidence locations must identify requests.jsonl line/role/tool and answer field. Null means unreviewed, never success.',
  });
}
const reviewPath = path.join(root, 'human-review.json');
if (!existsSync(reviewPath)) writeFileSync(reviewPath, JSON.stringify(worksheet, null, 2));
writeFileSync(path.join(root, 'human-review-template.json'), JSON.stringify(worksheet, null, 2));
const human = summarizeHumanReview(manifest, read('human-review.json') as EffectReview[]);
const reviewComplete = Object.values(human.byCondition).every(item => (item as { reviewComplete: boolean }).reviewComplete);
const summary = { scope: 'synthetic-only', result: reviewComplete
  ? 'Human review is complete. These measurements do not independently declare the Spec effect gates passed; compare quality, constraints, repeated reuse, forbidden uses and task cost.'
  : 'Human review is incomplete; unresolved judgments are null, and mechanical checks do not prove task benefit.',
  byCondition, human, plannedExecutions: manifest.fixtures.length * manifest.conditions.length * manifest.repeats,
  recordedExecutions: rows.length,
  tokenAccounting: 'input, cacheRead and cacheWrite are listed separately. Total task prompt tokens = input + cacheRead + cacheWrite. Background extraction/consolidation are separate, not task samples.',
  amortization: 'For K reuses of one generated memory, amortized background token cost is (extract + consolidate prompt/output tokens) / K. This experiment rebuilds each repeat and does not measure K reuses.',
  limitations: 'These twelve cases are short-history configuration/plan-writing tasks. They measure factual retrieval and planning constraint use. Suggested repeated bad steps can be counted, but no task executes an external command, so actual repeated execution savings are unmeasured. No token improvement is assumed. Generalization beyond these fixed samples is unsupported.',
};
writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
