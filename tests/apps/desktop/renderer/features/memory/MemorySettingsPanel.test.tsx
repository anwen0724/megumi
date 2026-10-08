// @vitest-environment jsdom
/* Verifies independent usage and generation settings through the real Settings host. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { MemorySettingsPanel } from '@megumi/desktop/renderer/features/memory/MemorySettingsPanel';
import { createSettingsFixture } from '../../settings-test-fixture';

it('saves explicit memory models while independently disabling generation', async () => {
  const fixture = createSettingsFixture({
    providers: { deepseek: { models: { 'deepseek-flash': {} } } },
  });
  window.megumi = {
    ...window.megumi,
    ...fixture.api,
  };
  const user = userEvent.setup();
  render(<MemorySettingsPanel />);
  const generate = await screen.findByRole('checkbox', { name: 'Generate memories automatically' });
  await waitFor(() => expect(generate).not.toBeDisabled());
  await user.click(generate);
  await user.click(screen.getByLabelText('Extraction model'));
  await user.click(screen.getByRole('option', { name: /deepseek/i }));
  await user.click(screen.getByLabelText('Consolidation model'));
  await user.click(screen.getByRole('option', { name: /deepseek/i }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(fixture.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          memory: {
            generateMemories: false,
            useMemories: true,
            extractModel: {
              providerId: 'deepseek',
              modelId: 'deepseek-flash',
            },
            consolidationModel: {
              providerId: 'deepseek',
              modelId: 'deepseek-flash',
            },
          },
        },
      },
    }),
  );
});
