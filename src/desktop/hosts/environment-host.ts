// Provides controlled environment access to desktop composition.
export interface EnvironmentHost {
  get(name: string): string | undefined;
}

export function createEnvironmentHost(env: NodeJS.ProcessEnv = process.env): EnvironmentHost {
  return {
    get: (name) => env[name],
  };
}
