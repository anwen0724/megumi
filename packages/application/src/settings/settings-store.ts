/* Owns settings.json file IO and atomic local file replacement. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import path from 'node:path';
import {
  ConfigurationFileSchema,
  ConfigurationPatchSchema,
  ConfigurationSchema,
  GlobalOnlySettingsFields,
} from './settings-schema';
import type {
  ReadSettingsResult,
  SettingsSnapshot,
  SettingsScope,
  UpdateSettingsRequest,
  UpdateSettingsResult,
} from './settings-contracts';
import { readJsonFile, writeJsonFile } from './json-file';
import { createCredentialStore } from './credential-store';
export interface CreateSettingsOptions {
  globalSettingsPath: string;
  projectSettingsPath?: string;
  credentialsPath: string;
  readEnvironment: (name: string) => string | undefined;
}

export type Settings = ReturnType<typeof createSettings>;

/** Creates file-bound configuration access without creating any files. */
export function createSettings(options: CreateSettingsOptions) {
  const listeners=new Set<()=>void>();
  let lastRevision:string|undefined;
  function observed(result:ReadSettingsResult):ReadSettingsResult {
    if(result.status==='ok') {
      const changed=lastRevision!==undefined && lastRevision!==result.settings.revision;
      lastRevision=result.settings.revision;
      if(changed)for(const listener of listeners)listener();
    }
    return result;
  }
  return {
    /** Observes a changed configuration after a read or successful local write. */
    subscribeConfiguration(listener:()=>void):()=>void {
      listeners.add(listener);return ()=>{listeners.delete(listener);};
    },
    ...createCredentialStore(options.credentialsPath, options.readEnvironment),
    /** Reads and validates the latest complete configuration; never writes files. */
    readSettings(): ReadSettingsResult {
      const documents = readConfigurationFiles(options);
      if (documents.status === 'rejected') return documents;
      return observed(resolveConfiguration(options, documents.global, documents.project));
    },

    /** Saves explicit edits to the bound file without materializing defaults. */
    updateSettings(request: UpdateSettingsRequest): UpdateSettingsResult {
      const patch = ConfigurationPatchSchema.safeParse(request.patch);
      if (!patch.success) return invalidConfiguration(patch.error.issues);
      const documents = readConfigurationFiles(options);
      if (documents.status === 'rejected') return documents;
      const current = resolveConfiguration(options, documents.global, documents.project);
      if (current.status === 'rejected') return current;
      const conflict = configurationConflict(
        request.expectedRevision,
        current.settings.revision,
        patch.data,
      );
      if (conflict) return conflict;
      const target = options.projectSettingsPath ? documents.project : documents.global;
      const next = applyConfigurationPatch(target, patch.data);
      const result = options.projectSettingsPath
        ? resolveConfiguration(options, documents.global, next)
        : resolveConfiguration(options, next, {});
      if (result.status === 'rejected') return result;
      if (JSON.stringify(target) === JSON.stringify(next)) {
        return { status: 'unchanged', settings: result.settings };
      }
      writeJsonFile(options.projectSettingsPath ?? options.globalSettingsPath, next);
      observed({status:'ok',settings:result.settings});
      return { status: 'updated', settings: result.settings };
    },
  };
}

/** Reads both documents once so validation and saving use the same input. */
function readConfigurationFiles(options: CreateSettingsOptions) {
  const global = readJsonFile(options.globalSettingsPath);
  const project = options.projectSettingsPath
    ? readJsonFile(options.projectSettingsPath)
    : { status: 'ok' as const, document: {} };
  if (global.status === 'invalid' || project.status === 'invalid') {
    return invalidConfiguration(
      [{ path: [], message: 'Settings must contain a JSON object.' }],
      global.status === 'invalid' ? 'global' : 'project',
    );
  }
  return { status: 'ok' as const, global: global.document, project: project.document };
}

