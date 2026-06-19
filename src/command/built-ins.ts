// Defines Megumi-owned built-in input commands for the new src command boundary.
import type { CommandDefinition } from './definition';
import { createCommandRegistry } from './registry';

export const REVIEW_AGENT_COMMAND_DESCRIPTION = 'Review code in the current project';

export const SUMMARY_TEMPLATE_INSTRUCTION = `请总结当前会话。重点包括：
- 用户目标。
- 已完成事项。
- 关键决策。
- 未解决问题。
- 推荐下一步。

如果用户在当前输入中指定了总结对象，请优先按该对象总结。
如果上下文不足，请先说明需要读取或确认的上下文。`;

export const WRITE_DOC_SKILL_INSTRUCTION = `你正在执行文档写作任务。

工作要求：
- 先理解文档目标、读者、范围和输出位置。
- 如果目标明确，读取必要项目上下文。
- 生成结构清晰、可维护、可后续更新的文档。
- 如果需要创建或修改文件，遵守当前 permission / approval 规则。
- 不伪造未读取的项目事实。`;

export const BUILT_IN_AGENT_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'review',
    kind: 'agent_command',
    source: 'core',
    description: REVIEW_AGENT_COMMAND_DESCRIPTION,
    dispatch: {
      kind: 'agent_command',
      commandName: 'review',
      description: REVIEW_AGENT_COMMAND_DESCRIPTION,
    },
  },
] as const;

export const BUILT_IN_PROMPT_TEMPLATE_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'summary',
    kind: 'prompt_template',
    source: 'core',
    description: 'Summarize the current session',
    argumentHint: '[focus]',
    dispatch: {
      kind: 'prompt_template',
      templateId: 'summary',
      variables: ['focus'],
    },
    metadata: {
      guidance: SUMMARY_TEMPLATE_INSTRUCTION,
      defaultText: '总结当前会话',
    },
  },
] as const;

export const BUILT_IN_SKILL_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'write-doc',
    kind: 'skill_trigger',
    source: 'core',
    description: 'Write or update project documentation',
    argumentHint: '[target]',
    dispatch: {
      kind: 'skill_trigger',
      skillName: 'write-doc',
      inputMode: 'append_args',
    },
    metadata: {
      guidance: WRITE_DOC_SKILL_INSTRUCTION,
    },
  },
] as const;

export const BUILT_IN_INPUT_COMMAND_REGISTRY = createCommandRegistry({
  agentCommands: BUILT_IN_AGENT_COMMANDS,
  promptTemplateCommands: BUILT_IN_PROMPT_TEMPLATE_COMMANDS,
  skillCommands: BUILT_IN_SKILL_COMMANDS,
});
