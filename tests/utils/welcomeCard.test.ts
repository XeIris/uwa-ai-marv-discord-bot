// resvg's wasm is initialised by the first renderWelcomeCard call, which every
// test using decodePixels makes before decoding.
import { Resvg } from '@resvg/resvg-wasm';
import {
  fetchAvatarDataUri,
  renderWelcomeCard,
  resetWelcomeCardCache,
  sanitiseDisplayName,
  WELCOME_EMBED_COLOUR,
} from '../../utils/welcomeCard';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CARD_WIDTH = 1376;
const CARD_HEIGHT = 768;

/**
 * RGBA pixels of a rendered card. resvg is already a dependency and exposes the
 * raw buffer, so this avoids pulling in an image library just to inspect output.
 */
function decodePixels(png: Buffer): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">`
    + `<image href="data:image/png;base64,${png.toString('base64')}" `
    + `width="${CARD_WIDTH}" height="${CARD_HEIGHT}"/></svg>`;
  return (new Resvg(svg, {}).render() as any).pixels;
}

describe('sanitiseDisplayName', () => {
  it('keeps an ordinary name unchanged', () => {
    expect(sanitiseDisplayName('xeiris')).toBe('xeiris');
  });

  it('collapses whitespace so the name stays on one line', () => {
    expect(sanitiseDisplayName('  new\n\tmember  ')).toBe('new member');
  });

  it('truncates a name that would shrink to unreadable', () => {
    const result = sanitiseDisplayName('this display name is definitely far too long to fit');
    expect(result.length).toBe(32);
    expect(result.endsWith('…')).toBe(true);
  });

  it('falls back to a placeholder when the name is empty after trimming', () => {
    expect(sanitiseDisplayName('   ')).toBe('new member');
  });
});

describe('fetchAvatarDataUri', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('refuses hosts outside the Discord CDN without making a request', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(PNG_SIGNATURE);
    }) as any;

    expect(await fetchAvatarDataUri('https://evil.example.com/avatar.png')).toBeNull();
    expect(called).toBe(false);
  });

  it('refuses a host that merely ends with the CDN name', async () => {
    expect(await fetchAvatarDataUri('https://notdiscordapp.com/a.png')).toBeNull();
    expect(await fetchAvatarDataUri('https://cdn.discordapp.com.evil.test/a.png')).toBeNull();
  });

  it('refuses plain http', async () => {
    expect(await fetchAvatarDataUri('http://cdn.discordapp.com/a.png')).toBeNull();
  });

  it('refuses a malformed url', async () => {
    expect(await fetchAvatarDataUri('not a url')).toBeNull();
  });

  it('returns a data uri for a PNG from the CDN', async () => {
    globalThis.fetch = (async () => new Response(PNG_SIGNATURE, {
      headers: { 'content-length': String(PNG_SIGNATURE.length) },
    })) as any;

    const result = await fetchAvatarDataUri('https://cdn.discordapp.com/avatars/1/a.png');
    expect(result).toBe(`data:image/png;base64,${PNG_SIGNATURE.toString('base64')}`);
  });

  it('rejects a response that is not a PNG', async () => {
    globalThis.fetch = (async () => new Response(Buffer.from('<svg>not a png</svg>'))) as any;
    expect(await fetchAvatarDataUri('https://cdn.discordapp.com/avatars/1/a.png')).toBeNull();
  });

  it('rejects a body that exceeds the size cap despite a small content-length', async () => {
    const oversized = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(5 * 1024 * 1024)]);
    globalThis.fetch = (async () => new Response(oversized, {
      headers: { 'content-length': '8' },
    })) as any;
    expect(await fetchAvatarDataUri('https://cdn.discordapp.com/avatars/1/a.png')).toBeNull();
  });

  it('rejects a non-ok response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as any;
    expect(await fetchAvatarDataUri('https://cdn.discordapp.com/avatars/1/a.png')).toBeNull();
  });

  it('gives up rather than throwing when the fetch fails', async () => {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
    expect(await fetchAvatarDataUri('https://cdn.discordapp.com/avatars/1/a.png')).toBeNull();
  });
});

describe('renderWelcomeCard', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    resetWelcomeCardCache();
  });

  it('renders a PNG at the artwork size', async () => {
    const png = await renderWelcomeCard({ displayName: 'xeiris', avatarUrl: null });
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    // IHDR width/height are big-endian uint32s at fixed offsets in every PNG.
    expect(png!.readUInt32BE(16)).toBe(1376);
    expect(png!.readUInt32BE(20)).toBe(768);
  });

  it('renders without an avatar rather than failing when the fetch is refused', async () => {
    const png = await renderWelcomeCard({
      displayName: 'xeiris',
      avatarUrl: 'https://evil.example.com/avatar.png',
    });
    expect(png).not.toBeNull();
  });

  it('covers the artwork\'s white disc with the avatar', async () => {
    // The disc is a placeholder to fill, not a frame to sit inside. A
    // mis-centred or undersized avatar leaves a white crescent, which is only
    // visible in the pixels — so assert on them rather than on the constants.
    const avatar = Buffer.from(await Bun.file('./data/marv-pfp.png').arrayBuffer());
    globalThis.fetch = (async () => new Response(avatar)) as any;

    const png = await renderWelcomeCard({
      displayName: 'xeiris',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
    });
    expect(png).not.toBeNull();

    const pixels = decodePixels(png!);
    let nearWhite = 0;
    // The disc spans x 526–849, y 222–546; scan a little wider than that.
    for (let y = 200; y < 570; y += 1) {
      for (let x = 500; x < 880; x += 1) {
        const i = (y * CARD_WIDTH + x) * 4;
        if (pixels[i] >= 245 && pixels[i + 1] >= 245 && pixels[i + 2] >= 245) nearWhite += 1;
      }
    }
    // The bare disc is ~82,000 px. Anything beyond a thin antialiased rim means
    // the avatar has drifted or shrunk.
    expect(nearWhite).toBeLessThan(500);
  });

  it('renders names outside basic Latin', async () => {
    const png = await renderWelcomeCard({ displayName: 'Přemysl Ковалёв', avatarUrl: null });
    expect(png).not.toBeNull();
  });

  it('exposes an embed colour Discord accepts', () => {
    expect(WELCOME_EMBED_COLOUR).toMatch(/^#[0-9a-f]{6}$/);
  });
});
