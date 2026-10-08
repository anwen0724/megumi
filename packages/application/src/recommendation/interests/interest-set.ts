/*
 * Identifies one authoritative enabled interest set without deriving a separate user profile.
 */
import { createHash } from 'node:crypto';
import type { InterestSnapshotEntry } from './interest-contracts';

/** Stable across list order; text edits are represented by their saved revision. */
export function interestSetHash(interests: readonly InterestSnapshotEntry[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        interests
          .filter(item => item.enabled)
          .map(item => [item.id, item.revision])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
    )
    .digest('hex');
}
