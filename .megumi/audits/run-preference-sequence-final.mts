import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runEvaluation } from '../../evals/agent/run/evaluation-runner';
import { EvaluationRunRequestSchema } from '../../evals/agent/contracts/evaluation-run';
import { scoreEvaluationRun } from '../../evals/agent/grading/score-run';
const root = process.cwd();
const candidateModel = JSON.parse(await readFile('.megumi/audits/preference-model.json', 'utf8'));
const profile = JSON.parse(await readFile('evals/agent/grading/profiles/preference-sequence.json', 'utf8'));
const output = path.join(root, '.megumi/audits/preference-sequence-final');
await mkdir(output, { recursive: true });
const outcomes = await Promise.allSettled([1, 2, 3].map(async (repetition) => {
  console.log(`Starting final repetition ${repetition}/3, ten continuous cases.`);
  const result = await runEvaluation({ repositoryRoot: root, evaluationRoot: path.join(root, 'evals/agent'), datasetRoot: path.join(root, 'evals/agent/datasets'),
    request: EvaluationRunRequestSchema.parse({ datasetIds: ['controlled/preference-sequence'], candidateModel, safetyWallClockLimitMs: 240000 }),
  });
  const scored = await scoreEvaluationRun({ runDirectory: result.runDirectory, outputDirectory: path.join(output, result.record.runId), profile });
  const summary = { repetition, runId: result.record.runId, runDirectory: result.runDirectory, status: scored.status, cases: scored.cases };
  await writeFile(path.join(output, `repetition-${repetition}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ repetition, runId: result.record.runId, cases: scored.cases.map((entry) => ({ case: entry.caseIdentity, status: entry.status })) }));
  return summary;
}));
await writeFile(path.join(output, 'summary.json'), JSON.stringify(outcomes, null, 2));
for (const result of outcomes) if (result.status === 'rejected') throw result.reason;
