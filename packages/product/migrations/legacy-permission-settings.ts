/*
 * Performs the one-time Product-owned migration from legacy permission pattern
 * settings to structured action permission rules before strict Settings parsing.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PermissionActionId, PermissionResourceType, PermissionRule } from '@megumi/agent/permissions';

type LegacyRule = {
  source: 'user' | 'workspace' | 'session';
  source_id?: string;
  pattern: string;
  reason?: string;
};

export class LegacyPermissionSettingsMigrationError extends Error {
  readonly code = 'legacy_permission_settings_migration_failed';
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'LegacyPermissionSettingsMigrationError';
  }
}

export function migrateLegacyPermissionSettingsFile(settingsPath: string): void {
  const absolutePath = path.resolve(settingsPath);
  let text: string;
  try {
    text = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  const parsed = JSON.parse(text) as unknown;
  const result = migrateLegacyPermissionSettings(parsed);
  if (!result.migrated) return;
  writeAtomic(absolutePath, `${JSON.stringify(result.settings, null, 2)}\n`);
}

export function migrateLegacyPermissionSettings(value: unknown): { migrated: boolean; settings: unknown } {
  if (!isRecord(value) || !isRecord(value.permissions)) return { migrated: false, settings: value };
  const permissions = value.permissions;
  const groups = ['allow', 'ask', 'deny'] as const;
  let migrated = permissions.mode === 'custom' || 'custom_fallback' in permissions;
  const { custom_fallback: customFallback, ...permissionValues } = permissions;
  const nextPermissions: Record<string, unknown> = {
    ...permissionValues,
    ...(permissions.mode === 'custom'
      ? { mode: ['ask', 'auto', 'full_access'].includes(String(customFallback)) ? customFallback : 'ask' }
      : {}),
  };
  for (const group of groups) {
    const rules = permissions[group];
    if (rules === undefined) continue;
    if (!Array.isArray(rules)) throw migrationError(group, undefined, 'Permission rule group must be an array.');
    nextPermissions[group] = rules.map((candidate, index) => {
      if (!isRecord(candidate) || !('pattern' in candidate)) return candidate;
      migrated = true;
      return migrateRule(candidate, group, index);
    });
  }
  return { migrated, settings: migrated ? { ...value, permissions: nextPermissions } : value };
}

function migrateRule(candidate: Record<string, unknown>, group: string, index: number): PermissionRule {
  const { source, source_id: sourceId, pattern, reason } = candidate;
  if (!['user', 'workspace', 'session'].includes(String(source)) || typeof pattern !== 'string') {
    throw migrationError(group, index, 'Legacy permission rule has an invalid source or pattern.');
  }
  if ((source === 'workspace' || source === 'session') && typeof sourceId !== 'string') {
    throw migrationError(group, index, `Legacy ${source} permission rule requires source_id.`);
  }
  const match = /^tool:([a-z][a-z0-9_]{0,63})\|([a-z][a-z0-9_]{0,63})=(.*)$/.exec(pattern);
  if (!match) throw migrationError(group, index, `Unsupported legacy permission pattern: ${pattern}`);
  const [, toolName, field, rawValue] = match;
  const base = {
    source: source as LegacyRule['source'],
    ...(typeof sourceId === 'string' ? { source_id: sourceId } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  };
  if (source === 'session') {
    return {
      ...base,
      target: { kind: 'tool', tool_identity: builtInIdentity(toolName) },
    };
  }
  const action = operationForLegacyTool(toolName, field);
  if (!action) throw migrationError(group, index, `Legacy pattern cannot be mapped unambiguously: ${pattern}`);
  const normalizedValue = rawValue.replace(/\\/g, '/').trim();
  const wildcard = normalizedValue.endsWith('*');
  return {
    ...base,
    target: {
      kind: 'operation',
      action: action.action,
      resource: {
        type: action.resourceType,
        matcher: wildcard
          ? { operator: 'prefix', value: normalizedValue.slice(0, -1) }
          : { operator: 'exact', value: normalizedValue },
      },
    },
  };
}

function operationForLegacyTool(toolName: string, field: string): { action: PermissionActionId; resourceType: PermissionResourceType } | undefined {
  if (toolName === 'run_command' && field === 'command') return { action: 'process.execute', resourceType: 'process.command' };
  if (['read_file', 'list_files'].includes(toolName) && field === 'path') return { action: 'workspace.read', resourceType: 'workspace.path' };
  if (toolName === 'write_file' && field === 'path') return { action: 'workspace.write', resourceType: 'workspace.path' };
  return undefined;
}

function builtInIdentity(toolName: string) {
  return { source_id: 'built_in', namespace: 'megumi', source_tool_name: toolName };
}

function migrationError(group: string, index: number | undefined, message: string) {
  return new LegacyPermissionSettingsMigrationError(message, { group, ...(index === undefined ? {} : { index }) });
}

function writeAtomic(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* preserve original error */ }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
