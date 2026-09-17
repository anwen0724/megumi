from pathlib import Path
import json,collections
root=Path('.megumi/audits/preference-semantic-review-2026-09-06')
r=json.loads((root/'ai-review.json').read_text(encoding='utf-8'))
main=[e for e in r['entries'] if e['group']=='preference-sequence-final']
case_rows=[]
for case in dict.fromkeys(e['caseId'] for e in main):
 rows=[e for e in main if e['caseId']==case]
 choice=lambda arm:' / '.join(','.join(i['candidateId'].rsplit('-',1)[-1] for a in e['arms'] if a['arm']==arm for i in a['items']) for e in rows)
 outcomes=[i['preferenceFit'] for e in rows for a in e['arms'] for i in a['items']]
 label='材料不足，保留不确定' if any(x in ['partial_or_unknown','unknown'] for x in outcomes) else '两组均有据符合（AI推定）'
 if case.endswith('photo-user-edit'):label='两组均满足明确的常见工具优先要求'
 case_rows.append('| '+case.split('.')[-1]+' | '+str(sum(bool(e['effectiveAutoPreferenceIds']) for e in rows))+'/3 | '+choice('learned')+' | '+choice('omitted')+' | '+label+' |')
issues=[]
for e in r['entries']:
 for a in e['arms']+[{'arm':'unpaired','items':e['unpaired']}]:
  for item in a['items']:
   for finding in item['reasonReview']['issues']:
    target='../../'+str(Path(e['resultPath']).relative_to(Path.cwd())).replace('\\','/')
    issues.append(f"| {e['caseId'].split('.')[-1]} / R{e['repetition']} / {a['arm']} | {finding['quote']} | {finding['reason']} | [记录]({target}) |")
