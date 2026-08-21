import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';

const SERVER = '111';
const USER = 'u1';
const OTHER_USER = 'u2';

/** 18:00 Perth on a fixed day, well clear of the 09:00 morning lead. */
const startsIn = (hours: number): string => new Date(Date.now() + hours * 3600_000).toISOString();

describe('EventReminderModel', () => {
  let db: Database;
  let eventId: number;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testEventReminder-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM EventReminder');
    await db.executeQuery('DELETE FROM Event');
    eventId = (await db.event.create(SERVER, { name: 'Workshop', startsAt: startsIn(72) }))!;
  });

  test('subscribing returns the resolved due time and stores it', async () => {
    const due = await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', startsIn(72));
    expect(due).not.toBeNull();

    const [row] = await db.eventReminder.listForUserEvent(eventId, USER);
    expect(row.lead).toBe('day');
    expect(row.dueAt).toBe(due!.toISOString());
    expect(row.sentAt).toBeNull();
  });

  test('leads stack rather than replacing each other', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'week', event!.startsAt);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'hour', event!.startsAt);

    const rows = await db.eventReminder.listForUserEvent(eventId, USER);
    expect(rows.map((r) => r.lead).sort()).toEqual(['hour', 'week']);
  });

  test('re-subscribing to the same lead re-arms it instead of erroring', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    const [first] = await db.eventReminder.listForUserEvent(eventId, USER);
    await db.eventReminder.claim(first.id);
    expect((await db.eventReminder.listForUserEvent(eventId, USER))[0].sentAt).not.toBeNull();

    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    const rows = await db.eventReminder.listForUserEvent(eventId, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0].sentAt).toBeNull();
  });

  test('a lead that does not resolve is not stored', async () => {
    // 09:00 Perth exactly: there is no "morning of" before it.
    const nineAm = await db.event.create(SERVER, { name: 'Early', startsAt: '2099-09-01T01:00:00.000Z' });
    const due = await db.eventReminder.subscribe(SERVER, nineAm!, USER, 'morning', '2099-09-01T01:00:00.000Z');
    expect(due).toBeNull();
    expect(await db.eventReminder.listForUserEvent(nineAm!, USER)).toHaveLength(0);
  });

  test('listDue returns only unsent, past-due rows for events that have not started', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'week', event!.startsAt);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'hour', event!.startsAt);

    // The event is 72h out, so only the week-before lead is due now.
    const due = await db.eventReminder.listDue(10);
    expect(due.map((r) => r.lead)).toEqual(['week']);
    // The join supplies the event fields the DM embed needs.
    expect(due[0].eventName).toBe('Workshop');
    expect(due[0].eventStartsAt).toBe(event!.startsAt);
  });

  test('a started event never yields due reminders', async () => {
    const past = await db.event.create(SERVER, { name: 'Gone', startsAt: startsIn(-1) });
    await db.executeQuery(
      'INSERT INTO EventReminder (event_id, server_id, user_id, lead, due_at) VALUES (?, ?, ?, ?, ?)',
      [past, SERVER, USER, 'hour', startsIn(-2)],
    );
    expect(await db.eventReminder.listDue(10)).toHaveLength(0);
  });

  test('claim is one-shot, so overlapping ticks cannot double-send', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'week', event!.startsAt);
    const [row] = await db.eventReminder.listForUserEvent(eventId, USER);

    expect(await db.eventReminder.claim(row.id)).toBe(true);
    expect(await db.eventReminder.claim(row.id)).toBe(false);
  });

  test('deleting an event removes its subscriptions', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    await db.event.delete(SERVER, eventId);
    expect(await db.eventReminder.countForEvent(eventId)).toBe(0);
  });

  test('rescheduling the event moves every subscription with it', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    await db.eventReminder.subscribe(SERVER, eventId, OTHER_USER, 'hour', event!.startsAt);
    const before = await db.eventReminder.listForUserEvent(eventId, USER);

    const moved = startsIn(96);
    await db.event.update(SERVER, eventId, { startsAt: moved });

    const after = await db.eventReminder.listForUserEvent(eventId, USER);
    expect(after[0].dueAt).not.toBe(before[0].dueAt);
    expect(new Date(after[0].dueAt).getTime())
      .toBe(new Date(moved).getTime() - 24 * 3600_000);
    // Everyone's subscription moves, not just the caller's.
    const other = await db.eventReminder.listForUserEvent(eventId, OTHER_USER);
    expect(new Date(other[0].dueAt).getTime()).toBe(new Date(moved).getTime() - 3600_000);
  });

  test('an edit that does not touch the start time leaves due times alone', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    const before = await db.eventReminder.listForUserEvent(eventId, USER);

    await db.event.update(SERVER, eventId, { location: 'Ezone' });

    const after = await db.eventReminder.listForUserEvent(eventId, USER);
    expect(after[0].dueAt).toBe(before[0].dueAt);
  });

  test('rescheduling re-arms a lead whose new due time is still ahead', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    const [row] = await db.eventReminder.listForUserEvent(eventId, USER);
    await db.eventReminder.claim(row.id);

    await db.event.update(SERVER, eventId, { startsAt: startsIn(120) });

    const after = await db.eventReminder.listForUserEvent(eventId, USER);
    expect(after[0].sentAt).toBeNull();
  });

  test('a lead that no longer resolves is dropped on reschedule', async () => {
    // A fixed 19:00 Perth (11:00 UTC) start, not the suite's rolling
    // `startsIn(72)`: that can land at or before 09:00 Perth, where "morning of"
    // never resolves and subscribe returns null — leaving the final assertion to
    // pass without a morning reminder ever having existed to drop.
    const evening = await db.event.create(SERVER, { name: 'Evening', startsAt: '2099-09-01T11:00:00.000Z' });
    await db.eventReminder.subscribe(SERVER, evening!, USER, 'morning', '2099-09-01T11:00:00.000Z');
    await db.eventReminder.subscribe(SERVER, evening!, USER, 'day', '2099-09-01T11:00:00.000Z');

    // The premise: both leads resolved and are on record before the move.
    const armed = await db.eventReminder.listForUserEvent(evening!, USER);
    expect(armed.map((r) => r.lead).sort()).toEqual(['day', 'morning']);

    // ...then it moves to 08:00 Perth (00:00 UTC), which has no morning-of.
    await db.event.update(SERVER, evening!, { startsAt: '2099-09-02T00:00:00.000Z' });

    const rows = await db.eventReminder.listForUserEvent(evening!, USER);
    expect(rows.map((r) => r.lead)).toEqual(['day']);
  });

  test('unsubscribe removes one lead; unsubscribeAll removes the rest', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'week', event!.startsAt);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);

    expect(await db.eventReminder.unsubscribe(eventId, USER, 'week')).toBe(true);
    expect(await db.eventReminder.unsubscribe(eventId, USER, 'week')).toBe(false);
    expect(await db.eventReminder.unsubscribeAll(eventId, USER)).toBe(1);
    expect(await db.eventReminder.listForUserEvent(eventId, USER)).toHaveLength(0);
  });

  test('one user\'s cancellation never touches another\'s', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
    await db.eventReminder.subscribe(SERVER, eventId, OTHER_USER, 'day', event!.startsAt);

    await db.eventReminder.unsubscribeAll(eventId, USER);
    expect(await db.eventReminder.listForUserEvent(eventId, OTHER_USER)).toHaveLength(1);
  });

  test('listForUser is scoped to the guild and skips started events', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);

    const past = await db.event.create(SERVER, { name: 'Gone', startsAt: startsIn(-1) });
    await db.eventReminder.subscribe(SERVER, past!, USER, 'day', startsIn(-1));

    const rows = await db.eventReminder.listForUser(SERVER, USER);
    expect(rows.map((r) => r.eventName)).toEqual(['Workshop']);
    expect(await db.eventReminder.listForUser('999', USER)).toHaveLength(0);
  });

  test('an unknown lead is rejected at the DAO boundary', async () => {
    await expect(db.eventReminder.subscribe(SERVER, eventId, USER, 'fortnight' as any, startsIn(72)))
      .rejects.toThrow('Unknown reminder lead');
  });
});
