import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scoreEvaluationRun } from '../../evals/agent/grading/score-run';
import { loadRunEvidence } from '../../evals/agent/grading/record-evidence';
import { PreferenceSequenceRecordSchema } from '../../evals/agent/contracts/preference-sequence-record';
const root=process.cwd();
const profile=JSON.parse(await readFile('evals/agent/grading/profiles/preference-sequence.json','utf8'));
const old=JSON.parse(await readFile('.megumi/audits/preference-sequence-real/summary.json','utf8'));
const rescoredRoot=path.join(root,'.megumi/audits/preference-sequence-baseline-rescored');
await mkdir(rescoredRoot,{recursive:true});
const rows=[];
for (const item of old) {
 const score=await scoreEvaluationRun({runDirectory:item.runDirectory,outputDirectory:path.join(rescoredRoot,item.runId),profile});
 rows.push(await summarize(item.runDirectory,score));
}
await writeFile(path.join(rescoredRoot,'summary.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows));
async function summarize(directory,score) {
 const {run,cases}=await loadRunEvidence(directory);
 let checkpoints=0,prepared=0,degraded=0,published=0,arms=0,extraLearningCalls=0;
 const failures=[];
 for(const c of cases) for(const step of PreferenceSequenceRecordSchema.parse(c.result.ownerFacts).steps) {
  if(step.input.kind!=='recommend')continue;
  checkpoints++;
  const learning=step.operationResult?.learning;
  if(learning?.status==='updated'||learning?.status==='unchanged')prepared++;
  if(learning?.status==='degraded'){degraded++;failures.push({case:c.snapshot.identity,step:step.stepId,failures:learning.failures});}
  for(const arm of step.experiments){arms++;if(arm.result?.status==='published')published++;extraLearningCalls+=arm.traces.filter(t=>t.kind==='preference_learning').reduce((sum,t)=>sum+(t.measurements?.modelCalls??0),0);}
 }
 return {runId:run.runId,cases:cases.length,checkpoints,prepared,degraded,published,arms,extraLearningCalls,
  ruleFailures:score.cases.flatMap(c=>c.metrics.filter(m=>m.status==='scored'&&m.value<1).map(m=>({case:c.caseIdentity,metric:m.metricId,reason:m.reason}))),failures};
}
