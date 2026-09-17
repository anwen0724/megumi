/* Completes the raw Trace audit for preference branches stored as nested artifacts. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {createTraceReader,nodeObservabilityStorage,type ObservabilityPersistenceStorage} from '@megumi/observability';
import {loadRunEvidence} from '../../../evals/agent/grading/record-evidence';
import {PreferenceSequenceRecordSchema} from '../../../evals/agent/contracts/preference-sequence-record';

const root=path.resolve('.megumi/audits/resume-metrics-20260908');
const summaries=path.join(root,'attempt-07-preference-formal');
const results:{key:string;evidenceDigest:string;interrupted:number;known:boolean;inputTotal:number|null;modelCalls:number;verifiedProviderRequests:number}[]=[];
for(const file of (await readdir(summaries)).filter(f=>f.endsWith('.json')).sort()){
  const summary=z.object({key:z.string(),runDirectory:z.string()}).parse(JSON.parse(await readFile(path.join(summaries,file),'utf8')));
  const loaded=await loadRunEvidence(summary.runDirectory),item=loaded.cases[0];assert.ok(item);
  const checkpoint=PreferenceSequenceRecordSchema.parse(item.result.ownerFacts).steps.find(s=>s.stepId==='paired-checkpoint');assert.ok(checkpoint);
  const arm=checkpoint.experiments.find(a=>a.arm==='omitted');assert.ok(arm);
  const nested=path.join(summary.runDirectory,'cases',item.result.caseRunId,'artifacts/sequence/paired-checkpoint/omitted/traces');
  const mapped=(target:string)=>{
    const relative=path.relative(nested,target);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));
    const segments=relative.split(path.sep);if(segments[0]==='traces')segments[0]='journal';return path.join(nested,...segments);
  };
  const deny=async():Promise<never>=>{throw new Error('Read-only archive');};
  const storage:ObservabilityPersistenceStorage={ensureDirectory:deny,appendText:deny,writeBytes:deny,move:deny,removeFile:deny,
    readText:f=>nodeObservabilityStorage.readText(mapped(f)),readBytes:f=>nodeObservabilityStorage.readBytes(mapped(f)),
    readBytesRange:(f,o,l)=>nodeObservabilityStorage.readBytesRange(mapped(f),o,l),listEntries:f=>nodeObservabilityStorage.listEntries(mapped(f)),stat:f=>nodeObservabilityStorage.stat(mapped(f))};
  const reader=createTraceReader({rootDirectory:nested,storage});
  let interrupted=0,input=0,modelCalls=0,known=true,requests=0;
  for(const expected of arm.traces){
    const trace=await reader.getTrace(expected.traceId),m=await reader.getTraceMeasurements(expected.traceId);assert.ok(trace&&m);
    assert.deepEqual(m,expected.measurements);
    interrupted+=trace.spans.filter(s=>s.name==='model.call'&&s.outcome?.status!=='ok').length;
    known&&=!trace.issues.length&&!m.issues.length&&!expected.issues.length;
    input+=m.usage.inputTokens+m.usage.cacheReadTokens+m.usage.cacheWriteTokens;modelCalls+=m.modelCalls;
  }
  for(const journal of await readdir(path.join(nested,'journal'))){
    if(!journal.endsWith('.jsonl'))continue;
    for(const line of (await readFile(path.join(nested,'journal',journal),'utf8')).split('\n').filter(Boolean)){
      const entry=z.object({type:z.string(),kind:z.string().optional(),content:z.unknown().optional()}).parse(JSON.parse(line));
      if(entry.type!=='content.recorded'||entry.kind!=='model.provider_request')continue;
      const content=z.object({mode:z.literal('stored'),contentId:z.string().regex(/^[a-f0-9]{64}$/)}).parse(entry.content);
      const bytes=await readFile(path.join(nested,'content/sha256',content.contentId.slice(0,2),`${content.contentId}.blob`));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),content.contentId);
      z.object({model:z.literal('deepseek-v4-flash'),thinking:z.object({type:z.literal('disabled')}),temperature:z.literal(0),max_tokens:z.literal(32768),max_completion_tokens:z.literal(32768)}).parse(JSON.parse(bytes.toString('utf8')));requests++;
    }
  }
  known&&=interrupted===0&&arm.traces.length>0&&requests>0;
  results.push({key:summary.key,evidenceDigest:item.evidenceDigest,interrupted,known,inputTotal:known?input:null,modelCalls,verifiedProviderRequests:requests});
}
assert.equal(results.length,18);
await writeFile(path.join(root,'omitted-trace-audit.json'),JSON.stringify({createdAt:new Date().toISOString(),results},null,2)+'\n',{flag:'wx'});
const base=z.object({evidence:z.array(z.object({key:z.string(),digest:z.string(),cost:z.record(z.unknown()).optional()}).passthrough())}).passthrough().parse(JSON.parse(await readFile(path.join(root,'final-metrics.json'),'utf8')));
const evidence=base.evidence.map(row=>{const supplement=results.find(r=>r.key===row.key);if(!supplement)return row;assert.equal(row.digest,supplement.evidenceDigest);return{...row,verifiedOmittedProviderRequests:supplement.verifiedProviderRequests,cost:{...row.cost,omitted:supplement}};});
await writeFile(path.join(root,'verified-metrics.json'),JSON.stringify({...base,evidence,omittedAudit:'omitted-trace-audit.json'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({branches:results.length,known:results.filter(r=>r.known).length,knownInput:results.reduce((n,r)=>n+(r.inputTotal??0),0),verifiedRequests:results.reduce((n,r)=>n+r.verifiedProviderRequests,0),unknown:results.filter(r=>!r.known)},null,2));
