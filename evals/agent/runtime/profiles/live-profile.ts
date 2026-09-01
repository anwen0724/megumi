/* Describes Live Evaluation adapters without granting access to the production Home. */
export function createLiveProfile(input: { readonly now?: () => Date } = {}) {
  const now = input.now ?? (() => new Date());
  return {
    profile: 'live' as const,
    now: () => now().toISOString(),
    sourceDescription: [{ sourceId: 'live', resultSetCount: 0 }] as const,
  };
}

