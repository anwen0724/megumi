/* Authors frozen synthetic recommendation inputs and separate labels for the resume audit. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EvaluationCaseSchema } from '../../../evals/agent/contracts/evaluation-dataset';
import { validateDatasets } from '../../../evals/agent/datasets/dataset-loader';

const root = path.resolve('.megumi/audits/resume-metrics-20260908');
const domains = [
  { id: 'photo', name: '摄影', interest: '摄影学习，关注实际拍摄方法、成像原理与不同条件下的调整，不关注器材促销或摄影师私生活。',
    topics: ['逆光人像','夜景曝光','室内白平衡','运动追焦','微距景深','街头构图','雨天反光','风光滤镜','儿童抓拍','静物布光'],
    scenes: ['窗边自然光','黄昏户外','低照度室内','阴天街道'],
    procedure: '先固定构图和光线，逐次改变拍摄参数并记录对应画面，比较高光、暗部与主体细节，再按画面差异调整设置。',
    theory: '从光线、成像与视觉关系解释画面差异，说明变量间的作用和方法的适用条件，并分析常见直觉在哪些条件下失效。',
    tangent: '记录摄影展览的策展线索、作者生平与作品流传，重点讨论艺术活动的历史背景和观看体验。',
    noise: '汇总相机购买套餐、渠道促销时段与明星代言动态，比较赠品、包装和预约权益。' },
  { id: 'cooking', name: '家常烹饪', interest: '家常烹饪，关注可复现做法、食材处理和烹饪原理，不关注餐饮门店经营或厨电促销。',
    topics: ['鸡胸肉口感','番茄炒蛋','炖牛肉','蒸鱼','面团发酵','煎豆腐','蔬菜焯水','米饭含水量','煎饺','清汤调味'],
    scenes: ['两人晚餐','工作日备餐','小份试做','家庭周末午餐'],
    procedure: '给出食材用量与处理次序，记录加热强度和时间，比较不同批次的口感，并提供过干、出水或不熟时的调整步骤。',
    theory: '解释水分、温度和食材结构如何共同影响口感，比较不同处理方式的作用边界，并说明替换食材时哪些条件会改变。',
    tangent: '介绍地方饮食的历史、节庆习俗和餐桌礼仪，记录菜名的演变与民间故事。',
    noise: '分析连锁餐饮门店选址、加盟合同和外卖促销，并展示厨电套餐的折扣规则与销售话术。' },
  { id: 'garden', name: '阳台园艺', interest: '阳台园艺，关注家庭植物养护、种植方法和生长原理，不关注花店经营或庭院工程报价。',
    topics: ['薄荷修剪','番茄育苗','多肉浇水','月季光照','盆土透气','香草扦插','黄叶排查','蓝莓基质','草莓授粉','盆栽越冬'],
    scenes: ['朝南阳台','半阴窗台','通风露台','夏季室内'],
    procedure: '从观察叶片与基质状态开始，给出处理顺序和复查时间，比较处理前后变化，并说明积水、萎蔫或过度修剪时的补救。',
    theory: '解释光照、水分和根系状态对生长的影响，区分相似表象的成因，说明温度和通风改变后养护结论的适用范围。',
    tangent: '介绍植物命名史、园林审美流派与城市展览，记录相关画作、文学意象和地方文化。',
    noise: '讨论花店节日定价、商业景观工程报价与苗木批发渠道，分析装修搭配和活动销售策略。' },
  { id: 'java', name: 'Java 后端', interest: 'Java 后端工程，关注数据库、并发和服务故障处理的实现与原理，不关注培训招生、证书宣传或求职薪资榜单。',
    topics: ['线程池排队','事务传播','组合索引','缓存失效','消息重复','接口幂等','连接池等待','慢查询','并发更新','任务取消'],
    scenes: ['社区服务','内容管理接口','后台处理任务','消息消费者'],
    procedure: '给出最小复现场景与关键日志，逐步定位等待和数据变化，展示修改前后的执行过程，并列出验证步骤与未覆盖的故障边界。',
    theory: '解释状态变化、并发顺序和资源边界之间的关系，分析常见方案的成立条件，以反例说明机制不能覆盖的情况。',
    tangent: '整理技术社区活动、软件发展沿革与开发者访谈，介绍团队协作背景和行业文化。',
    noise: '展示培训招生价格、证书推广和薪资排名，介绍报名折扣、课程礼包与机构宣传口号。' },
] as const;
const labels: Record<string, unknown> = {};
const ids: string[] = [];
await mkdir(root, { recursive: true });

for (const domain of domains) {
  const corpus = domain.topics.flatMap((topic, t) => domain.scenes.flatMap((scene, s) => [
    { style: 'steps', suffix: '操作记录', text: domain.procedure, grade: 2 },
    { style: 'principles', suffix: '条件与原理', text: domain.theory, grade: 2 },
    { style: 'overview', suffix: '概念速览', text: `列举${topic}的常用概念，简要说明${scene}中可能遇到的现象，为进一步阅读提供问题目录。`, grade: 1 },
    { style: 'culture', suffix: '专题观察', text: domain.tangent, grade: 0 },
    { style: 'market', suffix: '市场观察', text: domain.noise, grade: 0 },
  ].map(item => {
    const id = `item-${createHash('sha256').update(`${domain.id}:${t}:${s}:${item.style}`).digest('hex').slice(0, 12)}`;
    const title = `${topic}：${scene}中的${item.suffix}`;
    const text = `${title}。${item.text} 本文以${scene}为背景，按准备、观察、分析和复查四部分组织材料。案例只描述当前场景，不承诺适用于全部情况；读者需要核对自身条件再判断是否采用。`;
    return { grade: item.grade, candidate: { referenceId: id, sourceId: 'open_web', sourceName: 'Controlled Web',
      canonicalUrl: `https://example.test/resume/${domain.id}/${id}`, title, description: text, contentSummary: text,
      contentText: `${text}\n\n具体记录：${topic}首先区分现象与推断，保留${scene}中的限制条件。${item.text}`,
      matchedInterestReferenceIds: [domain.id], relevance: 'direct' as const, contentType: 'article' as const } };
  }))).sort((a,b) => a.candidate.referenceId.localeCompare(b.candidate.referenceId));
  assert.equal(corpus.length, 200);
  for (const count of [80,120,200]) {
    const caseId = `resume-recommendation.${domain.id}-${count}`;
    ids.push(caseId);
    const rows = corpus.slice(0,count);
    assert.ok(rows.filter(row=>row.grade===2).length>=20);
    labels[`controlled/${caseId}`] = { domain: domain.id, poolSize: count, targetCount: 20,
      rubric: '2=direct instructional or explanatory content; 1=on-topic introductory information; 0=outside explicit interest scope. Authored synthetic labels, not human user judgments.',
      grades: Object.fromEntries(rows.map(row=>[row.candidate.referenceId,row.grade])) };
    const base = EvaluationCaseSchema.parse({ schemaVersion: 2, caseId, revision: 1, name: `${domain.name}-${count}`, description: 'Frozen synthetic corpus for recommendation evaluation.',
      metadata: { source: 'Synthetic audit corpus; labels withheld from model', tags: ['resume-audit'] }, type: 'recommendation',
      initialState: { clock:'2026-09-08T08:00:00.000Z', recommendationTargetCount:20, recommendationWorkingSetCount:80,
        interests:[{referenceId:domain.id,description:domain.interest,status:'active'}], candidates:rows.map(row=>row.candidate), previousRecommendations:[],preferences:[] },
      input:{trigger:'manual'},expected:{allowedOutcomes:['published']} });
    for(const arm of ['layered','full'] as const) {
      const value=structuredClone(base);
      if(value.type!=='recommendation')throw new Error('Unexpected case type');
      value.initialState.recommendationWorkingSetCount=arm==='full'?count:80;
      const dir=path.join(root,'datasets',arm,'controlled','cases','recommendation');
      await mkdir(dir,{recursive:true});await writeFile(path.join(dir,`${caseId}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    }
  }
}
for(const arm of ['layered','full']) {
  const dir=path.join(root,'datasets',arm,'controlled','manifests');await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'resume-recommendation.json'),JSON.stringify({schemaVersion:1,environmentKind:'controlled',datasetId:'resume-recommendation',revision:1,name:'Resume recommendation audit',description:'Controlled synthetic recommendation benchmark',caseIds:ids},null,2)+'\n',{flag:'wx'});
  console.log(arm,await validateDatasets({rootDirectory:path.join(root,'datasets',arm)}));
}
await writeFile(path.join(root,'recommendation-labels.json'),JSON.stringify(labels,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(root,'corpus-freeze.json'),JSON.stringify({createdAt:new Date().toISOString(),labelDigest:createHash('sha256').update(JSON.stringify(labels)).digest('hex'),cases:ids,arms:['layered','full'],seed:'sha256(domain:topic:scene:style)',productModified:false},null,2)+'\n',{flag:'wx'});
