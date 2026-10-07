/*
 * Owns the interest management surface: list, create, update, and delete.
 * Saving only commits original interest state and its revision;
 * it never searches, calls a model, or deletes content.
 */
import { createHash } from 'node:crypto';
import {
  CreateInterestRequestSchema,
  DeleteInterestRequestSchema,
  UpdateInterestRequestSchema,
  type CreateInterestResult,
  type DeleteInterestResult,
  type InterestManagement,
  type InterestSnapshot,
  type UpdateInterestResult,
} from './interest-contracts';
import type { InterestStorage } from './interest-storage';

export interface InterestManagementOptions {
  readonly storage: InterestStorage;
  readonly newInterestId: () => string;
  readonly now: () => number;
}

/** Creates local CRUD with input validation and optimistic revision checks. */
export function createInterestManagement(
  options: InterestManagementOptions,
): InterestManagement {
  return {
    async listInterests(): Promise<InterestSnapshot> {
      return {
        interests: options.storage
          .list()
          .map(({ id, text, enabled, revision }) => ({ id, text, enabled, revision })),
      };
    },

    async createInterest(request): Promise<CreateInterestResult> {
      const parsed = CreateInterestRequestSchema.safeParse(request);
      if (!parsed.success) {
        return { status: 'invalid_request', message: describeIssues(parsed.error) };
      }
      const interest = options.storage.create({
        id: options.newInterestId(),
        text: parsed.data.text,
        now: options.now(),
      });
      return { status: 'created', interest };
    },

    async updateInterest(request): Promise<UpdateInterestResult> {
      const parsed = UpdateInterestRequestSchema.safeParse(request);
      if (!parsed.success) {
        return { status: 'invalid_request', message: describeIssues(parsed.error) };
      }
      return options.storage.update({ ...parsed.data, now: options.now() });
    },

    async deleteInterest(request): Promise<DeleteInterestResult> {
      const parsed = DeleteInterestRequestSchema.safeParse(request);
      if (!parsed.success) {
        return { status: 'invalid_request', message: describeIssues(parsed.error) };
      }
      return options.storage.remove(parsed.data);
    },
  };
}

function describeIssues(error: { issues: readonly { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** Identifies enabled input versions; display order and disabled interests do not change the hash. */
export function hashEnabledInterests(snapshot: InterestSnapshot): string {
  const versions = snapshot.interests
    .filter((interest) => interest.enabled)
    .map((interest) => [interest.id, interest.revision] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(versions)).digest('hex');
}
