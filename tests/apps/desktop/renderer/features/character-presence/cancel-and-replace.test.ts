import { describe, expect, it, vi } from 'vitest';
import { createCancelAndReplaceCoordinator } from '@megumi/desktop/renderer/features/character-presence/cancel-and-replace';

describe('CancelAndReplaceCoordinator', () => {
  it('stops speech, cancels an active run, and submits only after cancelled terminal confirmation', async () => {
    let confirmCancelled!: () => void;
    const waitForCancelled = vi.fn(() => new Promise<void>((resolve) => { confirmCancelled = resolve; }));
    const submit = vi.fn(async () => undefined);
    const coordinator = createCancelAndReplaceCoordinator({
      interruptSpeech: vi.fn(async () => undefined),
      cancelRun: vi.fn(async () => true),
      waitForCancelled,
      submit,
    });

    await coordinator.begin('run-1');
    const replacement = coordinator.accept('New request');
    await vi.waitFor(() => expect(waitForCancelled).toHaveBeenCalledWith('run-1'));
    expect(submit).not.toHaveBeenCalled();

    confirmCancelled();
    await replacement;
    expect(submit).toHaveBeenCalledWith('New request');
  });

  it('keeps at most one pending replacement and does not cancel a terminal run for TTS-only interruption', async () => {
    const cancelRun = vi.fn(async () => true);
    const submit = vi.fn(async () => undefined);
    const coordinator = createCancelAndReplaceCoordinator({
      interruptSpeech: vi.fn(async () => undefined),
      cancelRun,
      waitForCancelled: vi.fn(async () => undefined),
      submit,
    });

    await coordinator.begin();
    const first = coordinator.accept('Next request');
    const second = coordinator.accept('Ignored while pending');
    await Promise.all([first, second]);

    expect(cancelRun).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('Next request');
  });
});
