/* Verifies Context.build reads Session History through the fixed ModelCallContext main chain. */
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
  type Prompt,
} from '../../../packages/agent/context/src/index';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import {
  compactingModel,
  completedMessage,
  history,
  model,
  modelCall,
  runHistory,
  workspaceSource,
} from './context-test-fixtures';
import type { SessionHistoryItem } from '@megumi/session';

function fixture(tokens = 50): CreateContextOptions {
  return {
    sessionHistory: {
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: history() })),
      beginCompaction: vi.fn((request) => ({
        status: 'started' as const,
        compaction: {
          compactionId: request.compactionId,
          sessionId: request.sessionId,
          anchorEntryId: request.anchorEntryId,
          trigger: request.trigger,
          status: 'running' as const,
          startedAt: request.startedAt,
        },
      })),
      completeCompaction: vi.fn((request) => ({
        status: 'completed' as const,
        compaction: {
          compactionId: request.compactionId,
          sessionId: request.sessionId,
          anchorEntryId: request.coveredUntilEntryId,
          trigger: 'threshold' as const,
          status: 'completed' as const,
          startedAt: '2026-07-12T00:00:00.000Z',
          completedAt: request.completedAt,
        },
      })),
      endCompaction: vi.fn((request) => ({
        status: 'ended' as const,
        compaction: {
          compactionId: request.compactionId,
          sessionId: request.sessionId,
          anchorEntryId: 'entry:user:1',
          trigger: 'threshold' as const,
          status: request.status,
          ...(request.error ? { error: request.error } : {}),
          startedAt: '2026-07-12T00:00:00.000Z',
          completedAt: request.completedAt,
        },
      })),
    },
    attachmentReader: {
      readAttachmentContent: vi.fn(async () => ({
        status: 'failed' as const,
        failure: { code: 'attachment_not_found', message: 'not found' },
      })),
    },
    workspaceSource: workspaceSource(),
    instructionReader: {
      getSystemInstructions: vi.fn(async () => [
        { instructionId: 'megumi.common', sourcePath: '/instructions/common.md', content: 'system' },
      ]),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: {
          sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }],
        },
      })),
    },
    skills: {
      createView: vi.fn(async () => ({ status: 'ok' as const, view: { catalog: [], diagnostics: [] } })),
    },
    models: { completeSimple: vi.fn(async () => completedMessage()) },
    contextTokenEstimator: vi.fn(() => tokens),
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { compactionId: () => 'compaction:1' },
  };
}

