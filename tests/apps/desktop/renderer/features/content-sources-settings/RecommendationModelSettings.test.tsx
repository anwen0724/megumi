// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { RecommendationModelSettings } from '@megumi/desktop/renderer/features/content-sources-settings/RecommendationModelSettings';
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
  render(<RecommendationModelSettings />);
  const recommendation = await screen.findByLabelText('Recommendation model');
  const candidate = screen.getByLabelText('Candidate supply model');
  await waitFor(() => expect(recommendation).not.toBeDisabled());
  await user.click(recommendation);
  await user.click(screen.getByRole('option', { name: 'DeepSeek-V4.1-Flash', exact: true }));
  await user.click(candidate);
  await user.click(screen.getByRole('option', { name: 'custom-analysis', exact: true }));
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
