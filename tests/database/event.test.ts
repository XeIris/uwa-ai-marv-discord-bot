import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';

const SERVER = '111';
const OTHER_SERVER = '222';

const iso = (offsetHours: number): string => new Date(Date.now() + offsetHours * 3600_000).toISOString();

describe('EventModel', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testEvent-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => { await db.executeQuery('DELETE FROM Event'); });

  test('create returns an id and stores every field', async () => {
    const id = await db.event.create(SERVER, {
      name: 'AI Club Social',
      startsAt: iso(24),
      endsAt: iso(26),
      location: 'Guild Village',
      description: 'Come say hi',
      url: 'https://example.com',
    }, 'creator');

    expect(id).toBeGreaterThan(0);
    const stored = await db.event.getById(SERVER, id!);
    expect(stored?.name).toBe('AI Club Social');
    expect(stored?.location).toBe('Guild Village');
    expect(stored?.createdBy).toBe('creator');
  });

  test('listUpcoming excludes finished events and sorts soonest first', async () => {
    await db.event.create(SERVER, { name: 'Later', startsAt: iso(48) });
    await db.event.create(SERVER, { name: 'Sooner', startsAt: iso(2) });
    await db.event.create(SERVER, { name: 'Finished', startsAt: iso(-48), endsAt: iso(-47) });

    const upcoming = await db.event.listUpcoming(SERVER);
    expect(upcoming.map((event) => event.name)).toEqual(['Sooner', 'Later']);
  });

  test('an event that has started but not ended is still upcoming', async () => {
    await db.event.create(SERVER, { name: 'In progress', startsAt: iso(-1), endsAt: iso(1) });
    expect((await db.event.listUpcoming(SERVER)).map((event) => event.name)).toEqual(['In progress']);
  });

  test('listAll includes past events', async () => {
    await db.event.create(SERVER, { name: 'Finished', startsAt: iso(-48) });
    expect(await db.event.listUpcoming(SERVER)).toHaveLength(0);
    expect(await db.event.listAll(SERVER)).toHaveLength(1);
  });

  test('update leaves unsupplied fields untouched', async () => {
    const id = await db.event.create(SERVER, {
      name: 'Workshop', startsAt: iso(24), location: 'Ezone', description: 'Bring a laptop',
    });

    expect(await db.event.update(SERVER, id!, { name: 'Intro Workshop' })).toBe(true);

    const stored = await db.event.getById(SERVER, id!);
    expect(stored?.name).toBe('Intro Workshop');
    expect(stored?.location).toBe('Ezone');
    expect(stored?.description).toBe('Bring a laptop');
  });

  test('update can explicitly clear an optional field with null', async () => {
    const id = await db.event.create(SERVER, { name: 'Workshop', startsAt: iso(24), location: 'Ezone' });
    await db.event.update(SERVER, id!, { location: null });
    expect((await db.event.getById(SERVER, id!))?.location).toBeNull();
  });

  test('update and delete are scoped to the guild that owns the event', async () => {
    const id = await db.event.create(SERVER, { name: 'Ours', startsAt: iso(24) });

    expect(await db.event.update(OTHER_SERVER, id!, { name: 'Hijacked' })).toBe(false);
    expect(await db.event.delete(OTHER_SERVER, id!)).toBe(false);
    expect((await db.event.getById(SERVER, id!))?.name).toBe('Ours');

    expect(await db.event.delete(SERVER, id!)).toBe(true);
    expect(await db.event.getById(SERVER, id!)).toBeNull();
  });
});
