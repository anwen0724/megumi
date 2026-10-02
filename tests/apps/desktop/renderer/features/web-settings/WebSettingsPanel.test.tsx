/* Verifies search configuration and credential edits through real Settings. */
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { WebSettingsPanel } from '@megumi/desktop/renderer/features/web-settings';
import { createSettingsFixture } from '../../settings-test-fixture';

it('saves search parameters and credentials independently, retaining the visible key', async () => {
  const fixture = createSettingsFixture();
  fixture.settings.updateCredential({ target: { kind: 'webSearch' }, value: 'stored-secret' });
  Object.defineProperty(window, 'megumi', { configurable: true, value: fixture.api });
  const user = userEvent.setup();
  render(<WebSettingsPanel />);
  const provider = await screen.findByRole('combobox', { name: 'Search provider' });
  expect(provider).toHaveValue('');
  expect(screen.getByLabelText('Search API key')).toHaveValue('stored-secret');
  await user.selectOptions(provider, 'custom');
  await user.type(screen.getByRole('textbox', { name: 'Search Base URL' }), 'https://search.example.com/query');
  await user.clear(screen.getByLabelText('Search API key'));
  await user.type(screen.getByLabelText('Search API key'), 'secret');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fixture.settings.readSettings()).toMatchObject({ status: 'ok', settings: { config: { webSearch: { provider: 'custom', baseUrl: 'https://search.example.com/query' } } } }));
  expect(fixture.settings.readCredential({ target: { kind: 'webSearch' } })).toMatchObject({ status: 'found', value: 'secret' });
  expect(screen.getByLabelText('Search API key')).toHaveValue('secret');
});
