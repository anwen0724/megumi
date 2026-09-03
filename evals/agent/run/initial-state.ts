/*
 * Normalizes one validated Case and installs its pre-run state through real Owner contracts.
 */
import path from 'node:path';
import { createDatabase, migrateDatabase } from '@megumi/database';
import { createDiscoveryRepository, type DiscoveryRepository } from '@megumi/discovery';
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
        interests: evaluationCase.initialState.existingInterests,
        candidates: [], recommendations: [], preferences: [], existingReactions: [], controlledSources: [],
        approvalDecisions: [],
      };
    case 'candidate_supply':
      return {
        clock: evaluationCase.initialState.clock,
        recommendationTargetCount: 3,
        recommendationWorkingSetCount: 20,
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

export interface EvaluationInitialStateOwner {
  installWorkspace(input: { readonly rootPath: string }): Promise<{ readonly workspaceId: string }>;
  installSession(input: CaseInitialState['sessions'][number] & { readonly workspaceId: string }): Promise<{ readonly sessionId: string }>;
  installInterest(input: CaseInitialState['interests'][number]): Promise<{ readonly interestId: string }>;
  installCandidate(input: CaseInitialState['candidates'][number] & {
    readonly interestIds: readonly string[];
  }): Promise<{ readonly candidateId: string }>;
  installRecommendation(input: CaseInitialState['recommendations'][number] & {
    readonly candidateId: string;
  }): Promise<{ readonly recommendationId: string }>;
  installReaction(input: CaseInitialState['existingReactions'][number] & {
    readonly recommendationId: string;
  }): Promise<void>;
  installPreference(input: CaseInitialState['preferences'][number] & {
    readonly recommendationIds: readonly string[];
  }): Promise<{ readonly revisionId: string }>;
  verifyInstalled(input: {
    readonly initialState: CaseInitialState;
    readonly ids: InstalledInitialStateIds;
  }): Promise<void>;
}

export interface InstalledInitialStateIds {
  readonly workspaceId: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly interests: Readonly<Record<string, string>>;
  readonly candidates: Readonly<Record<string, string>>;
  readonly recommendations: Readonly<Record<string, string>>;
  readonly preferenceRevisions: readonly string[];
}

/** Installs one validated initial state and returns references used by the real product invocation. */
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
  const interests: Record<string, string> = {};
  for (const entry of input.initialState.interests) {
    interests[entry.referenceId] = (await input.owner.installInterest(entry)).interestId;
  }
  const candidates: Record<string, string> = {};
  for (const entry of input.initialState.candidates) {
    const interestIds = entry.matchedInterestReferenceIds.map((id) => requireMapped(interests, id, 'Interest'));
    candidates[entry.referenceId] = (await input.owner.installCandidate({ ...entry, interestIds })).candidateId;
  }
  const recommendations: Record<string, string> = {};
  for (const entry of input.initialState.recommendations) {
    const candidateId = requireMapped(candidates, entry.candidateReferenceId, 'Candidate');
    recommendations[entry.referenceId] = (await input.owner.installRecommendation({ ...entry, candidateId })).recommendationId;
  }
  for (const entry of input.initialState.existingReactions) {
    const recommendationId = requireMapped(recommendations, entry.recommendationReferenceId, 'Recommendation');
    await input.owner.installReaction({ ...entry, recommendationId });
  }
  const preferenceRevisions = [];
  for (const entry of input.initialState.preferences) {
    const recommendationIds = entry.supportingRecommendationReferenceIds
      .map((id) => requireMapped(recommendations, id, 'Recommendation'));
    preferenceRevisions.push((await input.owner.installPreference({ ...entry, recommendationIds })).revisionId);
  }
  const installed: InstalledInitialStateIds = {
    workspaceId: workspace.workspaceId,
    sessions,
    interests,
    candidates,
    recommendations,
    preferenceRevisions,
  };
  await input.owner.verifyInstalled({ initialState: input.initialState, ids: installed });
  return installed;
}

function requireMapped(values: Readonly<Record<string, string>>, referenceId: string, kind: string): string {
  const value = values[referenceId];
  if (!value) throw new Error(`${kind} initial-state reference was not installed: ${referenceId}.`);
  return value;
}

export interface DatabaseInitialStateOwner {
  readonly owner: EvaluationInitialStateOwner;
  close(): void;
}