describe('Context.build', () => {
  it('builds Daily Recommendation from a fixed Pool window without Source or Search facts', async () => {
    const options = fixture();
    const currentMessages = [{
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Choose today recommendations.' }],
      timestamp: 1,
    }];
    const result = await createContext(options).build({
      modelCallContext: {
        modelCallId: 'model-call:daily-recommendation',
        run: {
          kind: 'daily_recommendation',
          executionId: 'execution:daily',
          batchId: 'batch:daily',
          localDate: '2026-08-27',
          model,
          material: {
            requestedCount: 20,
            actualTarget: 2,
            availableCount: 2,
            readBudget: 2,
            interests: [{ interestId: 'interest:1', description: 'Agent architecture' }],
            candidates: [{
              candidateId: 'candidate:1', contentIdentity: 'identity:1', sourceName: 'example.com',
              canonicalUrl: 'https://example.com/guide', contentType: 'article', title: 'Agent guide',
              description: 'Compact candidate summary.', relevance: 'direct',
              matchedInterestIds: ['interest:1'], admissionReason: 'Directly useful.',
            }],
            recentRecommendations: [],
            recentFeedback: [],
          },
        },
        tools: [],
      },
      currentMessages,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(options.instructionReader.getSystemInstructions).toHaveBeenCalledWith('daily_recommendation');
    expect(options.sessionHistory.getActiveHistory).not.toHaveBeenCalled();
    expect(options.workspaceSource.readWorkspace).not.toHaveBeenCalled();
    expect(result.prompt.messages).toEqual(currentMessages);
    expect(result.prompt.systemPrompt).toContain('<daily_recommendation_material>');
    expect(result.prompt.systemPrompt).toContain('Agent guide');
    expect(result.prompt.systemPrompt).not.toContain('<sources>');
    expect(result.prompt.systemPrompt).not.toContain('<recent_query_outcomes>');
  });

  it('builds Candidate Supply from one fixed snapshot and accumulated Tool messages', async () => {
    const options = fixture();
    const currentMessages = [{
      role: 'toolResult' as const,
      toolCallId: 'call:search',
      toolName: 'search_content',
      content: [{ type: 'text' as const, text: '{"candidates":["candidate:1"]}' }],
      isError: false,
      timestamp: 1,
    }];
    const result = await createContext(options).build({
      modelCallContext: {
        modelCallId: 'model-call:supply',
        run: {
          kind: 'candidate_supply', executionId: 'execution:supply', startedAt: '2026-08-27T00:00:00.000Z',
          model,
          material: {
            pool: {
              counts: { available: 0 }, lowWatermark: 10, target: 20, hardLimit: 40,
              totalShortfall: 20, uncoveredInterestIds: ['interest:1'], consumerShortfalls: [],
            },
            interests: [{ interestId: 'interest:1', description: 'Agent architecture' }],
            negativeConstraints: ['不要纯营销内容'],
            sources: [{
              id: 'open_web', name: 'Open Web', access: 'public_http', supportedModes: ['relevance'],
              supportsRead: true, availability: 'ready',
            }],
            recentQueryOutcomes: [], pendingCandidates: [],
            budget: { searchesRemaining: 12, readsRemaining: 40, rawResultsRemaining: 200 },
          },
        },
        tools: [],
      },
      currentMessages,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(options.instructionReader.getSystemInstructions).toHaveBeenCalledWith('candidate_supply');
    expect(options.sessionHistory.getActiveHistory).not.toHaveBeenCalled();
    expect(options.workspaceSource.readWorkspace).not.toHaveBeenCalled();
    expect(result.prompt.messages).toEqual(currentMessages);
    expect(result.prompt.systemPrompt).toContain('<candidate_supply_material>');
    expect(result.prompt.systemPrompt).toContain('Agent architecture');
    expect(result.prompt.systemPrompt).toContain('"totalShortfall":20');
  });

  it('preserves the original conversation System Prompt organization through the public Context seam', async () => {
    const options = fixture();
    options.instructionReader.getSystemInstructions = vi.fn(async () => [
      {
        instructionId: 'megumi.common',
        sourcePath: '/instructions/common.md',
        content: 'Original identity paragraph.',
      },
      {
        instructionId: 'megumi.conversation',
        sourcePath: '/instructions/conversation.md',
        content: 'Behavior guidelines:\n- Original fixed guidance.',
      },
    ]);
    const tool = {
      name: 'inspect_result',
      description: 'Inspect one result.',
      promptSnippet: 'Inspect result evidence.',
      promptGuidelines: ['Tool guidance remains in the same list.'],
      parameters: { type: 'object' as const },
    };
    const result = await createContext(options).build({
      modelCallContext: modelCall({ tools: [tool] }),
      currentMessages: [],
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.prompt.systemPrompt).toBe([
      'Original identity paragraph.',
      'Behavior guidelines:\n- Original fixed guidance.\n- Tool guidance remains in the same list.',
      '<effective_instructions>\n  User and project-specific instructions and guidelines:\n  <instruction path="/workspace/AGENTS.md">\n    rules\n  </instruction>\n</effective_instructions>',
      '<available_tools>\n  In addition to the tools above, you may have access to other custom tools depending on the project.\n- inspect_result: Inspect result evidence.\n</available_tools>',
      '<execution_environment>\n  <working_directory>/workspace/packages/app</working_directory>\n  <operating_system>Linux</operating_system>\n  <shell>POSIX shell</shell>\n</execution_environment>',
    ].join('\n\n'));
  });

  it('builds daily discovery from fixed material and current Agent messages without Session or Workspace reads', async () => {
    const options = fixture();
    const currentMessages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'start discovery' }], timestamp: 1 }];
    const result = await createContext(options).build({
      modelCallContext: {
        modelCallId: 'model-call:daily',
        run: {
          kind: 'daily_discovery',
          executionId: 'execution:daily',
          batchId: 'batch:daily',
          localDate: '2026-08-24',
          model,
          material: {
            targetCount: 20,
            interests: [{ interestId: 'interest:1', description: '秋招面试经验' }],
            sources: [{
              id: 'bilibili', name: '哔哩哔哩', access: 'public_http',
              supportedModes: ['recent'], supportsRead: false,
            }],
            recommendationSignals: [],
          },
        },
        tools: [],
      },
      currentMessages,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(options.instructionReader.getSystemInstructions).toHaveBeenCalledWith('daily_discovery');
    expect(options.sessionHistory.getActiveHistory).not.toHaveBeenCalled();
    expect(options.workspaceSource.readWorkspace).not.toHaveBeenCalled();
    expect(options.skills.createView).not.toHaveBeenCalled();
    expect(result.prompt.messages).toEqual(currentMessages);
    expect(result.prompt.systemPrompt).toContain('秋招面试经验');
    expect(result.prompt.systemPrompt).toContain('<target_count>20</target_count>');
  });

  it('reads Session History and returns one provider-neutral Prompt', async () => {
    const options = fixture();
    const context = createContext(options);
    const result = await context.build({ modelCallContext: modelCall() });

    expect(options.sessionHistory.getActiveHistory).toHaveBeenCalledWith({
      session_id: 'session:1',
    });
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The systemPrompt follows the fixed order and carries the Execution Environment.
    const systemPrompt = result.prompt.systemPrompt ?? '';
    expect(systemPrompt).toContain('system');
    expect(systemPrompt).toContain('<effective_instructions>');
    expect(systemPrompt).toContain('/workspace/AGENTS.md');
    expect(systemPrompt).toContain('<execution_environment>');
    expect(systemPrompt).toContain('<working_directory>/workspace/packages/app</working_directory>');
    // No Skill Catalog section when the catalog is empty.
    expect(systemPrompt).not.toContain('<available_skills>');
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(result.prompt.tools).toEqual([]);
  });

  it('writes the Skill Catalog into the System Prompt without re-reading Skill content', async () => {
    const options = fixture();
    options.skills.createView = vi.fn(async () => ({
      status: 'ok' as const,
      view: {
        catalog: [{ name: 'review', description: 'Review', skillPath: '/skills/review/SKILL.md' }],
        diagnostics: [],
      },
    }));
    const result = await createContext(options).build({ modelCallContext: modelCall() });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const systemPrompt = result.prompt.systemPrompt ?? '';
    expect(systemPrompt).toContain('<available_skills>');
    expect(systemPrompt).toContain('<name>review</name>');
    expect(systemPrompt).toContain('<location>/skills/review/SKILL.md</location>');
    // The skill section keeps pi's guidance lines with the Megumi tool name.
    expect(systemPrompt).toContain('The following skills provide specialized instructions for specific tasks.');
    expect(systemPrompt).toContain('Use the read_file tool to load a skill\'s file when the task matches its description.');
    expect(systemPrompt).toContain('resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.');
    // Explicit Skill body is never re-read by Context; it lives in the saved UserMessage.
    expect(JSON.stringify(result.prompt.messages)).not.toContain('Selected instructions.');
  });

  it('distinguishes cancellation, policy failure, and hard Context window exhaustion', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(await createContext(fixture()).build({
      modelCallContext: modelCall(),
      signal: aborted.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    // An invalid policy for the Model Context Window is a configuration failure.
    expect(await createContext({ ...fixture(), policy: { reserveTokens: 500 } }).build({
      modelCallContext: modelCall({
        run: { ...modelCall().run, model: { ...model, contextWindow: 100 } },
      }),
    })).toMatchObject({ status: 'failed', failure: { code: 'policy_invalid' } });

    const exhausted: CreateContextOptions = {
      ...fixture(20_000),
    };
    expect(await createContext(exhausted).build({
      modelCallContext: modelCall(),
    })).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('fails on invalid Tool Definitions without a generic build failure', async () => {
    const options = fixture();
    expect(await createContext(options).build({
      modelCallContext: modelCall({
        tools: [{ name: 'broken' } as never],
      }),
    })).toMatchObject({ status: 'failed', failure: { code: 'tool_definitions_invalid' } });
  });

  it('resolves Workspace, Instructions and Skills sources itself in fixed order', async () => {
    const options = fixture();
    const result = await createContext(options).build({ modelCallContext: modelCall() });

    expect(result.status).toBe('ready');
    expect(options.workspaceSource.readWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace:1' }),
    );
    expect(options.instructionReader.getEffectiveInstructions).toHaveBeenCalledWith(
      { workspaceRoot: '/workspace', workingDirectory: '/workspace/packages/app' },
      undefined,
    );
    expect(options.skills.createView).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace:1' }),
    );
  });

  it('keeps Workspace, Instructions and Skills failures under their own owners', async () => {
    const options = fixture();
    options.workspaceSource.readWorkspace = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'workspace_not_found', message: 'missing' },
    }));
    expect(await createContext(options).build({
      modelCallContext: modelCall(),
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'workspace_failed', cause: { owner: 'workspace', code: 'workspace_not_found' } },
    });

    (options as { workspaceSource: unknown }).workspaceSource = workspaceSource();
    options.instructionReader.getEffectiveInstructions = vi.fn(async () => ({
      status: 'failed' as const,
      failure: {
        code: 'instruction_source_read_failed' as const,
        message: 'unreadable',
        sourcePath: '/workspace/AGENTS.md',
      },
    }));
    expect(await createContext(options).build({
      modelCallContext: modelCall(),
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'effective_instructions_failed',
        cause: { owner: 'instructions', code: 'instruction_source_read_failed' },
      },
    });

    options.instructionReader.getEffectiveInstructions = vi.fn(async () => ({
      status: 'ok' as const,
      instructions: { sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }] },
    }));
    options.skills.createView = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'skills_unavailable' as const, message: 'broken view' },
    }));
    expect(await createContext(options).build({
      modelCallContext: modelCall(),
    })).toMatchObject({
      status: 'failed',
      failure: { code: 'skill_view_failed', cause: { owner: 'skills', code: 'skills_unavailable' } },
    });
  });

  it('records real resolve and final Prompt checkpoints under the Context build Span', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createTraceRecorder({ enqueue: (record) => { records.push(record); } });
    const options = { ...fixture(50), observability };
    const result = await observability.withTrace({ kind: 'conversation' }, () => (
      createContext(options).build({ modelCallContext: modelCall() })
    ));
    expect(result.status).toBe('ready');
    expect(records.filter((record) => record.type === 'span.started').map((record) => record.name))
      .toEqual(['context.build', 'context.resolve', 'prompt.build']);
    expect(records.filter((record) => record.type === 'content.recorded').map((record) => record.kind))
      .toEqual(['context.resolved', 'prompt.final']);
  });

  it('never degrades known source, attachment, protocol and policy failures into a generic build failure', async () => {
    // Source failure stays under its owner.
    const sourceOptions = fixture();
    sourceOptions.sessionHistory.getActiveHistory = vi.fn(() => ({
      status: 'failed' as const,
      failure: { code: 'history_unreadable', message: 'unreadable' },
    }));
    expect(await createContext(sourceOptions).build({ modelCallContext: modelCall() })).toMatchObject({
      status: 'failed',
      failure: { code: 'session_history_failed' },
    });

    // Attachment materialization failure keeps its stable code.
    const imageOptions = fixture();
    imageOptions.sessionHistory.getActiveHistory = vi.fn(() => ({
      status: 'ok' as const,
      history: [{
        type: 'message' as const,
        entry: { entry_id: 'entry:user', session_id: 's', entry_type: 'message', message_id: 'm1', created_at: 'now' },
        message: {
          message_id: 'm1', session_id: 's', execution_id: 'r1', message_kind: 'user_message',
          display_content: [{ type: 'text', text: 'look' }],
          model_content: [{ type: 'text', text: 'look' }],
          created_at: 'now',
        },
        attachments: [{
          attachment_id: 'att:1', message_id: 'm1', session_id: 's', type: 'image',
          mime_type: 'image/png', source_type: 'host_reference', source_value: 'stored/x.png',
          ordinal: 0, created_at: 'now',
        }],
      }],
    }) as never);
    expect(await createContext(imageOptions).build({ modelCallContext: modelCall() })).toMatchObject({
      status: 'failed',
      failure: { code: 'image_materialization_failed' },
    });

    // Protocol closure failure keeps its stable code.
    const protocolOptions = fixture();
    protocolOptions.sessionHistory.getActiveHistory = vi.fn(() => ({
      status: 'ok' as const,
      history: [{
        type: 'message' as const,
        entry: { entry_id: 'entry:tool', session_id: 's', entry_type: 'message', message_id: 'm2', created_at: 'now' },
        message: {
          message_id: 'm2', session_id: 's', execution_id: 'r1', message_kind: 'tool_result',
          tool_call_id: 'call:missing', tool_name: 'read_file', status: 'success',
          content: [{ type: 'text', text: 'ok' }], created_at: 'now',
        },
        attachments: [],
      }],
    }) as never);
    expect(await createContext(protocolOptions).build({ modelCallContext: modelCall() })).toMatchObject({
      status: 'failed',
      failure: { code: 'protocol_closure_failed' },
    });

    // Policy failure stays a configuration failure.
    expect(await createContext({ ...fixture(), policy: { reserveTokens: 500 } }).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: { ...model, contextWindow: 100 } } }),
    })).toMatchObject({ status: 'failed', failure: { code: 'policy_invalid' } });
  });

  it('converts unexpected dependency exceptions into the stable unknown build failure', async () => {
    const options = fixture();
    options.sessionHistory.getActiveHistory = vi.fn(() => {
      throw new Error('database unavailable');
    });

    await expect(createContext(options).build({ modelCallContext: modelCall() })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'context_build_failed',
        message: 'database unavailable',
        retryable: false,
      },
    });
  });

  it('keeps the business result when Observability throws', async () => {
    const throwingObservability = {
      withTrace: vi.fn(() => { throw new Error('trace broken'); }),
      withSpan: vi.fn(() => { throw new Error('span broken'); }),
      recordContent: vi.fn(() => { throw new Error('capture broken'); }),
      recordEvent: vi.fn(() => { throw new Error('event broken'); }),
      linkTrace: vi.fn(() => { throw new Error('link broken'); }),
    } satisfies NonNullable<CreateContextOptions['observability']>;
    const result = await createContext({ ...fixture(), observability: throwingObservability }).build({
      modelCallContext: modelCall(),
    });
    expect(result.status).toBe('ready');
  });

  it('executes the business operation exactly once when Observability wraps it and then throws', async () => {
    const options = fixture();
    let reads = 0;
    options.sessionHistory.getActiveHistory = vi.fn(() => {
      reads += 1;
      return { status: 'ok' as const, history: history() };
    });
    const observability = {
      withTrace: vi.fn(() => { throw new Error('unused'); }),
      withSpan: vi.fn(async (_options: unknown, operation: () => Promise<unknown>) => {
        // The wrapper starts the business operation, then breaks.
        const started = operation();
        started.catch(() => undefined);
        throw new Error('span context broken after starting the operation');
      }),
      recordContent: vi.fn(),
      recordEvent: vi.fn(),
      linkTrace: vi.fn(),
    } satisfies NonNullable<CreateContextOptions['observability']>;

    const result = await createContext({ ...options, observability }).build({ modelCallContext: modelCall() });
    // The first business result wins; the source reads and build ran once.
    expect(result.status).toBe('ready');
    expect(reads).toBe(1);
    expect(options.workspaceSource.readWorkspace).toHaveBeenCalledTimes(1);
  });

  it('converges Skills cancellation to the stable cancelled failure', async () => {
    // createView reports the cancelled code: the failure is a cancellation.
    const cancelledViewOptions = fixture();
    cancelledViewOptions.skills.createView = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'cancelled' as const },
    }));
    expect(await createContext(cancelledViewOptions).build({ modelCallContext: modelCall() }))
      .toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    // The request signal is aborted while the Skills read is in flight.
    const controller = new AbortController();
    const abortedOptions = fixture();
    abortedOptions.skills.createView = vi.fn(async () => {
      controller.abort();
      return { status: 'ok' as const, view: { catalog: [], diagnostics: [] } };
    });
    expect(await createContext(abortedOptions).build({
      modelCallContext: modelCall(),
      signal: controller.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    // Non-cancelled Skills failures keep their owner and original code.
    const brokenOptions = fixture();
    brokenOptions.skills.createView = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'skill_unavailable' as const, skillPath: '/skills/review/SKILL.md' },
    }));
    expect(await createContext(brokenOptions).build({ modelCallContext: modelCall() })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'skill_view_failed',
        cause: { owner: 'skills', code: 'skill_unavailable' },
      },
    });
  });

  it('returns policy_invalid for illegal Compaction Policy configurations on build and compact', async () => {
    const illegalPolicies: Array<Partial<NonNullable<CreateContextOptions['policy']>>> = [
      { reserveTokens: -1 },
      { reserveTokens: 1.5 },
      { keepRecentTokens: Number.NaN },
      { minimumRecentMessages: -3 },
    ];
    for (const illegal of illegalPolicies) {
      const options = fixture();
      (options as { policy: unknown }).policy = illegal;
      expect(await createContext(options).build({ modelCallContext: modelCall() }), JSON.stringify(illegal))
        .toMatchObject({ status: 'failed', failure: { code: 'policy_invalid' } });
      expect(await createContext(options).compact({
        sessionId: 'session:1',
        workspaceId: 'workspace:1',
        model: compactingModel,
        trigger: 'manual',
        tools: [],
      }), JSON.stringify(illegal)).toMatchObject({ status: 'failed', failure: { code: 'policy_invalid' } });
      expect(options.models.completeSimple, JSON.stringify(illegal)).not.toHaveBeenCalled();
    }
  });

  it('classifies failed and cancelled Context build Span outcomes', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createTraceRecorder({ enqueue: (record) => { records.push(record); } });

    const failedOptions = { ...fixture(), observability };
    failedOptions.sessionHistory.getActiveHistory = vi.fn(() => {
      throw new Error('database unavailable');
    });
    await observability.withTrace({ kind: 'conversation' }, () => (
      createContext(failedOptions).build({ modelCallContext: modelCall() })
    ));

    const controller = new AbortController();
    controller.abort();
    await observability.withTrace({ kind: 'conversation' }, () => (
      createContext({ ...fixture(), observability }).build({
        modelCallContext: modelCall(),
        signal: controller.signal,
      })
    ));
    const contextEnds = records.filter((record): record is Extract<TraceJournalRecord, {
      readonly type: 'span.ended';
    }> => record.type === 'span.ended').filter((record) => {
      const started = records.find((candidate) => (
        candidate.type === 'span.started' && candidate.spanId === record.spanId
      ));
      return started?.type === 'span.started' && started.name === 'context.build';
    });
    expect(contextEnds.map((record) => record.outcome.status)).toEqual(['error', 'cancelled']);
  });

  it('re-reads the authoritative Session after automatic compaction and rebuilds the final Prompt', async () => {
    const order: string[] = [];
    let reads = 0;
    const fullHistory = [...runHistory(1), ...runHistory(2)];
    const compactedHistory: SessionHistoryItem[] = [
      {
        type: 'compaction',
        entry: {
          entry_id: 'entry:summary',
          session_id: 'session:1',
          parent_entry_id: 'entry:user:1',
          entry_type: 'compaction',
          compaction_id: 'compaction:1',
          created_at: 'now',
        },
        compaction: {
          compaction_id: 'compaction:1',
          session_id: 'session:1',
          summary_text: 'replacement summary',
          covered_until_entry_id: 'entry:user:2',
          first_kept_entry_id: 'entry:assistant:2',
          created_at: 'now',
        },
      },
      ...fullHistory.slice(2),
    ];
    const options: CreateContextOptions = {
      ...fixture(),
      sessionHistory: {
        getActiveHistory: vi.fn(() => {
          reads += 1;
          order.push('resolve');
          return {
            status: 'ok' as const,
            history: reads === 1 ? fullHistory : compactedHistory,
          };
        }),
        beginCompaction: vi.fn((request) => ({
          status: 'started' as const,
          compaction: {
            compactionId: request.compactionId,
            sessionId: request.sessionId,
            anchorEntryId: request.anchorEntryId,
            trigger: request.trigger,
            status: 'running' as const,
            startedAt: request.startedAt,
          },
        })),
        completeCompaction: vi.fn((request) => {
          order.push('save');
          return {
            status: 'completed' as const,
            compaction: {
              compactionId: request.compactionId,
              sessionId: request.sessionId,
              anchorEntryId: request.coveredUntilEntryId,
              trigger: 'threshold' as const,
              status: 'completed' as const,
              startedAt: '2026-07-12T00:00:00.000Z',
              completedAt: request.completedAt,
            },
          };
        }),
        endCompaction: vi.fn((request) => ({
          status: 'ended' as const,
          compaction: {
            compactionId: request.compactionId,
            sessionId: request.sessionId,
            anchorEntryId: 'entry:user:2',
            trigger: 'threshold' as const,
            status: request.status,
            ...(request.error ? { error: request.error } : {}),
            startedAt: '2026-07-12T00:00:00.000Z',
            completedAt: request.completedAt,
          },
        })),
      },
      contextTokenEstimator: vi.fn((prompt: Prompt) => {
        order.push('estimate');
        return prompt.messages.length * 60 + (prompt.systemPrompt ? 10 : 0);
      }),
      policy: { enabled: true, reserveTokens: 32, keepRecentTokens: 1, minimumRecentMessages: 1 },
    };
    const result = await createContext(options).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    // The fixed rebuild order: Resolver -> Prompt -> Usage -> Policy ->
    // Compaction -> Resolver -> Prompt -> Usage.
    expect(order.filter((entry) => entry === 'resolve')).toHaveLength(2);
    expect(order.indexOf('save')).toBeGreaterThan(order.indexOf('resolve'));
    expect(order.lastIndexOf('resolve')).toBeGreaterThan(order.indexOf('save'));
    expect(order.indexOf('estimate')).toBeLessThan(order.indexOf('save'));
    expect(order.lastIndexOf('estimate')).toBeGreaterThan(order.lastIndexOf('resolve'));
    // The final Prompt comes from the re-read authoritative history: the
    // committed Summary plus the genuinely kept messages.
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(JSON.stringify(result.prompt.messages)).toContain('replacement summary');
    expect(JSON.stringify(result.prompt.messages)).toContain('answer 2');
  });
});
