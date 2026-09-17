/* Runs paired existing recommendation configurations and derives audit-only quality/cost records. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { runEvaluation } from '../../../evals/agent/run/evaluation-runner';
import { EvaluationRunRequestSchema } from '../../../evals/agent/contracts/evaluation-run';
import { loadRunEvidence } from '../../../evals/agent/grading/record-evidence';
import { readDiscoveryRecordState } from '../../../evals/agent/grading/discovery-record-state';
import { auditStreams,auditModelParameters } from './model-configuration.mts';

const root=process.cwd();
const audit=path.join(root,'.megumi/audits/resume-metrics-20260908');
const phase=z.enum(['pilot-fast','formal']).parse(process.argv[2]);
const out=path.join(audit,phase==='pilot-fast'?'attempt-04-pilot-output-budget':'attempt-05-formal');
await mkdir(out,{recursive:true});
const labels=z.record(z.object({domain:z.string(),poolSize:z.number(),targetCount:z.number(),grades:z.record(z.number().int().min(0).max(2))})).parse(JSON.parse(await readFile(path.join(audit,'recommendation-labels.json'),'utf8')));
const baseModel=z.record(z.unknown()).parse(JSON.parse(await readFile(path.join(root,'.megumi/audits/preference-model.json'),'utf8')));
const model={...baseModel,maxOutputTokens:32768};
const identities=phase==='pilot-fast'?['controlled/resume-recommendation.photo-120']:Object.keys(labels).sort();
const repetitions=phase==='pilot-fast'?[0]:[1,2];
// Preflight equality excludes only the intended initial working-set treatment.
for(const identity of identities) {
  const name=identity.replace('controlled/','');
  const files=await Promise.all(['layered','full'].map(arm=>readFile(path.join(audit,'datasets',arm,'controlled/cases/recommendation',`${name}.json`),'utf8')));
  const left=JSON.parse(files[0]),right=JSON.parse(files[1]);
  left.initialState.recommendationWorkingSetCount=right.initialState.recommendationWorkingSetCount=0;
  assert.deepEqual(left,right);
}
for(const repetition of repetitions)for(const identity of identities)for(const arm of (repetition%2===0?['full','layered']:['layered','full'])) {
  const key=`${identity.replace('controlled/','')}.r${repetition}.${arm}`;
  const summaryFile=path.join(out,`${key}.json`);
  try {await readFile(summaryFile);console.log(JSON.stringify({event:'retained',key}));continue;}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  console.log(JSON.stringify({event:'started',key,at:new Date().toISOString()}));
  try {
    const run=await runEvaluation({repositoryRoot:root,evaluationRoot:path.join(out,'evaluation'),datasetRoot:path.join(audit,'datasets',arm),request:EvaluationRunRequestSchema.parse({caseIds:[identity],candidateModel:model,safetyWallClockLimitMs:240000}),dependencies:{modelStreams:{'openai-completions':auditStreams}}});
    const evidence=await loadRunEvidence(run.runDirectory);const item=evidence.cases[0];assert.ok(item);
    const initial=readDiscoveryRecordState(item.initialState,item.result.schemaVersion);const final=readDiscoveryRecordState(item.result.finalState,item.result.schemaVersion);
    if(!initial.success||!final.success)throw new Error('Missing validated business facts');
    const previous=new Set(initial.data.recommendations.map(row=>row.id));
    const recommendations=final.data.recommendations.filter(row=>!previous.has(row.id)).sort((a,b)=>a.position-b.position);
    const gold=labels[identity];assert.ok(gold);
    const rows=recommendations.map(row=>{const id=row.candidateId.replace(/^evaluation:candidate:/,'');const grade=gold.grades[id];assert.ok(grade!==undefined,`Unlabeled recommendation ${id}`);return{id,grade,position:row.position,reason:row.recommendationReason};});
    const dcg=(grades:number[])=>grades.slice(0,gold.targetCount).reduce((sum,grade,index)=>sum+(2**grade-1)/Math.log2(index+2),0);
    const ideal=dcg(Object.values(gold.grades).sort((a,b)=>b-a));
    const measurements=item.traceMetrics;
    const issues=[...(item.traceError?[item.traceError]:[]),...measurements.flatMap(m=>m.issues.map(i=>i.code)),...measurements.filter(m=>m.retries>0).map(()=> 'retry_usage_not_fully_verifiable')];
    for(const trace of item.traces)for(const span of trace.spans)if(span.name==='model.call'&&span.outcome?.status!=='ok')issues.push('interrupted_model_usage_unknown');
    if(item.result.traceIntegrity.status!=='complete'||!measurements.length)issues.push('trace_incomplete');
    const sum=(key:'inputTokens'|'cacheReadTokens'|'cacheWriteTokens'|'outputTokens')=>measurements.reduce((total,m)=>total+m.usage[key],0);
    const related=rows.filter(row=>row.grade>0).length;
    const summary={key,phase,repetition,arm,identity,modelParameters:auditModelParameters,domain:gold.domain,poolSize:gold.poolSize,targetCount:gold.targetCount,runDirectory:run.runDirectory,
      recordStatus:item.result.recordStatus,terminalState:item.result.terminalState,productResult:item.result.productResult,
      publishedCount:rows.length,relatedCount:related,relatedRate:rows.length?related/rows.length:null,effectiveDeliveryRate:related/gold.targetCount,ndcg:ideal?dcg(rows.map(row=>row.grade))/ideal:null,
      inputNoncached:issues.length?null:sum('inputTokens'),inputCachedRead:issues.length?null:sum('cacheReadTokens'),inputCachedWrite:issues.length?null:sum('cacheWriteTokens'),
      inputTotal:issues.length?null:sum('inputTokens')+sum('cacheReadTokens')+sum('cacheWriteTokens'),outputTokens:issues.length?null:sum('outputTokens'),
      modelCalls:measurements.reduce((n,m)=>n+m.modelCalls,0),toolCalls:measurements.reduce((n,m)=>n+m.toolCalls,0),
      durationMs:Date.parse(item.result.endedAt)-Date.parse(item.result.startedAt),issues,rows};
    await writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({event:'completed',key,published:rows.length,related,ndcg:summary.ndcg,inputTotal:summary.inputTotal,modelCalls:summary.modelCalls,issues}));
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    await writeFile(path.join(out,`${key}.failure.json`),JSON.stringify({key,at:new Date().toISOString(),message},null,2),{flag:'wx'});
    throw error;
  }
}
