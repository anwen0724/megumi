/*
 * Normalizes one validated Case and installs its pre-run state through real Owner contracts.
 */
import path from 'node:path';
import { createDatabase, migrateDatabase } from '@megumi/database';
import { initializeDiscoveryState } from '@megumi/discovery';
import { resolveInitialDiscoveryState } from './initial-discovery-state';
import { createSessionCatalog, createSessionHistory } from '@megumi/session';
import { createSessionStore } from '@megumi/session/store';
import { createWorkspaceCatalog } from '@megumi/workspace';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import { createWorkspaceStore } from '@megumi/workspace/store';
import type { EvaluationCase, WorkspaceFileData } from '../contracts/evaluation-dataset';

type ConversationCase = Extract<EvaluationCase, { readonly type: 'conversation' }>;
type InterestUnderstandingCase = Extract<EvaluationCase, { readonly type: 'interest_understanding' }>;
type CandidateSupplyCase = Extract<EvaluationCase, { readonly type: 'candidate_supply' }>;
type RecommendationCase = Extract<EvaluationCase, { readonly type: 'recommendation' }>;
type PreferenceLearningCase = Extract<EvaluationCase, { readonly type: 'preference_learning' }>;

export interface CaseInitialState {
  readonly clock: string;
  readonly interestEvidence?: InterestUnderstandingCase['initialState']['existingEvidence'];
  readonly recommendationTargetCount: number;
  readonly recommendationWorkingSetCount: number;
  readonly candidatePoolMinimumCount: number;
  readonly candidatePoolMaximumCount: number;
  readonly workspaceFiles: readonly WorkspaceFileData[];
  readonly sessions: readonly ConversationCase['initialState']['sessionHistory'][number][];
  readonly interests: readonly CandidateSupplyCase['initialState']['interests'][number][];
  readonly candidates: readonly RecommendationCase['initialState']['candidates'][number][];
  readonly recommendations: readonly PreferenceLearningCase['initialState']['recommendations'][number][];
  readonly preferences: readonly PreferenceLearningCase['initialState']['preferences'][number][];
  readonly existingReactions: readonly PreferenceLearningCase['initialState']['existingReactions'][number][];
  readonly controlledSources: readonly CandidateSupplyCase['initialState']['controlledSources'][number][];
  readonly approvalDecisions: readonly ConversationCase['initialState']['approvalDecisions'][number][];
}

/** Maps each business-specific Case Initial State to the internal installation input. */
export function caseInitialState(evaluationCase: EvaluationCase): CaseInitialState {
  switch (evaluationCase.type) {
    case 'conversation':
      return {
        clock: evaluationCase.initialState.clock,
        recommendationTargetCount: 3,
        recommendationWorkingSetCount: 20,
        candidatePoolMinimumCount: 100,
        candidatePoolMaximumCount: 200,
        workspaceFiles: evaluationCase.initialState.workspaceFiles,
        sessions: evaluationCase.initialState.sessionHistory,
        interests: [], candidates: [], recommendations: [], preferences: [], existingReactions: [],
        controlledSources: evaluationCase.initialState.controlledWeb,
        approvalDecisions: evaluationCase.initialState.approvalDecisions,
      };
    case 'interest_understanding':
      return {
        clock: evaluationCase.initialState.clock,
        recommendationTargetCount: 3,
        recommendationWorkingSetCount: 20,
        candidatePoolMinimumCount: 100,
        candidatePoolMaximumCount: 200,
        workspaceFiles: [],
        sessions: [evaluationCase.initialState.sourceSession],
        ...(evaluationCase.initialState.existingEvidence ? { interestEvidence: evaluationCase.initialState.existingEvidence } : {}),
        interests: evaluationCase.initialState.existingInterests,
        candidates: [], recommendations: [], preferences: [], existingReactions: [], controlledSources: [],
        approvalDecisions: [],
      };
    case 'candidate_supply':
      return {
        clock: evaluationCase.initialState.clock,
        // Supply Cases author their own pool capacity; unrelated recommendation defaults must fit it.
        recommendationTargetCount: Math.min(3, evaluationCase.initialState.maximumCount),
        recommendationWorkingSetCount: Math.min(20, evaluationCase.initialState.maximumCount),
        candidatePoolMinimumCount: evaluationCase.initialState.minimumCount,
        candidatePoolMaximumCount: evaluationCase.initialState.maximumCount,
        workspaceFiles: [], sessions: [],
        interests: evaluationCase.initialState.interests,
        candidates: evaluationCase.initialState.existingCandidates,
        recommendations: [], preferences: [], existingReactions: [],
        controlledSources: evaluationCase.initialState.controlledSources,
        approvalDecisions: [],
      };
    case 'recommendation':
      return {
        clock: evaluationCase.initialState.clock,
        recommendationTargetCount: evaluationCase.initialState.recommendationTargetCount,
        recommendationWorkingSetCount: evaluationCase.initialState.recommendationWorkingSetCount,
        candidatePoolMinimumCount: 100,
        candidatePoolMaximumCount: 200,
        workspaceFiles: [], sessions: [],
        interests: evaluationCase.initialState.interests,
        candidates: evaluationCase.initialState.candidates,
        recommendations: evaluationCase.initialState.previousRecommendations,
        preferences: evaluationCase.initialState.preferences,
        existingReactions: [], controlledSources: [], approvalDecisions: [],
      };
    case 'preference_learning':
      return {
        clock: evaluationCase.initialState.clock,
        recommendationTargetCount: 3,
        recommendationWorkingSetCount: 20,
        candidatePoolMinimumCount: 100,
        candidatePoolMaximumCount: 200,
        workspaceFiles: [], sessions: [],
        interests: evaluationCase.initialState.interests,
        candidates: evaluationCase.initialState.candidates,
        recommendations: evaluationCase.initialState.recommendations,
        preferences: evaluationCase.initialState.preferences,
        existingReactions: evaluationCase.initialState.existingReactions,
        controlledSources: [], approvalDecisions: [],
      };
  }
}

