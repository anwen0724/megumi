// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizard, useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { useThemeStore } from '@megumi/desktop/renderer/shared/theme';

describe('SetupWizard', () => {
  beforeEach(() => {
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
    useThemeStore.setState(useThemeStore.getInitialState(), true);
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
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    expect(screen.getByLabelText('Model IDs')).toHaveValue('');
    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'https://api.openai.com/v1');
    await user.clear(screen.getByLabelText('Model IDs'));
    await user.type(screen.getByLabelText('Model IDs'), 'gpt-5.5');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText('API key'), 'TEST_API_KEY_VALUE');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(completeSetup).toHaveBeenCalledWith(expect.objectContaining({
      language: 'en-US',
      theme: 'graphite-dark',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      modelIds: ['gpt-5.5'],
      apiKey: 'TEST_API_KEY_VALUE',
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
      skipProvider: true,
    }));
    expect(completeSetup.mock.calls[0][0]).not.toHaveProperty('providerId');
  });

  it('previews theme changes immediately without persisting setup', async () => {
    const user = userEvent.setup();
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false });

    render(<SetupWizard />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: 'Sage Mist' }));

    expect(useThemeStore.getState().theme).toBe('sage-mist');
  });

  it('offers third-party provider setup without prefilled endpoint values', async () => {
    const user = userEvent.setup();
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false });

    render(<SetupWizard />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('option', { name: 'Third-party compatible' })).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveValue('');
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    expect(screen.getByLabelText('Model IDs')).toHaveValue('');

    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');

    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    expect(screen.getByLabelText('Model IDs')).toHaveValue('');
  });
});