/** Validates explicit fields before resolving the complete configuration. */
function resolveConfiguration(
  options: CreateSettingsOptions,
  global: Record<string, unknown>,
  project: Record<string, unknown>,
): ReadSettingsResult {
  const scopeIssues = Object.entries(GlobalOnlySettingsFields).flatMap(([group, fields]) => {
    const values = project[group];
    return isConfigurationObject(values)
      ? fields
          .filter((field) => Object.hasOwn(values, field))
          .map((field) => ({
            scope: 'project' as const,
            path: [group, field],
            message: 'This setting can only be saved globally.',
          }))
      : [];
  });
  if (scopeIssues.length > 0) {
    return {
      status: 'rejected',
      error: {
        code: 'SETTINGS_SCOPE_INVALID',
        message: 'Project settings contain global-only fields.',
        issues: scopeIssues,
      },
    };
  }
  const globalValues = ConfigurationFileSchema.safeParse(global);
  const projectValues = ConfigurationFileSchema.safeParse(project);
  if (!globalValues.success) return invalidConfiguration(globalValues.error.issues, 'global');
  if (!projectValues.success) return invalidConfiguration(projectValues.error.issues, 'project');
  const combined = ConfigurationSchema.safeParse(
    mergeConfiguration(globalValues.data, projectValues.data),
  );
  if (!combined.success) {
    return invalidConfiguration(combined.error.issues);
  }
  return {
    status: 'ok',
    settings: {
      config: combined.data,
      sources: configurationSources(combined.data, globalValues.data, projectValues.data),
      revision: configurationRevision(options, combined.data, global, project),
      diagnostics: [
        ...unknownConfigurationFields(global, globalValues.data, 'global'),
        ...unknownConfigurationFields(project, projectValues.data, 'project'),
      ],
    },
  };
}

/** Converts validation issues without exposing raw files or secret-bearing unknown fields. */
function invalidConfiguration(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
  scope?: SettingsScope,
): Extract<ReadSettingsResult, { status: 'rejected' }> {
  return {
    status: 'rejected',
    error: {
      code: 'SETTINGS_INVALID',
      message: 'Settings contain invalid configuration.',
      issues: issues.map((issue) => ({
        ...(scope ? { scope } : {}),
        path: issue.path.map(String),
        message: issue.message,
      })),
    },
  };
}

/** Merges object fields while arrays and model references replace complete values. */
function mergeConfiguration(
  lower: Record<string, unknown>,
  higher: Record<string, unknown>,
  fieldPath: readonly string[] = [],
): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set([...Object.keys(lower), ...Object.keys(higher)])].map((key) => {
      const nextPath = [...fieldPath, key];
      const before = lower[key];
      const after = higher[key];
      return [
        key,
        after === undefined
          ? before
          : isConfigurationObject(before) &&
              isConfigurationObject(after) &&
              !isModelReferencePath(nextPath)
            ? mergeConfiguration(before, after, nextPath)
            : after,
      ];
    }),
  );
}

/** Attributes effective value fields without returning unknown file contents. */
function configurationSources(
  config: Record<string, unknown>,
  global: Record<string, unknown>,
  project: Record<string, unknown>,
  fieldPath: readonly string[] = [],
): SettingsSnapshot['sources'] {
  return Object.entries(config).flatMap(([name, value]) => {
    const nextPath = [...fieldPath, name];
    const globalValue = global[name];
    const projectValue = project[name];
    if (isConfigurationObject(value) && !isModelReferencePath(nextPath)) {
      return configurationSources(
        value,
        isConfigurationObject(globalValue) ? globalValue : {},
        isConfigurationObject(projectValue) ? projectValue : {},
        nextPath,
      );
    }
    return [
      {
        path: nextPath,
        source:
          projectValue !== undefined
            ? ('project' as const)
            : globalValue !== undefined
              ? ('global' as const)
              : ('default' as const),
      },
    ];
  });
}

function isModelReferencePath(fieldPath: readonly string[]): boolean {
  return (
    fieldPath.length === 2 &&
    ((fieldPath[0] === 'general' && fieldPath[1] === 'lastSelectedModel') ||
      (fieldPath[0] === 'discovery' && fieldPath[1] === 'candidateSupplyModel'))
  );
}

