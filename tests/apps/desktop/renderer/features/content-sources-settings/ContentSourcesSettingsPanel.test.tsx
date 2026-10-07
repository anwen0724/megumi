import { createSettingsFixture } from '../../settings-test-fixture';
// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentSourcesSettingsPanel } from '@megumi/desktop/renderer/features/content-sources-settings';

describe('ContentSourcesSettingsPanel', () => {
  const setCredential = vi.fn();
  const checkSourceAccess = vi.fn();

  beforeEach(() => {
    const fixture = createSettingsFixture();
    fixture.settings.updateCredential({
      target: { kind: 'discoverySource', sourceId: 'zhihu' },
      value: 'saved-zhihu-secret',
    });
    setCredential.mockReset().mockImplementation(fixture.api.settings.updateCredential);
    checkSourceAccess.mockReset().mockResolvedValue({ ok: true, data: { sourceId: 'xiaohongshu', state: 'available', checkedAt: '2026-10-07T00:00:00.000Z', retryAt: null, error: null } });
    // The panel needs no Discovery operation: enabling sources lives on the interests page.
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        models: fixture.api.models,
        settings: { ...fixture.api.settings, updateCredential: setCredential },
        discovery: {
          async getConfiguration() { return { ok: true, data: { candidateSupplyConfirmed: false, sources: [{ sourceId: 'xiaohongshu', name: '小红书', enabled: true, credentialConfigured: false, state: 'login_required', checkedAt: null, retryAt: null, error: null }] } }; },
          checkSourceAccess,
          async openSourceLogin() { return { ok: true, data: { status: 'opened' } }; },
        },
      },
    });
  });

  it('reveals the saved content-source credential and saves or clears it', async () => {
    const user = userEvent.setup();
    render(<ContentSourcesSettingsPanel />);

    const row = document.querySelector('[data-source-id="zhihu"]');
    if (!row) throw new Error('Expected the Zhihu source row.');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Configure' }));
    const secret = within(row as HTMLElement).getByLabelText('知乎 Access Secret');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('saved-zhihu-secret');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Show API key' }));
    expect(secret).toHaveAttribute('type', 'text');
    await user.clear(secret);
    await user.type(secret, 'zhihu-secret');
    await user.click(
      within(row as HTMLElement).getByRole('button', {
        name: 'Save 知乎 Access Secret credential',
      }),
    );

    await waitFor(() =>
      expect(setCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { kind: 'discoverySource', sourceId: 'zhihu' },
          value: 'zhihu-secret',
        }),
      ),
    );
    expect(secret).toHaveValue('zhihu-secret');
    expect(
      screen.getByText('Configured', { selector: '[data-source-id="zhihu"] *' }),
    ).toBeInTheDocument();

    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Clear' }));

    await waitFor(() =>
      expect(setCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { kind: 'discoverySource', sourceId: 'zhihu' },
          value: null,
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Not configured', { selector: '[data-source-id="zhihu"] *' }),
      ).toBeInTheDocument(),
    );
  });
  it('saves a recommendation Tavily key through its own credential target', async () => {
    const user = userEvent.setup();
    render(<ContentSourcesSettingsPanel />);
    const row = document.querySelector<HTMLElement>('[data-source-id="tavily"]');
    expect(row).not.toBeNull();
    if (!row) throw new Error('Expected Tavily credential row');
    await user.click(within(row).getByRole('button', { name: 'Configure' }));
    await user.type(within(row).getByLabelText('Tavily API Key'), 'recommendation-key');
    await user.click(within(row).getByRole('button', { name: 'Save Tavily API Key credential' }));
    await waitFor(() => expect(setCredential).toHaveBeenCalledWith({ target: { kind: 'discoverySource', sourceId: 'tavily' }, value: 'recommendation-key' }));
  });
  it('shows access state and probes only when the user asks to check access', async () => {
    const user = userEvent.setup();
    render(<ContentSourcesSettingsPanel />);
    expect(await screen.findByText('Login required')).toBeInTheDocument();
    expect(checkSourceAccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Check access' }));
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(checkSourceAccess).toHaveBeenCalledWith(expect.objectContaining({ payload: { sourceId: 'xiaohongshu' } }));
  });
  it('keeps login-required state when only the login window has opened', async () => {
    const user = userEvent.setup();
    render(<ContentSourcesSettingsPanel />);
    await screen.findByText('Login required');
    await user.click(screen.getByRole('button', { name: 'Open login window' }));
    expect(await screen.findByText('Login window opened. Access has not been confirmed.')).toBeInTheDocument();
    expect(screen.getByText('Login required')).toBeInTheDocument();
    expect(checkSourceAccess).not.toHaveBeenCalled();
  });
});
