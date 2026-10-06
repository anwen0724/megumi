/*
 * Owns the interest management surface: list, create, update, and delete.
 * Saving only commits interest state and the relation cleanup a change implies;
 * it never searches, calls a model, or deletes content.
 */
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

export function createInterestManagement(
  options: InterestManagementOptions,
): InterestManagement {
  return {
    async listInterests(): Promise<InterestSnapshot> {
      return {
        interests: options.storage
          .list()
          .map(({ id, text, enabled }) => ({ id, text, enabled })),
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
      const interest = options.storage.update({
        id: parsed.data.id,
        ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        now: options.now(),
      });
      return interest ? { status: 'updated', interest } : { status: 'not_found' };
    },

    async deleteInterest(request): Promise<DeleteInterestResult> {
      const parsed = DeleteInterestRequestSchema.safeParse(request);
      if (!parsed.success) {
        return { status: 'invalid_request', message: describeIssues(parsed.error) };
      }
      return options.storage.remove(parsed.data.id)
        ? { status: 'deleted' }
        : { status: 'not_found' };
    },
  };
}

function describeIssues(error: { issues: readonly { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
