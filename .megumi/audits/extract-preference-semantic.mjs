import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadRunEvidence } from '../../evals/agent/grading/record-evidence.ts';
import { comparablePreferenceArms } from '../../evals/agent/grading/preference-sequence-metrics.ts';
import { PreferenceSequenceRecordSchema } from '../../evals/agent/contracts/preference-sequence-record.ts';
const out='.megumi/audits/preference-semantic-review-2026-09-06';
await mkdir(out,{recursive:false});
const packets=[];
const baselines=[];
for(const folder of ['preference-sequence-final','preference-sequence-multi-cycle']) for(let repetition=1;repetition<=3;repetition++) {
 const summary=JSON.parse(await readFile(`.megumi/audits/${folder}/repetition-${repetition}.json`,'utf8'));
 const {run,cases}=await loadRunEvidence(summary.runDirectory);
 for(const c of cases) {
  if(c.traceError) throw new Error(c.traceError);
  const record=PreferenceSequenceRecordSchema.parse(c.result.ownerFacts);
  for(const step of record.steps.filter(s=>s.input.kind==='recommend')) {
   const learned=step.experiments.find(a=>a.arm==='learned');
   const omitted=step.experiments.find(a=>a.arm==='omitted');
   const state=learned?.initialState ?? step.initialState;
   const basis={caseId:c.snapshot.identity,revision:c.snapshot.revision,checkpoint:step.stepId,
    interests:state.interests,operations:record.steps.slice(0,record.steps.indexOf(step)).map(s=>s.input),
    feedback:state.recommendations.map(r=>({id:r.id,content:state.recommendationContents.find(x=>x.recommendationId===r.id),reaction:state.recommendationStates.find(x=>x.recommendationId===r.id)})),
    initialPreferences:c.snapshot.case.initialState.preferences,candidates:state.candidates,preferenceBeforeLearning:step.initialState.preferences};
   const packet={runId:run.runId,repetition,group:folder,caseId:c.snapshot.identity,revision:c.snapshot.revision,checkpoint:step.stepId,caseDigest:c.snapshot.digest,evidenceDigest:c.evidenceDigest,
    resultPath:path.join(summary.runDirectory,'cases',c.result.caseRunId,'result.json').replaceAll('\\','/'),comparable:!!learned&&!!omitted&&comparablePreferenceArms(learned,omitted),
    preparation:step.operationResult?.learning??null,learnedPreferences:state.preferences,learningEvidence:state.preferenceEvidence,
    arms:step.experiments.map(arm=>({arm:arm.arm,omittedIds:arm.omittedLearnedIds,
     actualPreferences:arm.inputSummary[0]?.material?.preferences,
     selected:arm.finalState.recommendations.filter(r=>!arm.initialState.recommendations.some(x=>x.id===r.id)).map(r=>({...r,content:arm.finalState.recommendationContents.find(x=>x.recommendationId===r.id)}))})),
    unpaired: !learned ? step.finalState.recommendations.filter(r=>!step.initialState.recommendations.some(x=>x.id===r.id)).map(r=>({...r,content:step.finalState.recommendationContents.find(x=>x.recommendationId===r.id)})):[]};
   packets.push(packet);
   if(repetition===1) baselines.push(basis);
  }
 }
}
await writeFile(path.join(out,'basis.json'),JSON.stringify(baselines,null,2));
await writeFile(path.join(out,'packets.json'),JSON.stringify(packets,null,2));
console.log(JSON.stringify({directory:out,checkpoints:packets.length,paired:packets.filter(p=>p.comparable).length,uniqueBasis:baselines.length}));
