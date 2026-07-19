// @vitest-environment jsdom
/* Verifies Settings-owned permission rule management without duplicating the Composer mode selector. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionRulesPanel } from '@megumi/desktop/renderer/features/permission-settings';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session';

describe('PermissionRulesPanel', () => {
  const get = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    useProjectStore.setState({
      currentProjectId: 'workspace_1',
      projects: [{
        id: 'workspace_1', projectId: 'workspace_1', name: 'Megumi', repoPath: 'C:/megumi', repoPathKey: 'workspace_1',
        status: 'available', createdAt: '2026-07-20T00:00:00.000Z', lastOpenedAt: '2026-07-20T00:00:00.000Z',
      }],
    });
    useSessionStore.setState({
      sessions: [{ id: 'session_1', projectId: 'workspace_1', title: 'Permission design', status: 'active', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }],
    });
    get.mockReset().mockResolvedValue(result('ok'));
    update.mockReset().mockResolvedValue(result('updated'));
    Object.defineProperty(window, 'megumi', { configurable: true, value: { settings: { get, update } } });
  });

  it('lists rule effects and never renders a second permission mode selector', async () => {
    render(<PermissionRulesPanel />);
    expect(await screen.findByRole('heading', { name: 'Permission rules' })).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('Always allow')).toBeInTheDocument();
    expect(screen.getByText('Workspace rule · Megumi')).toBeInTheDocument();
    expect(screen.getByText('Session grant · Permission design')).toBeInTheDocument();
    expect(screen.queryByText(/workspace_1|session_1/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Permission mode')).not.toBeInTheDocument();
  });

  it('adds a validated workspace hostname rule through the existing Settings channel', async () => {
    const user = userEvent.setup();
    render(<PermissionRulesPanel />);
    await screen.findByRole('heading', { name: 'Permission rules' });
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.selectOptions(screen.getByLabelText('Effect'), 'deny');
    await user.selectOptions(screen.getByLabelText('Operation'), 'network.fetch');
    await user.selectOptions(screen.getByLabelText('Match type'), 'hostname');
    await user.clear(screen.getByLabelText('Match value'));
    await user.type(screen.getByLabelText('Match value'), '*.example.com');
    await user.selectOptions(screen.getByLabelText('Scope'), 'workspace');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].payload).toEqual({ permissions: { ruleChange: {
      operation: 'add',
      rule: {
        effect: 'deny', source: 'workspace', sourceId: 'workspace_1',
        target: { kind: 'operation', action: 'network.fetch', resource: {
          type: 'network.url', operator: 'hostname', value: '*.example.com',
        } },
      },
    } } });
  });
});

function result(status: 'ok' | 'updated') {
  return { ok: true, data: { status, settings: {
    language: 'en-US', theme: 'midnight-blue', setup: { completed: true }, memory: { enabled: false },
    web: { search: { hasApiKey: false, credentialSource: 'missing' } }, providers: {},
    permissions: {
      mode: 'ask',
      rules: [{
        effect: 'allow', source: 'user',
        target: { kind: 'operation', action: 'network.fetch', resource: { type: 'network.url', operator: 'hostname', value: 'example.com' } },
      }, {
        effect: 'ask', source: 'workspace', sourceId: 'workspace_1',
        target: { kind: 'operation', action: 'workspace.read', resource: { type: 'workspace.path', operator: 'any' } },
      }, {
        effect: 'deny', source: 'session', sourceId: 'session_1',
        target: { kind: 'tool', sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'read_file', displayName: 'Read file' },
      }],
      catalog: {
        operations: [
          { action: 'workspace.read', resourceType: 'workspace.path', operators: ['any', 'exact', 'prefix', 'glob'] },
          { action: 'network.fetch', resourceType: 'network.url', operators: ['any', 'exact', 'hostname'] },
        ],
        tools: [{ sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'read_file', registeredToolName: 'read_file', displayName: 'Read file' }],
      },
    },
  } }, meta: {} };
}
