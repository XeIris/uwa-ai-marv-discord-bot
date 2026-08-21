import {
  describe, expect, test, beforeEach,
} from 'bun:test';
import { EventScheduler } from '../../classes/eventScheduler';
import type { EventEntry, ReminderKind } from '../../database/models/EventModel';
import type { DueEventReminder } from '../../database/models/EventReminderModel';
import type { EventNoticeEntry } from '../../database/models/EventNoticeModel';

const NOW = new Date('2026-09-01T00:00:00.000Z');
/** Real Discord channel ids are 17-20 digit snowflakes — parseSnowflakeIds validates that. */
const CH_A = '100000000000000001';
const CH_B = '100000000000000002';

function makeEvent(overrides: Partial<EventEntry> = {}): EventEntry {
  return {
    id: 1,
    serverId: 'g1',
    name: 'Workshop',
    description: null,
    startsAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    endsAt: null,
    location: 'CSSE building',
    url: null,
    createdBy: null,
    createdAt: '',
    imageChannelId: null,
    imageMessageId: null,
    imageAttachmentId: null,
    reminderDaySentAt: null,
    reminderSoonSentAt: null,
    ...overrides,
  };
}

function makeReminder(overrides: Partial<DueEventReminder> = {}): DueEventReminder {
  return {
    id: 1,
    eventId: 1,
    serverId: 'g1',
    userId: 'u1',
    lead: 'day',
    dueAt: NOW.toISOString(),
    sentAt: null,
    createdAt: '',
    eventName: 'Workshop',
    eventStartsAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function makeNotice(overrides: Partial<EventNoticeEntry> = {}): EventNoticeEntry {
  return {
    id: 1,
    eventId: 1,
    serverId: 'g1',
    target: 'dm',
    userId: 'u1',
    kind: 'changed',
    eventName: 'Workshop',
    oldStartsAt: NOW.toISOString(),
    newStartsAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    oldEndsAt: null,
    newEndsAt: null,
    oldLocation: null,
    newLocation: null,
    droppedLeads: null,
    createdAt: NOW.toISOString(),
    sentAt: null,
    ...overrides,
  };
}

interface Harness {
  client: any;
  sent: { channelId: string; embedTitle: string; image: string | null }[];
  dms: { userId: string; embedTitle: string; description: string }[];
  dmClaims: number[];
  noticeClaims: number[];
  claims: { kind: ReminderKind; id: number }[];
  releases: { kind: ReminderKind; id: number }[];
  bands: { kind: ReminderKind; fromMs: number; toMs: number; configKey: string }[];
  configRows: Record<string, any>[];
}

function harness(opts: {
  events?: Partial<Record<ReminderKind, EventEntry[]>>;
  reminderChannels?: string;
  claimResult?: boolean;
  attachmentUrl?: string;
  dueReminders?: DueEventReminder[];
  dmClaimResult?: boolean;
  dmError?: any;
  dueNotices?: EventNoticeEntry[];
} = {}): Harness {
  const sent: Harness['sent'] = [];
  const dms: Harness['dms'] = [];
  const dmClaims: number[] = [];
  const noticeClaims: number[] = [];
  const claims: Harness['claims'] = [];
  const releases: Harness['releases'] = [];
  const bands: Harness['bands'] = [];
  const configRows = opts.reminderChannels
    ? [{ key: 'event_reminder_channels', value: opts.reminderChannels }]
    : [];

  const client = {
    db: {
      serverConfig: { getAllServerConfig: async () => configRows },
      event: {
        listDueReminders: async (
          kind: ReminderKind,
          fromMs: number,
          toMs: number,
          configKey: string,
        ) => {
          bands.push({
            kind, fromMs, toMs, configKey,
          });
          // The real query filters opted-out guilds in SQL; mimic that here.
          if (!opts.reminderChannels) return [];
          return opts.events?.[kind] ?? [];
        },
        claimReminder: async (kind: ReminderKind, id: number) => {
          claims.push({ kind, id });
          return opts.claimResult ?? true;
        },
        releaseReminder: async (kind: ReminderKind, id: number) => {
          releases.push({ kind, id });
          return true;
        },
        clearImage: async () => true,
        clearImageIfMatches: async () => true,
      },
      eventNotice: {
        listDue: async () => opts.dueNotices ?? [],
        claim: async (id: number) => {
          noticeClaims.push(id);
          return true;
        },
      },
      eventReminder: {
        listDue: async () => opts.dueReminders ?? [],
        claim: async (id: number) => {
          dmClaims.push(id);
          return opts.dmClaimResult ?? true;
        },
      },
    },
    users: {
      fetch: async (userId: string) => ({
        send: async ({ embeds }: any) => {
          if (opts.dmError) throw opts.dmError;
          dms.push({
            userId,
            embedTitle: embeds[0].data.title,
            description: embeds[0].data.description ?? '',
          });
        },
      }),
    },
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        messages: {
          fetch: async () => ({
            attachments: new Map(opts.attachmentUrl ? [['a1', { id: 'a1', url: opts.attachmentUrl }]] : []),
          }),
        },
        send: async ({ embeds }: any) => {
          sent.push({
            channelId,
            embedTitle: embeds[0].data.title,
            image: embeds[0].data.image?.url ?? null,
          });
        },
      }),
    },
  };

  return {
    client, sent, dms, dmClaims, noticeClaims, claims, releases, bands, configRows,
  };
}

