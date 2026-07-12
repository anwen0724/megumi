/*
 * Assembles already resolved owner facts into ActiveContext and a separate source trace.
 */
import type { ToolSetEntry } from '@megumi/ai';
import type { EffectiveAgentInstructions, SystemInstruction } from '../../../instructions';
import type { SkillCatalogItem } from '../../../skills/domain/dto/context/skill-context-response';
import type { ActiveContext } from '../../domain/model/active-context';
import type {
  ConversationTurn,
  CurrentConversationTurn,
} from '../../domain/model/conversation-turn';
import type {
  ContextSourceRef,
  ActivatedSkillInstruction,
  MemoryContextInput,
  VisibleCompactionSummary,
} from '../../domain/model/prompt';

export type BuildActiveContextRequest = {
  sessionId: string;
  systemInstructions: SystemInstruction[];
  agentInstructions: EffectiveAgentInstructions;
  skillCatalog: SkillCatalogItem[];
  activatedSkills: ActivatedSkillInstruction[];
  compactionSummary?: VisibleCompactionSummary;
  memoryRecall?: MemoryContextInput;
  historicalTurns: ConversationTurn[];
  currentTurn: CurrentConversationTurn;
  tools: ToolSetEntry[];
};

export type BuildActiveContextResult = {
  activeContext: ActiveContext;
  sourceRefs: ContextSourceRef[];
};

export function buildActiveContext(
  request: BuildActiveContextRequest,
): BuildActiveContextResult {
  const activeContext: ActiveContext = {
    sessionId: request.sessionId,
    instructions: {
      system: request.systemInstructions,
      agentInstructions: request.agentInstructions,
      activatedSkills: request.activatedSkills.map(({ skillId, name, content }) => ({
        skillId,
        name,
        content,
      })),
    },
    referenceContext: {
      skillCatalog: request.skillCatalog,
      ...(request.compactionSummary
        ? { compactionSummary: request.compactionSummary }
        : {}),
      ...(request.memoryRecall ? { memoryRecall: request.memoryRecall } : {}),
    },
    historicalTurns: request.historicalTurns,
    currentTurn: request.currentTurn,
    tools: request.tools,
  };

  return {
    activeContext,
    sourceRefs: buildSourceRefs(activeContext),
  };
}

function buildSourceRefs(activeContext: ActiveContext): ContextSourceRef[] {
  const refs: ContextSourceRef[] = [
    ...activeContext.instructions.system.map(({ instructionId }) => ({
      sourceType: 'system_instruction' as const,
      sourceId: instructionId,
    })),
    ...activeContext.instructions.agentInstructions.sources.map(({ sourceId }) => ({
      sourceType: 'agent_instruction' as const,
      sourceId,
    })),
    ...activeContext.instructions.activatedSkills.map(({ skillId }) => ({
      sourceType: 'activated_skill' as const,
      sourceId: skillId,
    })),
    ...activeContext.referenceContext.skillCatalog.map(({ skillId }) => ({
      sourceType: 'skill_catalog' as const,
      sourceId: skillId,
    })),
  ];

  const { compactionSummary, memoryRecall } = activeContext.referenceContext;
  if (compactionSummary) {
    refs.push({ sourceType: 'compaction_summary', sourceId: compactionSummary.compactionId });
  }
  if (memoryRecall) {
    refs.push(...memoryRecall.items.map(({ memoryId }) => ({
      sourceType: 'memory' as const,
      sourceId: memoryId,
    })));
  }

  for (const turn of activeContext.historicalTurns) {
    refs.push(
      { sourceType: 'session_message', sourceId: turn.source.userMessageId },
      { sourceType: 'agent_run_history', sourceId: turn.source.runId },
      ...turn.modelSteps.flatMap((step) => step.toolCalls.flatMap((toolCall) => (
        toolCall.result ? [{ sourceType: 'tool_result' as const, sourceId: toolCall.toolCallId }] : []
      ))),
      ...(turn.source.assistantMessageId
        ? [{ sourceType: 'session_message' as const, sourceId: turn.source.assistantMessageId }]
        : []),
    );
  }

  refs.push({
    sourceType: 'session_message',
    sourceId: activeContext.currentTurn.userEntry.entryId,
  });
  activeContext.currentTurn.runItems.forEach((item, index) => {
    refs.push(item.type === 'tool_result'
      ? { sourceType: 'tool_result', sourceId: item.toolCallId }
      : {
          sourceType: 'current_run_item',
          sourceId: `${activeContext.currentTurn.runId}:${index}`,
        });
  });
  refs.push(...activeContext.tools.map(({ name }) => ({
    sourceType: 'tool_definition' as const,
    sourceId: name,
  })));

  return refs;
}
