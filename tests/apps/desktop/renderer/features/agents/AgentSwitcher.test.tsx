import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentSwitcher from '@megumi/desktop/renderer/features/agents/components/AgentSwitcher';
import { useAgentPreferenceStore } from '@megumi/desktop/renderer/features/agents/store';

describe('AgentSwitcher', () => {
  beforeEach(() => {
    useAgentPreferenceStore.setState({ activeAgentType: 'analyst' });
  });

  it('should render current agent name', () => {
    render(<AgentSwitcher />);
    expect(screen.getByText('Analyst')).toBeDefined();
  });

  it('should show dropdown options on click', async () => {
    render(<AgentSwitcher />);
    const trigger = screen.getByText('Analyst');
    await userEvent.click(trigger);
    expect(screen.getByText('Architect')).toBeDefined();
  });

  it('should switch agent on selection', async () => {
    render(<AgentSwitcher />);
    await userEvent.click(screen.getByText('Analyst'));
    await userEvent.click(screen.getByText('Developer'));
    expect(useAgentPreferenceStore.getState().activeAgentType).toBe('developer');
  });
});
