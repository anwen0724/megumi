/*
 * Defines the provider-neutral prompt, its semantic partitions, and preparation trace.
 */
import type { ContentBlock, ConversationItem, ToolSetEntry } from '@megumi/ai';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
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

export type PromptInstructions = {
  system: SystemInstruction[];
  agentInstructions: EffectiveAgentInstructions;
};

export type PromptRunContext = { skills: UsedSkillContent[] };

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

export type PromptReferenceContext = {
  skillCatalog: SkillCatalogItem[];
  compactionSummary?: VisibleCompactionSummary;
  memoryRecall?: MemoryContextInput;
};

export type Prompt = {
  instructions: PromptInstructions;
  referenceContext: PromptReferenceContext;
  runContext: PromptRunContext;
  conversation: ConversationItem[];
  tools: ToolSetEntry[];
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
  prompt: Prompt;
  usage: ContextUsage;
  sourceRefs: ContextSourceRef[];
  compaction?: CompactionResultRef;
};
