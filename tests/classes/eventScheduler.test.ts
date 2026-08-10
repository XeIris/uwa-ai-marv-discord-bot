import {
  describe, expect, test, beforeEach,
} from 'bun:test';
import { EventScheduler } from '../../classes/eventScheduler';
import type { EventEntry, ReminderKind } from '../../database/models/EventModel';

const NOW = new Date('2026-09-01T00:00:00.000Z');
/** Real Discord channel ids are 17-20 digit snowflakes — parseChannelIds validates that. */
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

interface Harness {
  client: any;
  sent: { channelId: string; embedTitle: string; image: string | null }[];
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
} = {}): Harness {
  const sent: Harness['sent'] = [];
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
    client, sent, claims, releases, bands, configRows,
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
