/* Frozen fictional task histories and independent acceptance labels; never imported by product code. */
export interface EffectHistory {
  id: string;
  project: string;
  user: string;
  tool?: {
    command: string;
    output: string;
    succeeded: boolean;
  };
  conclusion: string;
  excluded?: boolean;
}
export interface EffectFact {
  id: string;
  description: string;
  field: string;
  expected: string | number | boolean | null | readonly string[];
  evidence: readonly string[];
  applicability: string;
  memoryRequired?: boolean;
  ordered?: boolean;
}
export interface EffectFixture {
  id: string;
  category: string;
  project: string;
  histories: readonly EffectHistory[];
  task: string;
  facts: readonly EffectFact[];
  forbidden: readonly {
    field: string;
    value: string;
    reason: string;
  }[];
}
const history = (
  id: string,
  project: string,
  user: string,
  conclusion = '已确认，后续同条件任务按上述结论处理。',
): EffectHistory => ({
  id,
  project,
  user,
  conclusion,
});
const fact = (
  id: string,
  field: string,
  expected: EffectFact['expected'],
  description: string,
  evidence: string[],
  applicability: string,
): EffectFact => ({
  id,
  field,
  expected,
  description,
  evidence,
  applicability,
});

export const effectFixtures: readonly EffectFixture[] = [
  {
    id: 'preference-report',
    category: 'stable-preference',
    project: 'Aurora',
    histories: [
      history(
        'report-style',
        'Aurora',
        '这是合成用户的稳定偏好：以后给我写性能报告，语言标识用 zh-CN，时长统一以 ms 为单位，报告先写结果再解释原因。',
      ),
    ],
    task: '请按我一直使用的报告习惯，为本次耗时 1.25 秒的任务给出报告参数。输出 JSON：language、durationUnit、durationValue、sectionOrder（用 result/reason 两个英文枚举表示章节顺序）。',
    facts: [
      fact('language', 'language', 'zh-CN', '报告用简体中文', ['report-style'], '该用户的性能报告'),
      fact('unit', 'durationUnit', 'ms', '时长用毫秒', ['report-style'], '性能报告'),
      {
        ...fact(
          'value',
          'durationValue',
          1250,
          '秒转毫秒的任务结果',
          ['report-style'],
          '本次 1.25 秒',
        ),
        memoryRequired: false,
      },
      fact(
        'order',
        'sectionOrder',
        ['result', 'reason'],
        '先结果后原因',
        ['report-style'],
        '性能报告',
      ),
    ],
    forbidden: [],
  },
  {
    id: 'preference-example',
    category: 'stable-preference',
    project: 'Learning',
    histories: [
      history(
        'teaching-style',
        'Learning',
        '这是合成用户的长期学习偏好。代码例子使用 TypeScript，先给最小可运行例子再解释原理；讲 React Hook 时不要默认我已经理解闭包。',
      ),
    ],
    task: '我要继续学习 React Hook。按我过去的学习习惯给出教学计划 JSON：language、sectionOrder（example/explanation 两项）、prerequisiteToExplain（用单数英文技术名词表示）。不要写具体教程。',
    facts: [
      fact('language', 'language', 'TypeScript', '示例语言', ['teaching-style'], '该用户编程学习'),
      fact(
        'order',
        'sectionOrder',
        ['example', 'explanation'],
        '示例先行',
        ['teaching-style'],
        '编程教学',
      ),
      fact(
        'prerequisite',
        'prerequisiteToExplain',
        'closure',
        '先解释闭包',
        ['teaching-style'],
        'React Hook',
      ),
    ],
    forbidden: [],
  },
  {
    id: 'constraint-http',
    category: 'project-constraint',
    project: 'Aurora',
    histories: [
      history(
        'api-contract',
        'Aurora',
        'Aurora 的接口契约已经冻结：每次请求必须发送 X-Aurora-Trace 请求头；响应信封只有 payload 和 problem 两个顶层字段。成功时 problem 为 null。不要套用其他项目的 data/error 信封。',
      ),
    ],
    task: '为当前 Aurora 项目创建一次成功请求的契约参数 JSON：traceHeader、responseFields（数组）、successProblemValue。只给契约。',
    facts: [
      fact(
        'header',
        'traceHeader',
        'X-Aurora-Trace',
        '项目专属请求头',
        ['api-contract'],
        'Aurora HTTP',
      ),
      {
        ...fact(
          'envelope',
          'responseFields',
          ['payload', 'problem'],
          '项目响应字段',
          ['api-contract'],
          'Aurora HTTP',
        ),
        ordered: false,
      },
      fact(
        'success',
        'successProblemValue',
        null,
        '成功的错误字段为空',
        ['api-contract'],
        'Aurora 成功响应',
      ),
    ],
    forbidden: [
      {
        field: 'responseFields',
        value: 'data',
        reason: '其他项目的信封不能替代当前约定',
      },
    ],
  },
  {
    id: 'constraint-runtime',
    category: 'project-constraint',
    project: 'Nimbus',
    histories: [
      history(
        'runtime-contract',
        'Nimbus',
        'Nimbus 项目约定 Node.js 20，包管理器 pnpm，CI 必须使用 pnpm install --frozen-lockfile。升级 Node 和切换 npm 均需另行决策，当前没有变更。',
      ),
    ],
    task: '给当前 Nimbus 项目写 CI 安装步骤的配置 JSON：nodeMajor、packageManager、installCommand。',
    facts: [
      fact('node', 'nodeMajor', 20, '固定 Node 20', ['runtime-contract'], 'Nimbus CI'),
      fact('manager', 'packageManager', 'pnpm', '固定包管理器', ['runtime-contract'], 'Nimbus'),
      fact(
        'command',
        'installCommand',
        'pnpm install --frozen-lockfile',
        '锁文件安装',
        ['runtime-contract'],
        'Nimbus CI',
      ),
    ],
    forbidden: [
      {
        field: 'packageManager',
        value: 'npm',
        reason: '未批准切换',
      },
    ],
  },
  {
    id: 'success-csv',
    category: 'verified-procedure',
    project: 'Ledger',
    histories: [
      {
        ...history(
          'csv-success',
          'Ledger',
          'Ledger 的账单 CSV 含 UTF-8 BOM，分号分隔。之前默认 UTF-8 和逗号导致第一列字段错误。请验证修复并记住这个文件族的读取参数。',
          '工具验证通过：以后 Ledger 的这类账单用 utf-8-sig 与分号，不把这个结论用于别的 CSV。',
        ),
        tool: {
          command: 'python verify_ledger_csv.py --encoding utf-8-sig --delimiter ";"',
          output: 'PASS: columns=[invoice_id,amount]; rows=3; sum=125.50; BOM removed',
          succeeded: true,
        },
      },
    ],
    task: 'Ledger 又导出了相同格式账单，请给解析参数 JSON：encoding、delimiter、expectedFirstColumn。沿用经过验证的方法。',
    facts: [
      fact('encoding', 'encoding', 'utf-8-sig', '清除 BOM', ['csv-success'], 'Ledger 同格式账单'),
      fact('delimiter', 'delimiter', ';', '分号分隔', ['csv-success'], 'Ledger 同格式账单'),
      fact(
        'column',
        'expectedFirstColumn',
        'invoice_id',
        '验证列名',
        ['csv-success'],
        'Ledger 同格式账单',
      ),
    ],
    forbidden: [],
  },
  {
    id: 'success-native',
    category: 'verified-procedure',
    project: 'DesktopLab',
    histories: [
      {
        ...history(
          'native-success',
          'DesktopLab',
          'DesktopLab 的 CI 初次安装阶段必须跳过安装脚本，再只重建 better-sqlite3。请验证这两步能恢复 Node 测试。',
          '验证完成，后续相同 CI 镜像使用工具中验证的两条命令和顺序。',
        ),
        tool: {
          command: 'npm ci --ignore-scripts THEN npm rebuild better-sqlite3',
          output:
            'npm ci exit=0; npm rebuild better-sqlite3 exit=0; node sqlite-smoke.js PASS rows=1',
          succeeded: true,
        },
      },
    ],
    task: '同一 DesktopLab CI 镜像又要初始化依赖。给出已验证顺序 JSON：commands（两项数组）、targetRuntime（Node.js 或 Electron）。',
    facts: [
      fact(
        'commands',
        'commands',
        ['npm ci --ignore-scripts', 'npm rebuild better-sqlite3'],
        '验证成功的安装与重建顺序',
        ['native-success'],
        'DesktopLab 相同 CI 镜像',
      ),
      fact('runtime', 'targetRuntime', 'Node.js', '验证针对 Node', ['native-success'], 'CI 测试'),
    ],
    forbidden: [],
  },
  {
    id: 'failure-sql',
    category: 'failure-prevention',
    project: 'TenantDB',
    histories: [
      {
        ...history(
          'sql-failure',
          'TenantDB',
          'TenantDB 清理旧草稿失败了。请保留失败原因和修复约束，后续不得直接复用原语句。',
          '已确认修复约束：必须先执行 SELECT 预览，DELETE 必须同时带 workspace_id 和 status 条件；批量清理当前没有授权。',
        ),
        tool: {
          command: "DELETE FROM drafts WHERE status='old'",
          output:
            'FAIL: removed rows from workspace w-beta while task scope was w-alpha; transaction rolled back',
          succeeded: false,
        },
      },
    ],
    task: '当前仅清理 TenantDB 的 w-alpha 旧草稿。给出安全计划 JSON：previewOperation、deleteFilters（字段名数组）、workspaceValue；不执行 SQL。',
    facts: [
      fact('preview', 'previewOperation', 'SELECT', '先预览', ['sql-failure'], 'TenantDB 草稿清理'),
      {
        ...fact(
          'filters',
          'deleteFilters',
          ['workspace_id', 'status'],
          '同时限制租户和状态',
          ['sql-failure'],
          'TenantDB 草稿清理',
        ),
        ordered: false,
      },
      {
        ...fact('scope', 'workspaceValue', 'w-alpha', '当前授权范围', ['sql-failure'], '当前任务'),
        memoryRequired: false,
      },
    ],
    forbidden: [],
  },
  {
    id: 'failure-abi',
    category: 'failure-prevention',
    project: 'DesktopLab',
    histories: [
      {
        ...history(
          'abi-failure',
          'DesktopLab',
          'DesktopLab 上一次测试与启动 Electron 同时进行，better-sqlite3 加载失败。请检查日志并记录正确流程。',
          '根因是同一 node_modules 被两个 ABI 重建并发覆盖。顺序固定：Node 重建、Node 测试、Electron 重建、Electron 启动。不得并行重建。',
        ),
        tool: {
          command: 'parallel npm rebuild better-sqlite3 AND electron-rebuild -f -w better-sqlite3',
          output:
            'FAIL NODE_MODULE_VERSION mismatch: node test loaded Electron binary while concurrent rebuild was writing',
          succeeded: false,
        },
      },
    ],
    task: '现在要依次验收 DesktopLab 的 Node 测试和 Electron 启动。按已确认的故障防护给 JSON：parallelRebuilds（boolean）、stages（数组，使用 node-rebuild/node-test/electron-rebuild/electron-start）。',
    facts: [
      fact(
        'serial',
        'parallelRebuilds',
        false,
        '不能并行重建',
        ['abi-failure'],
        '共享 node_modules 的桌面验证',
      ),
      fact(
        'order',
        'stages',
        ['node-rebuild', 'node-test', 'electron-rebuild', 'electron-start'],
        '正确顺序',
        ['abi-failure'],
        '同一安装目录',
      ),
    ],
    forbidden: [],
  },
  {
    id: 'correction-api',
    category: 'corrected-conclusion',
    project: 'Aurora',
    histories: [
      history('old-api', 'Aurora', 'Aurora 列表接口暂定 GET /api/v1/items，分页参数 page。'),
      history(
        'new-api',
        'Aurora',
        '修正前面的结论：Aurora 服务已迁移，当前唯一列表接口是 GET /api/v2/items，分页参数 cursor。v1 和 page 已停用，后续不要再推荐旧方案。',
      ),
    ],
    task: '继续 Aurora 列表功能，给当前接口 JSON：method、endpoint、paginationParameter。',
    facts: [
      fact('method', 'method', 'GET', '列表读取方法', ['new-api'], 'Aurora 当前版本'),
      fact('endpoint', 'endpoint', '/api/v2/items', '新的唯一接口', ['new-api'], 'Aurora 当前版本'),
      fact(
        'pagination',
        'paginationParameter',
        'cursor',
        '新分页参数',
        ['new-api'],
        'Aurora 当前版本',
      ),
    ],
    forbidden: [
      {
        field: 'endpoint',
        value: '/api/v1/items',
        reason: '后续明确纠正',
      },
      {
        field: 'paginationParameter',
        value: 'page',
        reason: '旧分页已停用',
      },
    ],
  },
  {
    id: 'correction-rounding',
    category: 'corrected-conclusion',
    project: 'Ledger',
    histories: [
      history('old-rounding', 'Ledger', 'Ledger 试验时金额采用 ROUND_HALF_UP。'),
      history(
        'new-rounding',
        'Ledger',
        '会计已修正：Ledger 现在统一采用 ROUND_HALF_EVEN，保留两位小数。旧 ROUND_HALF_UP 结论作废。',
      ),
      {
        ...history(
          'excluded-rounding',
          'Ledger',
          '这是已撤回的外包建议：改用 ROUND_DOWN 并保留一位小数。',
        ),
        excluded: true,
      },
    ],
    task: 'Ledger 要处理新账单。给现行金额规范 JSON：roundingMode（Python decimal 常量名）、decimalPlaces。不要使用已撤回来源。',
    facts: [
      fact(
        'mode',
        'roundingMode',
        'ROUND_HALF_EVEN',
        '纠正后舍入模式',
        ['new-rounding'],
        'Ledger 当前金额',
      ),
      fact('places', 'decimalPlaces', 2, '保留两位', ['new-rounding'], 'Ledger 当前金额'),
    ],
    forbidden: [
      {
        field: 'roundingMode',
        value: 'ROUND_HALF_UP',
        reason: '已纠正',
      },
      {
        field: 'roundingMode',
        value: 'ROUND_DOWN',
        reason: '来源明确排除',
      },
    ],
  },
  {
    id: 'cross-pagination',
    category: 'cross-project',
    project: 'Beta',
    histories: [
      history(
        'alpha-pagination',
        'Alpha',
        'Alpha 是离线报表，分页必须用 offset，固定 limit=100。仅适用于 Alpha。',
      ),
      history(
        'beta-pagination',
        'Beta',
        'Beta 是实时消息流，分页必须用 cursor，固定 limit=25；不能复用 Alpha 的 offset。仅适用于 Beta。',
      ),
    ],
    task: '当前在 Beta 项目继续做列表加载。给该项目参数 JSON：paginationParameter 表示分页方式，填写 offset 或 cursor，不要求实际 HTTP 参数名；limit 填写每页数量。',
    facts: [
      fact(
        'pagination',
        'paginationParameter',
        'cursor',
        'Beta 使用游标',
        ['beta-pagination'],
        '仅 Beta 实时流',
      ),
      fact('limit', 'limit', 25, 'Beta 容量', ['beta-pagination'], '仅 Beta'),
    ],
    forbidden: [
      {
        field: 'paginationParameter',
        value: 'offset',
        reason: '只适用于 Alpha',
      },
    ],
  },
  {
    id: 'cross-delete',
    category: 'cross-project',
    project: 'ProductionLedger',
    histories: [
      history(
        'sandbox-delete',
        'SandboxLedger',
        'SandboxLedger 是可丢弃实验库，清理使用 hard-delete，不保留审计；仅适用于这个实验项目。',
      ),
      history(
        'production-delete',
        'ProductionLedger',
        'ProductionLedger 是正式账簿，删除必须 soft-delete，字段 deleted_at 标记且保留 audit_event；不得套用 SandboxLedger 物理删除规则。',
      ),
    ],
    task: '当前 ProductionLedger 要新增删除功能，给配置 JSON：deleteMode（hard-delete 或 soft-delete）、markerField（标记字段名称）、auditRecord（需要保留的审计记录名称，字符串，不是布尔值）。不要执行删除。',
    facts: [
      fact(
        'mode',
        'deleteMode',
        'soft-delete',
        '正式项目软删',
        ['production-delete'],
        'ProductionLedger',
      ),
      fact(
        'marker',
        'markerField',
        'deleted_at',
        '软删标记',
        ['production-delete'],
        'ProductionLedger',
      ),
      fact(
        'audit',
        'auditRecord',
        'audit_event',
        '保留审计',
        ['production-delete'],
        'ProductionLedger',
      ),
    ],
    forbidden: [
      {
        field: 'deleteMode',
        value: 'hard-delete',
        reason: '只适用于实验项目',
      },
    ],
  },
];

export const effectConditions = ['none', 'full-history', 'memory'] as const;
export type EffectCondition = (typeof effectConditions)[number];
