from pathlib import Path
import json, hashlib, collections
root=Path('.megumi/audits/preference-semantic-review-2026-09-06')
packets=json.loads((root/'packets.json').read_text(encoding='utf-8'))
rubric=json.loads((root/'rubric.json').read_text(encoding='utf-8'))
# Findings are explicit AI judgments made after reading each original reason; no text matcher grades semantics.
findings={
 (0,'learned'):[('source_identity','coming from a new source (Open Web)','既往和当前内容的 sourceId 均为 open_web；展示名 Controlled Web/Open Web 不足以证明引入新来源。')],
 (1,'omitted'):[('user_identity','Megumi 的家常菜兴趣','把产品名称当作用户名称，并使用“她”；样本没有给出用户姓名或性别。')],
 (2,'learned'):[('unsupported_preference_detail','成功案例对照','学习陈述增加“成功案例”，但其支持材料仅提供失败原因、步骤及对照结果，未说明成功案例。')],
 (7,'omitted'):[('source_identity','尚未推荐过的 Open Web','既往和当前 sourceId 相同，不能把来源显示名差异当作新来源。')],
 (12,'omitted'):[('candidate_misstatement','其他候选仅罗列结论','只有 cooking-5 只有结论；cooking-6 提供条件调整方法和对照示例，不能将所有其它选项一概描述为仅有结论。')],
 (13,'learned'):[('invented_feedback','您不喜欢的有结论无步骤的热门清单风格','用户踩的是 r3 的器材宣传/购买链接，并未对 cooking-5 热门清单表达不喜欢；不能替用户补写反馈。')],
 (16,'learned'):[('source_identity','来自新的来源（Open Web）','既往和当前 sourceId 相同，来源显示名不一致不能证明来源新颖。')],
 (17,'omitted'):[('invented_reading','此前已读的 Controlled Web 教程','数据只记录推荐及 reaction，没有已读/打开事实可支持这个陈述。')],
 (18,'omitted'):[('source_identity','引入新的 Open Web 来源','既往和当前 sourceId 均为 open_web。')],
 (20,'learned'):[('source_identity','来源（Open Web）与近期推荐不同','源标识相同，仅 sourceName 不同。')],
 (21,'learned'):[('invented_feedback','你此前喜欢的热门清单','当前正向反馈是 r1/r2 步骤与对照内容；未给热门清单点赞，r3 也无 reaction。')],
 (21,'omitted'):[('source_identity','来源为Open Web，与此前Controlled Web的推荐不重复','内容不重复可由身份验证，但以来源显示名对比暗示来源变化缺乏支持。')],
 (22,'omitted'):[('source_identity','与近期已推荐内容来源不同','源标识相同，无法支持不同来源的陈述。')],
 (27,'learned'):[('source_identity','此前从未推荐过的来源','所有历史内容仍属于 open_web。')],
 (27,'omitted'):[('source_identity','尚未出现过的 Open Web 来源','所有历史内容仍属于 open_web。')],
 (28,'learned'):[('source_identity','新的 Open Web 来源','所有历史内容仍属于 open_web。')],
 (32,'unpaired'):[('source_identity','与近期推荐不同的来源（Open Web）','所有历史内容仍属于 open_web。')],
 (33,'learned'):[('invented_reading','此前对摄影教程内容的阅读','有推荐与点赞事实，但没有阅读完成或打开事实；不应把推荐记录说成已读。')],
}
learning_findings={
 (2,'cooking-depth'):'“成功案例”没有直接材料支持；且只采用 r2，未在推断中明确交代 r1 反转后的不确定性。步骤/具体细节有依据，新增成功限定需核验。',
 (12,'cooking-depth'):'偏好聚焦失败原因和步骤有 r2 支持，但反例解释断言 r1 缺少实际对照结果；简短摘要没有提及不等于全文不存在。反馈原因也未经用户明确说明。',
 (13,'4ff10e81-18e8-4776-8409-dfc2b1bc1aa5'):'“有测量依据”强于原文的固定条件对比/参数关系；材料没有给出测量记录。解释把合理假设写成了已确认的内容事实。',
}
consistent=set(rubric['candidate_rubrics']['consistent_procedural_feedback']['cases'])
reviews=[]
for i,p in enumerate(packets):
 case=p['caseId'].split('.')[-1]
 policy='feedback_inference' if case in consistent else 'explicit_requirement' if case=='photo-user-edit' else 'insufficient_preference_evidence'
 def assess(arm,selected):
  rows=[]
  for item in selected:
   suffix=item['candidateId'].split('-')[-1]
   if case in consistent:
    rating='supported_under_feedback_inference' if suffix in ['4','6'] else 'not_supported_under_feedback_inference'
    why='内容提供步骤/失败排查或条件调整/对照，与当前正向反馈的可观察特征相近。仅为按反馈作出的AI推测，不是用户确认的偏好。'
   elif case=='photo-user-edit':
    rating='supported_by_explicit_requirement' if suffix=='4' else 'unknown'
    why='4明确提供常见工具练习与步骤，直接对应用户的优先条件；不将偶尔可看器材理解为禁令。' if suffix=='4' else '其它材料没有说明工具门槛，无法确认是否满足明确优先条件。'
   else:
    rating='partial_or_unknown'
    why=rubric['candidate_rubrics'][case]['basis']
   issues=[{'code':code,'quote':quote,'reason':reason} for code,quote,reason in findings.get((i,arm),[])]
   for issue in issues: assert issue['quote'] in item['recommendationReason'],(i,arm,issue)
   rows.append({'recommendationId':item['id'],'candidateId':item['candidateId'],'content':item['content'],
    'recommendationReason':item['recommendationReason'],'preferenceFit':rating,'rationale':why,
    'reasonReview':{'status':'findings' if issues else 'no_specific_issue_identified','issues':issues}})
  return rows
 activeids=set(x for a in p['arms'] if a['arm']=='omitted' for x in a['omittedIds'])
 preferences=[]
 for pref in p['learnedPreferences']:
  if pref['id'] not in activeids:continue
  finding=learning_findings.get((i,pref['id']))
  preferences.append({'preferenceId':pref['id'],'statement':pref['statement'],
   'status':'needs_review' if finding else 'plausible_not_user_confirmed',
   'rationale':finding or '当前正向/反向反馈及引用内容为这一限定于当前兴趣的推断提供一定支持；原文与依据可追溯，但真实用户动机和长期稳定性未经确认。',
   'evidence':[e for e in p['learningEvidence'] if e['preferenceId']==pref['id']]})
 shared_notes=[]
 if case in ['cooking-delete-new-evidence','photo-delete-old-evidence']:
  shared_notes.append('被删除条目保持 deleted，本次未重新生成；删除后的内容仍可因原兴趣/原反馈被推荐，不将同主题内容视为被禁止。')
 if case=='cooking-delete-new-evidence':shared_notes.append('新增 r3 是器材宣传的正向反馈，与原步骤/对照偏好无直接关系；该 Case 不能证明“新相关证据可支持重学”的正向分支。')
 if case=='photo-last-support':shared_notes.append('虽然移除了原条目唯一直接引用 r1，但 r2 仍为 liked 且有步骤/对照内容；不是所有潜在支持都已消失。不能按 Case 名称推断应无偏好。')
 if case=='photo-user-edit':shared_notes.append('用户原话在两组中均保留，且两组都选4；这验证明确要求遵循，不验证自动学习增量收益。')
 if case=='photo-accumulation':shared_notes.append('本轮未形成自动偏好；只能确认反馈保存/历史复用和推荐完成，不能证明已完成有价值的偏好归纳。')
 if p['preparation'] and p['preparation']['status']=='degraded':shared_notes.append('保留真实降级；待核验偏好未供两组使用，不将无输出当成学习正确。')
 reviews.append({'packetIndex':i,**{k:p[k] for k in ['runId','repetition','group','caseId','revision','checkpoint','caseDigest','evidenceDigest','resultPath','comparable']},
  'ratingBasis':policy,'effectiveAutoPreferenceIds':sorted(activeids),'learningReview':preferences,'sharedNotes':shared_notes,
  'arms':[{'arm':a['arm'],'items':assess(a['arm'],a['selected'])} for a in p['arms']],
  'unpaired':assess('unpaired',p['unpaired'])})
