// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { DiscoverySettingsPanel } from '@megumi/desktop/renderer/features/discovery-settings/DiscoverySettingsPanel';
import { createSettingsFixture } from '../../settings-test-fixture';

it('saves separate task models chosen from added models without changing the chat choice', async () => {
  const fixture = createSettingsFixture({
    general: { lastSelectedModel: { providerId: 'deepseek', modelId: 'deepseek-flash' } },
    providers: {
      deepseek: {
        models: {
          'deepseek-flash': {},
          'custom-analysis': { contextWindowTokens: 64000, maxOutputTokens: 4096 },
        },
      },
    },
  });
  window.megumi = { ...window.megumi, ...fixture.api };
  const user = userEvent.setup();
  render(<DiscoverySettingsPanel />);
  const recommendation = await screen.findByLabelText('Recommendation model');
  const candidate = screen.getByLabelText('Candidate supply model');
  await waitFor(() => expect(recommendation).not.toBeDisabled());
  await user.selectOptions(recommendation, 'deepseek/deepseek-flash');
  await user.selectOptions(candidate, 'deepseek/custom-analysis');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(fixture.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          general: { lastSelectedModel: { providerId: 'deepseek', modelId: 'deepseek-flash' } },
          discovery: {
            recommendationModel: { providerId: 'deepseek', modelId: 'deepseek-flash' },
            candidateSupplyModel: { providerId: 'deepseek', modelId: 'custom-analysis' },
          },
        },
      },
    }),
  );
});
