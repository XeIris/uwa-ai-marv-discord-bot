/**
 * The join-welcome card — the PNG posted when someone joins the server.
 *
 * `data/marv-welcome.png` is a fixed piece of art with a blank white circle in
 * the middle; this composites the new member's avatar into that circle, puts
 * "Welcome to / UWA AI Club" above it and their name below, and rasterises the
 * lot. Same pipeline as the diagram renderer — satori lays out, resvg-wasm
 * rasterises — so there's no Chromium and no native image dependency.
 *
 * Unlike `utils/diagramGen.ts` this markup is **ours**, not the model's, so the
 * allowlists that file enforces don't apply here. The one piece of outside data
 * is the avatar, and it never reaches satori as a URL: it's fetched here under a
 * timeout and a size cap, checked to actually be a PNG, and handed on as a data
 * URI. That keeps satori's fetcher from being pointed at anything, and means a
 * slow or hostile CDN response degrades to a card with no avatar rather than
 * hanging the join handler.
 *
 * Everything is positioned in the background image's own pixel space (1376×768),
 * so the layout constants below are literally measured off the art. If the art
 * is ever replaced, re-measure CIRCLE_* against the new file.
 */

import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { log, logError } from './log';

const ASSET_DIR = `${import.meta.dir}/../data`;
const FONT_DIR = `${ASSET_DIR}/fonts`;
const BACKGROUND_PATH = `${ASSET_DIR}/marv-welcome.png`;

/** Natural size of marv-welcome.png; every constant below is in this space. */
const WIDTH = 1376;
const HEIGHT = 768;

/**
 * The white placeholder disc in the artwork, measured off the file rather than
 * eyeballed: it spans x 526–849, y 222–546, so it is a clean 324px circle
 * centred at (687.5, 384). Re-derive these if the art is ever replaced.
 */
const CIRCLE_X = 687.5;
const CIRCLE_Y = 384;
const CIRCLE_DIAMETER = 324;

/**
 * The avatar covers the disc completely — it is a placeholder to fill, not a
 * frame to sit inside. The extra 2px absorbs the disc's antialiased rim, which
 * would otherwise show as a pale fringe around the avatar.
 */
const AVATAR_DIAMETER = CIRCLE_DIAMETER + 2;

/**
 * Widest the title may render before it collides with Marv on the left. The
 * title is centred on the circle, so this is a full width, not a half.
 */
const MAX_TITLE_WIDTH = 700;
const MAX_NAME_WIDTH = 520;
const MAX_TITLE_SIZE = 92;
const MAX_NAME_SIZE = 56;

const TITLE_TOP = 26;
const NAME_TOP = 578;

/**
 * Bruno Ace ships one weight (400). Rather than skew or squash it, the card
 * strokes the glyph outlines in their own fill colour, which thickens every
 * stem evenly and stays exactly on-curve. 4px is tuned for MAX_TITLE_SIZE; the
 * smaller lines get half, so they thicken proportionally rather than turning
 * into blobs.
 */
const TITLE_STROKE = 4;

const TITLE_COLOUR = '#eafff4';
const SUBTITLE_COLOUR = '#9bb3c9';
const NAME_COLOUR = '#7dfcb4';

/**
 * Discord embed accent, sampled from the artwork's own green (the vivid decile
 * of its green-dominant pixels) so the embed's left bar reads as part of the
 * image rather than next to it.
 */
export const WELCOME_EMBED_COLOUR = '#94d28c';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Discord avatars at size=512 are far under this; the cap is for a hostile CDN. */
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 20_000;

/**
 * Names are drawn, not printed, so they need clamping: an 80-character display
 * name would shrink to unreadable, and newlines would break the single-line
 * layout satori is given.
 */
const MAX_NAME_CHARS = 32;

// ---------------------------------------------------------------------------
// Asset loading (cached — the art and fonts never change at runtime)
// ---------------------------------------------------------------------------

interface LoadedAssets {
  background: string;
  fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[];
}

let cachedAssets: LoadedAssets | null = null;
let assetLoadFailed = false;