describe('EventScheduler', () => {
  let h: Harness;

  beforeEach(() => { h = harness(); });

  test('does nothing when there are no due events', async () => {
    await new EventScheduler(h.client).tick(NOW);
    expect(h.sent).toEqual([]);
    expect(h.claims).toEqual([]);
  });

  test('posts a reminder to every configured channel', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: `${CH_A},${CH_B}` });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent.map((x) => x.channelId)).toEqual([CH_A, CH_B]);
    expect(hh.sent[0].embedTitle).toBe('Workshop — starting soon');
  });

  test('uses the right label per window', async () => {
    const hh = harness({ events: { day: [makeEvent()] }, reminderChannels: CH_A });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent[0].embedTitle).toBe('Workshop — tomorrow');
  });

  test('an unconfigured guild is a silent no-op and does NOT consume the marker', async () => {
    const hh = harness({ events: { soon: [makeEvent()] } });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toEqual([]);
    // Critically: no claim, so configuring a channel later still gets a reminder.
    expect(hh.claims).toEqual([]);
  });

  test('a malformed config consumes the marker, so it cannot starve healthy guilds', async () => {
    // Non-empty value that yields no usable snowflake: it passes the SQL filter,
    // so if the marker were left NULL the row would return in every batch.
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: 'not-a-snowflake' });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toEqual([]);
    expect(hh.claims).toEqual([{ kind: 'soon', id: 1 }]);
    expect(hh.releases).toEqual([]);
  });

  test('passes a lead-time band and the opt-in config key to the query', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: CH_A });
    await new EventScheduler(hh.client).tick(NOW);
    const day = hh.bands.find((b) => b.kind === 'day')!;
    const soon = hh.bands.find((b) => b.kind === 'soon')!;
    // A band, not just an upper bound: the 24h sweep must not fire for an event
    // two hours out.
    expect(day.fromMs).toBeGreaterThan(0);
    expect(day.toMs).toBe(24 * 60 * 60 * 1000);
    expect(day.fromMs).toBeLessThan(day.toMs);
    expect(soon.fromMs).toBe(0);
    expect(soon.toMs).toBe(60 * 60 * 1000);
    // The guild filter is pushed into SQL so opted-out guilds can't eat the batch.
    expect(day.configKey).toBe('event_reminder_channels');
  });

  test('releases the claim when delivery reaches no channel, so a later tick retries', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: CH_A });
    hh.client.channels.fetch = async () => { throw new Error('missing permissions'); };
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toEqual([]);
    expect(hh.claims).toHaveLength(1);
    expect(hh.releases).toEqual([{ kind: 'soon', id: 1 }]);
  });

  test('keeps the claim on partial delivery, so nobody is double-posted', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: `${CH_A},${CH_B}` });
    const originalFetch = hh.client.channels.fetch;
    hh.client.channels.fetch = async (id: string) => {
      if (id === CH_A) throw new Error('missing permissions');
      return originalFetch(id);
    };
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toHaveLength(1);
    expect(hh.releases).toEqual([]);
  });

  test('claims before posting, so a lost race posts nothing', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: CH_A, claimResult: false });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.claims).toHaveLength(1);
    expect(hh.sent).toEqual([]);
  });

  test('attaches the event image when one resolves', async () => {
    const hh = harness({
      events: { soon: [makeEvent({ imageChannelId: 'c1', imageMessageId: 'm1', imageAttachmentId: 'a1' })] },
      reminderChannels: CH_A,
      attachmentUrl: 'https://cdn.discordapp.com/poster.png?ex=FRESH',
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent[0].image).toBe('https://cdn.discordapp.com/poster.png?ex=FRESH');
  });

  test('still posts when the image is gone', async () => {
    const hh = harness({
      events: { soon: [makeEvent({ imageChannelId: 'c1', imageMessageId: 'm1', imageAttachmentId: 'a1' })] },
      reminderChannels: CH_A,
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toHaveLength(1);
    expect(hh.sent[0].image).toBeNull();
  });

  test('overlapping ticks do not double-sweep', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: CH_A });
    const scheduler = new EventScheduler(hh.client);
    await Promise.all([scheduler.tick(NOW), scheduler.tick(NOW)]);
    expect(hh.sent).toHaveLength(1);
  });

  test('a DB failure while listing does not throw out of the tick', async () => {
    const client = harness().client;
    client.db.event.listDueReminders = async () => { throw new Error('db down'); };
    await new EventScheduler(client).tick(NOW);
  });

  test('a send failure to one channel does not block the others', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: `${CH_A},${CH_B}` });
    const originalFetch = hh.client.channels.fetch;
    hh.client.channels.fetch = async (id: string) => {
      if (id === CH_A) throw new Error('missing permissions');
      return originalFetch(id);
    };
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent.map((x) => x.channelId)).toEqual([CH_B]);
  });

  test('stop() is safe before start() and idempotent', () => {
    const scheduler = new EventScheduler(h.client);
    scheduler.stop();
    scheduler.stop();
  });
});