/** Applies edits while preserving empty model entries that represent an added builtin. */
function applyConfigurationPatch(
  document: Record<string, unknown>,
  patch: Record<string, unknown>,
  fieldPath: readonly string[] = [],
): Record<string, unknown> {
  const next = { ...document };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete next[key];
      continue;
    }
    const nextPath = [...fieldPath, key];
    if (isConfigurationObject(value) && !isModelReferencePath(nextPath)) {
      const previous = isConfigurationObject(next[key]) ? next[key] : {};
      const changed = applyConfigurationPatch(previous, value, nextPath);
      const modelEntry =
        nextPath.length === 4 && nextPath[0] === 'providers' && nextPath[2] === 'models';
      if (JSON.stringify(previous) === JSON.stringify(changed)) {
        if (modelEntry && !Object.hasOwn(next, key)) next[key] = changed;
        continue;
      }
      if (Object.keys(changed).length === 0 && !modelEntry) delete next[key];
      else next[key] = changed;
    } else {
      Object.defineProperty(next, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return next;
}

function isConfigurationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reports discarded field locations, never their potentially secret contents. */
function unknownConfigurationFields(
  document: Record<string, unknown>,
  known: Record<string, unknown>,
  scope: SettingsScope,
  fieldPath: readonly string[] = [],
): SettingsSnapshot['diagnostics'] {
  return Object.entries(document).flatMap(([name, value]) => {
    const nextPath = [...fieldPath, name];
    if (!Object.hasOwn(known, name)) {
      return [
        {
          code: 'SETTINGS_UNKNOWN_FIELD' as const,
          scope,
          path: nextPath,
          message: 'This field is not declared.',
        },
      ];
    }
    const knownValue = known[name];
    return isConfigurationObject(value) && isConfigurationObject(knownValue)
      ? unknownConfigurationFields(value, knownValue, scope, nextPath)
      : [];
  });
}

const RevisionSchema = z.object({
  binding: z.string(),
  fields: z.record(z.string()),
});

/** Encodes fingerprints of known fields only; no file contents or secrets are included. */
function configurationRevision(
  options: CreateSettingsOptions,
  config: Record<string, unknown>,
  global: Record<string, unknown>,
  project: Record<string, unknown>,
): string {
  const fields: Record<string, string> = {};
  function visit(value: Record<string, unknown>, fieldPath: readonly string[] = []): void {
    for (const [name, field] of Object.entries(value)) {
      const nextPath = [...fieldPath, name];
      fields[JSON.stringify(nextPath)] = fingerprint([
        field,
        configurationValue(global, nextPath),
        configurationValue(project, nextPath),
      ]);
      if (isConfigurationObject(field) && !isModelReferencePath(nextPath)) visit(field, nextPath);
    }
  }
  visit(config);
  return Buffer.from(
    JSON.stringify({
      binding: fingerprint([options.globalSettingsPath, options.projectSettingsPath]),
      fields,
    }),
  ).toString('base64url');
}

/** Detects conflicts at edited fields, not at file or configuration-group boundaries. */
function configurationConflict(
  expected: string,
  actual: string,
  patch: Record<string, unknown>,
): Extract<ReadSettingsResult, { status: 'rejected' }> | undefined {
  let previous: z.infer<typeof RevisionSchema>;
  try {
    previous = RevisionSchema.parse(
      JSON.parse(Buffer.from(expected, 'base64url').toString('utf8')),
    );
  } catch {
    return {
      status: 'rejected',
      error: { code: 'SETTINGS_CONFLICT', message: 'Read settings before saving changes.' },
    };
  }
  const current = RevisionSchema.parse(
    JSON.parse(Buffer.from(actual, 'base64url').toString('utf8')),
  );
  const paths = editedConfigurationPaths(patch);
  const conflicts = paths.filter((fieldPath) => {
    const key = JSON.stringify(fieldPath);
    return previous.fields[key] !== current.fields[key];
  });
  if (previous.binding !== current.binding || conflicts.length > 0) {
    return {
      status: 'rejected',
      error: {
        code: 'SETTINGS_CONFLICT',
        message: 'Edited configuration changed since it was read.',
        issues: conflicts.map((fieldPath) => ({
          path: fieldPath,
          message: 'Read the current value before updating it.',
        })),
      },
    };
  }
  return undefined;
}

function editedConfigurationPaths(
  patch: Record<string, unknown>,
  fieldPath: readonly string[] = [],
): string[][] {
  return Object.entries(patch).flatMap(([name, value]) => {
    const nextPath = [...fieldPath, name];
    if (value === undefined) return [];
    return isConfigurationObject(value) && !isModelReferencePath(nextPath)
      ? editedConfigurationPaths(value, nextPath)
      : [nextPath];
  });
}

function configurationValue(
  document: Record<string, unknown>,
  fieldPath: readonly string[],
): unknown {
  let current: unknown = document;
  for (const key of fieldPath) {
    if (!isConfigurationObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value, (_key, item: unknown) =>
    isConfigurationObject(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  );
  return createHash('sha256').update(text).digest('base64url');
}
