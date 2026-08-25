/*
 * Owns Daily Discovery wall-clock scheduling, startup catch-up, and timer shutdown.
 */
import type { EnsureDailyDiscoveryRequest } from './daily-discovery';

export interface DailyDiscoveryScheduler {
  /** Starts catch-up and future scheduling exactly once. */
  start(): Promise<void>;
  /** Returns the next wall-clock generation timestamp when scheduled. */
  getNextScheduledAt(): string | undefined;
  /** Stops future scheduling and waits for the active scheduled invocation. */
  shutdown(): Promise<void>;
}

export interface CreateDailyDiscoverySchedulerOptions {
  readonly now: () => string;
  readonly timezone: () => string;
  readonly generationTime: () => string;
  readonly ensure: (request: EnsureDailyDiscoveryRequest) => Promise<unknown>;
  readonly onScheduledError: (error: unknown) => void;
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** Creates the single timer owner for Daily Discovery generation. */
export function createDailyDiscoveryScheduler(
  options: CreateDailyDiscoverySchedulerOptions,
): DailyDiscoveryScheduler {
  const timers = options.timers ?? defaultTimers();
  let accepting = true;
  let started = false;
  let timerHandle: unknown;
  let activeInvocation: Promise<void> | undefined;
  let nextScheduledAt: string | undefined;

  const scheduleNext = (): void => {
    if (!accepting || !started) return;
    if (timerHandle !== undefined) timers.clearTimeout(timerHandle);
    nextScheduledAt = nextScheduledTimestamp(
      options.now(),
      options.timezone(),
      options.generationTime(),
    );
    const delay = Math.max(0, Date.parse(nextScheduledAt) - Date.parse(options.now()));
    timerHandle = timers.setTimeout(() => {
      timerHandle = undefined;
      if (!accepting) return;
      activeInvocation = runScheduledEnsure(options)
        .then(() => {
          activeInvocation = undefined;
          try {
            scheduleNext();
          } catch (error) {
            reportScheduledError(options, error);
          }
        });
    }, delay);
    unrefTimer(timerHandle);
  };

  return {
    async start() {
      if (started || !accepting) return;
      started = true;
      const now = options.now();
      const scheduledToday = scheduledTimestamp(
        localDateAt(now, options.timezone()),
        options.generationTime(),
        options.timezone(),
      );
      if (Date.parse(now) >= Date.parse(scheduledToday)) {
        await options.ensure({ trigger: 'startup_catchup', now });
      }
      scheduleNext();
    },
    getNextScheduledAt: () => nextScheduledAt,
    async shutdown() {
      accepting = false;
      if (timerHandle !== undefined) timers.clearTimeout(timerHandle);
      timerHandle = undefined;
      nextScheduledAt = undefined;
      if (activeInvocation) await activeInvocation;
    },
  };
}

/** Resolves the local calendar date for a timestamp in the configured timezone. */
export function localDateAt(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function runScheduledEnsure(options: CreateDailyDiscoverySchedulerOptions): Promise<void> {
  try {
    await options.ensure({ trigger: 'schedule', now: options.now() });
  } catch (error) {
    reportScheduledError(options, error);
  }
}

function reportScheduledError(
  options: CreateDailyDiscoverySchedulerOptions,
  error: unknown,
): void {
  try {
    options.onScheduledError(error);
  } catch {
    // The observer is the terminal boundary and must not create another rejection.
  }
}

function nextScheduledTimestamp(now: string, timezone: string, generationTime: string): string {
  const today = localDateAt(now, timezone);
  const todayScheduled = scheduledTimestamp(today, generationTime, timezone);
  if (Date.parse(todayScheduled) > Date.parse(now)) return todayScheduled;
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return scheduledTimestamp(date.toISOString().slice(0, 10), generationTime, timezone);
}

function scheduledTimestamp(localDate: string, generationTime: string, timezone: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(generationTime)) {
    throw new Error('Discovery dailyGenerationTime must use HH:mm.');
  }
  const dateParts = localDate.split('-').map(Number);
  const timeParts = generationTime.split(':').map(Number);
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];
  const hour = timeParts[0];
  const minute = timeParts[1];
  if (dateParts.length !== 3 || timeParts.length !== 2
    || year === undefined || month === undefined || day === undefined
    || hour === undefined || minute === undefined
    || ![year, month, day, hour, minute].every(Number.isFinite)) {
    throw new Error('Discovery schedule contains an invalid date or time.');
  }
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desiredAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
      Number(value.second),
    );
    instant += desiredAsUtc - representedAsUtc;
  }
  return new Date(instant).toISOString();
}

function defaultTimers() {
  return {
    setTimeout(callback: () => void, delayMs: number): unknown {
      return globalThis.setTimeout(callback, Math.min(delayMs, 2_147_483_647));
    },
    clearTimeout(handle: unknown): void {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    },
  };
}

function unrefTimer(handle: unknown): void {
  if (handle && typeof handle === 'object' && 'unref' in handle
    && typeof (handle as { unref?: unknown }).unref === 'function') {
    (handle as { unref(): void }).unref();
  }
}
