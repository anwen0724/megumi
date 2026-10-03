import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings } from '@megumi/application/settings/settings-store';
import { resolveConfiguredPermissionRules, recordConfiguredSessionGrant } from '@megumi/agent/permissions/permission-rules';
// @vitest-environment node
/* Verifies the resource-specific matching semantics kept internal to Permissions. */
import { describe, expect, it, onTestFinished } from 'vitest';
import type { PermissionOperation, PermissionRule } from '@megumi/agent/permissions/permission-rules';
import { matchesPermissionRule } from '@megumi/agent/permissions/permission-rules';

const context = {
  workspaceId: 'workspace_1',
  sessionId: 'session_1',
  executionId: 'run_1',
  toolIdentity: {
    registeredToolName: 'test',
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: 'test',
  },
};

function operation(
  action: PermissionOperation['action'],
  type: NonNullable<PermissionOperation['resource']>['type'],
  id: string,
  attributes?: Record<string, string | number | boolean | null>,
): PermissionOperation {
  return { action, resource: { type, id, ...(attributes ? { attributes } : {}) }, context };
}

function rule(
  action: string,
  type: string,
  matcher: { operator: string; value?: string },
): PermissionRule {
  return {
    source: 'user',
    target: { kind: 'operation', action, resource: { type, matcher } },
  } as PermissionRule;
}

describe('Permission rules', () => {
  it('does not match legacy Session grants that authorize an entire Tool identity', () => {
    expect(
      matchesPermissionRule(
        {
          source: 'session',
          source_id: 'session_1',
          target: {
            kind: 'tool',
            tool_identity: {
              source_id: 'built_in',
              namespace: 'megumi',
              source_tool_name: 'read_file',
            },
          },
        },
        operation('workspace.read', 'workspace.path', 'secret.md'),
      ),
    ).toBe(false);
  });
  it('matches path and command prefixes only at their semantic boundaries', () => {
    const pathRule = rule('workspace.write', 'workspace.path', {
      operator: 'prefix',
      value: 'C:/work/src',
    });
    expect(
      matchesPermissionRule(
        pathRule,
        operation('workspace.write', 'workspace.path', 'C:/work/src/a.ts'),
      ),
    ).toBe(true);
    expect(
      matchesPermissionRule(
        pathRule,
        operation('workspace.write', 'workspace.path', 'C:/work/src-other/a.ts'),
      ),
    ).toBe(false);

    const commandRule = rule('process.execute', 'process.command', {
      operator: 'prefix',
      value: 'npm test',
    });
    expect(
      matchesPermissionRule(
        commandRule,
        operation('process.execute', 'process.command', 'npm test -- --run'),
      ),
    ).toBe(true);
    expect(
      matchesPermissionRule(
        commandRule,
        operation('process.execute', 'process.command', 'npm tester'),
      ),
    ).toBe(false);
  });

  it('keeps exact hostnames distinct from wildcard subdomains', () => {
    const exact = rule('network.fetch', 'network.url', {
      operator: 'hostname',
      value: 'example.com',
    });
    const wildcard = rule('network.fetch', 'network.url', {
      operator: 'hostname',
      value: '*.example.com',
    });
    expect(
      matchesPermissionRule(
        exact,
        operation('network.fetch', 'network.url', 'https://example.com', {
          hostname: 'example.com',
        }),
      ),
    ).toBe(true);
    expect(
      matchesPermissionRule(
        exact,
        operation('network.fetch', 'network.url', 'https://api.example.com', {
          hostname: 'api.example.com',
        }),
      ),
    ).toBe(false);
    expect(
      matchesPermissionRule(
        wildcard,
        operation('network.fetch', 'network.url', 'https://api.example.com', {
          hostname: 'api.example.com',
        }),
      ),
    ).toBe(true);
    expect(
      matchesPermissionRule(
        wildcard,
        operation('network.fetch', 'network.url', 'https://example.com', {
          hostname: 'example.com',
        }),
      ),
    ).toBe(false);
  });
});

it.each([false, true])(
  'persists session grants in the effective allow file (project override=%s)',
  (overridden) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-settings-'));
    onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
    const globalSettingsPath = path.join(root, 'settings.json');
    const projectSettingsPath = path.join(root, 'project.json');
    const options = {
      globalSettingsPath,
      credentialsPath: path.join(root, 'credentials.json'),
      readEnvironment: () => undefined,
    };
    fs.writeFileSync(globalSettingsPath, JSON.stringify({ permissions: { allow: [] } }));
    if (overridden)
      fs.writeFileSync(projectSettingsPath, JSON.stringify({ permissions: { allow: [] } }));
    const globalSettings = createSettings(options);
    const projectSettings = createSettings({ ...options, projectSettingsPath });
    const grant: PermissionRule = {
      source: 'session',
      source_id: 'session_1',
      target: { kind: 'operation', action: 'agent.context.activate' },
    };
    for (let index = 0; index < 2; index++) {
      expect(
        recordConfiguredSessionGrant(projectSettings, globalSettings, {
          sessionId: 'session_1',
          rules: [grant],
        }),
      ).toEqual({ status: 'saved' });
    }
    expect(
      resolveConfiguredPermissionRules(projectSettings, {
        sessionId: 'session_1',
        workspaceId: 'workspace_1',
      }),
    ).toMatchObject({ permissionSettings: { allow: [grant] } });
    expect(
      resolveConfiguredPermissionRules(projectSettings, {
        sessionId: 'session_2',
        workspaceId: 'workspace_1',
      }),
    ).toMatchObject({ permissionSettings: { allow: [] } });
    expect(globalSettings.readSettings()).toMatchObject({
      settings: { config: { permissions: { allow: overridden ? [] : [grant] } } },
    });
    expect(fs.existsSync(projectSettingsPath)).toBe(overridden);
    expect(
      recordConfiguredSessionGrant(projectSettings, globalSettings, {
        sessionId: 'session_2',
        rules: [grant],
      }),
    ).toMatchObject({ status: 'failed' });
  },
);
