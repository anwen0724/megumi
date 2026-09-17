/* Freezes paired synthetic users with feedback topics held out from recommendation topics. */
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EvaluationCaseSchema } from '../../../evals/agent/contracts/evaluation-dataset';
import { validateDatasets } from '../../../evals/agent/datasets/dataset-loader';

const root=path.resolve('.megumi/audits/resume-metrics-20260908');
const labels:Record<string,unknown>={};const ids:string[]=[];
for(const domain of ['photo','cooking','java']) {
  const original=EvaluationCaseSchema.parse(JSON.parse(await readFile(path.join(root,'datasets/layered/controlled/cases/recommendation',`resume-recommendation.${domain}-200.json`),'utf8')));
  if(original.type!=='recommendation')throw new Error('Wrong source case');
  const candidates=original.initialState.candidates;
  const topics=[...new Set(candidates.map(c=>c.title.split('：')[0]))].sort();
  const trainTopics=new Set(topics.slice(0,4));
  const training=[...trainTopics].flatMap(topic=>['操作记录','条件与原理'].map(style=>{
    const selected=candidates.find(c=>c.title.startsWith(`${topic}：`)&&c.title.endsWith(style));assert.ok(selected);return selected;
  }));
  const test=candidates.filter(c=>!trainTopics.has(c.title.split('：')[0])&&(c.title.endsWith('操作记录')||c.title.endsWith('条件与原理')));
  const neutral=candidates.filter(c=>!trainTopics.has(c.title.split('：')[0])&&c.title.endsWith('概念速览')).slice(0,12);
  const available=[...test,...neutral].sort((a,b)=>a.referenceId.localeCompare(b.referenceId));
  assert.equal(training.length,8);assert.equal(available.length,60);
  assert.equal(new Set([...training,...available].map(c=>c.referenceId)).size,68);
  for(const [user,preferred] of [['u1','操作记录'],['u2','条件与原理']] as const) {
    const caseId=`resume-preference.${domain}-${user}`;ids.push(caseId);
    const recommendations=training.map((candidate,index)=>({referenceId:`history-${index}`,candidateReferenceId:candidate.referenceId,reason:'来自此前的内容推荐',reaction:'none' as const,reactionRevision:0,learnedReaction:'none' as const,learnedReactionRevision:0}));
    const value=EvaluationCaseSchema.parse({schemaVersion:2,caseId,revision:1,name:`${domain}-${user}`,description:'Paired recommendation after balanced historical feedback with held-out topics.',metadata:{source:'Synthetic paired user; latent scoring rule withheld',tags:['resume-audit']},type:'preference_sequence',
      initialState:{clock:'2026-09-08T08:00:00.000Z',interests:original.initialState.interests,candidates:[...training,...available],recommendations,preferences:[],recommendationTargetCount:5,recommendationWorkingSetCount:80},
      input:{steps:[...training.map((candidate,index)=>({stepId:`feedback-${index}`,kind:'feedback',recommendationReferenceId:`history-${index}`,reaction:candidate.title.endsWith(preferred)?'liked':'disliked'})),{stepId:'paired-checkpoint',kind:'recommend',paired:true}]},expected:{checkpoints:{'paired-checkpoint':{publicationIntegrityRequired:true}}}});
    const dir=path.join(root,'datasets/preference/controlled/cases/preference-sequence');await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,`${caseId}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    labels[`controlled/${caseId}`]={domain,user,preferred,targetCount:5,trainingTopics:[...trainTopics],testTopics:topics.filter(t=>!trainTopics.has(t)),
      grades:Object.fromEntries(available.map(c=>[c.referenceId,c.title.endsWith(preferred)?2:c.title.endsWith('概念速览')?1:0])),
      rubric:'Synthetic latent preference: preferred format=2, neutral overview=1, consistently disliked format=0. Feedback balanced across training topics; this does not claim real-user preferences.'};
  }
}
const manifest=path.join(root,'datasets/preference/controlled/manifests');await mkdir(manifest,{recursive:true});
await writeFile(path.join(manifest,'resume-preference.json'),JSON.stringify({schemaVersion:1,environmentKind:'controlled',datasetId:'resume-preference',revision:1,name:'Resume preference audit',description:'Held-out synthetic preference contribution cases',caseIds:ids},null,2)+'\n',{flag:'wx'});
await writeFile(path.join(root,'preference-labels.json'),JSON.stringify(labels,null,2)+'\n',{flag:'wx'});
console.log(await validateDatasets({rootDirectory:path.join(root,'datasets/preference')}));
