/* Installs a Task Scenario through narrow Owner-specific commands in an isolated database. */
import path from 'node:path';
import { createDatabase, migrateDatabase } from '@megumi/database';
import { createDiscoveryRepository, type DiscoveryRepository } from '@megumi/discovery';
import { createSessionCatalog, createSessionHistory } from '@megumi/session';
import { createSessionStore } from '@megumi/session/store';
import { createWorkspaceCatalog } from '@megumi/workspace';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import { createWorkspaceStore } from '@megumi/workspace/store';
import type { EvaluationScenario } from '../contracts/evaluation-task';

export interface EvaluationScenarioOwner {
  installWorkspace(input: { readonly rootPath: string }): Promise<{ readonly workspaceId: string }>;
  installSession(input: EvaluationScenario['sessions'][number] & { readonly workspaceId: string }): Promise<{ readonly sessionId: string }>;
  installInterest(input: EvaluationScenario['interests'][number]): Promise<{ readonly interestId: string }>;
  installCandidate(input: EvaluationScenario['candidates'][number] & {
    readonly interestIds: readonly string[];
  }): Promise<{ readonly candidateId: string }>;
  installRecommendation(input: EvaluationScenario['recommendations'][number] & {
    readonly candidateId: string;
  }): Promise<{ readonly recommendationId: string }>;
  installPreference(input: EvaluationScenario['preferences'][number] & {
    readonly recommendationIds: readonly string[];
  }): Promise<{ readonly revisionId: string }>;
  verifyInstalled(input: {
    readonly scenario: EvaluationScenario;
    readonly ids: InstalledScenarioIds;
  }): Promise<void>;
}

export interface InstalledScenarioIds {
  readonly workspaceId: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly interests: Readonly<Record<string, string>>;
  readonly candidates: Readonly<Record<string, string>>;
  readonly recommendations: Readonly<Record<string, string>>;
  readonly preferenceRevisions: readonly string[];
}

/** Installs one validated Scenario and returns stable references used by Task Runners. */
export async function installScenario(input: {
  readonly scenario: EvaluationScenario;
  readonly workspaceRoot: string;
  readonly owner: EvaluationScenarioOwner;
}): Promise<InstalledScenarioIds> {
  const workspace = await input.owner.installWorkspace({ rootPath: input.workspaceRoot });
  const sessions: Record<string, string> = {};
  for (const entry of input.scenario.sessions) {
    sessions[entry.scenarioSessionId] = (await input.owner.installSession({ ...entry, workspaceId: workspace.workspaceId })).sessionId;
  }
  const interests: Record<string, string> = {};
  for (const entry of input.scenario.interests) {
    interests[entry.scenarioInterestId] = (await input.owner.installInterest(entry)).interestId;
  }
  const candidates: Record<string, string> = {};
  for (const entry of input.scenario.candidates) {
    const interestIds = entry.matchedInterestScenarioIds.map((id) => requireMapped(interests, id, 'Interest'));
    candidates[entry.scenarioCandidateId] = (await input.owner.installCandidate({ ...entry, interestIds })).candidateId;
  }
  const recommendations: Record<string, string> = {};
  for (const entry of input.scenario.recommendations) {
    const candidateId = requireMapped(candidates, entry.candidateScenarioId, 'Candidate');
    recommendations[entry.scenarioRecommendationId] = (await input.owner.installRecommendation({ ...entry, candidateId })).recommendationId;
  }
  const preferenceRevisions = [];
  for (const entry of input.scenario.preferences) {
    const recommendationIds = entry.supportingRecommendationScenarioIds
      .map((id) => requireMapped(recommendations, id, 'Recommendation'));
    preferenceRevisions.push((await input.owner.installPreference({ ...entry, recommendationIds })).revisionId);
  }
  const installed: InstalledScenarioIds = {
    workspaceId: workspace.workspaceId,
    sessions,
    interests,
    candidates,
    recommendations,
    preferenceRevisions,
  };
  await input.owner.verifyInstalled({ scenario: input.scenario, ids: installed });
  return installed;
}

function requireMapped(values: Readonly<Record<string, string>>, scenarioId: string, kind: string): string {
  const value = values[scenarioId];
  if (!value) throw new Error(`${kind} Scenario reference was not installed: ${scenarioId}.`);
  return value;
}

export interface DatabaseScenarioOwner {
  readonly owner: EvaluationScenarioOwner;
  close(): void;
}

