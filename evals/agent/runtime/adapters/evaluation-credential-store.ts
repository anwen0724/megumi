/* Resolves runtime credentials while preventing secret values from entering artifacts. */
export interface EvaluationCredentials {
  require(environmentVariable: string): string;
  describe(environmentVariable: string): { readonly environmentVariable: string; readonly configured: boolean };
}

export function createEvaluationCredentials(
  environment: Readonly<Record<string, string | undefined>>,
): EvaluationCredentials {
  return {
    require(environmentVariable) {
      const value = environment[environmentVariable]?.trim();
      if (!value) throw new Error(`Required Evaluation credential is missing: ${environmentVariable}.`);
      return value;
    },
    describe(environmentVariable) {
      return { environmentVariable, configured: Boolean(environment[environmentVariable]?.trim()) };
    },
  };
}

