import { describe, expect, test } from 'bun:test';
import {
  imageGenToolDef,
  runImageGeneration,
  resetSelfPortraitCache,
  usesImagesEndpoint,
  type ImageGenContext,
} from '../../utils/imageGen';
import { creditsForImages } from '../../utils/aiPricing';

// 1x1 transparent PNG — whatever the fake image model "returns".
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function fakeDb() {
  const calls = { reserved: 0, failed: 0 };
  return {
    calls,
    imageGen: {
      reserveGeneration: async () => { calls.reserved += 1; return 1; },
      markFailed: async () => { calls.failed += 1; },
    },
  };
}

/** Captures the request body the image model would have received. */
function fakeOpenrouter() {
  const state: { body: any } = { body: null };
  const client = {
    chat: {
      completions: {
        create: async (body: any) => {
          state.body = body;
          return {
            choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${TINY_PNG}` } }] } }],
          };
        },
      },
    },
  };
  return { state, client: client as any };
}

const run = (ctx: ImageGenContext, args: Record<string, any>, or = fakeOpenrouter()) => ({
  or,
  result: runImageGeneration({
    ctx, openrouter: or.client, model: 'test/imgen', args,
  }),
});

describe('imageGenToolDef', () => {
  test('advertises use_self_portrait only when the persona has a portrait', () => {
    expect(imageGenToolDef().function.parameters.properties.use_self_portrait).toBeUndefined();
    expect(imageGenToolDef({ selfPortrait: false }).function.parameters.properties.use_self_portrait)
      .toBeUndefined();
    expect(imageGenToolDef({ selfPortrait: true }).function.parameters.properties.use_self_portrait)
      .toBeDefined();
  });
});

describe('runImageGeneration self-portrait', () => {
  test('rejects use_self_portrait without burning a generation slot when not enabled', async () => {
    const db = fakeDb();
    const { result } = run({ userId: 'u1', db }, { prompt: 'you at the beach', use_self_portrait: true });
    const res = await result;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('not available');
    expect(db.calls.reserved).toBe(0);
  });

  test('sends the portrait as a reference part alongside the scene prompt', async () => {
    resetSelfPortraitCache();
    const db = fakeDb();
    const { or, result } = run(
      { userId: 'u1', db, selfPortrait: true },
      { prompt: 'you at Scarborough beach', use_self_portrait: true },
    );
    const res = await result;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resultText).toContain('Image of you generated');

    const content = or.state.body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('Asimarv');
    expect(content[0].text).toContain('you at Scarborough beach');
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(content[1].image_url.url.length).toBeGreaterThan(1000);
  });

  test('an ordinary generation stays a plain text prompt', async () => {
    const db = fakeDb();
    const { or, result } = run({ userId: 'u1', db, selfPortrait: true }, { prompt: 'a cat' });
    const res = await result;
    expect(res.ok).toBe(true);
    expect(or.state.body.messages[0].content).toBe('a cat');
  });

  test('combines the portrait with an attached edit source, portrait first', async () => {
    resetSelfPortraitCache();
    const db = fakeDb();
    const attached = { type: 'image_url', image_url: { url: 'data:image/png;base64,ATTACHED' } };
    const { or, result } = run(
      {
        userId: 'u1', db, selfPortrait: true, imageParts: [attached],
      },
      { prompt: 'you holding this', use_self_portrait: true, use_attached_images: true },
    );
    const res = await result;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Still a picture of Marv, not a plain edit.
    expect(res.resultText).toContain('Image of you edited');
    const content = or.state.body.messages[0].content;
    expect(content).toHaveLength(3);
    expect(content[0].text).toContain('Asimarv');
    expect(content[2]).toBe(attached);
  });
});

describe('images-endpoint transport', () => {
  test('classifies muse-image as images-endpoint-only, hybrids as chat', () => {
    expect(usesImagesEndpoint('meta/muse-image')).toBe(true);
    expect(usesImagesEndpoint('google/gemini-3.1-flash-lite-image')).toBe(false);
    expect(usesImagesEndpoint('test/imgen')).toBe(false);
  });

  test('posts a bare prompt to /images and reads the b64_json envelope', async () => {
    const db = fakeDb();
    const posted: { path: string | null; body: any } = { path: null, body: null };
    const client: any = {
      post: async (path: string, opts: any) => {
        posted.path = path;
        posted.body = opts.body;
        return { data: [{ b64_json: TINY_PNG, media_type: 'image/webp' }] };
      },
      chat: { completions: { create: async () => { throw new Error('must not use chat/completions'); } } },
    };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(true);
    expect(posted.path).toBe('/images');
    expect(posted.body).toEqual({ model: 'meta/muse-image', prompt: 'a cat', n: 1 });
    expect(posted.body.messages).toBeUndefined();
    // The extension comes from the endpoint's own media_type, not a data URL.
    if (result.ok) expect(result.attachment.name.endsWith('.webp')).toBe(true);
  });

  test('edit sources ride as input_references, not as message parts', async () => {
    const db = fakeDb();
    const part = { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } };
    const posted: { body: any } = { body: null };
    const client: any = {
      post: async (_path: string, opts: any) => {
        posted.body = opts.body;
        return { data: [{ b64_json: TINY_PNG, media_type: 'image/webp' }] };
      },
    };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db, imageParts: [part] },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'make it daylight', use_attached_images: true },
    });

    expect(result.ok).toBe(true);
    expect(posted.body.input_references).toEqual([part]);
  });

  test('a response with no usable image releases the slot', async () => {
    const db = fakeDb();
    const client: any = { post: async () => ({ data: [{}] }) };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(false);
    expect(db.calls.failed).toBe(1);
  });

  test('a bogus media_type is rejected rather than becoming a filename', async () => {
    const db = fakeDb();
    const client: any = {
      post: async () => ({ data: [{ b64_json: TINY_PNG, media_type: '../../etc/passwd' }] }),
    };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(false);
    expect(db.calls.failed).toBe(1);
  });
});

describe('credit metering', () => {
  function fakeMeteredDb(reserveOk = true) {
    const base = fakeDb();
    const usage = {
      reserved: [] as number[], released: [] as number[], charged: [] as any[],
    };
    return {
      usage,
      db: {
        ...base,
        aiUsage: {
          tryReserve: (_u: string, credits: number) => {
            usage.reserved.push(credits);
            return reserveOk ? { ok: true } : { ok: false, reason: 'daily' };
          },
          release: (_u: string, credits: number) => { usage.released.push(credits); },
          addImageUsage: async (u: string, m: string, n: number) => {
            usage.charged.push([u, m, n]);
          },
        },
      },
      calls: base.calls,
    };
  }

  test('reserves before the call, charges once, and always releases', async () => {
    const { db, usage, calls } = fakeMeteredDb();
    const client: any = {
      post: async () => ({ data: [{ b64_json: TINY_PNG, media_type: 'image/webp' }] }),
    };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(true);
    expect(usage.reserved).toEqual([creditsForImages('meta/muse-image')]);
    expect(usage.released).toEqual([creditsForImages('meta/muse-image')]);
    expect(usage.charged).toEqual([['u1', 'meta/muse-image', 1]]);
    expect(calls.failed).toBe(0);
  });

  test('a failed generation releases the reservation and charges nothing', async () => {
    const { db, usage, calls } = fakeMeteredDb();
    const client: any = { post: async () => { throw new Error('provider exploded'); } };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(false);
    expect(usage.released.length).toBe(1);
    expect(usage.charged).toEqual([]);
    expect(calls.failed).toBe(1);
  });

  test('an exhausted credit budget blocks the call and returns the slot', async () => {
    const { db, usage, calls } = fakeMeteredDb(false);
    const client: any = { post: async () => { throw new Error('must not be called'); } };

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('daily');
    expect(usage.charged).toEqual([]);
    expect(calls.failed).toBe(1);
  });

  test('an unpriced model skips metering entirely', async () => {
    const { db, usage } = fakeMeteredDb();
    const or = fakeOpenrouter();

    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: or.client,
      model: 'test/imgen',
      args: { prompt: 'a cat' },
    });

    expect(result.ok).toBe(true);
    expect(usage.reserved).toEqual([]);
    expect(usage.charged).toEqual([]);
  });
});

describe('media_type fallback', () => {
  const sniffCase = async (bytes: Buffer) => {
    const db = fakeDb();
    const client: any = {
      // b64_json present, media_type absent — documented as only included when
      // the format is identifiable.
      post: async () => ({ data: [{ b64_json: bytes.toString('base64') }] }),
    };
    return runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });
  };

  test('sniffs a PNG when media_type is omitted', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    const result = await sniffCase(png);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment.name.endsWith('.png')).toBe(true);
  });

  test('sniffs a webp when media_type is omitted', async () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'latin1'),
      Buffer.alloc(16),
    ]);
    const result = await sniffCase(webp);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment.name.endsWith('.webp')).toBe(true);
  });

  test('sniffs a JPEG when media_type is omitted', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);
    const result = await sniffCase(jpeg);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment.name.endsWith('.jpg')).toBe(true);
  });

  test('unrecognisable bytes are rejected rather than guessed at', async () => {
    // Never defaults to image/png: a wrong extension would lie to aiModeration
    // and to Discord about what the file actually is.
    const result = await sniffCase(Buffer.from('not an image at all', 'latin1'));
    expect(result.ok).toBe(false);
  });

  test('an explicit media_type still wins over sniffing', async () => {
    const db = fakeDb();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    const client: any = {
      post: async () => ({ data: [{ b64_json: png.toString('base64'), media_type: 'image/webp' }] }),
    };
    const result = await runImageGeneration({
      ctx: { userId: 'u1', db },
      openrouter: client,
      model: 'meta/muse-image',
      args: { prompt: 'a cat' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment.name.endsWith('.webp')).toBe(true);
  });
});
