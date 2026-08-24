/* Provides Settings with explicit, host-supplied environment variable reads. */

export interface SettingsEnvironment {
  readVariable(name: string): string | undefined;
}

export const emptySettingsEnvironment: SettingsEnvironment = {
  readVariable: () => undefined,
};

export function createRecordSettingsEnvironment(
  values: Readonly<Record<string, string | undefined>>,
): SettingsEnvironment {
  return {
    readVariable: (name) => values[name],
  };
}
