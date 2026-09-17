import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadRunEvidence } from '../../evals/agent/grading/record-evidence';
import { PreferenceSequenceRecordSchema } from '../../evals/agent/contracts/preference-sequence-record';
const root=process.cwd();
const groups=[];
for(const [name,folder,rawKind] of [['baseline','preference-sequence-baseline-rescored','baseline'],['final','preference-sequence-final','final'],['multi-cycle','preference-sequence-multi-cycle','final']]) {
 const rows=[];
 if(rawKind==='baseline') rows.push(...JSON.parse(await readFile(`.megumi/audits/${folder}/summary.json`,'utf8')));
 else for(let repetition=1;repetition<=3;repetition++) {
  const s=JSON.parse(await readFile(`.megumi/audits/${folder}/repetition-${repetition}.json`,'utf8'));
  const {cases}=await loadRunEvidence(s.runDirectory);
  let checkpoints=0,prepared=0,degraded=0,published=0,arms=0,extraLearningCalls=0,unpairedPublished=0;
  const failures=[];
  for(const c of cases) for(const step of PreferenceSequenceRecordSchema.parse(c.result.ownerFacts).steps) {
   if(step.input.kind!=='recommend')continue;
   checkpoints++;
   const learning=step.operationResult?.learning;
   if(learning?.status==='updated'||learning?.status==='unchanged')prepared++;
   if(learning?.status==='degraded'){degraded++;failures.push({case:c.snapshot.identity,step:step.stepId,failures:learning.failures});}
   if(!step.input.paired && step.operationResult?.status==='published')unpairedPublished++;
   for(const arm of step.experiments){arms++;if(arm.result?.status==='published')published++;extraLearningCalls+=arm.traces.filter(t=>t.kind==='preference_learning').reduce((sum,t)=>sum+(t.measurements?.modelCalls??0),0);}
  }
  rows.push({runId:s.runId,cases:cases.length,checkpoints,prepared,degraded,published,arms,extraLearningCalls,unpairedPublished,
   ruleFailures:s.cases.flatMap(c=>c.metrics.filter(m=>m.status==='scored'&&m.value<1).map(m=>({case:c.caseIdentity,metric:m.metricId,reason:m.reason}))),failures});
 }
 groups.push({name,folder,rows,totals:Object.fromEntries(['cases','checkpoints','prepared','degraded','published','arms','extraLearningCalls','unpairedPublished'].map(key=>[key,rows.reduce((sum,row)=>sum+(row[key]??0),0)])),ruleFailures:rows.flatMap(r=>r.ruleFailures),failures:rows.flatMap(r=>r.failures)});
}
await writeFile('.megumi/audits/preference-learning-delivery.json',JSON.stringify(groups,null,2));
const [baseline,final,multi]=groups;
const link=(label,target)=>`[${label}](${target.replaceAll('\\','/')})`;
const runLinks=groups.map(group=>`### ${group.name}\n\n`+group.rows.map(row=>`- ${link(row.runId,`../../evals/agent/records/${row.runId}/run.json`)}；${link('评分报告',`../../.megumi/audits/${group.folder}/${row.runId}/report.md`)}；${link('评审模板',`../../.megumi/audits/${group.folder}/${row.runId}/review-template.json`)}`).join('\n')).join('\n\n');
const failures=final.failures.map(f=>`- ${f.case} / ${f.step}：${f.failures.map(x=>x.code).join(', ')}`).join('\n');
const report=`# 偏好惰性学习交付与验证报告

日期：2026-09-06。分支：\`codex/preference-lazy-learning\`，最终提交：\`4412e447\`。

## 已实现的用户行为

- 推荐准入后惰性学习；反馈、启动、页面读取和时间推进不调用学习模型。
- 结合近期历史与完整直接依据增量修订。用户编辑保留原 ID 与原话并转为明确要求；删除即时退出推荐，保留原反馈和最小删除边界。
- 反馈修正和兴趣/偏好更正即时失效相关自动结论；准备受 60 秒总限额、三次有限尝试和取消约束，失败不使用无效判断。
- 发布事务校验用户更正版本，旧输入最多重新生成一次；首次反馈创建空作用域不误触发重启。
- 兴趣入口提供偏好和依据查看、编辑、删除、冲突草稿、空状态与长度校验。
- 连续评估保存逐步状态、成对实际输入和 Trace；离线生成规则、阶段成本与逐检查点人工评审模板。

## 工程验证

三套类型检查通过；8 Dataset / 23 Case 定义校验通过；完整回归 335 文件 / 1816 项通过，随后新增跨两次推荐的历史复用测试，其所在文件 3 项通过。数据库升级测试验证版本 25 到 26 的实体身份、反馈和依据保留及重复启动。没有打包，没有修改正常 Megumi Home 数据。

实现计划与提交记录见 ${link('实现计划','../develop/preference-learning/implementation-plan.md')}。受控 Provider 仅验证协议、取消、用户更正竞态和隔离边界，未当作真实语义效果。

## 真实模型结果

使用已授权根目录 .env 中的凭据，显式配置 DeepSeek / deepseek-v4-flash（openai-completions，上下文 1000000、输出上限 8192）；凭据未写入记录。初始与修正后分别运行十个固定连续 Case，各重复三次，不删除失败记录。两次使用相同 revision=1 Case；修正提示词和评估对照复用后重新执行，不将两次运行视为统计显著实验。初始串行、复测三轮并行，因此不据此比较墙钟性能。

| 实测项 | 初始 30 次 | 修正后 30 次 |
| --- | ---: | ---: |
| 显式准备成功或无变化 | ${baseline.totals.prepared} | ${final.totals.prepared} |
| 准备降级 | ${baseline.totals.degraded} | ${final.totals.degraded} |
| 成对推荐成功发布 | ${baseline.totals.published}/${baseline.totals.arms} | ${final.totals.published}/${final.totals.arms} |
| 对照中额外学习调用 | ${baseline.totals.extraLearningCalls} | ${final.totals.extraLearningCalls} |
| 自动规则失败项 | ${baseline.ruleFailures.length} | ${final.ruleFailures.length} |

初始失败项来自对照再次学习导致输入不可比；修复后两组一次性复用相同准备结果，包括降级结果。该改善属于评估可靠性，不能写成推荐质量提升。模型提示词补清了必须逐一处理 needs_review，以及仅有用户偏好也必须返回作用域；没有放宽提交规则或为非法输出增加未经确认的重试。

修正后仍降级的记录：

${failures||'无。'}

降级保留为真实结果，不补造偏好、不将 failed 改为成功。自动规则验证的是用户控制、有效输入、惰性触发和对照约束；并不保证偏好推断有价值。

另将 photo-accumulation 提升到 revision=2，增加跨两次推荐与隔日新反馈。三次独立复测完成 ${multi.totals.checkpoints} 个推荐检查点，首轮单组发布 ${multi.totals.unpairedPublished}/3，后续成对发布 ${multi.totals.published}/${multi.totals.arms}，自动规则失败 ${multi.ruleFailures.length} 项。此结果单列，不混入原 revision=1 的比较。受控回归确认第二轮输入保留第一轮已处理且未形成判断的反馈。

## 质量结论边界

所有真实运行的人工语义项仍为 needs_review，总体 incomplete，不能宣称相关性提升或整体无退化。下一步按模板检查推断依据、适用范围、删除后重学的新证据，以及两组各自符合用户取舍的推荐数/实际推荐数和理由。请填写实际评审身份；本次未代替用户做人工评分。

语义同义删除约束由模型指令与人工核验共同约束；代码可校验引用、版本、精确归一化文本和新反馈序号，不能证明任意自然语言改写是否同义。

每个评分目录的 preference-cost.json 分别记录共享学习、完整主路径和两组推荐的调用、Trace 内重试、缓存/非缓存 Token 与 Trace 时长。共享学习只计一次；缺失用量保留 null。Trace 时长之和不是用户总等待时间，也不据成本单项推导质量。

## 原始证据与评审入口

${runLinks}

机器汇总：${link('preference-learning-delivery.json','../../.megumi/audits/preference-learning-delivery.json')}。所有旧 v2/v3 记录、初始失败记录及评分目录保持不变；本次离线重评分使用新目录。
`;
await writeFile('docs/notes/preference-learning-delivery-2026-09-06.md',report,'utf8');
console.log(JSON.stringify(groups.map(({name,totals,ruleFailures})=>({name,totals,ruleFailures:ruleFailures.length}))));
