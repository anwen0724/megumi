// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizard, useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';

describe('SetupWizard', () => {
  beforeEach(() => {
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
  });

  it('walks through setup and submits selected settings', async () => {
    const user = userEvent.setup();
    const completeSetup = vi.fn().mockResolvedValue(undefined);
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false, completeSetup });

    render(<SetupWizard />);

    expect(screen.getByRole('heading', { name: 'Set up Megumi' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Language'), 'en-US');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('radio', { name: 'Graphite Dark' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'https://api.openai.com/v1');
    await user.clear(screen.getByLabelText('Model ID'));
    await user.type(screen.getByLabelText('Model ID'), 'gpt-5.5');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText('API key'), 'sk-test-secret');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({
      language: 'en-US',
      theme: 'graphite-dark',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      defaultModelId: 'gpt-5.5',
      apiKey: 'sk-test-secret',
    }));
  });

  it('allows skipping provider configuration', async () => {
    const user = userEvent.setup();
    const completeSetup = vi.fn().mockResolvedValue(undefined);
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false, completeSetup });

    render(<SetupWizard />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByLabelText('Configure provider later'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'deepseek',
      skipProvider: true,
    }));
  });
});