report='''# 偏好学习语义预评审与简历数据结论

日期：2026-09-06。评审者：Codex（AI）；不是用户标注，也不是独立人工评审。

## 结论

**现有封存样本没有提供“加入自动偏好后，推荐更符合用户取舍”的提升证据。目前不应在简历中填写推荐符合度提升百分比。**

已经完成对 30 组主对照、3 组跨两轮补充对照以及 3 条首轮单组推荐的逐条阅读，共 69 条推荐理由；同时检查主对照实际输入中的 14 个自动偏好实例。重复运行同一偏好按实例保留，不称为 14 个独立偏好。

这次仅使用已封存结果，没有重新调用候选模型、修改产品代码或改写旧记录。正式人工评审仍为 needs_review；本次 AI 判断另存，不能导入 human 指标冒充人工结论。

## 范围与判断方法

1. 从原始兴趣、用户编辑/删除、当前反馈以及内容材料确定评价依据，不用系统生成的偏好或推荐理由反过来定义正确答案。
2. 显式要求可以直接核对；点赞/点踩只支持有限推测，不证明用户为什么评价内容，也不证明长期稳定偏好。
3. 推荐符合度区分“有据符合”“部分或不确定”“有据不符合”。不确定不补成通过或失败，空自动偏好不算学习质量满分。
4. 两组均保留原始反馈和用户要求，仅省略自动偏好。这里检验的是显式学习结果的额外贡献，不是全部个性化能力与无个性化的差异。
5. 主分析固定为修正后三轮、十个 revision=1 Case；revision=2 的跨两次推荐单列，保留全部样本。单轮不同选择不被直接归因为学习有效。

先读取原始材料制定了 [本次评审标准](../../.megumi/audits/preference-semantic-review-2026-09-06/rubric.json)，再检查所有输出。本评审非盲审、非独立评审，反馈推断的标准也未经真实用户验证，因此数字仅用于诊断。

## 实际对照结果

| 检查项 | 主对照结果 |
| --- | ---: |
| 成对输入可比 | 30/30 |
| 实际存在有效自动偏好的组 | 13/30 |
| 没有有效自动偏好的组 | 17/30 |
| 两组选择同一内容 | 23/30 |
| 有自动偏好时两组选择不同 | 6/13 |
| 无自动偏好时两组仍选择不同 | 1/17 |

无自动偏好的 17 组包含删除、明确用户要求、未形成结论和降级等情形，很多属于正确的保护行为。这些组可以验证控制机制，但不能作为自动学习带来收益的证据。其中一组在没有自动偏好差异时仍选出不同内容，也提醒我们不能将一次不同选择直接归因为学习。

依据原始反馈内容，可对 15 组作“步骤/失败排查或条件调整/对照”这一层面的推定判断；另外 3 组有“优先常见工具练习”的明确要求。这 18 组中两组各有 18 条符合本次标准，未观察到符合度差异。另外 12 组因删除后的取舍不明、反馈反转原因不明、或低成本/替代食材证据不足而保留不确定。

**不能把这写成准确率 100%，也不能把 18/30 写成准确率 60%。**前者掩盖不确定样本，后者把不确定当作错误。这一标准只能检验粗略内容特征，不能证明真实用户满意度。实际有自动偏好且能按材料推定判断的 8 组，两组也均符合，未显示可辨别的额外收益。

可选内容几乎固定为三条：4 是“常见工具练习、步骤与失败排查”；5 是“热门清单、只有结论无步骤”；6 是“不同条件的调整方法与对照示例”。两个领域复用相同内容模板，通常都容易选到 4 或 6，难以体现细粒度个性化。

| 场景 | 有自动偏好 | 使用偏好的选择 R1/R2/R3 | 省略偏好的选择 R1/R2/R3 | 语义判断 |
| --- | ---: | --- | --- | --- |
'''+ '\n'.join(case_rows)+'''

编号 4/5/6 只对应各场景自己的候选，原始完整 ID 与正文见逐条 JSON。跨两轮补充的 3 组都没有有效自动偏好，两组都选择 6；第一轮均选择 4。它们验证了连续执行及历史反馈可复用，但未展示“反馈累积后形成新偏好并改善推荐”。

## 学习结果本身

实际输入包含 14 个自动偏好实例，其中 12 个是对预置偏好的保留/修订，2 个是在同一次“相反反馈”运行中新增。不能把 27/30 次准备正常完成解释为 27 次形成有价值的新偏好：unchanged 同样属于正常完成。

14 个实例中，11 个能从当前材料找到合理但尚未经用户确认的推断依据；另外 3 个需复核：

- 反馈反转 R1 的偏好增加“成功案例”，支持材料只有失败原因、步骤和对照结果，并未说明成功案例。
- 反馈反转 R2 的反例解释声称旧内容“缺少实际对照结果”。简短摘要没提及，不等于内容中没有；点踩原因也未经用户说明。
- 相反反馈 R2 把“固定条件对比、参数与结果关系”提升为“有测量依据”，原材料没有测量数据，解释的确定性过强。

其余合理推断也不是已验证的稳定用户画像。零散反馈场景没有新增偏好不必然是错误，但它不能被用来展示学习收益。

## 样本设计缺口

- `cooking-delete-new-evidence` 的新反馈喜欢的是器材宣传，旧删除偏好是步骤/对照。新反馈与旧判断无关；不恢复旧偏好是合理结果。该样本没有验证“新增相关证据支持重新学习”的正向分支。
- `photo-last-support` 仅移除了偏好原来的唯一直接引用 r1；r2 仍为 liked 且包含步骤/对照。因此它不等于“所有潜在支持均已消失”，不能按名称直接要求最终无偏好。
- 更新兴趣后的“低成本、替代食材”缺少对应内容事实；不能用“常见工具”推定菜品成本或存在替代食材。
- 主对照大多只生成一条推荐，且候选描述只有一句话；两个领域的材料高度重复，没有真实用户对候选的独立偏好标注。

## 推荐理由的问题

逐条阅读发现主对照两组各 8 条理由有具体事实或表述问题，共 16/60 条；补充样本另有 2/9 条。该数量是本次 AI 指出的待核验项，不是经过人工确认的错误率，也不是一套穷尽所有问题的评分。

最直接的两例：

- 相反反馈 R2 说用户“不喜欢有结论无步骤的热门清单”，但用户实际点踩的是器材宣传/购买链接。
- 兴趣描述更新 R3 说“你此前喜欢的热门清单”，但实际正向反馈是步骤/对照内容，热门清单没有点赞记录。

还有多条理由把 Controlled Web 与 Open Web 的显示名差异称为“新来源”；原始 sourceId 都是 open_web，域名也一致。这里既有模型断言问题，也有测试数据来源命名不一致的问题，不宜直接外推真实平台的错误率。

| 样本与组 | 原文片段 | 核对结果 | 原始证据 |
| --- | --- | --- | --- |
'''+ '\n'.join(issues)+'''

## 简历如何处理

首句继续保留用户确认的“针对兴趣描述难以表达用户细粒度内容取舍的问题”。后文可以描述已经实现的跨轮证据累积、增量修订、将内容反馈转为后续推荐依据，以及用户纠正能力。

本轮不填“推荐符合度由 A% 提升至 B%”，不拿准备成功率、发布成功率或自动规则通过率替代推荐效果。也不将小样本、AI 推断的粗略内容符合度包装成真实用户指标。

若要取得可用于简历的效果数字，需要补充能够区分用户取舍的内容材料与独立标注：同主题下有明确的深度/形式/成本等差异，覆盖首次形成偏好和跨轮变化，并把用户明确要求场景与自动学习收益场景分开。冻结样本和评价标准后再做成对重复验证，有提升再填写实测结果；不要为凑简历数字选择容易通过的样本。

## 产物

- [逐条 AI 评审与汇总](../../.megumi/audits/preference-semantic-review-2026-09-06/ai-review.json)：69 条推荐逐条保留原理由、符合度判断、理由和问题；14 个自动偏好实例保留依据及判断。
- [证据提取包](../../.megumi/audits/preference-semantic-review-2026-09-06/packets.json)：绑定 runId、caseDigest、evidenceDigest、检查点及原始结果路径。
- [原始判断依据](../../.megumi/audits/preference-semantic-review-2026-09-06/basis.json)、[评审标准](../../.megumi/audits/preference-semantic-review-2026-09-06/rubric.json)。
- [工程交付报告](preference-learning-delivery-2026-09-06.md)：保留原执行结论与所有封存入口，正式人工评分没有修改。
'''
p=Path('docs/notes/preference-semantic-review-2026-09-06.md')
assert not p.exists(),'Do not overwrite an existing assessment.'
p.write_text(report,encoding='utf-8')
print('Wrote',p)
print('Reviewed recommendations',sum(sum(len(a['items']) for a in e['arms'])+len(e['unpaired']) for e in r['entries']))
print('Detailed findings',len(issues))
