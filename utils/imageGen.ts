import type { OpenAI } from 'openai';
import { log, logError } from './log';

export const IMAGE_GEN_TOOL_NAME = 'generate_image';
export const IMAGE_GEN_DAILY_LIMIT = 5;
/** Hard cap on attached-image edit sources per tool call — guards against
 * bursty spending (N images × N tool iterations) and matches the Imgen
 * model's single-composite output anyway. */
export const IMAGE_EDIT_MAX_SOURCES = 1;
export const IMAGE_GEN_FALLBACK_MODEL = 'google/gemini-3.1-flash-lite-image';

/** Marv's own avatar, used as a character reference when he draws himself. */
const SELF_PORTRAIT_PATH = `${import.meta.dir}/../data/marv-pfp.png`;
const SELF_PORTRAIT_MIME = 'image/png';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const IMAGE_GEN_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 2_000;
// Discord upload cap on non-boosted servers.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const TOOL_DESCRIPTION = 'Generate an image from a text prompt, or edit the single image the user attached. Use ONLY '
  + 'when the user explicitly asks you to generate, create, draw, or edit an image/picture — never for ordinary '
  + 'questions. The generated image is attached to your reply automatically; do not claim you cannot generate '
  + 'images, and do not write links or placeholders for it. '
  + `Users are limited to ${IMAGE_GEN_DAILY_LIMIT} generations per 24 hours.`;

const USE_ATTACHED_DESCRIPTION = 'Set to true to use the image attached to the user\'s current message as the '
  + 'base for an edit/transformation (the prompt then describes the desired change). Only valid when the current '
  + `message has EXACTLY ${IMAGE_EDIT_MAX_SOURCES} image attachment(s) — calls are rejected when the message has `
  + 'none or more than that; in the multi-image case, refuse the edit and ask the user to attach a single image.';

const USE_SELF_PORTRAIT_DESCRIPTION = 'Set to true ONLY when the user asks for a picture of YOU — Marv, Asimarv, '
  + 'the UWA AI Club mascot ("generate an image of yourself", "draw yourself at the beach", "make a picture of '
  + 'Marv"). Your own reference portrait is then passed to the image model so the scene shows the real you '
  + 'instead of an invented character; the prompt should describe the scene you want to appear in. Leave it '
  + 'false/absent for every other image request — a picture of something else is not a picture of you.';

/** Prefixed to the image-model prompt so the reference is read as a character sheet, not a base to edit. */
const SELF_PORTRAIT_INSTRUCTION = 'The reference image provided is Asimarv ("Marv"), the mascot character of the '
  + 'UWA AI Club. Draw a NEW image of this exact character — keep his design, colours, and proportions faithful '
  + 'to the reference — in the following scene: ';

export interface ImageGenContext {
  /** Discord user id of the requester (rate-limit key). */
  userId: string;
  /** Shared Database instance (db.imageGen). */
  db: any;
  /**
   * OpenRouter image_url content parts from the user's attached images
   * (base64 data URLs, see utils/aiMedia.ts). When present, the model may set
   * use_attached_images to edit them instead of generating from scratch.
   */
  imageParts?: any[];
  /**
   * Marv only (persona `clubTools`): offers `use_self_portrait`, which passes
   * `data/marv-pfp.png` to the image model as a character reference so "generate
   * an image of yourself" produces the actual mascot.
   */
  selfPortrait?: boolean;
}

export interface ImageGenAttachment {
  attachment: Buffer;
  name: string;
}

export type ImageGenResult =
  | { ok: true; attachment: ImageGenAttachment; resultText: string }
  | { ok: false; error: string };

export interface ImageGenToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, any> };
}

export function imageGenToolDef(ctx?: Pick<ImageGenContext, 'selfPortrait'>): ImageGenToolDef {
  return {
    type: 'function',
    function: {
      name: IMAGE_GEN_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'A detailed description of the image to generate, or of the edit to apply.',
          },
          use_attached_images: {
            type: 'boolean',
            description: USE_ATTACHED_DESCRIPTION,
          },
          // Only advertised to the persona that has a portrait (Marv).
          ...(ctx?.selfPortrait ? {
            use_self_portrait: {
              type: 'boolean',
              description: USE_SELF_PORTRAIT_DESCRIPTION,
            },
          } : {}),
        },
        required: ['prompt'],
      },
    },
  };
}

