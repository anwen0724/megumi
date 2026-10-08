// @vitest-environment node
import { expect, it } from 'vitest';
import { createSourceFixture } from './source-fixture';

it('records content activity separately and gives saved replies durable increasing cursors', async () => {
  const fixture = createSourceFixture();

  try {
    await fixture.user('u1');
    fixture.reply('a1');

    expect(
      fixture.database
        .prepare({ sql: 'SELECT content_updated_at FROM sessions WHERE session_id = ?' })
        .get(['s1']),
    ).toEqual({ content_updated_at: '2026-10-03T00:00:00.000Z' });

    const first = fixture.database
      .prepare<{ sequence: number }>({ sql: 'SELECT sequence FROM session_reply_sequence' })
      .get();

    expect(first?.sequence).toBe(1);

    fixture.database.prepare({ sql: "DELETE FROM session_messages WHERE message_id = 'a1'" }).run();
    fixture.store.updateSessionActiveEntry({
      session_id: 's1',
      active_entry_id: 'entry:u1',
      updated_at: '2026-10-04',
    });
    fixture.reply('a2');

    expect(
      fixture.database.prepare({ sql: 'SELECT sequence FROM session_reply_sequence' }).get(),
    ).toEqual({ sequence: 2 });
  } finally {
    fixture.database.close();
  }
});
