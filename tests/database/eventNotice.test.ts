import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';

const SERVER = '111';
const USER = 'u1';
const OTHER_USER = 'u2';

const startsIn = (hours: number): string => new Date(Date.now() + hours * 3600_000).toISOString();

describe('EventNotice queueing', () => {
  let db: Database;
  let eventId: number;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testEventNotice-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM EventNotice');
    await db.executeQuery('DELETE FROM EventReminder');
    await db.executeQuery('DELETE FROM Event');
    eventId = (await db.event.create(SERVER, {
      name: 'Workshop', startsAt: startsIn(72), location: 'CSSE',
    }))!;
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'day', event!.startsAt);
  });

  const dmNotices = async () => (await db.eventNotice.listForEvent(eventId))
    .filter((notice) => notice.target === 'dm');
  const channelNotices = async () => (await db.eventNotice.listForEvent(eventId))
    .filter((notice) => notice.target === 'channel');

  test('moving the start time queues a DM notice and one channel notice', async () => {
    const before = (await db.event.getById(SERVER, eventId))!.startsAt;
    const moved = startsIn(96);
    await db.event.update(SERVER, eventId, { startsAt: moved });

    const dms = await dmNotices();
    expect(dms).toHaveLength(1);
    expect(dms[0].userId).toBe(USER);
    expect(dms[0].kind).toBe('changed');
    expect(dms[0].oldStartsAt).toBe(before);
    expect(dms[0].newStartsAt).toBe(moved);
    expect(await channelNotices()).toHaveLength(1);
  });

  test('a location change alone is notifiable', async () => {
    await db.event.update(SERVER, eventId, { location: 'Ezone North' });
    const [notice] = await dmNotices();
    expect(notice.oldLocation).toBe('CSSE');
    expect(notice.newLocation).toBe('Ezone North');
    // Untouched fields stay NULL on both sides, so delivery says nothing about them.
    expect(notice.oldStartsAt).toBeNull();
    expect(notice.newStartsAt).toBeNull();
  });

  test('an end-time-only change is notifiable', async () => {
    const ends = startsIn(74);
    await db.event.update(SERVER, eventId, { endsAt: ends });
    const [notice] = await dmNotices();
    expect(notice.newEndsAt).toBe(ends);
  });

  test('an edit that touches nothing notifiable queues no notice', async () => {
    await db.event.update(SERVER, eventId, { description: 'now with snacks' });
    expect(await dmNotices()).toHaveLength(0);
    expect(await channelNotices()).toHaveLength(0);
  });

  test('repeated edits collapse into one notice keeping the ORIGINAL old value', async () => {
    const original = (await db.event.getById(SERVER, eventId))!.startsAt;
    const first = startsIn(96);
    const second = startsIn(120);

    await db.event.update(SERVER, eventId, { startsAt: first });
    await db.event.update(SERVER, eventId, { startsAt: second });

    const dms = await dmNotices();
    expect(dms).toHaveLength(1);
    // The subscriber should read "original → second", not "first → second".
    expect(dms[0].oldStartsAt).toBe(original);
    expect(dms[0].newStartsAt).toBe(second);
  });

  test('moving an event and moving it back sends nothing at all', async () => {
    const original = (await db.event.getById(SERVER, eventId))!.startsAt;
    await db.event.update(SERVER, eventId, { startsAt: startsIn(96) });
    expect(await dmNotices()).toHaveLength(1);

    await db.event.update(SERVER, eventId, { startsAt: original });
    expect(await dmNotices()).toHaveLength(0);
    expect(await channelNotices()).toHaveLength(0);
  });

  test('separate edits to different fields accumulate into one notice', async () => {
    const moved = startsIn(96);
    await db.event.update(SERVER, eventId, { startsAt: moved });
    await db.event.update(SERVER, eventId, { location: 'Ezone North' });

    const dms = await dmNotices();
    expect(dms).toHaveLength(1);
    expect(dms[0].newStartsAt).toBe(moved);
    expect(dms[0].newLocation).toBe('Ezone North');
  });

  test('an edit after delivery starts a fresh notice instead of reopening it', async () => {
    await db.event.update(SERVER, eventId, { startsAt: startsIn(96) });
    const [first] = await dmNotices();
    await db.eventNotice.claim(first.id);

    const later = startsIn(120);
    await db.event.update(SERVER, eventId, { startsAt: later });

    const dms = await dmNotices();
    expect(dms).toHaveLength(1);
    expect(dms[0].sentAt).toBeNull();
    // The delivered notice is history: this one starts from where that left off.
    expect(dms[0].oldStartsAt).toBe(first.newStartsAt);
    expect(dms[0].newStartsAt).toBe(later);
  });

  test('a dropped lead is recorded on that subscriber\'s notice only', async () => {
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'morning', event!.startsAt);
    await db.eventReminder.subscribe(SERVER, eventId, OTHER_USER, 'day', event!.startsAt);

    // 08:00 Perth — no "morning of" resolves before it.
    await db.event.update(SERVER, eventId, { startsAt: '2099-09-02T00:00:00.000Z' });

    const dms = await dmNotices();
    const mine = dms.find((notice) => notice.userId === USER)!;
    const theirs = dms.find((notice) => notice.userId === OTHER_USER)!;
    expect(mine.droppedLeads).toBe('morning');
    expect(theirs.droppedLeads).toBeNull();
  });

  test('someone whose ONLY lead is dropped still gets told', async () => {
    await db.executeQuery('DELETE FROM EventReminder');
    const event = await db.event.getById(SERVER, eventId);
    await db.eventReminder.subscribe(SERVER, eventId, USER, 'morning', event!.startsAt);

    await db.event.update(SERVER, eventId, { startsAt: '2099-09-02T00:00:00.000Z' });

    // Their subscription row is gone, so the recipient list has to have been
    // captured before the reschedule ran.
    expect(await db.eventReminder.listForUserEvent(eventId, USER)).toHaveLength(0);
    const dms = await dmNotices();
    expect(dms.map((notice) => notice.userId)).toEqual([USER]);
    expect(dms[0].droppedLeads).toBe('morning');
  });

  test('deleting an event queues cancellations that outlive it', async () => {
    const startedAt = (await db.event.getById(SERVER, eventId))!.startsAt;
    await db.event.delete(SERVER, eventId);

    expect(await db.event.getById(SERVER, eventId)).toBeNull();
    expect(await db.eventReminder.countForEvent(eventId)).toBe(0);

    const notices = await db.eventNotice.listForEvent(eventId);
    const dm = notices.find((notice) => notice.target === 'dm')!;
    expect(dm.kind).toBe('cancelled');
    // The name is snapshotted, since there's no Event row left to join to.
    expect(dm.eventName).toBe('Workshop');
    expect(dm.oldStartsAt).toBe(startedAt);
    expect(notices.some((notice) => notice.target === 'channel')).toBe(true);
  });

  test('a cancellation supersedes a pending change notice', async () => {
    await db.event.update(SERVER, eventId, { startsAt: startsIn(96) });
    await db.event.delete(SERVER, eventId);

    const dms = await dmNotices();
    expect(dms).toHaveLength(1);
    expect(dms[0].kind).toBe('cancelled');
  });

  test('listDue returns only unsent notices and claim is one-shot', async () => {
    await db.event.update(SERVER, eventId, { startsAt: startsIn(96) });
    const due = await db.eventNotice.listDue(10);
    expect(due).toHaveLength(2); // one dm, one channel

    expect(await db.eventNotice.claim(due[0].id)).toBe(true);
    expect(await db.eventNotice.claim(due[0].id)).toBe(false);
    expect(await db.eventNotice.listDue(10)).toHaveLength(1);
  });

  test('an event with no subscribers still queues the public channel notice', async () => {
    await db.executeQuery('DELETE FROM EventReminder');
    await db.event.update(SERVER, eventId, { startsAt: startsIn(96) });
    expect(await dmNotices()).toHaveLength(0);
    expect(await channelNotices()).toHaveLength(1);
  });
});
