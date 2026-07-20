/*
 * Assembles already resolved owner facts into ActiveContext and a separate source trace.
 */
import type { ToolSetEntry } from '@megumi/ai';
import type { EffectiveAgentInstructions, SystemInstruction } from '../../../instructions';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
import type { ActiveContext } from '../../domain/model/active-context';
import type {
  ConversationTurn,
  CurrentConversationTurn,
} from '../../domain/model/conversation-turn';
import type {
  ContextSourceRef,
  MemoryContextInput,
  VisibleCompactionSummary,
} from '../../domain/model/prompt';

export type BuildActiveContextRequest = {
  sessionId: string;
  systemInstructions: SystemInstruction[];
  agentInstructions: EffectiveAgentInstructions;
  skillCatalog: SkillCatalogItem[];
  usedSkills: UsedSkillContent[];
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
    },
    referenceContext: {
      skillCatalog: request.skillCatalog,
      ...(request.compactionSummary
        ? { compactionSummary: request.compactionSummary }
        : {}),
      ...(request.memoryRecall ? { memoryRecall: request.memoryRecall } : {}),
    },
    runContext: {
      skills: request.usedSkills.map((skill) => ({ ...skill })),
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
    ...activeContext.runContext.skills.map(({ skillPath }) => ({
      sourceType: 'used_skill' as const,
      sourceId: skillPath,
    })),
    ...activeContext.referenceContext.skillCatalog.map(({ skillPath }) => ({
      sourceType: 'skill_catalog' as const,
      sourceId: skillPath,
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
      ...turn.source.responseMessageRefs.map(({ messageId }) => ({
        sourceType: 'session_message' as const,
        sourceId: messageId,
      })),
      ...turn.items.flatMap((item) => item.type === 'tool_result'
        ? [{ sourceType: 'tool_result' as const, sourceId: item.toolCallId }]
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