async function loadAssets(): Promise<LoadedAssets | null> {
  if (cachedAssets) return cachedAssets;
  if (assetLoadFailed) return null;
  try {
    const [bg, display, fallback] = await Promise.all([
      Bun.file(BACKGROUND_PATH).arrayBuffer(),
      Bun.file(`${FONT_DIR}/BrunoAce-Regular.ttf`).arrayBuffer(),
      Bun.file(`${FONT_DIR}/DejaVuSans.ttf`).arrayBuffer(),
    ]);
    if (!Buffer.from(bg.slice(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) {
      throw new Error(`${BACKGROUND_PATH} is not a PNG`);
    }
    cachedAssets = {
      background: `data:image/png;base64,${Buffer.from(bg).toString('base64')}`,
      fonts: [
        // Registered at both weights so a stray fontWeight can't silently fall
        // through to the Latin-only-fallback font.
        {
          name: 'display', data: display, weight: 400, style: 'normal',
        },
        {
          name: 'display', data: display, weight: 700, style: 'normal',
        },
        // Bruno Ace covers basic Latin only, so accented, Greek and Cyrillic
        // display names come out of DejaVu instead of as tofu boxes. CJK and
        // emoji still box — covering those means bundling a CJK font (tens of
        // MB) for a case the club's roster doesn't hit.
        {
          name: 'fallback', data: fallback, weight: 400, style: 'normal',
        },
      ],
    };
    log('[welcome] loaded background art and Bruno Ace font set');
    return cachedAssets;
  } catch (err) {
    // Missing assets are a deployment problem (run: bun scripts/fetch-fonts.ts);
    // don't retry the same failing read on every join.
    assetLoadFailed = true;
    logError('[welcome] failed to load card assets:', err);
    return null;
  }
}

/** Test seam — drops cached art/fonts and any remembered load failure. */
export function resetWelcomeCardCache(): void {
  cachedAssets = null;
  assetLoadFailed = false;
}

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
      await initWasm(await Bun.file(wasmPath).arrayBuffer());
    })().catch((err) => {
      // A failed init here isn't necessarily permanent — let the next call retry.
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/**
 * Fetches an avatar and returns it as a data URI, or null if anything is off.
 *
 * Null is a normal outcome, not an error path worth failing the card over: a
 * member with no avatar, a CDN hiccup, or a response that isn't a PNG all just
 * mean the circle stays blank. The caller still gets a card.
 */
export async function fetchAvatarDataUri(url: string): Promise<string | null> {
  // Only Discord's own CDN — this string comes from discord.js, so anything else
  // means an unexpected shape and is not worth a request.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logError(`[welcome] avatar url is not a valid URL: ${url}`);
    return null;
  }
  if (parsed.protocol !== 'https:' || !/(^|\.)discordapp\.com$/.test(parsed.hostname)) {
    logError(`[welcome] refusing to fetch avatar from unexpected host: ${parsed.hostname}`);
    return null;
  }

  try {
    const res = await fetch(parsed, { signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      log(`[welcome] avatar fetch returned HTTP ${res.status}; rendering without one`);
      return null;
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES) {
      log(`[welcome] avatar declares ${declared} bytes (> ${MAX_AVATAR_BYTES}); rendering without one`);
      return null;
    }
    const buf = await res.arrayBuffer();
    // Re-check after the read: content-length is a claim, byteLength is a fact.
    if (buf.byteLength === 0 || buf.byteLength > MAX_AVATAR_BYTES) {
      log(`[welcome] avatar is ${buf.byteLength} bytes; rendering without one`);
      return null;
    }
    if (!Buffer.from(buf.slice(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) {
      log('[welcome] avatar response is not a PNG; rendering without one');
      return null;
    }
    return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
  } catch (err) {
    logError('[welcome] avatar fetch failed; rendering without one:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Collapses whitespace and truncates. Display names are user-controlled and go
 * straight into the picture, so newlines (which would break the one-line layout)
 * and runaway lengths are dealt with here rather than trusted to satori.
 */
export function sanitiseDisplayName(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return 'new member';
  return flat.length > MAX_NAME_CHARS ? `${flat.slice(0, MAX_NAME_CHARS - 1)}…` : flat;
}

/**
 * Rendered width of one line of text, measured off satori's own output.
 *
 * satori has no measurement API, so this lays the text out on an oversized
 * canvas and takes the largest coordinate in the emitted glyph paths. Those
 * paths are absolute and start at x=0, and for a line wider than it is tall the
 * largest coordinate is always an x — which holds for every string here.
 */
async function measureText(text: string, size: number, fonts: any[]): Promise<number> {
  const svg = await satori(
    {
      type: 'div',
      props: { style: { display: 'flex', fontFamily: 'display', fontSize: size }, children: text },
    } as any,
    { width: WIDTH * 4, height: size * 4, fonts },
  );
  let max = 0;
  for (const path of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const num of path[1].matchAll(/-?\d+(?:\.\d+)?/g)) {
      const value = parseFloat(num[0]);
      if (value > max) max = value;
    }
  }
  return max;
}

/** Largest size (capped) at which `text` fits inside `maxWidth`. */
async function fitTextSize(text: string, fonts: any[], maxWidth: number, cap: number): Promise<number> {
  const widthAt100 = await measureText(text, 100, fonts);
  if (!(widthAt100 > 0)) return cap;
  return Math.max(12, Math.min(cap, Math.floor((maxWidth / widthAt100) * 100)));
}

function textNode(text: string, top: number, size: number, colour: string, tracking: number, stroke: number) {
  return {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        top,
        left: 0,
        width: WIDTH,
        display: 'flex',
        justifyContent: 'center',
        fontFamily: 'display',
        fontSize: size,
        letterSpacing: tracking,
        color: colour,
        WebkitTextStroke: `${stroke}px ${colour}`,
      },
      children: text,
    },
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface WelcomeCardInput {
  /** The member's display name, as shown under the avatar. */
  displayName: string;
  /** Discord CDN avatar URL, or null to leave the circle blank. */
  avatarUrl: string | null;
}

/**
 * Renders the welcome card. Returns null when the card can't be produced —
 * callers post a text-only welcome rather than nothing.
 */
export async function renderWelcomeCard(input: WelcomeCardInput): Promise<Buffer | null> {
  const assets = await loadAssets();
  if (!assets) return null;

  try {
    await ensureWasm();
  } catch (err) {
    logError('[welcome] resvg wasm init failed:', err);
    return null;
  }

  const { fonts } = assets;
  const name = sanitiseDisplayName(input.displayName);
  const avatar = input.avatarUrl ? await fetchAvatarDataUri(input.avatarUrl) : null;

  try {
    const titleSize = await fitTextSize('UWA AI Club', fonts, MAX_TITLE_WIDTH, MAX_TITLE_SIZE);
    const subtitleSize = Math.round(titleSize * 0.5);
    const nameSize = await fitTextSize(name, fonts, MAX_NAME_WIDTH, MAX_NAME_SIZE);

    const children: any[] = [
      {
        type: 'img',
        props: {
          src: assets.background,
          width: WIDTH,
          height: HEIGHT,
          style: { position: 'absolute', top: 0, left: 0 },
        },
      },
      textNode('Welcome to', TITLE_TOP, subtitleSize, SUBTITLE_COLOUR, 6, TITLE_STROKE / 2),
      textNode('UWA AI Club', TITLE_TOP + subtitleSize * 1.25, titleSize, TITLE_COLOUR, 2, TITLE_STROKE),
    ];

    if (avatar) {
      children.push({
        type: 'img',
        props: {
          src: avatar,
          width: AVATAR_DIAMETER,
          height: AVATAR_DIAMETER,
          style: {
            position: 'absolute',
            left: CIRCLE_X - AVATAR_DIAMETER / 2,
            top: CIRCLE_Y - AVATAR_DIAMETER / 2,
            borderRadius: AVATAR_DIAMETER / 2,
          },
        },
      });
    }

    children.push(textNode(name, NAME_TOP, nameSize, NAME_COLOUR, 1, TITLE_STROKE / 2));

    const svg = await Promise.race([
      satori(
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
            },
            children,
          },
        } as any,
        { width: WIDTH, height: HEIGHT, fonts: fonts as any },
      ),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`layout timed out after ${RENDER_TIMEOUT_MS}ms`)), RENDER_TIMEOUT_MS).unref?.();
      }),
    ]);

    const png = Buffer.from(new Resvg(svg, {
      // Only our own fonts, never the host's — deterministic output, and the
      // renderer never enumerates the filesystem looking for font files.
      font: {
        fontBuffers: fonts.map((f) => new Uint8Array(f.data)),
        defaultFontFamily: 'display',
        loadSystemFonts: false,
      },
    }).render().asPng());

    log(`[welcome] rendered card for "${name}" (${Math.round(png.length / 1024)} KB, avatar: ${avatar ? 'yes' : 'no'})`);
    return png;
  } catch (err) {
    logError('[welcome] card render failed:', err);
    return null;
  }
}