/** Creates the narrow Scenario owner over real repositories in an isolated database. */
export function createDatabaseScenarioOwner(input: {
  readonly homePath: string;
  readonly migrationsFolder: string;
  readonly now: string;
}): DatabaseScenarioOwner {
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

  const owner: EvaluationScenarioOwner = {
    async installWorkspace(workspace) {
      const result = await workspaces.openWorkspace({ root_path: workspace.rootPath });
      if (result.status !== 'opened') throw new Error(`Scenario Workspace failed: ${result.failure.message}`);
      return { workspaceId: result.workspace.workspace_id };
    },
    async installSession(entry) {
      const created = sessions.createSession({ workspace_id: entry.workspaceId, title: entry.title });
      if (created.status !== 'created') throw new Error(`Scenario Session failed: ${created.failure.message}`);
      let parentEntryId: string | undefined;
      for (const [turnIndex, turn] of entry.turns.entries()) {
        const executionId = `evaluation:execution:${entry.scenarioSessionId}:${turnIndex + 1}`;
        const user = await history.saveUserMessage({
          message_id: `evaluation:user:${entry.scenarioSessionId}:${turnIndex + 1}`,
          session_id: created.session.session_id,
          execution_id: executionId,
          display_content: [{ type: 'text', text: turn.user }],
          model_content: [{ type: 'text', text: turn.user }],
          ...(parentEntryId ? { parent_entry_id: parentEntryId } : {}),
          created_at: input.now,
        });
        if (user.status !== 'saved') throw new Error(`Scenario user turn failed: ${user.failure.message}`);
        const assistant = history.saveAssistantReply({
          message_id: `evaluation:assistant:${entry.scenarioSessionId}:${turnIndex + 1}`,
          session_id: created.session.session_id,
          execution_id: executionId,
          parent_entry_id: user.entry.entry_id,
          status: 'completed',
          content: [{ type: 'text', text: turn.assistant }],
          completed_at: input.now,
        });
        if (assistant.status !== 'saved') {
          throw new Error(`Scenario assistant turn failed: ${assistant.failure.message}`);
        }
        parentEntryId = assistant.entry.entry_id;
      }
      return { sessionId: created.session.session_id };
    },
    async installInterest(entry) {
      const interest = discovery.changeInterest({
        action: 'create',
        interestId: `evaluation:interest:${entry.scenarioInterestId}`,
        description: entry.description,
        now: input.now,
      });
      if (entry.status === 'paused') {
        discovery.changeInterest({ action: 'pause', interestId: interest.interestId, now: input.now });
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
          ...(entry.description ? { description: entry.description } : {}),
        }],
      });
      const candidate = material.candidates[0];
      if (!candidate) throw new Error(`Scenario Candidate was not materialized: ${entry.scenarioCandidateId}.`);
      if (entry.contentText) {
        discovery.commitCandidateDetail({
          candidateId: candidate.candidateId,
          now: input.now,
          detail: {
            sourceId: entry.sourceId,
            sourceName: entry.sourceName,
            canonicalUrl: entry.canonicalUrl,
            contentType: 'article',
            title: entry.title,
            ...(entry.description ? { description: entry.description } : {}),
            contentText: entry.contentText,
          },
        });
      }
      const interestRevisions = discovery.listInterests()
        .filter((interest) => entry.interestIds.includes(interest.interestId))
        .map((interest) => ({ interestId: interest.interestId, revision: interest.revision }));
      const [admitted] = discovery.commitAdmission({
        executionId,
        assessmentVersion: 'evaluation-scenario-v1',
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
          reason: 'Installed by the isolated Evaluation Scenario owner.',
        }],
      });
      if (!admitted) throw new Error(`Scenario Candidate admission failed: ${entry.scenarioCandidateId}.`);
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
        throw new Error(`Scenario Recommendation Batch was not claimed: ${batchId}.`);
      }
      const result = discovery.publish({
        batchId,
        executionId,
        publishedAt: input.now,
        allowedCandidateIds: [entry.candidateId],
        items: [{
          recommendationId: `evaluation:recommendation:${entry.scenarioRecommendationId}`,
          candidateId: entry.candidateId,
          recommendationReason: entry.reason,
        }],
      });
      if (result.status !== 'published') {
        throw new Error(`Scenario Recommendation publication failed: ${entry.scenarioRecommendationId}.`);
      }
      const recommendation = result.recommendations[0];
      if (!recommendation) throw new Error('Scenario Recommendation publication returned no result.');
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
      if (!batch) throw new Error(`Scenario Preference Batch had no pending Feedback: ${batchId}.`);
      const facts = discovery.readPreferenceLearningFacts(batchId);
      if (!facts) throw new Error(`Scenario Preference facts were unavailable: ${batchId}.`);
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
        throw new Error(`Scenario Preference commit was rejected: ${result.reason}.`);
      }
      return { revisionId: `${entry.scopeKey}:${result.revisions[0]?.revision ?? 0}` };
    },
    async verifyInstalled(entry) {
      verifyScenario(discovery, sessionStore, entry.ids);
    },
  };
  return { owner, close: () => database.close() };
}

function verifyScenario(
  discovery: DiscoveryRepository,
  sessionStore: ReturnType<typeof createSessionStore>,
  ids: InstalledScenarioIds,
): void {
  for (const sessionId of Object.values(ids.sessions)) {
    if (!sessionStore.findSessionById(sessionId)) {
      throw new Error(`Installed Session could not be read: ${sessionId}.`);
    }
  }
  const interestIds = new Set(discovery.listInterests().map((interest) => interest.interestId));
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
