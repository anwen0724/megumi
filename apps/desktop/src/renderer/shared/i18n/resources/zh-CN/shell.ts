/* Defines Simplified Chinese copy for the Desktop shell. */
/* Defines Simplified Chinese copy for Desktop shell. */
import type { TranslationShape } from '../translation-shape';
import type { shell as source } from '../en-US/shell';

export const shell = {
  navigation: {
    primary: '主要项目导航',
    expandSidebar: '展开侧边栏',
    collapseSidebar: '收起侧边栏',
    resizeSidebar: '调整聊天侧边栏宽度',
    chats: '聊天',
    newSession: '新建会话',
    taskPlan: '任务计划',
    settings: '设置',
  },
  projects: {
    label: '项目',
    actions: '项目操作',
    open: '打开项目',
    create: '新建项目',
    manage: '管理项目',
    empty: '暂无项目',
    noSessions: '暂无会话',
    showMore: '显示更多会话',
    showFewer: '收起会话',
    openSession: '打开会话 {{title}}，更新于 {{updated}}',
    selectedNone: '未选择项目',
  },
  projectSidebar: {
    project: '项目',
    files: '文件',
    artifacts: '产物',
    back: '返回项目',
    close: '关闭项目侧边栏',
    openView: '打开项目{{title}}视图',
    filesDescription: '浏览项目文件',
    artifactsDescription: '打开生成的产物',
  },
  projectManager: {
    title: '管理项目',
    closeOverlay: '关闭项目管理遮罩',
    close: '关闭项目管理',
    empty: '暂无项目',
    available: '可用',
    missing: '缺失',
    lastOpened: '上次打开：{{date}}',
    openProject: '打开 {{name}}',
    removeProject: '从列表移除 {{name}}',
  },
  workspace: {
    localSessions: '本地会话',
  },
} as const satisfies TranslationShape<typeof source>;
