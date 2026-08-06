import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';

const SERVER = '111';
const OTHER_SERVER = '222';

describe('CommitteeModel', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testCommittee-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => { await db.executeQuery('DELETE FROM Committee'); });

  test('one title can be held by two people', async () => {
    await db.committee.upsert(SERVER, 'adib', 'Tech Lead', { displayName: 'Adib' });
    await db.committee.upsert(SERVER, 'kaz', 'Tech Lead', { displayName: 'Kaz' });

    const roster = await db.committee.listByServer(SERVER);
    expect(roster).toHaveLength(2);
    expect(roster.every((entry) => entry.title === 'Tech Lead')).toBe(true);
  });

  test('one person can hold two titles', async () => {
    await db.committee.upsert(SERVER, 'james', 'Secretary');
    await db.committee.upsert(SERVER, 'james', 'Marketing Officer');

    expect(await db.committee.getTitlesForUser(SERVER, 'james')).toEqual(
      expect.arrayContaining(['Secretary', 'Marketing Officer']),
    );
  });

  test('re-adding the same title updates rather than duplicating', async () => {
    await db.committee.upsert(SERVER, 'ruan', 'Treasurer', { displayName: 'Ruan', isExecutive: false });
    await db.committee.upsert(SERVER, 'ruan', 'Treasurer', { displayName: 'Ruan L', isExecutive: true });

    const roster = await db.committee.listByServer(SERVER);
    expect(roster).toHaveLength(1);
    expect(roster[0].displayName).toBe('Ruan L');
    expect(roster[0].isExecutive).toBe(1);
  });

  test('getTitlesForUser is empty for a non-member', async () => {
    expect(await db.committee.getTitlesForUser(SERVER, 'nobody')).toEqual([]);
  });

  test('listByServer sorts executives first, then by sort order', async () => {
    await db.committee.upsert(SERVER, 'aaron', 'Head of Events', { sortOrder: 3 });
    await db.committee.upsert(SERVER, 'prabh', 'Head of Marketing', { sortOrder: 1 });
    await db.committee.upsert(SERVER, 'sasank', 'President', { isExecutive: true, sortOrder: 1 });

    const roster = await db.committee.listByServer(SERVER);
    expect(roster.map((entry) => entry.title)).toEqual([
      'President', 'Head of Marketing', 'Head of Events',
    ]);
  });

  test('remove without a title clears every title the user holds', async () => {
    await db.committee.upsert(SERVER, 'james', 'Secretary');
    await db.committee.upsert(SERVER, 'james', 'Marketing Officer');

    expect(await db.committee.remove(SERVER, 'james')).toBe(2);
    expect(await db.committee.getTitlesForUser(SERVER, 'james')).toEqual([]);
  });

  test('remove with a title leaves the other titles alone', async () => {
    await db.committee.upsert(SERVER, 'james', 'Secretary');
    await db.committee.upsert(SERVER, 'james', 'Marketing Officer');

    expect(await db.committee.remove(SERVER, 'james', 'Secretary')).toBe(1);
    expect(await db.committee.getTitlesForUser(SERVER, 'james')).toEqual(['Marketing Officer']);
  });

  test('updateEntry renames a title and leaves unsupplied fields untouched', async () => {
    await db.committee.upsert(SERVER, 'izzy', 'Head of Partnerships', {
      displayName: 'Izzy', isExecutive: false, sortOrder: 7,
    });

    expect(await db.committee.updateEntry(SERVER, 'izzy', 'Head of Partnerships', {
      title: 'Head of Partnerships and External Relations',
    })).toBe(true);

    const roster = await db.committee.listByServer(SERVER);
    expect(roster[0].title).toBe('Head of Partnerships and External Relations');
    expect(roster[0].displayName).toBe('Izzy');
    expect(roster[0].sortOrder).toBe(7);
  });

  test('updateEntry returns false for a title the user does not hold', async () => {
    expect(await db.committee.updateEntry(SERVER, 'ghost', 'President', { title: 'Emperor' })).toBe(false);
  });

  test('rosters are scoped per guild', async () => {
    await db.committee.upsert(SERVER, 'sasank', 'President');
    await db.committee.upsert(OTHER_SERVER, 'someone', 'President');

    expect(await db.committee.listByServer(SERVER)).toHaveLength(1);
    expect(await db.committee.getTitlesForUser(OTHER_SERVER, 'sasank')).toEqual([]);
  });
});
