// Builds preliminary renderer input preprocessing payloads before Desktop Main performs trusted validation.
import type { PermissionModeSelectionSource } from '@megumi/shared/permission';
import {
  type InputIntentCommandMetadata,
  type InputPreprocessingResult,
  createCodeReviewInputIntentMetadata,
} from '@megumi/shared/input';
import {
  dispatchCommandText,
  listCommandSuggestions,
  type CommandDefinition,
} from '../../../shared/commands';
import { BUILT_IN_INPUT_COMMAND_REGISTRY } from '../commands/built-in-input-commands';

const REVIEW_INTENT_INSTRUCTION = 'Current input comes from the review intent.';

const SUMMARY_TEMPLATE_INSTRUCTION = `请总结当前会话。重点包括：
- 用户目标。
- 已完成事项。
- 关键决策。
- 未解决问题。
- 推荐下一步。

如果用户在当前输入中指定了总结对象，请优先按该对象总结。
如果上下文不足，请先说明需要读取或确认的上下文。`;

const WRITE_DOC_SKILL_INSTRUCTION = `你正在执行文档写作任务。

工作要求：
- 先理解文档目标、读者、范围和输出位置。
- 如果目标明确，读取必要项目上下文。
- 生成结构清晰、可维护、可后续更新的文档。
- 如果需要创建或修改文件，遵守当前 permission / approval 规则。
- 不伪造未读取的项目事实。`;

export interface InputPreprocessingSubmitPayload {
  message: string;
  permissionMode?: 'plan';
  permissionSource?: PermissionModeSelectionSource;
  // Kept only as a compatibility bridge until Desktop Main fully consumes
  // structured preprocessing. Runtime must still re-validate this metadata.
  intent?: InputIntentCommandMetadata;
  preprocessing: InputPreprocessingResult;
}

export function listInputCommandSuggestions(inputText: string): CommandDefinition[] {
  return listCommandSuggestions(inputText, BUILT_IN_INPUT_COMMAND_REGISTRY);
}

function createReviewPayload(rawText: string, argsText: string): InputPreprocessingSubmitPayload {
  const intent = createCodeReviewInputIntentMetadata(argsText);

  // Renderer can provide structured hints for immediate IPC compatibility, but
  // it is not the trust boundary. Desktop Main owns final intent and permission
  // normalization before the run is created.
  return {
    message: rawText,
    permissionMode: 'plan',
    permissionSource: 'intent_default',
    intent,
    preprocessing: {
      originalText: rawText,
      effectiveUserText: argsText,
      entries: [
        {
          kind: 'intent',
          sourceId: 'input:intent:review',
          sourceName: '/review',
          visibility: 'model_visible',
          instructionText: REVIEW_INTENT_INSTRUCTION,
          intentId: 'review',
          commandName: 'review',
          defaultPermissionMode: 'plan',
          defaultPermissionSource: 'intent_default',
          metadata: {
            intentName: intent.intentName,
            argsText: intent.argsText,
          },
        },
      ],
      diagnostics: [],
    },
  };
}

function createSummaryPayload(rawText: string, argsText: string): InputPreprocessingSubmitPayload {
  return {
    message: rawText,
    preprocessing: {
      originalText: rawText,
      effectiveUserText: argsText || '总结当前会话',
      entries: [
        {
          kind: 'prompt_template',
          sourceId: 'input:prompt-template:summary',
          sourceName: '/summary',
          visibility: 'model_visible',
          instructionText: SUMMARY_TEMPLATE_INSTRUCTION,
          templateId: 'summary',
          commandName: 'summary',
          templateSource: 'builtin',
        },
      ],
      diagnostics: [],
    },
  };
}

function createWriteDocPayload(rawText: string, argsText: string): InputPreprocessingSubmitPayload {
  return {
    message: rawText,
    preprocessing: {
      originalText: rawText,
      effectiveUserText: argsText,
      entries: [
        {
          kind: 'skill',
          sourceId: 'input:skill:write-doc',
          sourceName: '/write-doc',
          visibility: 'model_visible',
          instructionText: WRITE_DOC_SKILL_INSTRUCTION,
          skillId: 'write-doc',
          commandName: 'write-doc',
          skillSource: 'builtin',
        },
      ],
      diagnostics: [],
    },
  };
}

export function createInputPreprocessingSubmitPayload(message: string): InputPreprocessingSubmitPayload | null {
  const dispatch = dispatchCommandText(message, BUILT_IN_INPUT_COMMAND_REGISTRY);

  // This switch maps command kinds to structured preprocessing entries instead
  // of expanding provider-visible text in the renderer.
  if (dispatch.kind === 'send_intent' && dispatch.command.name === 'review') {
    return createReviewPayload(dispatch.rawText, dispatch.argsText);
  }

  if (dispatch.kind === 'send_prompt' && dispatch.command.name === 'summary' && dispatch.source === 'prompt_template') {
    return createSummaryPayload(dispatch.rawText, dispatch.argsText);
  }

  if (dispatch.kind === 'send_prompt' && dispatch.command.name === 'write-doc' && dispatch.source === 'skill') {
    return createWriteDocPayload(dispatch.rawText, dispatch.argsText);
  }

  return null;
}
