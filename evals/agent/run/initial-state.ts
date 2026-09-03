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
type DailyRecommendationCase = Extract<EvaluationCase, { readonly type: 'daily_recommendation' }>;
type PreferenceLearningCase = Extract<EvaluationCase, { readonly type: 'preference_learning' }>;

export interface CaseInitialState {
  readonly clock: string;
  readonly dailyTargetCount: number;
  readonly workspaceFiles: readonly WorkspaceFileData[];
  readonly sessions: readonly ConversationCase['initialState']['sessionHistory'][number][];
  readonly interests: readonly CandidateSupplyCase['initialState']['interests'][number][];
  readonly candidates: readonly DailyRecommendationCase['initialState']['candidates'][number][];
  readonly recommendations: readonly PreferenceLearningCase['initialState']['recommendations'][number][];
  readonly preferences: readonly PreferenceLearningCase['initialState']['preferences'][number][];
  readonly existingFeedback: readonly PreferenceLearningCase['initialState']['existingFeedback'][number][];
  readonly controlledSources: readonly CandidateSupplyCase['initialState']['controlledSources'][number][];
  readonly approvalDecisions: readonly ConversationCase['initialState']['approvalDecisions'][number][];
}

/** Maps each business-specific Case Initial State to the internal installation input. */
export function caseInitialState(evaluationCase: EvaluationCase): CaseInitialState {
  switch (evaluationCase.type) {
    case 'conversation':
      return {
        clock: evaluationCase.initialState.clock,
        dailyTargetCount: 3,
        workspaceFiles: evaluationCase.initialState.workspaceFiles,
        sessions: evaluationCase.initialState.sessionHistory,
        interests: [], candidates: [], recommendations: [], preferences: [], existingFeedback: [],
        controlledSources: evaluationCase.initialState.controlledWeb,
        approvalDecisions: evaluationCase.initialState.approvalDecisions,
      };
    case 'interest_understanding':
      return {
        clock: evaluationCase.initialState.clock,
        dailyTargetCount: 3,
        workspaceFiles: [],
        sessions: [evaluationCase.initialState.sourceSession],
        interests: evaluationCase.initialState.existingInterests,
        candidates: [], recommendations: [], preferences: [], existingFeedback: [], controlledSources: [],
        approvalDecisions: [],
      };
    case 'candidate_supply':
      return {
        clock: evaluationCase.initialState.clock,
        dailyTargetCount: evaluationCase.initialState.targetCount,
        workspaceFiles: [], sessions: [],
        interests: evaluationCase.initialState.interests,
        candidates: evaluationCase.initialState.existingCandidates,
        recommendations: [], preferences: [], existingFeedback: [],
        controlledSources: evaluationCase.initialState.controlledSources,
        approvalDecisions: [],
      };
    case 'daily_recommendation':
      return {
        clock: evaluationCase.initialState.clock,
        dailyTargetCount: evaluationCase.initialState.dailyTargetCount,
        workspaceFiles: [], sessions: [],
        interests: evaluationCase.initialState.interests,
        candidates: evaluationCase.initialState.candidates,
        recommendations: evaluationCase.initialState.previousRecommendations,
        preferences: evaluationCase.initialState.preferences,
        existingFeedback: [], controlledSources: [], approvalDecisions: [],
      };
    case 'preference_learning':
      return {
        clock: evaluationCase.initialState.clock,
        dailyTargetCount: 3,
        workspaceFiles: [], sessions: [],
        interests: evaluationCase.initialState.interests,
        candidates: evaluationCase.initialState.candidates,
        recommendations: evaluationCase.initialState.recommendations,
        preferences: evaluationCase.initialState.preferences,
        existingFeedback: evaluationCase.initialState.existingFeedback,
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
  installFeedback(input: CaseInitialState['existingFeedback'][number] & {
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
  for (const entry of input.initialState.existingFeedback) {
    const recommendationId = requireMapped(recommendations, entry.recommendationReferenceId, 'Recommendation');
    await input.owner.installFeedback({ ...entry, recommendationId });
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
  const discovery = createDiscoveryRepository({ database });
  const sessionStore = createSessionStore({ database });
  const sessions = createSessionCatalog({ store: sessionStore, now: () => input.now });
  const history = createSessionHistory({ store: sessionStore });
  const workspaces = createWorkspaceCatalog({
    store: createWorkspaceStore({ database }),
    file_system: createNodeWorkspaceFileSystem(),
    now: () => input.now,
  });
  let candidateIndex = 0;
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
      candidateIndex += 1;
      const executionId = `evaluation:candidate-execution:${candidateIndex}`;
      const queryId = `evaluation:query:${candidateIndex}`;
      discovery.beginQuery({
        queryId,
        executionId,
        sourceId: entry.sourceId,
        query: entry.title,
        mode: 'relevance',
        targetInterestIds: entry.interestIds,
        startedAt: input.now,
      });
      const material = discovery.commitSearchResult({
        queryId,
        completedAt: input.now,
        hardLimit: 100,
        items: [{
          sourceId: entry.sourceId,
          sourceName: entry.sourceName,
          canonicalUrl: entry.canonicalUrl,
          contentType: 'article',
          title: entry.title,
          ...(!entry.contentText && entry.description ? { description: entry.description } : {}),
        }],
      });
      const candidate = material.candidates[0];
      if (!candidate) throw new Error(`Initial Candidate was not materialized: ${entry.referenceId}.`);
      if (entry.contentText) {
        discovery.commitCandidateDetail({
          candidateId: candidate.candidateId,
          detail: {
            sourceId: entry.sourceId,
            sourceName: entry.sourceName,
            canonicalUrl: entry.canonicalUrl,
            contentType: 'article',
            title: entry.title,
            ...(entry.description ? { description: entry.description } : {}),
            contentText: entry.contentText,
          },
          now: input.now,
        });
      }
      const interestRevisions = discovery.listNonDeletedInterests()
        .filter((interest) => entry.interestIds.includes(interest.interestId))
        .map((interest) => ({ interestId: interest.interestId, revision: interest.revision }));
      const [admitted] = discovery.commitAdmission({
        executionId,
        assessmentVersion: 'evaluation-initial-state-v1',
        assessedAt: input.now,
        decisions: [{
          candidateId: candidate.candidateId,
          decision: 'admit',
          relevance: entry.relevance,
          matchedInterestIds: [...entry.interestIds],
          contentValue: 'substantive',
          novelty: 'novel',
          temporalValidity: 'valid',
          negativeConstraint: 'clear',
          interestRevisions,
          preferenceRevisions: [],
          preferenceAlignment: [],
          reason: 'Installed by the isolated Evaluation initial-state owner.',
        }],
      });
      if (!admitted) throw new Error(`Initial Candidate admission failed: ${entry.referenceId}.`);
      return { candidateId: admitted.candidateId };
    },
    async installRecommendation(entry) {
      recommendationIndex += 1;
      const localDate = `2025-01-${String(recommendationIndex).padStart(2, '0')}`;
      const batchId = `evaluation:batch:${recommendationIndex}`;
      const executionId = `evaluation:recommendation-execution:${recommendationIndex}`;
      const claimed = discovery.claimBatch({
        batchId,
        localDate,
        timezone: 'UTC',
        executionId,
        requestedCount: 1,
        actualTarget: 1,
        now: input.now,
      });
      if (claimed.status !== 'claimed') {
        throw new Error(`Initial-state Recommendation Batch was not claimed: ${batchId}.`);
      }
      const result = discovery.publish({
        batchId,
        executionId,
        publishedAt: input.now,
        allowedCandidateIds: [entry.candidateId],
        items: [{
          recommendationId: `evaluation:recommendation:${entry.referenceId}`,
          candidateId: entry.candidateId,
          recommendationReason: entry.reason,
        }],
      });
      if (result.status !== 'published') {
        throw new Error(`Initial Recommendation publication failed: ${entry.referenceId}.`);
      }
      const recommendation = result.recommendations[0];
      if (!recommendation) throw new Error('Initial-state Recommendation publication returned no result.');
      if (entry.reaction !== 'none') {
        discovery.updateRecommendationState({
          recommendationId: recommendation.recommendationId,
          action: 'set_reaction',
          reaction: entry.reaction,
          now: input.now,
          feedbackId: `evaluation:feedback:${recommendationIndex}`,
          feedbackChangeId: `evaluation:feedback-change:${recommendationIndex}`,
        });
      }
      return { recommendationId: recommendation.recommendationId };
    },
    async installFeedback(entry) {
      discovery.updateRecommendationState({
        recommendationId: entry.recommendationId,
        action: 'set_reaction',
        reaction: entry.reaction === 'none' ? null : entry.reaction,
        now: input.now,
        feedbackId: `evaluation:feedback:${entry.referenceId}`,
        feedbackChangeId: `evaluation:feedback-change:${entry.referenceId}`,
      });
    },
    async installPreference(entry) {
      preferenceIndex += 1;
      for (const [index, recommendationId] of entry.recommendationIds.entries()) {
        discovery.updateRecommendationState({
          recommendationId,
          action: 'set_reaction',
          reaction: entry.polarity === 'positive' ? 'liked' : 'disliked',
          now: input.now,
          feedbackId: `evaluation:preference-feedback:${preferenceIndex}:${index + 1}`,
          feedbackChangeId: `evaluation:preference-change:${preferenceIndex}:${index + 1}`,
        });
      }
      const batchId = `evaluation:preference-batch:${preferenceIndex}`;
      const batch = discovery.claimPreferenceLearningBatch({
        batchId,
        reason: 'threshold',
        now: input.now,
        limit: 20,
      });
      if (!batch) throw new Error(`Initial-state Preference Batch had no pending Feedback: ${batchId}.`);
      const facts = discovery.readPreferenceLearningFacts(batchId);
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
            supportingFeedbackIds: facts.feedbackChanges.map((change) => change.feedbackId),
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
    if (!discovery.readCandidate(candidateId)) throw new Error(`Installed Candidate could not be read: ${candidateId}.`);
  }
  for (const recommendationId of Object.values(ids.recommendations)) {
    if (!discovery.readRecommendationReference(recommendationId)) {
      throw new Error(`Installed Recommendation could not be read: ${recommendationId}.`);
    }
  }
}
