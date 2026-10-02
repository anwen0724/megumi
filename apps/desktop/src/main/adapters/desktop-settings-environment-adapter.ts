/* Provides named environment reads to application configuration. */
export function createDesktopSettingsEnvironment(): (name: string) => string | undefined {
  return (name) => process.env[name];
}