export interface InstalledInitialStateIds {
  readonly workspaceId: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly interests: Readonly<Record<string, string>>;
  readonly candidates: Readonly<Record<string, string>>;
  readonly recommendations: Readonly<Record<string, string>>;
  readonly preferenceRevisions: readonly string[];
}

interface EvaluationInitialStateOwner {
  installWorkspace(input: { readonly rootPath: string }): Promise<{ readonly workspaceId: string }>;
  installSession(input: CaseInitialState['sessions'][number] & { readonly workspaceId: string }): Promise<{ readonly sessionId: string }>;
  installDiscovery(initial: CaseInitialState, ids: InstalledInitialStateIds): void;
}

/** Installs pre-existing facts, without invoking any tested business operation. */
export async function installInitialState(input: {
  readonly initialState: CaseInitialState;
  readonly workspaceRoot: string;
  readonly owner: EvaluationInitialStateOwner;
}): Promise<InstalledInitialStateIds> {
  const workspace = await input.owner.installWorkspace({ rootPath: input.workspaceRoot });
  const sessions: Record<string, string> = {};
  for (const entry of input.initialState.sessions) {
    sessions[entry.referenceId] = (await input.owner.installSession({ ...entry, workspaceId: workspace.workspaceId })).sessionId;
  }
  const references = (kind: string, entries: readonly { readonly referenceId: string }[]): Record<string, string> =>
    Object.fromEntries(entries.map(({ referenceId }) => [referenceId, `evaluation:${kind}:${referenceId}`]));
  const ids: InstalledInitialStateIds = {
    workspaceId: workspace.workspaceId, sessions,
    interests: references('interest', input.initialState.interests),
    candidates: references('candidate', input.initialState.candidates),
    recommendations: references('recommendation', input.initialState.recommendations),
    preferenceRevisions: [...new Set(input.initialState.preferences.map(({ interestReferenceId }) => `evaluation:preference-set:${interestReferenceId}:1`))],
  };
  input.owner.installDiscovery(input.initialState, ids);
  return ids;
}

/** Owns isolated database lifetime for initialization before application startup. */
export function createDatabaseInitialStateOwner(input: {
  readonly homePath: string;
  readonly migrationsFolder: string;
  readonly now: string;
}): { readonly owner: EvaluationInitialStateOwner; close(): void } {
  const database = createDatabase({ filename: path.join(input.homePath, 'sqlite', 'megumi.sqlite') });
  migrateDatabase({ database, migrationsFolder: input.migrationsFolder });
  const sessionStore = createSessionStore({ database });
  const sessions = createSessionCatalog({ store: sessionStore, now: () => input.now });
  const history = createSessionHistory({ store: sessionStore });
  const workspaces = createWorkspaceCatalog({
    store: createWorkspaceStore({ database }),
    file_system: createNodeWorkspaceFileSystem(),
    now: () => input.now,
  });
  const owner: EvaluationInitialStateOwner = {
    async installWorkspace(workspace) {
      const result = await workspaces.openWorkspace({ root_path: workspace.rootPath });
      if (result.status !== 'opened') throw new Error(`Initial-state Workspace failed: ${result.failure.message}`);
      return { workspaceId: result.workspace.workspace_id };
    },
    async installSession(entry) {
      const created = sessions.createSession({ workspace_id: entry.workspaceId, title: entry.title });
      if (created.status !== 'created') throw new Error(`Initial-state Session failed: ${created.failure.message}`);
      let parentEntryId: string | undefined;
      for (const [turnIndex, turn] of entry.turns.entries()) {
        const executionId = `evaluation:execution:${entry.referenceId}:${turnIndex + 1}`;
        const user = await history.saveUserMessage({
          message_id: `evaluation:user:${entry.referenceId}:${turnIndex + 1}`,
          session_id: created.session.session_id,
          execution_id: executionId,
          display_content: [{ type: 'text', text: turn.user }],
          model_content: [{ type: 'text', text: turn.user }],
          ...(parentEntryId ? { parent_entry_id: parentEntryId } : {}),
          created_at: input.now,
        });
        if (user.status !== 'saved') throw new Error(`Initial-state user turn failed: ${user.failure.message}`);
        const assistant = history.saveAssistantReply({
          message_id: `evaluation:assistant:${entry.referenceId}:${turnIndex + 1}`,
          session_id: created.session.session_id,
          execution_id: executionId,
          parent_entry_id: user.entry.entry_id,
          status: 'completed',
          content: [{ type: 'text', text: turn.assistant }],
          completed_at: input.now,
        });
        if (assistant.status !== 'saved') {
          throw new Error(`Initial-state assistant turn failed: ${assistant.failure.message}`);
        }
        parentEntryId = assistant.entry.entry_id;
      }
      return { sessionId: created.session.session_id };
    },

    installDiscovery(initial, ids) {
      initializeDiscoveryState(database, resolveInitialDiscoveryState(initial, ids));
    },
  };
  return { owner, close: () => database.close() };
}