describe('EventScheduler DM reminders', () => {
  test('claims and DMs a due subscription', async () => {
    const hh = harness({ dueReminders: [makeReminder()] });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dmClaims).toEqual([1]);
    expect(hh.dms).toHaveLength(1);
    expect(hh.dms[0].userId).toBe('u1');
    expect(hh.dms[0].embedTitle).toBe('Reminder — Workshop');
  });

  test('a lost claim means another tick already sent it — no DM', async () => {
    const hh = harness({ dueReminders: [makeReminder()], dmClaimResult: false });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dms).toEqual([]);
  });

  test('a reminder that came due long ago is consumed, not sent', async () => {
    // Bot was down for a day: telling someone about a lead time that passed
    // yesterday is worse than saying nothing, but the row must not linger.
    const stale = makeReminder({ dueAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000).toISOString() });
    const hh = harness({ dueReminders: [stale] });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dmClaims).toEqual([1]);
    expect(hh.dms).toEqual([]);
  });

  test('closed DMs keep the claim, so it is not retried every tick', async () => {
    const hh = harness({ dueReminders: [makeReminder()], dmError: { code: 50007 } });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dmClaims).toEqual([1]);
    expect(hh.dms).toEqual([]);
  });

  test('channel reminders still work when there are no due DMs', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: CH_A });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toHaveLength(1);
    expect(hh.dms).toEqual([]);
  });
});

describe('EventScheduler change notices', () => {
  test('DMs a subscriber that the event moved', async () => {
    const hh = harness({ dueNotices: [makeNotice()] });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.noticeClaims).toEqual([1]);
    expect(hh.dms[0].embedTitle).toBe('Updated — Workshop');
    expect(hh.dms[0].description).toContain('New time');
  });

  test('says only what actually changed', async () => {
    // Start untouched (NULL both sides), location moved.
    const hh = harness({
      dueNotices: [makeNotice({
        oldStartsAt: null, newStartsAt: null, oldLocation: 'CSSE', newLocation: 'Ezone',
      })],
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dms[0].description).toContain('Ezone');
    expect(hh.dms[0].description).not.toContain('New time');
  });

  test('tells a subscriber when their lead was removed', async () => {
    const hh = harness({ dueNotices: [makeNotice({ droppedLeads: 'morning' })] });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dms[0].description).toContain('doesn\'t work with the new time');
    expect(hh.dms[0].description).toContain('/event remindme');
  });

  test('a cancellation reads as cancelled, not as a change', async () => {
    const hh = harness({
      dueNotices: [makeNotice({ kind: 'cancelled', newStartsAt: null })],
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.dms[0].embedTitle).toBe('Cancelled — Workshop');
    expect(hh.dms[0].description).toContain('no longer happening');
  });

  test('a channel notice posts to every configured reminder channel', async () => {
    const hh = harness({
      dueNotices: [makeNotice({ target: 'channel', userId: '' })],
      reminderChannels: `${CH_A},${CH_B}`,
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent.map((x) => x.channelId)).toEqual([CH_A, CH_B]);
    expect(hh.dms).toEqual([]);
  });

  test('a channel notice in a guild with no reminder channels is dropped, not retried', async () => {
    const hh = harness({ dueNotices: [makeNotice({ target: 'channel', userId: '' })] });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toEqual([]);
    // Claimed regardless: the guild opted out, so this row must not come back.
    expect(hh.noticeClaims).toEqual([1]);
  });

  test('a notice queued days ago is consumed unsent', async () => {
    const old = makeNotice({ createdAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString() });
    const hh = harness({ dueNotices: [old] });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.noticeClaims).toEqual([1]);
    expect(hh.dms).toEqual([]);
  });

  test('closed DMs do not stall the queue', async () => {
    const hh = harness({ dueNotices: [makeNotice()], dmError: { code: 50007 } });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.noticeClaims).toEqual([1]);
    expect(hh.dms).toEqual([]);
  });
});
