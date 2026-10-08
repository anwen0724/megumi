/*
 * Verifies daily delivery independently of candidate analysis and source availability.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
it('queues changed daily inputs and delivers them before older candidate analysis finishes', async () => {
  const searching = Promise.withResolvers<void>();
  const searchGate = Promise.withResolvers<Response>();
  const analyzing = Promise.withResolvers<void>();
  const analysisGate = Promise.withResolvers<unknown>();
  let searches = 0;
  const f = recommendationFixture({
    fetch: async () => {
      if (++searches === 1) {
        searching.resolve();
        return searchGate.promise;
      }

      return Response.json({ results: [] });
    },

    respond: async prompt => {
      if (prompt.stage === 'analysis') {
        analyzing.resolve();
        return analysisGate.promise;
      }
      if (prompt.stage === 'topic')
        return {
          items: prompt.items!.map(item => ({
            id: item.id,
            result: {
              relation: 'related',
              evidence: [
                {
                  materialId: item.materialId,
                  quote: '准备方法',
                },
              ],
            },
          })),
        };

      return f.defaultRespond(prompt);
    },

    webFetch: {
      async fetch({ url }) {
        return {
          url,
          content: '面试准备方法',
          contentType: 'text/html',
          truncated: false,
          document:
            '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-06T12:00:00+08:00"}</script><article>面试准备方法</article>',
        };
      },
    },
  });
  const firstInterest = await f.owner.interests.createInterest({ text: '面试' });
  const first = await f.owner.host.startDailyFeed({ requestId: 'before-change' });
  await searching.promise;

  const secondInterest = await f.owner.interests.createInterest({ text: '求职' });
  let second;
  try {
    second = await f.owner.host.startDailyFeed({ requestId: 'after-change' });
  } catch (error) {
    searchGate.resolve(Response.json({ results: [] }));
    analysisGate.resolve({});
    throw error;
  }

  expect(second.status).toBe('started');
  expect('runId' in second && 'runId' in first && second.runId !== first.runId).toBe(true);

  const delivered = Promise.withResolvers<void>();
  const unsubscribe = f.owner.host.onChanged(event => {
    if (event.kind === 'run' && 'runId' in second && event.runId === second.runId) {
      void f.owner.host.getRun({ runId: second.runId }).then(run => {
        if (run?.finishedAt) delivered.resolve();
      });
    }
  });
  searchGate.resolve(
    Response.json({
      results: [
        {
          url: 'https://example.com/interview',
          title: '面试',
          content: '面试准备方法',
        },
      ],
    }),
  );
  await analyzing.promise;

  try {
    await delivered.promise;

    const feed = await f.owner.host.listDailyFeed({});
    if (firstInterest.status !== 'created' || secondInterest.status !== 'created')
      throw new Error('Interest setup failed.');

    expect(feed.batches.map(batch => batch.interestId)).toEqual(
      expect.arrayContaining([firstInterest.interest.id, secondInterest.interest.id]),
    );
  } finally {
    unsubscribe();
    analysisGate.resolve(f.defaultRespond(f.prompts.find(prompt => prompt.stage === 'analysis')!));
  }

  await f.owner.daily.completion();
});
it('replays a joined daily request after the run finishes and the service restarts', async () => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<Response>();
  const f = recommendationFixture({
    fetch: async () => {
      entered.resolve();
      return gate.promise;
    },
  });
  await f.owner.interests.createInterest({ text: '面试' });

  const first = await f.owner.host.startDailyFeed({ requestId: 'original-daily' });
  await entered.promise;

  const joined = await f.owner.host.startDailyFeed({ requestId: 'joined-daily' });

  expect(joined).toMatchObject({
    status: 'joined',
    runId: 'runId' in first ? first.runId : undefined,
  });

  gate.resolve(Response.json({ results: [] }));
  await f.owner.daily.completion();
  await f.restart();

  expect(await f.owner.host.startDailyFeed({ requestId: 'joined-daily' })).toEqual(joined);
});
it('reuses successful topic judgments when retrying a partial batch', async () => {
  let retry = false;
  const f = recommendationFixture({
    fetch: async input =>
      new URL(String(input)).pathname === '/search'
        ? Response.json({
            results: ['one', 'two'].map(name => ({
              url: `https://example.com/${name}`,
              title: name,
              content: '准备方法',
            })),
          })
        : Response.json({ results: [] }),

    webFetch: {
      async fetch({ url }) {
        return {
          url,
          content: '面试准备方法包含实际案例和注意事项 ' + url,
          contentType: 'text/html',
          truncated: false,
          document:
            '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-06T12:00:00+08:00"}</script><article>面试准备方法包含实际案例和注意事项 ' +
            url +
            '</article>',
        };
      },
    },

    respond: async prompt => {
      if (prompt.stage !== 'topic') return f.defaultRespond(prompt);

      firstContent ||= prompt.items![0]!.id;
      return {
        items: prompt.items!.map(item => ({
          id: item.id,
          result:
            retry || item.id === firstContent
              ? {
                  relation: 'related',
                  evidence: [
                    {
                      materialId: item.materialId,
                      quote: '准备方法',
                    },
                  ],
                }
              : {
                  relation: 'related',
                  evidence: [],
                },
        })),
      };
    },
  });
  let firstContent = '';
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.host.startDailyFeed({ requestId: 'partial-first' });
  await f.owner.daily.completion();

  const first = await f.owner.host.listDailyFeed({});

  expect(first.batches[0]?.status).toBe('partial');
  expect(first.items).toHaveLength(1);

  const calls = f.prompts.length;
  await f.owner.daily.check();
  await f.owner.daily.completion();

  expect(f.prompts).toHaveLength(calls);

  const before = f.prompts.length;
  retry = true;
  f.advance(5 * 60000);
  await f.owner.host.startDailyFeed({ requestId: 'partial-retry' });
  await f.owner.daily.completion();

  expect((await f.owner.host.listDailyFeed({})).items).toHaveLength(2);
  expect(
    f.prompts
      .slice(before)
      .filter(prompt => prompt.stage === 'topic')
      .flatMap(prompt => prompt.items!.map(item => item.id)),
  ).not.toContain(firstContent);
});
it('merges same-day interest labels and suppresses that content on the following date', async () => {
  const f = recommendationFixture({
    webFetch: {
      async fetch({ url }) {
        return {
          url,
          content: '面试准备方法',
          contentType: 'text/html',
          truncated: false,
          document:
            '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-06T12:00:00+08:00"}</script><article>面试准备方法</article>',
        };
      },
    },

    respond: async prompt =>
      prompt.stage === 'topic'
        ? {
            items: prompt.items!.map(item => ({
              id: item.id,
              result: {
                relation: 'related',
                evidence: [
                  {
                    materialId: item.materialId,
                    quote: '准备方法',
                  },
                ],
              },
            })),
          }
        : f.defaultRespond(prompt),
  });
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.interests.createInterest({ text: '求职' });
  await f.owner.host.startDailyFeed({ requestId: 'day-one' });
  await f.owner.daily.completion();

  const first = await f.owner.host.listDailyFeed({});

  expect(first.items).toHaveLength(1);
  expect(first.items[0]?.interestLabels).toHaveLength(2);

  f.advance(86400000);
  await f.owner.daily.check();
  await f.owner.daily.completion();

  expect((await f.owner.host.listDailyFeed({})).items).toEqual([]);
  expect((await f.owner.host.listDailyFeed({ date: '2026-10-07' })).items).toHaveLength(1);
});
it('leaves interests without an execution slot waiting instead of publishing empty batches', async () => {
  const f = recommendationFixture({ config: { limits: { maxSearchCalls: 2 } as never } });
  for (const text of ['面试', '求职', '简历']) await f.owner.interests.createInterest({ text });

  await f.owner.host.startDailyFeed({ requestId: 'bounded-daily' });
  await f.owner.daily.completion();

  const first = await f.owner.host.listDailyFeed({});

  expect(first.batches).toHaveLength(1);

  await f.owner.daily.check();
  await f.owner.daily.completion();

  expect((await f.owner.host.listDailyFeed({})).batches).toHaveLength(2);
});
it('keeps each interest first-attempt window when a new interest joins a retry', async () => {
  const f = recommendationFixture({ config: { enabledSources: [] } });
  await f.owner.interests.createInterest({ text: '面试' });

  const firstTime = f.now();
  await f.owner.host.startDailyFeed({ requestId: 'first-window' });
  await f.owner.daily.completion();
  f.advance(5 * 60000);
  await f.owner.interests.createInterest({ text: '求职' });
  await f.owner.host.startDailyFeed({ requestId: 'mixed-windows' });
  await f.owner.daily.completion();

  const feed = await f.owner.host.listDailyFeed({});

  expect(feed.batches.find(batch => batch.interestText === '面试')?.windowEnd).toBe(
    new Date(firstTime).toISOString(),
  );
  expect(feed.batches.find(batch => batch.interestText === '求职')?.windowEnd).toBe(
    new Date(f.now()).toISOString(),
  );
});
it('publishes one interest while another interest acquisition is still waiting', async () => {
  const waiting = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<Response>();
  let searches = 0;
  const f = recommendationFixture({
    fetch: async input => {
      if (new URL(String(input)).pathname === '/search' && ++searches === 2) {
        waiting.resolve();
        return gate.promise;
      }

      return Response.json({
        results: [
          {
            url: 'https://example.com/interview',
            title: '面试',
            content: '准备方法',
          },
        ],
      });
    },

    webFetch: {
      async fetch() {
        return {
          url: 'https://example.com/interview',
          content: '面试准备方法',
          contentType: 'text/html',
          truncated: false,
          document:
            '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-06T12:00:00+08:00"}</script><article>面试准备方法</article>',
        };
      },
    },

    respond: async prompt =>
      prompt.stage === 'topic'
        ? {
            items: prompt.items!.map(item => ({
              id: item.id,
              result: {
                relation: 'related',
                evidence: [
                  {
                    materialId: item.materialId,
                    quote: '准备方法',
                  },
                ],
              },
            })),
          }
        : f.defaultRespond(prompt),
  });
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.interests.createInterest({ text: '求职' });

  let published = false;
  f.owner.host.onChanged(event => {
    if (event.kind === 'daily_feed') published = true;
  });
  await f.owner.host.startDailyFeed({ requestId: 'independent-interests' });
  await waiting.promise;

  const result = published;
  gate.resolve(Response.json({ results: [] }));
  await f.owner.daily.completion();

  expect(result).toBe(true);
});
it('publishes a verified daily item before candidate analysis completes and reads it after restart', async () => {
  const analysisEntered = Promise.withResolvers<void>();
  const analysisGate = Promise.withResolvers<unknown>();
  const f = recommendationFixture({
    fetch: async input =>
      new URL(String(input)).pathname === '/search'
        ? Response.json({
            results: [
              {
                url: 'https://example.com/interview',
                title: '面试',
                content: '面试准备方法',
              },
            ],
          })
        : Response.json({
            results: [],
            failed_results: [
              {
                url: 'https://example.com/interview',
                error: 'missing',
              },
            ],
          }),

    webFetch: {
      async fetch() {
        return {
          url: 'https://example.com/interview',
          content: '面试准备方法',
          contentType: 'text/html',
          truncated: false,
          document:
            '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-06T12:00:00+08:00"}</script><article>面试准备方法</article>',
        };
      },
    },

    respond: async prompt => {
      if (prompt.stage === 'analysis') {
        analysisEntered.resolve();
        return analysisGate.promise;
      }
      if (prompt.stage === 'topic')
        return {
          items: prompt.items!.map(item => ({
            id: item.id,
            result: {
              relation: 'related',
              evidence: [
                {
                  materialId: item.materialId,
                  quote: '准备方法',
                },
              ],
            },
          })),
        };

      return f.defaultRespond(prompt);
    },
  });
  await f.owner.interests.createInterest({ text: '面试' });

  const started = await f.owner.host.startDailyFeed({ requestId: 'daily-1' });

  expect(started.status).toBe('started');

  await analysisEntered.promise;

  const feed = await f.owner.host.listDailyFeed({});

  expect(feed.items).toHaveLength(1);
  expect(feed.batches[0]?.status).toBe('ready');

  const calls = f.requests.length;

  expect((await f.owner.host.listDailyFeed({})).items).toHaveLength(1);
  expect(f.requests).toHaveLength(calls);

  analysisGate.resolve(f.defaultRespond(f.prompts.find(prompt => prompt.stage === 'analysis')!));
  await f.owner.daily.completion();
  await f.restart();

  expect((await f.owner.host.listDailyFeed({})).items).toHaveLength(1);
});
it('never promotes a fresh search date into a verified publication date', async () => {
  const f = recommendationFixture();
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.host.startDailyFeed({ requestId: 'date-unknown' });
  await f.owner.daily.completion();

  const feed = await f.owner.host.listDailyFeed({});

  expect(feed.items).toEqual([]);
  expect(feed.batches[0]?.status).toBe('empty');
});
it('keeps a source failure distinct from a successful empty daily batch', async () => {
  const f = recommendationFixture({ config: { enabledSources: [] } });
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.host.startDailyFeed({ requestId: 'no-sources' });
  await f.owner.daily.completion();

  const feed = await f.owner.host.listDailyFeed({});

  expect(feed.items).toEqual([]);
  expect(feed.batches[0]).toMatchObject({
    status: 'failed',
    issues: expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_UNAVAILABLE' })]),
  });
});
it('reuses the first window on same-day retry and does not repeat a completed batch', async () => {
  let first = true;
  const f = recommendationFixture({
    fetch: async input => {
      if (new URL(String(input)).pathname === '/search' && first) {
        first = false;
        return Response.json({ invalid: true });
      }

      return Response.json({
        results: [
          {
            url: 'https://example.com/interview',
            title: '面试',
            content: '准备方法',
            raw_content: '面试准备方法',
          },
        ],
        failed_results: [],
      });
    },
  });
  await f.owner.interests.createInterest({ text: '面试' });
  await f.owner.host.startDailyFeed({ requestId: 'failed-first' });
  await f.owner.daily.completion();

  const batch = (await f.owner.host.listDailyFeed({})).batches[0]!;

  expect(batch.status).toBe('failed');

  f.advance(5 * 60000);
  await f.owner.host.startDailyFeed({ requestId: 'retry' });
  await f.owner.daily.completion();

  expect((await f.owner.host.listDailyFeed({})).batches[0]).toMatchObject({
    windowStart: batch.windowStart,
    windowEnd: batch.windowEnd,
    status: 'empty',
  });

  const histories = f.database
    .prepare<{
      window_end: number;
    }>({ sql: "SELECT window_end FROM search_history WHERE purpose='daily_feed'" })
    .all();

  expect(new Set(histories.map(row => row.window_end)).size).toBe(1);

  const calls = f.requests.length;

  expect((await f.owner.host.startDailyFeed({ requestId: 'again' })).status).toBe(
    'already_completed',
  );
  expect(f.requests).toHaveLength(calls);
});
