/*
 * Provides the public Context Service entrypoint for session context and prompt construction.
 */
import {
  buildAgentResponsePrompt,
} from '../core/prompt-builder';
import { buildPromptParts } from '../core/prompt-parts';
import type {
  BuildPromptRequest,
  BuildPromptResult,
  GetSessionContextRequest,
  GetSessionContextResult,
  PromptMessage,
  SessionContextSource,
} from '../contracts/context-contracts';

export interface ContextSessionFactRepository {
  listMessagesBySession(sessionId: string): Array<{
    messageId: string;
    sessionId?: string;
    role: 'user' | 'assistant';
    content: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    metadata?: Record<string, unknown>;
  }>;
  listSessionCompactionsBySession(sessionId: string): Array<{
    compactionId: string;
    summary: string;
    status: 'completed';
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  listRuntimeFactsBySession(sessionId: string): Array<{
    factId: string;
    text: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
  }>;
  listToolResultsBySession(sessionId: string): Array<{
    toolResultId: string;
    text: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ContextInstructionSourcePort {
  loadInstructionSources(input: {
    projectRoot?: string;
    effectiveCwd?: string;
    globalInstructionDirs?: string[];
    loadedAt: string;
  }): Promise<Array<{
    sourceId: string;
    status: 'included' | 'included_truncated' | 'missing' | 'unavailable' | 'read_failed';
    text?: string;
    relativePath?: string;
    sourceUri?: string;
    loadedAt: string;
    metadata?: Record<string, unknown>;
  }>>;
}

export interface PromptLogPort {
  writePrompt(input: {
    prompt_id: string;
    purpose: 'agent_response' | 'context_compaction';
    session_id: string;
    messages: PromptMessage[];
    created_at: string;
  }): void;
}

export interface ContextSkillSourcePort {
  getSkillCatalog(request: { workspaceId?: string }): Promise<
    | { status: 'ok'; skills: Array<{ skillId: string; name: string; description: string }> }
    | { status: 'failed'; message: string }
  >;
}

export class ContextService {
  constructor(private readonly options: {
    repository: ContextSessionFactRepository;
    instructionSource?: ContextInstructionSourcePort;
    skillSource?: ContextSkillSourcePort;
    promptResources: {
      system_prompt: string;
    };
    promptLog?: PromptLogPort;
    clock?: { now(): string };
    ids?: { promptId(): string };
    projectRootProvider?: (input: { session_id: string; workspace_id?: string }) => string | undefined;
  }) {}

  async getSessionContext(request: GetSessionContextRequest): Promise<GetSessionContextResult> {
    try {
      const sources: SessionContextSource[] = [];
      const messages = this.options.repository.listMessagesBySession(request.session_id)
        .filter((message) => message.status === 'completed')
        .map((message): SessionContextSource => ({
          source_id: message.messageId,
          source_kind: 'session_message',
          text: message.content,
          persisted: true,
          created_at: message.createdAt,
          metadata: filterMetadata({
            ...message.metadata,
            role: message.role,
            completed_at: message.completedAt,
            origin_module: 'session',
          }),
        }));
      sources.push(...messages);

      const compactions = this.options.repository.listSessionCompactionsBySession(request.session_id)
        .filter((compaction) => compaction.status === 'completed')
        .map((compaction): SessionContextSource => ({
          source_id: compaction.compactionId,
          source_kind: 'context_compaction_summary',
          text: compaction.summary,
          persisted: true,
          created_at: compaction.createdAt,
          metadata: filterMetadata({
            ...compaction.metadata,
            origin_module: 'context',
          }),
        }));
      sources.push(...compactions);

      sources.push(...this.options.repository.listRuntimeFactsBySession(request.session_id)
        .map((fact): SessionContextSource => ({
          source_id: fact.factId,
          source_kind: 'runtime_fact',
          text: fact.text,
          persisted: true,
          created_at: fact.createdAt,
          metadata: filterMetadata({
            ...fact.metadata,
            origin_module: 'agent-run',
          }),
        })));

      sources.push(...this.options.repository.listToolResultsBySession(request.session_id)
        .map((result): SessionContextSource => ({
          source_id: result.toolResultId,
          source_kind: 'tool_result',
          text: result.text,
          persisted: true,
          created_at: result.createdAt,
          metadata: filterMetadata({
            ...result.metadata,
            origin_module: 'tools',
          }),
        })));

      if (this.options.instructionSource) {
        const loadedAt = this.now();
        const instructionSources = await this.options.instructionSource.loadInstructionSources({
          projectRoot: this.options.projectRootProvider?.({
            session_id: request.session_id,
            workspace_id: request.workspace_id,
          }),
          loadedAt,
        });
        sources.push(...instructionSources
          .filter((source) => source.status === 'included' || source.status === 'included_truncated')
          .map((source): SessionContextSource => ({
            source_id: source.sourceId,
            source_kind: 'agent_instruction',
            text: source.text ?? '',
            persisted: false,
            created_at: source.loadedAt,
            metadata: filterMetadata({
              ...source.metadata,
              status: source.status,
              relative_path: source.relativePath,
              source_uri: source.sourceUri,
              origin_module: 'context',
            }),
          })));
      }

      if (request.memory_recall) {
        sources.push({
          source_id: request.memory_recall.memory_id,
          source_kind: 'memory_recall_result',
          text: request.memory_recall.text,
          persisted: false,
          metadata: filterMetadata({
            score: request.memory_recall.score,
            ...request.memory_recall.metadata,
            origin_module: 'memory',
          }),
        });
      }

      if (this.options.skillSource && request.purpose !== 'context_compaction') {
        const catalog = await this.options.skillSource.getSkillCatalog({
          ...(request.workspace_id ? { workspaceId: request.workspace_id } : {}),
        });
        if (catalog.status === 'ok' && catalog.skills.length > 0) {
          sources.push({
            source_id: 'skill-catalog',
            source_kind: 'skill_catalog',
            text: renderSkillCatalog(catalog.skills),
            persisted: false,
            metadata: { origin_module: 'skills' },
          });
        }
      }

      return {
        status: 'ok',
        session_context: {
          session_id: request.session_id,
          ...(request.workspace_id ? { workspace_id: request.workspace_id } : {}),
          sources,
        },
      };
    } catch (error) {
      return {
        status: 'failed',
        failure: {
          code: 'context_session_read_failed',
          message: error instanceof Error ? error.message : 'Failed to read session context.',
        },
      };
    }
  }

  buildPrompt(request: BuildPromptRequest): BuildPromptResult {
    if (!request.session_context.session_id) {
      return {
        status: 'failed',
        reason: 'invalid_session_context',
        failure: {
          code: 'invalid_session_context',
          message: 'Session context must include a session_id.',
        },
      };
    }

    const partsResult = buildPromptParts({
      session_context: request.session_context,
      purpose: request.purpose,
      current_user_message_id: request.current_user_message_id,
      runtime_sources: request.runtime_sources,
    });

    if (partsResult.status === 'failed') {
      return {
        status: 'failed',
        reason: partsResult.reason,
        failure: {
          code: partsResult.reason,
          message: partsResult.message,
        },
      };
    }

    try {
      const prompt = buildAgentResponsePrompt({
        prompt_id: this.options.ids?.promptId() ?? `prompt:${Date.now()}`,
        parts: partsResult.parts,
        prompt_resources: {
          system_prompt: this.options.promptResources.system_prompt,
        },
      });
      this.writePromptLog({
        prompt_id: prompt.prompt_id,
        purpose: prompt.purpose,
        session_id: request.session_context.session_id,
        messages: prompt.messages,
      });

      return { status: 'ok', prompt };
    } catch (error) {
      return {
        status: 'failed',
        reason: 'prompt_build_failed',
        failure: {
          code: 'prompt_build_failed',
          message: error instanceof Error ? error.message : 'Failed to build prompt.',
        },
      };
    }
  }

  private writePromptLog(input: {
    prompt_id: string;
    purpose: 'agent_response' | 'context_compaction';
    session_id: string;
    messages: PromptMessage[];
  }): void {
    try {
      this.options.promptLog?.writePrompt({
        prompt_id: input.prompt_id,
        purpose: input.purpose,
        session_id: input.session_id,
        messages: input.messages,
        created_at: this.now(),
      });
    } catch {
      // Prompt logging is developer-only observability and must not affect agent execution.
    }
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function renderSkillCatalog(skills: Array<{ skillId: string; description: string }>): string {
  return [
    'Available Skills',
    '',
    'The following skills are available for this workspace.',
    'If a skill can help with the current task, call the activate_skill tool with the corresponding exact skillId.',
    '',
    ...skills.map((skill) => [
      `- skillId: ${skill.skillId}`,
      `  description: ${skill.description}`,
    ].join('\n')),
  ].join('\n');
}

function filterMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const forbiddenKeys = new Set(['provider_state', 'previous_response_id', 'conversation_id']);
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .filter(([key]) => !forbiddenKeys.has(key));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
