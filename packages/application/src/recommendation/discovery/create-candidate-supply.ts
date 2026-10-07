/*
 * Owns the single active candidate round and preserves local reads during external work.
 */
import type { Api, Model } from '@megumi/ai';
import type { RecommendationConfiguration } from '../../settings/definitions/recommendation';
import type { CandidateMaintenanceOptions } from './maintain-candidates';
import { maintainCandidates } from './maintain-candidates';
import type { SourceQueue } from './source-queue';
export interface CandidateSupplyOptions extends Omit<CandidateMaintenanceOptions, 'runId' | 'purpose' | 'config' | 'configRevision' | 'model' | 'signal'> {
  readConfiguration(): {
    revision: string;
    config: RecommendationConfiguration;
  };
  resolveModel(): Promise<Model<Api> | undefined>;
  newId(prefix: string): string;
}
/** Starting twice joins the existing round; closing invalidates every pending writer. */
export function createCandidateSupply(input: CandidateSupplyOptions) {
  let closed = false;
  let active: {
    id: string;
    controller: AbortController;
    result: Promise<Awaited<ReturnType<typeof run>>>;
  } | undefined;
  let closing: Promise<void> | undefined;
  async function run(id: string, signal: AbortSignal) {
    const { config, revision } = input.readConfiguration();
    if (!config.enabled || signal.aborted)
      return { status: 'disabled' as const, issues: [] };
    const model = await input.resolveModel();
    if (!model)
      return { status: 'unavailable' as const, issues: [{ code: 'MODEL_UNAVAILABLE', message: 'The supply model is unavailable.' }] };
    return maintainCandidates({ ...input, runId: id, purpose: 'candidate_supply', config, configRevision: revision, model, signal });
  }
  return {
    startMaintenance(_request: {
      reason: 'startup' | 'periodic' | 'shortage';
    }) {
      if (closed)
        throw new Error('Candidate supply is closed.');
      if (active)
        return { id: active.id, result: active.result };
      const id = input.newId('discovery');
      const controller = new AbortController();
      const result = Promise.resolve().then(() => run(id, controller.signal));
      active = { id, controller, result };
      void result.finally(() => {
        if (active?.id === id)
          active = undefined;
      }).catch(() => undefined);
      return { id, result };
    },
    async listCandidates(request: {
      excludeContentIds?: readonly string[];
    } = {}) {
      const { config } = input.readConfiguration();
      return { candidates: input.candidates.listCandidates(input.now(), { contentLanguages: config.candidateSupply.contentLanguages, ...request }) };
    },
    /** Reports each earliest incomplete stage separately from qualified inventory. */
    async getSupplyStatus() {
      const { config } = input.readConfiguration();
      const interests = (await input.interests.listInterests()).interests.filter(i => i.enabled);
      return interests.map(interest => {
        const counts = { missingMaterial: 0, pendingAnalysis: 0, pendingMatching: 0, blocked: 0 };
        for (const content of input.materials.listIdentities()) {
          if (!content.material) {
            counts.missingMaterial++;
            continue;
          }
          const analysis = input.materials.analysisWork(content.contentId, content.material.id, input.now());
          if (analysis !== 'ready') {
            counts.pendingAnalysis++;
            if (analysis === 'blocked')
              counts.blocked++;
            continue;
          }
          const match = input.candidates.matchingWork(content.contentId, content.material.id, interest.id, interest.revision, input.now());
          if (match !== 'ready') {
            counts.pendingMatching++;
            if (match === 'blocked')
              counts.blocked++;
          }
        }
        const eligibleCount = input.candidates.inventory(input.now(), interest.id, config.candidateSupply.contentLanguages);
        return { interestId: interest.id, interestRevision: interest.revision, eligibleCount, shortage: Math.max(0, config.candidateSupply.interestTargetCount - eligibleCount), ...counts };
      });
    },
    /** Disabling stops work but keeps this owner available for a later re-enable. */
    async cancel() {
      active?.controller.abort(); if (active)
        await active.result;
    },
    close() {
      closing ??= (async () => {
        closed = true; active?.controller.abort(); if (active)
          await active.result; await drainQueues([input.sourceQueue, input.modelQueue]);
      })();
      return closing;
    },
  };
}
/** A cancelled caller is not proof that its external operation has finished. */
async function drainQueues(queues: readonly SourceQueue[]): Promise<void> {
  const deadline = AbortSignal.timeout(15000);
  try {
    await Promise.all(queues.map(q => q.drain(deadline)));
  }
  catch (error) {
    throw new Error('Recommendation shutdown still has external work after 15 seconds.', { cause: error });
  }
}
