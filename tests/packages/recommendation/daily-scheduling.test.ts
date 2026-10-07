/*
 * Verifies daily scheduling, retained dates and publication precision.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
it('checks today immediately on resume without waiting for the minute timer', async () => {
  const f = recommendationFixture();
  f.advance(-2 * 3600_000);
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.startBackground();
  expect((await f.owner.host.listDailyFeed({})).batches).toHaveLength(0);
  f.advance(2 * 3600_000);
  await f.owner.resumeBackground();
  await f.owner.daily.completion();
  expect((await f.owner.host.listDailyFeed({})).batches).toHaveLength(1);
});
it('rejects an impossible calendar date even when its string lies inside the history window', async () => {
  const f=recommendationFixture();f.advance(Date.parse('2026-03-02T09:00:00+08:00')-f.now());
  await expect(f.owner.host.listDailyFeed({date:'2026-02-30'})).rejects.toMatchObject({code:'DATE_OUT_OF_RANGE'});
});
it('does not automatically start a fourth failed attempt', async () => {
  const f = recommendationFixture({ config: { enabledSources: [] } });
  await f.owner.interests.createInterest({ text: '面试' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.owner.daily.check();
    await f.owner.daily.completion();
    f.advance(5 * 60000);
  }
  const before = f.database.prepare<{
    count: number;
  }>({ sql: "SELECT count(*) AS count FROM recommendation_runs WHERE kind='daily_feed'" }).get()!.count;
  expect(before).toBe(3);
  await f.owner.daily.check();
  await f.owner.daily.completion();
  expect(f.database.prepare<{
    count: number;
  }>({ sql: "SELECT count(*) AS count FROM recommendation_runs WHERE kind='daily_feed'" }).get()!.count).toBe(3);
});
it('checks the scheduled time without creating past missing dates', async () => {
  const f = recommendationFixture();
  f.advance(-2 * 3600000);
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.daily.check();
  expect(f.requests).toEqual([]);
  f.advance(3 * 86400000 + 3600000);
  await f.owner.daily.check();
  await f.owner.daily.completion();
  expect(f.database.prepare<{
    date: string;
  }>({ sql: 'SELECT date FROM daily_feed_batches' }).all()).toEqual([{ date: '2026-10-10' }]);
  await expect(f.owner.host.listDailyFeed({ date: '2026-10-03' })).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
});
