/* Measures learned versus omitted preferences using existing shared-state sequence experiments. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {runEvaluation} from '../../../evals/agent/run/evaluation-runner';
import {EvaluationRunRequestSchema} from '../../../evals/agent/contracts/evaluation-run';
import {PreferenceSequenceRecordSchema} from '../../../evals/agent/contracts/preference-sequence-record';
import {comparablePreferenceArms} from '../../../evals/agent/grading/preference-sequence-metrics';
import {auditStreams,auditModelParameters} from './model-configuration.mts';

const root=process.cwd(),audit=path.join(root,'.megumi/audits/resume-metrics-20260908');
const phase=z.enum(['pilot','formal']).parse(process.argv[2]);
const out=path.join(audit,phase==='pilot'?'attempt-06-preference-pilot':'attempt-07-preference-formal');await mkdir(out,{recursive:true});
const baseModel=z.record(z.unknown()).parse(JSON.parse(await readFile(path.join(root,'.megumi/audits/preference-model.json'),'utf8')));
const labels=z.record(z.object({domain:z.string(),user:z.string(),preferred:z.string(),targetCount:z.number(),grades:z.record(z.number())})).parse(JSON.parse(await readFile(path.join(audit,'preference-labels.json'),'utf8')));
const identities=phase==='pilot'?['controlled/resume-preference.photo-u1']:Object.keys(labels).sort();
for(const repetition of phase==='pilot'?[0]:[1,2,3])for(const identity of identities) {
  const key=`${identity.replace('controlled/','')}.r${repetition}`,file=path.join(out,`${key}.json`);
  try {await readFile(file);console.log(JSON.stringify({event:'retained',key}));continue;}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  console.log(JSON.stringify({event:'started',key,at:new Date().toISOString()}));
  const run=await runEvaluation({repositoryRoot:root,evaluationRoot:path.join(out,'evaluation'),datasetRoot:path.join(audit,'datasets/preference'),request:EvaluationRunRequestSchema.parse({caseIds:[identity],candidateModel:{...baseModel,maxOutputTokens:32768},safetyWallClockLimitMs:480000}),dependencies:{modelStreams:{'openai-completions':auditStreams}}});
  const result=run.caseResults[0];assert.ok(result);
  const sequence=PreferenceSequenceRecordSchema.parse(result.ownerFacts);const checkpoint=sequence.steps.find(s=>s.stepId==='paired-checkpoint');
  const gold=labels[identity];assert.ok(gold);
  const dcg=(grades:number[])=>grades.slice(0,gold.targetCount).reduce((sum,grade,index)=>sum+(2**grade-1)/Math.log2(index+2),0);
  const ideal=dcg(Object.values(gold.grades).sort((a,b)=>b-a));
  const arms=(checkpoint?.experiments??[]).map(arm=>{
    const before=new Set(arm.initialState.recommendations.map(r=>r.id));
    const rows=arm.finalState.recommendations.filter(r=>!before.has(r.id)).sort((a,b)=>a.position-b.position).map(row=>{
      const id=row.candidateId.replace(/^evaluation:candidate:/,'');const grade=gold.grades[id];assert.ok(grade!==undefined,`Unlabeled output ${id}`);return{id,grade,reason:row.recommendationReason};
    });
    return{arm:arm.arm,status:z.object({status:z.string()}).parse(arm.result).status,publishedCount:rows.length,ndcg:ideal?dcg(rows.map(r=>r.grade))/ideal:null,
      preferredCount:rows.filter(r=>r.grade===2).length,neutralCount:rows.filter(r=>r.grade===1).length,
      omittedLearnedIds:arm.omittedLearnedIds,preferences:arm.initialState.preferences,measurements:arm.traces.map(t=>t.measurements),issues:arm.issues,rows};
  });
  const learned=checkpoint?.experiments.find(a=>a.arm==='learned'),omitted=checkpoint?.experiments.find(a=>a.arm==='omitted');
  const summary={key,repetition,phase,identity,modelParameters:auditModelParameters,domain:gold.domain,user:gold.user,preferred:gold.preferred,targetCount:gold.targetCount,
    runDirectory:run.runDirectory,recordStatus:result.recordStatus,terminalState:result.terminalState,productResult:result.productResult,
    comparable:!!learned&&!!omitted&&comparablePreferenceArms(learned,omitted),learning:checkpoint?.operationResult,
    issues:sequence.steps.flatMap(s=>s.issues),sharedLearningTraces:checkpoint?.traces.filter(t=>t.kind==='preference_learning'),arms};
  await writeFile(file,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({event:'completed',key,comparable:summary.comparable,arms:arms.map(a=>({arm:a.arm,published:a.publishedCount,ndcg:a.ndcg,omitted:a.omittedLearnedIds.length})),issues:summary.issues}));
}
