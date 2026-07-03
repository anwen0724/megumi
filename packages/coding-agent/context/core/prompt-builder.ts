/*
 * Builds model-call prompts from Context prompt parts and injected static prompt resources.
 */
import type { Prompt, PromptSourceRef } from '../contracts/context-contracts';
import type { PromptPart } from './prompt-parts';

export type PromptResources = {
  system_prompt: string;
  context_compaction_prompt: string;
};

export type BuildAgentResponsePromptInput = {
  prompt_id: string;
  parts: PromptPart[];
  prompt_resources: Pick<PromptResources, 'system_prompt'>;
};

export type BuildContextCompactionPromptInput = {
  prompt_id: string;
  parts: PromptPart[];
  prompt_resources: Pick<PromptResources, 'context_compaction_prompt'>;
};

export function buildAgentResponsePrompt(input: BuildAgentResponsePromptInput): Prompt {
  const contextParts = input.parts.filter((part) => part.part_kind !== 'current_user_message');
  const currentUserParts = input.parts.filter((part) => part.part_kind === 'current_user_message');
  const contextSourceRefs = collectSourceRefs(contextParts);
  const userSourceRefs = collectSourceRefs(currentUserParts);
  const systemContent = [
    input.prompt_resources.system_prompt,
    renderAgentContextBlock(contextParts),
  ].filter(Boolean).join('\n\n');

  return {
    prompt_id: input.prompt_id,
    purpose: 'agent_response',
    messages: [
      {
        role: 'system',
        content: systemContent,
        source_refs: contextSourceRefs,
      },
      ...currentUserParts.map((part) => ({
        role: 'user' as const,
        content: part.text,
        source_refs: part.source_refs,
      })),
    ],
    source_refs: [...contextSourceRefs, ...userSourceRefs],
  };
}

export function buildContextCompactionPrompt(input: BuildContextCompactionPromptInput): Prompt {
  const sourceRefs = collectSourceRefs(input.parts);

  return {
    prompt_id: input.prompt_id,
    purpose: 'context_compaction',
    messages: [
      {
        role: 'system',
        content: input.prompt_resources.context_compaction_prompt,
      },
      {
        role: 'user',
        content: renderCompactionCandidates(input.parts),
        source_refs: sourceRefs,
      },
    ],
    source_refs: sourceRefs,
  };
}

function renderAgentContextBlock(parts: PromptPart[]): string {
  if (parts.length === 0) {
    return '';
  }

  return [
    '<session_context>',
    ...parts.map((part) => renderPart(part)),
    '</session_context>',
  ].join('\n');
}

function renderCompactionCandidates(parts: PromptPart[]): string {
  return [
    '<context_compaction_candidates>',
    ...parts.map((part) => renderPart(part)),
    '</context_compaction_candidates>',
  ].join('\n');
}

function renderPart(part: PromptPart): string {
  return `<${part.part_kind} source="${part.part_id}">\n${part.text}\n</${part.part_kind}>`;
}

function collectSourceRefs(parts: PromptPart[]): PromptSourceRef[] {
  const seen = new Set<string>();
  const refs: PromptSourceRef[] = [];

  for (const part of parts) {
    for (const ref of part.source_refs) {
      const key = `${ref.source_kind}:${ref.source_id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push(ref);
    }
  }

  return refs;
}
