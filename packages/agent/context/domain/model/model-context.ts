/*
 * Defines Context-owned semantic inputs and the prepared AI Context returned to Agent Run.
 */
import type { Context, Tool } from '@megumi/ai';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
import type { ContentBlock } from '../../../model-content';
import type { CompactionResultRef } from './compaction';
import type { ContextUsage } from './context-usage';

export type SystemInstruction = {
  instructionId: string;
  content: string;
};

export type AgentInstructionSource = {
  sourceId: string;
  sourcePath: string;
  content: string;
};

export type EffectiveAgentInstructions = {
  sources: AgentInstructionSource[];
};

export type ContextInstructions = {
  system: SystemInstruction[];
  agentInstructions: EffectiveAgentInstructions;
};

export type RunContext = { skills: UsedSkillContent[] };

export type VisibleCompactionSummary = {
  compactionId: string;
  content: string;
};

export type MemoryReferenceItem = {
  memoryId: string;
  content: ContentBlock[];
};

export type MemoryContextInput = {
  recallId: string;
  items: MemoryReferenceItem[];
};

export type ReferenceContext = {
  skillCatalog: SkillCatalogItem[];
  compactionSummary?: VisibleCompactionSummary;
  memoryRecall?: MemoryContextInput;
};

export type ContextSourceRef = {
  sourceType:
    | 'system_instruction'
    | 'agent_instruction'
    | 'skill_catalog'
    | 'used_skill'
    | 'compaction_summary'
    | 'session_message'
    | 'current_run_item'
    | 'memory'
    | 'tool_definition'
    | 'tool_result';
  sourceId: string;
};

export type PreparedModelCall = {
  preparationId: string;
  context: Context;
  usage: ContextUsage;
  sourceRefs: ContextSourceRef[];
  compaction?: CompactionResultRef;
};

export type ContextToolSet = Tool[];
