/*
 * Computes persisted daily windows and verifies publication evidence without model inference.
 */
import type { ContentMaterial, PublicationEvidence } from './content/material-contracts';
/** Rejects dates that JavaScript would silently roll into the following month. */
export function isCalendarDate(date: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}
/** Returns the operating-system IANA timezone unless a controlled clock supplies one. */
export function currentTimezone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
/** Formats a UTC instant as one calendar date in the selected timezone. */
export function localDate(time: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
/** Moves by civil dates, without assuming a day contains 24 local hours. */
export function shiftDate(date: string, days: number): string {
  const time = Date.parse(`${date}T12:00:00Z`) + days * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}
/** Resolves local midnight using the timezone offset at the resulting instant. */
export function midnight(date: string, timezone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  let result = target;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let iteration = 0; iteration < 4; iteration++) {
    const parts = format.formatToParts(result);
    const part = (type: string) => parts.find(entry => entry.type === type)!.value;
    const civil = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
    const difference = target - civil;
    if (!difference)
      return result;
    result += difference;
  }
  return result;
}
/** Produces a verified interval; uncertain Web dates retain their entire possible range. */
export function publicationInterval(material: ContentMaterial): {
  start: number;
  end: number;
  evidence: PublicationEvidence;
  precision: 'instant' | 'date';
} | undefined {
  const published = material.publicationEvidence.filter(item => item.kind === 'published' && item.status === 'verified' && item.value !== null && item.precision !== 'unknown');
  if (material.publicationEvidence.some(item => item.kind === 'published' && item.status === 'conflicting') || !published.length)
    return undefined;
  const ranked = published.map(evidence => ({ evidence, rank: /datePublished/.test(evidence.location) ? 2 : /detail|created|pubdate|publish_time/i.test(evidence.location) ? 3 : 1 }));
  const best = ranked.filter(item => item.rank === Math.max(...ranked.map(entry => entry.rank))).map(({ evidence }) => {
    if (evidence.precision === 'instant') {
      if (typeof evidence.value === 'string' && !/Z$|[+-]\d\d:\d\d$/.test(evidence.value))
        return undefined;
      const time = typeof evidence.value === 'number' ? evidence.value : Date.parse(evidence.value!);
      return Number.isFinite(time) ? { start: time, end: time, evidence, precision: 'instant' as const } : undefined;
    }
    const date = String(evidence.value).slice(0, 10);
    if (!isCalendarDate(date))
      return undefined;
    const timezone = evidence.timezone ?? (material.platform === 'web' ? undefined : 'Asia/Shanghai');
    return timezone ? { start: midnight(date, timezone), end: midnight(shiftDate(date, 1), timezone) - 1, evidence, precision: 'date' as const } : { start: Date.parse(`${date}T00:00:00Z`) - 14 * 3600000, end: Date.parse(`${shiftDate(date, 1)}T00:00:00Z`) + 12 * 3600000 - 1, evidence, precision: 'date' as const };
  }).filter(item => item !== undefined);
  if (!best.length || best.some(item => item.start !== best[0]!.start || item.end !== best[0]!.end))
    return undefined;
  return best[0];
}
