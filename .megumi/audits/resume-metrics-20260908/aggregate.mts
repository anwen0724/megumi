/* Independently audits sealed runs and produces derived metrics; never rewrites source evidence. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {loadRunEvidence} from '../../../evals/agent/grading/record-evidence';
import {readDiscoveryRecordState} from '../../../evals/agent/grading/discovery-record-state';
import {PreferenceSequenceRecordSchema} from '../../../evals/agent/contracts/preference-sequence-record';
import {comparablePreferenceArms} from '../../../evals/agent/grading/preference-sequence-metrics';
import {auditModelParameters} from './model-configuration.mts';

const root=path.resolve('.megumi/audits/resume-metrics-20260908');
const mode=z.enum(['partial','final']).parse(process.argv[2]);
const json=async(file:string):Promise<unknown>=>JSON.parse(await readFile(file,'utf8'));
const scoreRow=z.object({id:z.string(),grade:z.number().int().min(0).max(2)});
const common={key:z.string(),identity:z.string(),repetition:z.number().int(),domain:z.string(),runDirectory:z.string(),modelParameters:z.unknown(),issues:z.array(z.unknown())};
const aSchema=z.object({...common,arm:z.enum(['layered','full']),poolSize:z.number(),targetCount:z.number(),publishedCount:z.number(),relatedCount:z.number(),ndcg:z.number().nullable(),inputTotal:z.number().nullable(),modelCalls:z.number(),rows:z.array(scoreRow)});
const bSchema=z.object({...common,comparable:z.boolean(),targetCount:z.number(),arms:z.array(z.object({arm:z.enum(['learned','omitted']),status:z.string(),publishedCount:z.number(),ndcg:z.number().nullable(),omittedLearnedIds:z.array(z.string()),rows:z.array(scoreRow)}))});
const labelSchema=z.record(z.object({targetCount:z.number(),grades:z.record(z.number().int().min(0).max(2))}));
const aLabelsRaw=await json(path.join(root,'recommendation-labels.json'));
const aLabels=labelSchema.parse(aLabelsRaw),bLabels=labelSchema.parse(await json(path.join(root,'preference-labels.json')));
const frozen=z.object({labelDigest:z.string()}).parse(await json(path.join(root,'corpus-freeze.json')));
assert.equal(createHash('sha256').update(JSON.stringify(aLabelsRaw)).digest('hex'),frozen.labelDigest);
const files=async(dir:string)=>(await readdir(path.join(root,dir))).filter(f=>f.endsWith('.json')&&!f.endsWith('.failure.json')).sort().map(f=>path.join(root,dir,f));
const a=await Promise.all((await files('attempt-05-formal')).map(async f=>aSchema.parse(await json(f))));
const b=await Promise.all((await files('attempt-07-preference-formal')).map(async f=>bSchema.parse(await json(f))));
assert.equal(new Set(a.map(x=>x.key)).size,a.length);assert.equal(new Set(b.map(x=>x.key)).size,b.length);
if(mode==='final'){
  const expectedA=Object.keys(aLabels).flatMap(id=>[1,2].flatMap(rep=>['layered','full'].map(arm=>`${id.replace('controlled/','')}.r${rep}.${arm}`)));
  const expectedB=Object.keys(bLabels).flatMap(id=>[1,2,3].map(rep=>`${id.replace('controlled/','')}.r${rep}`));
  assert.deepEqual(a.map(r=>r.key).sort(),expectedA.sort());assert.deepEqual(b.map(r=>r.key).sort(),expectedB.sort());
}
for(const id of Object.keys(aLabels)){
  const schema=z.object({initialState:z.object({recommendationWorkingSetCount:z.number()}).passthrough()}).passthrough();
  const left=schema.parse(await json(path.join(root,'datasets/layered/controlled/cases/recommendation',`${id.replace('controlled/','')}.json`)));
  const right=schema.parse(await json(path.join(root,'datasets/full/controlled/cases/recommendation',`${id.replace('controlled/','')}.json`)));
  left.initialState.recommendationWorkingSetCount=right.initialState.recommendationWorkingSetCount=0;assert.deepEqual(left,right);
}

// Independent arithmetic: rank 1 is undiscounted, absent results contribute zero.
const ndcg=(grades:number[],allGrades:number[],k:number)=>{
  const weights=Array.from({length:k},(_,i)=>1/Math.log2(i+2));
  const gain=(values:number[])=>weights.reduce((sum,w,i)=>sum+w*(2**(values[i]??0)-1),0);
  return gain(grades)/gain([...allGrades].sort((x,y)=>y-x));
};
assert.equal(ndcg([2,2],[2,2],2),1);assert.equal(ndcg([0,0],[2,2],2),0);
assert.ok(Math.abs(ndcg([0,2],[2,0],2)-1/Math.log2(3))<1e-12);
const close=(x:number|null,y:number)=>assert.ok(x!==null&&Math.abs(x-y)<1e-10,`${x} != ${y}`);
const sum=(xs:number[])=>xs.reduce((x,y)=>x+y,0);
const mean=(xs:number[])=>xs.length?sum(xs)/xs.length:null;
const evidence:Record<string,unknown>[]=[];
const badCosts=new Set<string>();
const providerRequest=z.object({model:z.literal('deepseek-v4-flash'),thinking:z.object({type:z.literal('disabled')}),temperature:z.literal(0),max_tokens:z.literal(32768),max_completion_tokens:z.literal(32768)});
async function auditRequests(runDirectory:string,caseRunId:string){
  const traceRoot=path.join(runDirectory,'cases',caseRunId,'traces');let count=0;
  for(const file of await readdir(path.join(traceRoot,'journal'))){
    if(!file.endsWith('.jsonl'))continue;
    for(const line of (await readFile(path.join(traceRoot,'journal',file),'utf8')).split('\n').filter(Boolean)){
      const entry=z.object({type:z.string(),kind:z.string().optional(),content:z.unknown().optional()}).parse(JSON.parse(line));
      if(entry.type!=='content.recorded'||entry.kind!=='model.provider_request')continue;
      const content=z.object({mode:z.literal('stored'),contentId:z.string().regex(/^[a-f0-9]{64}$/)}).parse(entry.content);
      const bytes=await readFile(path.join(traceRoot,'content','sha256',content.contentId.slice(0,2),`${content.contentId}.blob`));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),content.contentId);
      providerRequest.parse(JSON.parse(bytes.toString('utf8')));count++;
    }
  }
  assert.ok(count>0);return count;
}
for(const row of a){
  assert.deepEqual(row.modelParameters,auditModelParameters);
  const gold=aLabels[row.identity];assert.ok(gold);
  assert.equal(new Set(row.rows.map(r=>r.id)).size,row.rows.length);
  for(const item of row.rows)assert.equal(item.grade,gold.grades[item.id]);
  close(row.ndcg,ndcg(row.rows.map(r=>r.grade),Object.values(gold.grades),gold.targetCount));
  assert.equal(row.publishedCount,row.rows.length);assert.equal(row.relatedCount,row.rows.filter(r=>r.grade>0).length);
  const loaded=await loadRunEvidence(row.runDirectory);const item=loaded.cases[0];assert.ok(item);
  assert.equal(item.snapshot.identity,row.identity);assert.equal(item.result.recordStatus,'recorded');
  assert.equal(loaded.run.status,'completed');
  const cleanup=z.object({status:z.string()}).parse(await json(path.join(row.runDirectory,'cases',item.result.caseRunId,'cleanup.json')));
  assert.deepEqual(item.snapshot.case,await json(path.join(root,'datasets',row.arm,'controlled/cases/recommendation',`${row.identity.replace('controlled/','')}.json`)));
  const requests=await auditRequests(row.runDirectory,item.result.caseRunId);
  const before=readDiscoveryRecordState(item.initialState,item.result.schemaVersion),after=readDiscoveryRecordState(item.result.finalState,item.result.schemaVersion);
  assert.ok(before.success&&after.success);
  const old=new Set(before.data.recommendations.map(r=>r.id));
  const ids=after.data.recommendations.filter(r=>!old.has(r.id)).sort((x,y)=>x.position-y.position).map(r=>r.candidateId.replace(/^evaluation:candidate:/,''));
  assert.deepEqual(ids,row.rows.map(r=>r.id));
  const interrupted=item.traces.flatMap(t=>t.spans).filter(s=>s.name==='model.call'&&s.outcome?.status!=='ok').length;
  const valid=!item.traceError&&item.result.traceIntegrity.status==='complete'&&item.traceMetrics.length>0&&!interrupted&&!row.issues.length;
  if(valid){const actual=sum(item.traceMetrics.map(m=>m.usage.inputTokens+m.usage.cacheReadTokens+m.usage.cacheWriteTokens));assert.equal(row.inputTotal,actual);}
  else {badCosts.add(row.key);assert.equal(row.inputTotal,null);}
  const product=z.object({completion:z.object({status:z.string()})}).parse(item.result.productResult);
  evidence.push({key:row.key,digest:item.evidenceDigest,inputComparable:true,publication:product.completion.status,traceIntegrity:item.result.traceIntegrity.status,interrupted,costVerified:valid,verifiedProviderRequests:requests,cleanup:cleanup.status});
}
for(const row of b){
  assert.deepEqual(row.modelParameters,auditModelParameters);
  const loaded=await loadRunEvidence(row.runDirectory);const item=loaded.cases[0];assert.ok(item);
  assert.equal(item.snapshot.identity,row.identity);
  assert.equal(loaded.run.status,'completed');
  const cleanup=z.object({status:z.string()}).parse(await json(path.join(row.runDirectory,'cases',item.result.caseRunId,'cleanup.json')));
  assert.deepEqual(item.snapshot.case,await json(path.join(root,'datasets/preference/controlled/cases/preference-sequence',`${row.identity.replace('controlled/','')}.json`)));
  const requests=await auditRequests(row.runDirectory,item.result.caseRunId);
  const sequence=PreferenceSequenceRecordSchema.parse(item.result.ownerFacts);
  const checkpoint=sequence.steps.find(s=>s.stepId==='paired-checkpoint');assert.ok(checkpoint);
  const left=checkpoint.experiments.find(x=>x.arm==='learned'),right=checkpoint.experiments.find(x=>x.arm==='omitted');assert.ok(left&&right);
  assert.equal(row.comparable,comparablePreferenceArms(left,right));
  for(const arm of row.arms){
    const source:z.infer<typeof PreferenceSequenceRecordSchema>['steps'][number]['experiments'][number]=arm.arm==='learned'?left:right;
    const gold=bLabels[row.identity];assert.ok(gold);
    const old=new Set(source.initialState.recommendations.map(r=>r.id));
    const ids=source.finalState.recommendations.filter(r=>!old.has(r.id)).sort((x,y)=>x.position-y.position).map(r=>r.candidateId.replace(/^evaluation:candidate:/,''));
    assert.deepEqual(ids,arm.rows.map(r=>r.id));assert.deepEqual(arm.omittedLearnedIds,source.omittedLearnedIds);
    assert.equal(new Set(ids).size,ids.length);
    for(const r of arm.rows)assert.equal(r.grade,gold.grades[r.id]);
    close(arm.ndcg,ndcg(arm.rows.map(r=>r.grade),Object.values(gold.grades),gold.targetCount));
  }
  const cost=(traces:typeof checkpoint.traces)=>{
    const known=traces.every(t=>t.measurements&&!t.issues.length&&item.traces.some(actual=>actual.traceId===t.traceId&&actual.spans.filter(s=>s.name==='model.call').every(s=>s.outcome?.status==='ok')));
    const measurements=traces.flatMap(t=>t.measurements?[t.measurements]:[]);
    return{known,inputTotal:known?sum(measurements.map(m=>m.usage.inputTokens+m.usage.cacheReadTokens+m.usage.cacheWriteTokens)):null,modelCalls:sum(measurements.map(m=>m.modelCalls))};
  };
  evidence.push({key:row.key,digest:item.evidenceDigest,comparable:row.comparable,traceIntegrity:item.result.traceIntegrity.status,verifiedProviderRequests:requests,cleanup:cleanup.status,cost:{sharedLearning:cost(checkpoint.traces.filter(t=>t.kind==='preference_learning')),learned:cost(left.traces),omitted:cost(right.traces)}});
}
type A=z.infer<typeof aSchema>;
const pairKeys=[...new Set(a.map(r=>`${r.identity}.r${r.repetition}`))];
const pairs=pairKeys.flatMap(key=>{
  const sides=a.filter(r=>`${r.identity}.r${r.repetition}`===key),layered=sides.find(r=>r.arm==='layered'),full=sides.find(r=>r.arm==='full');
  if(!layered||!full)return[];
  const costComparable=layered.inputTotal!==null&&full.inputTotal!==null&&layered.publishedCount===layered.targetCount&&full.publishedCount===full.targetCount&&!badCosts.has(layered.key)&&!badCosts.has(full.key);
  return[{key,poolSize:layered.poolSize,domain:layered.domain,repetition:layered.repetition,costComparable,layered,full}];
});
const stats=(rows:A[])=>({tasks:rows.length,published:sum(rows.map(r=>r.publishedCount)),target:sum(rows.map(r=>r.targetCount)),related:sum(rows.map(r=>r.relatedCount)),ndcg:mean(rows.flatMap(r=>r.ndcg===null?[]:[r.ndcg])),stronglyRelated:sum(rows.map(r=>r.rows.filter(v=>v.grade===2).length)),completeTasks:rows.filter(r=>r.publishedCount===r.targetCount).length});
const byPool=[80,120,200].map(poolSize=>{
  const group=pairs.filter(p=>p.poolSize===poolSize),valid=group.filter(p=>p.costComparable);
  const totals=(side:'layered'|'full')=>sum(valid.map(p=>p[side].inputTotal??0));
  return{poolSize,pairs:group.length,costPairs:valid.length,layeredInput:totals('layered'),fullInput:totals('full'),inputReduction:valid.length?1-totals('layered')/totals('full'):null,layered:stats(group.map(p=>p.layered)),full:stats(group.map(p=>p.full))};
});
const main=pairs.filter(p=>p.poolSize>80),mainValid=main.filter(p=>p.costComparable);
const mainLayered=sum(mainValid.map(p=>p.layered.inputTotal??0)),mainFull=sum(mainValid.map(p=>p.full.inputTotal??0));
const bPairs=b.map(row=>{const learned=row.arms.find(a=>a.arm==='learned'),omitted=row.arms.find(a=>a.arm==='omitted');assert.ok(learned&&omitted);return{key:row.key,comparable:row.comparable,effectivePreferences:omitted.omittedLearnedIds.length,learned:learned.ndcg,omitted:omitted.ndcg,sameOrder:JSON.stringify(learned.rows.map(r=>r.id))===JSON.stringify(omitted.rows.map(r=>r.id)),sameSet:[...learned.rows.map(r=>r.id)].sort().join(',')===[...omitted.rows.map(r=>r.id)].sort().join(',')};});
const output={createdAt:new Date().toISOString(),mode,modelParameters:auditModelParameters,counts:{a:a.length,b:b.length},byPool,
  recommendation:{pairs:main.length,costPairs:mainValid.length,excludedCostPairs:main.filter(p=>!p.costComparable).map(p=>p.key),layeredInput:mainLayered,fullInput:mainFull,inputReduction:mainValid.length?1-mainLayered/mainFull:null,layered:stats(main.map(p=>p.layered)),full:stats(main.map(p=>p.full)),pairedInputReductions:mainValid.map(p=>({key:p.key,value:1-(p.layered.inputTotal??0)/(p.full.inputTotal??1)}))},
  preference:{pairs:bPairs.length,comparable:bPairs.filter(p=>p.comparable).length,effectivePairs:bPairs.filter(p=>p.effectivePreferences>0).length,learnedNdcg:mean(bPairs.flatMap(p=>p.learned===null?[]:[p.learned])),omittedNdcg:mean(bPairs.flatMap(p=>p.omitted===null?[]:[p.omitted])),sameOrder:bPairs.filter(p=>p.sameOrder).length,sameSet:bPairs.filter(p=>p.sameSet).length,rows:bPairs},evidence};
if(mode==='final')await writeFile(path.join(root,'final-metrics.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...output,evidence:output.evidence.length},null,2));
