import { describe, expect, test } from 'bun:test';
import {
  imageGenToolDef,
  imageGenGeminiDecl,
  runImageGeneration,
  resetSelfPortraitCache,
  type ImageGenContext,
} from '../../utils/imageGen';

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

    expect(imageGenGeminiDecl().parameters.properties.use_self_portrait).toBeUndefined();
    expect(imageGenGeminiDecl({ selfPortrait: true }).parameters.properties.use_self_portrait).toBeDefined();
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
