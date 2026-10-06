import { createSettingsFixture } from '../../settings-test-fixture';
// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentSourcesSettingsPanel } from '@megumi/desktop/renderer/features/content-sources-settings';

describe('ContentSourcesSettingsPanel', () => {
  const setCredential = vi.fn();

  beforeEach(() => {
    const fixture = createSettingsFixture();
    fixture.settings.updateCredential({
      target: { kind: 'discoverySource', sourceId: 'zhihu' },
      value: 'saved-zhihu-secret',
    });
    setCredential.mockReset().mockImplementation(fixture.api.settings.updateCredential);
    // The panel needs no Discovery operation: enabling sources lives on the interests page.
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        models: fixture.api.models,
        settings: { ...fixture.api.settings, updateCredential: setCredential },
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
});
