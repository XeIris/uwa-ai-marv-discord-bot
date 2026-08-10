import { describe, expect, test } from 'bun:test';
import {
  imageRefFor,
  validateImageAttachment,
  resolveEventImageUrl,
  resolveAndPrune,
} from '../../utils/eventImage';
import type { EventEntry } from '../../database/models/EventModel';

const baseEvent: EventEntry = {
  id: 7,
  serverId: 'g1',
  name: 'Workshop',
  description: null,
  startsAt: '2026-09-01T02:00:00.000Z',
  endsAt: null,
  location: null,
  url: null,
  createdBy: null,
  createdAt: '',
  imageChannelId: null,
  imageMessageId: null,
  imageAttachmentId: null,
  reminderDaySentAt: null,
  reminderSoonSentAt: null,
};

const withImage = (overrides: Partial<EventEntry> = {}): EventEntry => ({
  ...baseEvent,
  imageChannelId: 'c1',
  imageMessageId: 'm1',
  imageAttachmentId: 'a1',
  ...overrides,
});

/** Minimal discord.js-shaped client. */
function fakeClient(opts: {
  attachmentUrl?: string;
  fetchChannelError?: any;
  fetchMessageError?: any;
  channelIsText?: boolean;
}): any {
  return {
    channels: {
      fetch: async () => {
        if (opts.fetchChannelError) throw opts.fetchChannelError;
        if (opts.channelIsText === false) return {};
        return {
          messages: {
            fetch: async () => {
              if (opts.fetchMessageError) throw opts.fetchMessageError;
              return {
                attachments: new Map(
                  opts.attachmentUrl ? [['a1', { id: 'a1', url: opts.attachmentUrl }]] : [],
                ),
              };
            },
          },
        };
      },
    },
  };
}

describe('imageRefFor', () => {
  test('returns null when any part of the reference is missing', () => {
    expect(imageRefFor(baseEvent)).toBeNull();
    expect(imageRefFor(withImage({ imageMessageId: null }))).toBeNull();
    expect(imageRefFor(withImage({ imageAttachmentId: null }))).toBeNull();
  });

  test('returns the full reference when present', () => {
    expect(imageRefFor(withImage())).toEqual({ channelId: 'c1', messageId: 'm1', attachmentId: 'a1' });
  });
});

describe('resolveEventImageUrl', () => {
  test('re-resolves a freshly signed url from the source message', async () => {
    const client = fakeClient({ attachmentUrl: 'https://cdn.discordapp.com/x.png?ex=NEW' });
    const res = await resolveEventImageUrl(client, withImage());
    expect(res).toEqual({ url: 'https://cdn.discordapp.com/x.png?ex=NEW', missing: false });
  });

  test('reports no image, not a failure, when the event has none', async () => {
    expect(await resolveEventImageUrl(fakeClient({}), baseEvent)).toEqual({ url: null, missing: false });
  });

  test.each([
    ['deleted message (10008)', { code: 10008 }],
    ['unknown channel (10003)', { code: 10003 }],
  ])('marks the reference missing on %s', async (_label, error) => {
    const res = await resolveEventImageUrl(fakeClient({ fetchMessageError: error }), withImage());
    expect(res).toEqual({ url: null, missing: true });
  });

  test('marks missing when the attachment is gone from a surviving message', async () => {
    const res = await resolveEventImageUrl(fakeClient({}), withImage());
    expect(res.missing).toBe(true);
  });

  test('keeps the reference on a transient error so it can retry', async () => {
    const res = await resolveEventImageUrl(
      fakeClient({ fetchMessageError: Object.assign(new Error('rate limited'), { code: 429 }) }),
      withImage(),
    );
    expect(res).toEqual({ url: null, missing: false });
  });

  test('treats a non-text channel as missing', async () => {
    const res = await resolveEventImageUrl(fakeClient({ channelIsText: false }), withImage());
    expect(res.missing).toBe(true);
  });
});

describe('resolveAndPrune', () => {
  test('clears the stored reference when the source is gone', async () => {
    const cleared: any[] = [];
    const db = {
      event: {
        clearImageIfMatches: async (s: string, i: number, ref: any) => { cleared.push([s, i, ref]); },
      },
    };
    const url = await resolveAndPrune(fakeClient({ fetchMessageError: { code: 10008 } }), db, withImage());
    expect(url).toBeNull();
    expect(cleared).toEqual([['g1', 7, { channelId: 'c1', messageId: 'm1', attachmentId: 'a1' }]]);
  });

  test('clears CONDITIONALLY, so a concurrent /event setimage is not wiped', async () => {
    // The prune must name the reference it resolved. An unconditional clear would
    // delete a newer image an organiser set between the resolve and the prune.
    const cleared: any[] = [];
    const db = {
      event: {
        clearImageIfMatches: async (_s: string, _i: number, ref: any) => { cleared.push(ref); return false; },
        clearImage: async () => { throw new Error('must not use the unconditional clear here'); },
      },
    };
    await resolveAndPrune(fakeClient({ fetchMessageError: { code: 10008 } }), db, withImage());
    expect(cleared).toEqual([{ channelId: 'c1', messageId: 'm1', attachmentId: 'a1' }]);
  });

  test('does not clear on a transient failure', async () => {
    let calls = 0;
    const db = { event: { clearImageIfMatches: async () => { calls += 1; } } };
    await resolveAndPrune(fakeClient({ fetchMessageError: { code: 500 } }), db, withImage());
    expect(calls).toBe(0);
  });

  test('returns the url and clears nothing on success', async () => {
    let calls = 0;
    const db = { event: { clearImageIfMatches: async () => { calls += 1; } } };
    const url = await resolveAndPrune(fakeClient({ attachmentUrl: 'https://cdn/x.png' }), db, withImage());
    expect(url).toBe('https://cdn/x.png');
    expect(calls).toBe(0);
  });
});

describe('validateImageAttachment', () => {
  test('accepts the common image types', () => {
    for (const contentType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(validateImageAttachment({ contentType, size: 1000 })).toBeNull();
    }
  });

  test('accepts a content type with parameters', () => {
    expect(validateImageAttachment({ contentType: 'image/png; charset=utf-8', size: 10 })).toBeNull();
  });

  test('rejects non-images', () => {
    expect(validateImageAttachment({ contentType: 'application/pdf', size: 10 })).toMatch(/must be one of/);
    expect(validateImageAttachment({ contentType: 'text/html', size: 10 })).toMatch(/must be one of/);
    expect(validateImageAttachment({ size: 10 })).toMatch(/unknown/);
  });

  test('rejects an oversized image', () => {
    expect(validateImageAttachment({ contentType: 'image/png', size: 9e6 })).toMatch(/limit is 8 MB/);
  });

  test('passes when there is no attachment at all', () => {
    expect(validateImageAttachment(null)).toBeNull();
    expect(validateImageAttachment(undefined)).toBeNull();
  });
});