export function imageGenGeminiDecl(
  ctx?: Pick<ImageGenContext, 'selfPortrait'>,
): { name: string; description: string; parameters: any } {
  return {
    name: IMAGE_GEN_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'A detailed description of the image to generate, or of the edit to apply.',
        },
        use_attached_images: {
          type: 'BOOLEAN',
          description: USE_ATTACHED_DESCRIPTION,
        },
        ...(ctx?.selfPortrait ? {
          use_self_portrait: {
            type: 'BOOLEAN',
            description: USE_SELF_PORTRAIT_DESCRIPTION,
          },
        } : {}),
      },
      required: ['prompt'],
    },
  };
}

let cachedSelfPortraitPart: any = null;
let selfPortraitLoadFailed = false;

/**
 * Marv's avatar as an OpenRouter image part, read once and cached (it's a small
 * committed file that never changes at runtime). A missing file is a deployment
 * problem, so it isn't retried on every call.
 */
async function getSelfPortraitPart(): Promise<any | null> {
  if (cachedSelfPortraitPart) return cachedSelfPortraitPart;
  if (selfPortraitLoadFailed) return null;
  try {
    const buf = await Bun.file(SELF_PORTRAIT_PATH).arrayBuffer();
    if (buf.byteLength === 0) throw new Error('portrait file is empty');
    // The data URL hard-codes image/png, so check the file really is one — a
    // truncated checkout or a swapped file should fail here (before quota is
    // reserved) rather than as a provider error the user pays for.
    if (!Buffer.from(buf.slice(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) {
      throw new Error('portrait file is not a PNG');
    }
    const b64 = Buffer.from(buf).toString('base64');
    cachedSelfPortraitPart = {
      type: 'image_url',
      image_url: { url: `data:${SELF_PORTRAIT_MIME};base64,${b64}` },
    };
    log(`[imagegen] loaded self-portrait reference ${SELF_PORTRAIT_PATH} (${Math.round(buf.byteLength / 1024)} KB)`);
    return cachedSelfPortraitPart;
  } catch (err) {
    selfPortraitLoadFailed = true;
    logError(`[imagegen] failed to load self-portrait at ${SELF_PORTRAIT_PATH}:`, err);
    return null;
  }
}

/** Test seam — drops the cached portrait (and any remembered load failure). */
export function resetSelfPortraitCache(): void {
  cachedSelfPortraitPart = null;
  selfPortraitLoadFailed = false;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runImageGeneration(opts: {
  ctx: ImageGenContext;
  openrouter: OpenAI;
  model: string;
  /** Output modalities — image-only models (Flux, Recraft) need ['image']; hybrids need ['image', 'text']. */
  modalities?: string[];
  args: Record<string, any>;
}): Promise<ImageGenResult> {
  const { ctx, openrouter, model } = opts;
  const modalities = opts.modalities?.length ? opts.modalities : ['image'];
  const rawPrompt = opts.args?.prompt;

  if (typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return { ok: false, error: 'Error: "prompt" must be a non-empty string.' };
  }
  const prompt = rawPrompt.trim().slice(0, MAX_PROMPT_CHARS);

  // Attached-image editing: only honored when the caller actually collected
  // image parts from the triggering message. Checked before quota reservation
  // so a bad call doesn't burn a generation slot.
  const useAttached = opts.args?.use_attached_images === true;
  const imageParts = Array.isArray(ctx.imageParts) ? ctx.imageParts : [];
  if (useAttached && imageParts.length === 0) {
    return {
      ok: false,
      error: 'Error: the current message has no usable attached images to edit. Generate from the prompt alone, '
        + 'or tell the user to attach the image to the message that asks for the edit.',
    };
  }
  if (useAttached && imageParts.length > IMAGE_EDIT_MAX_SOURCES) {
    return {
      ok: false,
      error: `Error: only ${IMAGE_EDIT_MAX_SOURCES} attached image can be edited per request, but the user attached `
        + `${imageParts.length}. Do NOT retry — refuse the edit and tell the user to send a message with exactly one `
        + 'image attached.',
    };
  }

  // Self-portrait reference (Marv only). Like the attached-image checks above,
  // everything that can reject the call happens before quota reservation.
  const wantsSelfPortrait = opts.args?.use_self_portrait === true;
  if (wantsSelfPortrait && !ctx.selfPortrait) {
    return {
      ok: false,
      error: 'Error: "use_self_portrait" is not available to you. Retry without it.',
    };
  }
  let selfPortraitPart: any = null;
  if (wantsSelfPortrait) {
    selfPortraitPart = await getSelfPortraitPart();
    if (!selfPortraitPart) {
      return {
        ok: false,
        error: 'Error: your reference portrait is unavailable, so an accurate picture of you cannot be made. '
          + 'Do NOT retry with use_self_portrait — tell the user this is temporarily broken.',
      };
    }
  }

  // Atomically count + insert the quota row (fail closed: DB errors block generation).
  let reservationId: number | null = null;
  try {
    reservationId = await ctx.db.imageGen.reserveGeneration(ctx.userId, prompt, model, IMAGE_GEN_DAILY_LIMIT);
  } catch (err) {
    logError('[imagegen] quota reservation failed:', err);
    return { ok: false, error: 'Error: image generation is temporarily unavailable.' };
  }
  if (reservationId === null) {
    return {
      ok: false,
      error: `Error: this user has reached the image generation limit (${IMAGE_GEN_DAILY_LIMIT} per 24 hours). `
        + 'Tell them to try again later.',
    };
  }

  const reservedId = reservationId;
  const releaseQuota = async () => {
    await ctx.db.imageGen.markFailed(reservedId).catch((err: any) => {
      logError('[imagegen] failed to release quota slot:', err);
    });
  };

  log(`[imagegen] user ${ctx.userId} generating${useAttached ? ` (editing ${imageParts.length} attached image${imageParts.length === 1 ? '' : 's'})` : ''}${selfPortraitPart ? ' (self-portrait reference)' : ''}: ${prompt.slice(0, 120)}`);

  // For edits (and self-portraits) the request carries the source images as
  // multimodal content parts alongside the instruction text (base64 data URLs,
  // never persisted). The portrait leads so it reads as the character reference.
  const sourceParts = [
    ...(selfPortraitPart ? [selfPortraitPart] : []),
    ...(useAttached ? imageParts : []),
  ];
  const instruction = selfPortraitPart ? `${SELF_PORTRAIT_INSTRUCTION}${prompt}` : prompt;
  const userContent = sourceParts.length > 0
    ? [{ type: 'text', text: instruction }, ...sourceParts]
    : instruction;

  let dataUrl = '';
  try {
    const completion: any = await withTimeout(
      openrouter.chat.completions.create({
        model,
        messages: [{ role: 'user', content: userContent }],
        modalities,
      } as any),
      IMAGE_GEN_TIMEOUT_MS,
      '[imagegen] generation',
    );
    dataUrl = completion?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
  } catch (err) {
    logError('[imagegen] generation failed:', err);
    await releaseQuota();
    return { ok: false, error: 'Error: image generation failed. Tell the user to try again later.' };
  }

  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(dataUrl);
  if (!match) {
    logError(`[imagegen] unexpected response format (no base64 data URL); got: ${dataUrl.slice(0, 80)}`);
    await releaseQuota();
    return { ok: false, error: 'Error: the image model returned no image. Tell the user to try again later.' };
  }

  const ext = match[1].split('/')[1].replace('jpeg', 'jpg');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    await releaseQuota();
    return { ok: false, error: 'Error: the generated image could not be attached (empty or too large).' };
  }

  return {
    ok: true,
    attachment: { attachment: buffer, name: `imgen-${Date.now()}.${ext}` },
    // "of you" survives a combined call — a self-portrait built on the user's
    // attached image is still a picture of Marv, and the model shouldn't
    // describe it as a plain edit.
    resultText: `Image ${selfPortraitPart ? 'of you ' : ''}${useAttached ? 'edited' : 'generated'} successfully from prompt "${prompt.slice(0, 200)}". `
      + 'It is attached to your reply automatically — do not write a link, markdown image, or placeholder for it; '
      + 'just describe it briefly.',
  };
}