/** Creates the narrow initial-state owner over real repositories in an isolated database. */
export function createDatabaseInitialStateOwner(input: {
  readonly homePath: string;
  readonly migrationsFolder: string;
  readonly now: string;
}): DatabaseInitialStateOwner {
  const database = createDatabase({ filename: path.join(input.homePath, 'sqlite', 'megumi.sqlite') });
  migrateDatabase({ database, migrationsFolder: input.migrationsFolder });
  const discovery = createDiscoveryRepository({ database, clock: { now: () => input.now } });
  const sessionStore = createSessionStore({ database });
  const sessions = createSessionCatalog({ store: sessionStore, now: () => input.now });
  const history = createSessionHistory({ store: sessionStore });
  const workspaces = createWorkspaceCatalog({
    store: createWorkspaceStore({ database }),
    file_system: createNodeWorkspaceFileSystem(),
    now: () => input.now,
  });
  let recommendationIndex = 0;
  let preferenceIndex = 0;

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
    async installInterest(entry) {
      const interest = discovery.applyInterestChange({
        action: 'create',
        interestId: `evaluation:interest:${entry.referenceId}`,
        description: entry.description,
        now: input.now,
      });
      if (entry.status === 'paused') {
        discovery.applyInterestChange({ action: 'pause', interestId: interest.interestId, now: input.now });
      }
      return { interestId: interest.interestId };
    },
    async installCandidate(entry) {
      const result = discovery.submitCandidate({
        content: {
          sourceId: entry.sourceId,
          sourceName: entry.sourceName,
          canonicalUrl: entry.canonicalUrl,
          contentType: 'article',
          title: entry.title,
          ...(entry.description ? { description: entry.description } : {}),
        },
        contentSummary: entry.description ?? entry.title,
        matches: entry.interestIds.map((interestId) => ({
          interestId,
          relevance: entry.relevance,
          matchReason: 'Installed by the isolated Evaluation initial-state owner.',
        })),
        settings: {
          minimumCount: 100,
          targetCount: 160,
          maximumCount: 200,
          candidateValidityDays: 30,
          candidateContentExcerptMaxCharacters: 8_000,
        },
      });
      if (result.status === 'ignored') {
        throw new Error(`Initial Candidate installation failed: ${entry.referenceId} (${result.reason}).`);
      }
      return { candidateId: result.candidate.id };
    },
    async installRecommendation(entry) {
      recommendationIndex += 1;
      const localDate = `2025-01-${String(recommendationIndex).padStart(2, '0')}`;
      const candidate = discovery.findCandidateById(entry.candidateId);
      const primaryInterestId = candidate?.interestMatches[0]?.interestId;
      if (!candidate || !primaryInterestId) {
        throw new Error(`Initial-state Recommendation Candidate has no Interest: ${entry.candidateId}.`);
      }
      const result = discovery.publish({
        localDate,
        snapshotAt: input.now,
        publishedAt: input.now,
        items: [{
          candidateId: entry.candidateId,
          sourceName: candidate.candidate.sourceId,
          recommendationReason: entry.reason,
          selectionBasis: {
            primaryInterestId,
            matchedInterestIds: candidate.interestMatches.map(({ interestId }) => interestId),
            interestRevisions: candidate.interestMatches.map(({ interestId }) => ({
              interestId,
              revision: 0,
            })),
            preferenceRevisions: [],
          },
        }],
      });
      if (result.status !== 'published') {
        throw new Error(`Initial Recommendation publication failed: ${entry.referenceId}.`);
      }
      const recommendation = result.collection.items[0];
      if (!recommendation) throw new Error('Initial-state Recommendation publication returned no result.');
      if (entry.reaction !== 'none') {
        discovery.updateState({
          recommendationId: recommendation.id,
          action: 'set_reaction',
          reaction: entry.reaction,
        });
      }
      return { recommendationId: recommendation.id };
    },
    async installReaction(entry) {
      discovery.updateState({
        recommendationId: entry.recommendationId,
        action: 'set_reaction',
        reaction: entry.reaction === 'none' ? null : entry.reaction,
      });
    },
    async installPreference(entry) {
      preferenceIndex += 1;
      for (const recommendationId of entry.recommendationIds) {
        discovery.updateState({
          recommendationId,
          action: 'set_reaction',
          reaction: entry.polarity === 'positive' ? 'liked' : 'disliked',
        });
      }
      const batchId = `evaluation:preference-batch:${preferenceIndex}`;
      const batch = discovery.claimPreferenceLearningBatch({
        batchId,
        reason: 'threshold',
        now: input.now,
        limit: 20,
      });
      if (!batch) throw new Error(`Initial-state Preference Batch had no pending Reaction: ${batchId}.`);
      const facts = discovery.getPreferenceLearningFacts(batchId);
      if (!facts) throw new Error(`Initial-state Preference facts were unavailable: ${batchId}.`);
      const result = discovery.commitPreferenceLearningBatch({
        batchId,
        committedAt: input.now,
        scopes: [{
          scopeKey: entry.scopeKey,
          baseRevision: 0,
          directions: [{
            directionId: entry.directionId,
            polarity: entry.polarity,
            dimension: entry.dimension,
            statement: entry.statement,
            supportingRecommendationIds: [...entry.recommendationIds],
          }],
        }],
      });
      if (result.status !== 'committed') {
        throw new Error(`Initial-state Preference commit was rejected: ${result.reason}.`);
      }
      return { revisionId: `${entry.scopeKey}:${result.revisions[0]?.revision ?? 0}` };
    },
    async verifyInstalled(entry) {
      verifyInitialState(discovery, sessionStore, entry.ids);
    },
  };
  return { owner, close: () => database.close() };
}

function verifyInitialState(
  discovery: DiscoveryRepository,
  sessionStore: ReturnType<typeof createSessionStore>,
  ids: InstalledInitialStateIds,
): void {
  for (const sessionId of Object.values(ids.sessions)) {
    if (!sessionStore.findSessionById(sessionId)) {
      throw new Error(`Installed Session could not be read: ${sessionId}.`);
    }
  }
  const interestIds = new Set(discovery.listNonDeletedInterests().map((interest) => interest.interestId));
  for (const interestId of Object.values(ids.interests)) {
    if (!interestIds.has(interestId)) throw new Error(`Installed Interest could not be read: ${interestId}.`);
  }
  for (const candidateId of Object.values(ids.candidates)) {
    if (!discovery.findCandidateById(candidateId)) {
      throw new Error(`Installed Candidate could not be read: ${candidateId}.`);
    }
  }
  for (const recommendationId of Object.values(ids.recommendations)) {
    if (!discovery.getRecommendationReference(recommendationId)) {
      throw new Error(`Installed Recommendation could not be read: ${recommendationId}.`);
    }
  }
}