summaries=[]
for group in ['preference-sequence-final','preference-sequence-multi-cycle']:
 rows=[r for r in reviews if r['group']==group and r['comparable']]
 fit={}
 for arm in ['learned','omitted']:
  items=[x for r in rows for a in r['arms'] if a['arm']==arm for x in a['items']]
  counts=collections.Counter(x['preferenceFit'] for x in items)
  fit[arm]={'total':len(items),'supported_under_declared_ai_rubric':sum(v for k,v in counts.items() if k.startswith('supported_')),
   'not_supported_under_declared_ai_rubric':sum(v for k,v in counts.items() if k.startswith('not_supported_')),
   'partial_or_unknown':counts['partial_or_unknown']+counts['unknown'],
   'reason_findings':sum(bool(x['reasonReview']['issues']) for x in items)}
 equal=lambda r:[x['candidateId'] for x in r['arms'][0]['items']]==[x['candidateId'] for x in r['arms'][1]['items']]
 exposed=[r for r in rows if r['effectiveAutoPreferenceIds']]
 summary={'group':group,'pairs':len(rows),'exposed_pairs':len(exposed),'zero_exposure_pairs':len(rows)-len(exposed),
  'same_selection':sum(map(equal,rows)),'changed_with_exposure':sum(not equal(r) for r in exposed),
  'changed_without_exposure':sum(not equal(r) for r in rows if not r['effectiveAutoPreferenceIds']),
  'fit':fit,'learning_statements':sum(len(r['learningReview']) for r in rows),
  'learning_needs_review':sum(p['status']=='needs_review' for r in rows for p in r['learningReview'])}
 summaries.append(summary)
review={'schemaVersion':1,'status':'ai_assessed_human_pending','reviewer':rubric['reviewer'],
 'rubricSha256':hashlib.sha256((root/'rubric.json').read_bytes()).hexdigest(),
 'packetsSha256':hashlib.sha256((root/'packets.json').read_bytes()).hexdigest(),
 'officialHumanReviewUpdated':False,'summary':summaries,'entries':reviews}
(root/'ai-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summaries,ensure_ascii=False))
