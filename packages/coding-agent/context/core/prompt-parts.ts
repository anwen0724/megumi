/*
 * Organizes session context sources into internal prompt parts.
 */
import type {
  PromptSourceRef,
  SessionContext,
  SessionContextSource,
} from '../contracts/context-contracts';

export type PromptPart = {
  part_id: string;
  part_kind:
    | 'system_prompt'
    | 'agent_instruction'
    | 'session_message'
    | 'context_compaction_summary'
    | 'runtime_fact'
    | 'tool_result'
    | 'memory'
    | 'current_user_message'
    | 'context_compaction_candidate';
  text: string;
  source_refs: PromptSourceRef[];
  priority: number;
  required: boolean;
  trim_policy: 'none' | 'truncate';
  metadata?: Record<string, unknown>;
};

export type BuildPromptPartsInput = {
  session_context: SessionContext;
  purpose: 'agent_response' | 'context_compaction';
  current_user_message_id?: string;
  runtime_sources?: SessionContextSource[];
};

export type BuildPromptPartsResult =
  | { status: 'ok'; parts: PromptPart[] }
  | { status: 'failed'; reason: 'invalid_session_context' | 'missing_required_prompt_part'; message: string };

const SOURCE_KIND_RANK: Record<SessionContextSource['source_kind'], number> = {
  agent_instruction: 0,
  context_compaction_summary: 1,
  session_message: 2,
  runtime_fact: 3,
  tool_result: 4,
  memory_recall_result: 5,
};

export function buildPromptParts(input: BuildPromptPartsInput): BuildPromptPartsResult {
  if (!input.session_context.session_id || !Array.isArray(input.session_context.sources)) {
    return {
      status: 'failed',
      reason: 'invalid_session_context',
      message: 'Session context must include a session_id and sources array.',
    };
  }

  const seen = new Set<string>();
  const coveredSourceIds = new Set<string>();

  const sources = [
    ...input.session_context.sources,
    ...(input.runtime_sources ?? []),
  ];

  for (const source of sources) {
    const covered = source.metadata?.covered_source_ids;
    if (source.source_kind === 'context_compaction_summary' && Array.isArray(covered)) {
      for (const sourceId of covered) {
        if (typeof sourceId === 'string') {
          coveredSourceIds.add(sourceId);
        }
      }
    }
  }

  const parts: PromptPart[] = [];

  for (const source of sources) {
    const key = `${source.source_kind}:${source.source_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (source.source_kind === 'session_message' && coveredSourceIds.has(source.source_id)) {
      continue;
    }

    if ((source.source_kind === 'agent_instruction' || source.source_kind === 'context_compaction_summary')
      && source.text.trim().length === 0) {
      return {
        status: 'failed',
        reason: 'missing_required_prompt_part',
        message: `Required prompt source ${source.source_id} is empty.`,
      };
    }

    const part = createPromptPart(source, input);
    if (part) {
      parts.push(part);
    }
  }

  parts.sort((left, right) => {
    const leftRank = rankPart(left);
    const rightRank = rankPart(right);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return right.priority - left.priority;
  });

  return { status: 'ok', parts };
}

function createPromptPart(source: SessionContextSource, input: BuildPromptPartsInput): PromptPart | undefined {
  const sourceRef: PromptSourceRef = {
    source_id: source.source_id,
    source_kind: source.source_kind,
    ...(source.metadata?.origin_module ? { origin_module: source.metadata.origin_module as PromptSourceRef['origin_module'] } : {}),
  };

  if (input.purpose === 'context_compaction' && source.source_kind !== 'agent_instruction') {
    return {
      part_id: source.source_id,
      part_kind: 'context_compaction_candidate',
      text: source.text,
      source_refs: [sourceRef],
      priority: priorityForSource(source),
      required: false,
      trim_policy: 'truncate',
      ...(source.metadata ? { metadata: source.metadata } : {}),
    };
  }

  const partKind = source.source_kind === 'memory_recall_result'
    ? 'memory'
    : source.source_kind === 'session_message' && source.source_id === input.current_user_message_id
      ? 'current_user_message'
      : source.source_kind;

  return {
    part_id: source.source_id,
    part_kind: partKind,
    text: source.text,
    source_refs: [sourceRef],
    priority: priorityForSource(source),
    required: source.source_kind === 'agent_instruction'
      || source.source_kind === 'context_compaction_summary'
      || partKind === 'current_user_message',
    trim_policy: source.source_kind === 'agent_instruction' || partKind === 'current_user_message' ? 'none' : 'truncate',
    ...(source.metadata ? { metadata: source.metadata } : {}),
  };
}

function rankPart(part: PromptPart): number {
  if (part.part_kind === 'current_user_message') {
    return SOURCE_KIND_RANK.session_message;
  }
  if (part.part_kind === 'memory') {
    return SOURCE_KIND_RANK.memory_recall_result;
  }
  if (part.part_kind === 'context_compaction_candidate') {
    return SOURCE_KIND_RANK.session_message;
  }
  return SOURCE_KIND_RANK[part.part_kind as SessionContextSource['source_kind']] ?? 99;
}

function priorityForSource(source: SessionContextSource): number {
  switch (source.source_kind) {
    case 'agent_instruction':
      return 100;
    case 'context_compaction_summary':
      return 90;
    case 'session_message':
      return 60;
    case 'runtime_fact':
      return 50;
    case 'tool_result':
      return 40;
    case 'memory_recall_result':
      return 30;
  }
}
