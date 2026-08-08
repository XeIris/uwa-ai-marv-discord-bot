import {
  describe, expect, test, beforeEach,
} from 'bun:test';
import { EventScheduler } from '../../classes/eventScheduler';
import type { EventEntry, ReminderKind } from '../../database/models/EventModel';

const NOW = new Date('2026-09-01T00:00:00.000Z');

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
  const configRows = opts.reminderChannels
    ? [{ key: 'event_reminder_channels', value: opts.reminderChannels }]
    : [];

  const client = {
    db: {
      serverConfig: { getAllServerConfig: async () => configRows },
      event: {
        listDueReminders: async (kind: ReminderKind) => opts.events?.[kind] ?? [],
        claimReminder: async (kind: ReminderKind, id: number) => {
          claims.push({ kind, id });
          return opts.claimResult ?? true;
        },
        clearImage: async () => true,
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
    client, sent, claims, configRows,
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
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: '111,222' });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent.map((s) => s.channelId)).toEqual(['111', '222']);
    expect(hh.sent[0].embedTitle).toBe('Workshop — starting soon');
  });

  test('uses the right label per window', async () => {
    const hh = harness({ events: { day: [makeEvent()] }, reminderChannels: '111' });
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

  test('claims before posting, so a lost race posts nothing', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: '111', claimResult: false });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.claims).toHaveLength(1);
    expect(hh.sent).toEqual([]);
  });

  test('attaches the event image when one resolves', async () => {
    const hh = harness({
      events: { soon: [makeEvent({ imageChannelId: 'c1', imageMessageId: 'm1', imageAttachmentId: 'a1' })] },
      reminderChannels: '111',
      attachmentUrl: 'https://cdn.discordapp.com/poster.png?ex=FRESH',
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent[0].image).toBe('https://cdn.discordapp.com/poster.png?ex=FRESH');
  });

  test('still posts when the image is gone', async () => {
    const hh = harness({
      events: { soon: [makeEvent({ imageChannelId: 'c1', imageMessageId: 'm1', imageAttachmentId: 'a1' })] },
      reminderChannels: '111',
    });
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent).toHaveLength(1);
    expect(hh.sent[0].image).toBeNull();
  });

  test('overlapping ticks do not double-sweep', async () => {
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: '111' });
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
    const hh = harness({ events: { soon: [makeEvent()] }, reminderChannels: '111,222' });
    const originalFetch = hh.client.channels.fetch;
    hh.client.channels.fetch = async (id: string) => {
      if (id === '111') throw new Error('missing permissions');
      return originalFetch(id);
    };
    await new EventScheduler(hh.client).tick(NOW);
    expect(hh.sent.map((s) => s.channelId)).toEqual(['222']);
  });

  test('stop() is safe before start() and idempotent', () => {
    const scheduler = new EventScheduler(h.client);
    scheduler.stop();
    scheduler.stop();
  });
});
