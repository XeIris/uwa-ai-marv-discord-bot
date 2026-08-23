import type Database from '../database/Database';
import { getOpenRouterClient, getPersonaByName } from './ai';
import { createChatCompletionWithRetry } from './llmRetry';
import { GLOBAL_CONFIG_KEYS } from './globalConfig';
import { MAX_IMAGES as MAX_MEDIA_IMAGES } from './aiMedia';
import { log, logError, logWarning } from './log';

/**
 * Content-safety screening for AI chats (`ai_moderation` in GlobalConfig).
 *
 * When enabled, every AI turn on a session-backed surface is screened by the
 * "Moderation" persona — an NVIDIA Nemotron content-safety classifier, which
 * takes no system prompt: you hand it the raw exchange and it emits plain-text
 * labels, e.g.
 *
 *   User Safety: unsafe
 *   Response Safety: safe
 *   Safety Categories: Violence, Threat
 *
 * `Response Safety` is only emitted when an assistant turn was supplied, and a
 * reasoning-mode model may wrap a `<think>` block around it all, so both are
 * treated as optional.
 *
 * Screening runs twice per turn: on the user message alone before generating
 * (so an unsafe prompt never reaches — or bills — the chat model), then on the
 * user+assistant pair before the reply is delivered.
 *
 * The classifier takes `text+image` input, so the pre-screen also carries the
 * images the user attached: the caption and the picture are judged together,
 * which is the only way an image with an innocuous caption gets caught. User
 * images ride the pre-screen only — see `moderateExchange`. Images the bot
 * *generated* are screened separately by `moderateGeneratedImages`.
 */

/**
 * Shown on session-backed surfaces, in the voice of the persona they were
 * talking to. The session is paused for good — hence "start a new chat".
 */
export const MODERATION_PAUSED_MESSAGE = 'safety filters have paused this chat, please start a new chat';

/**
 * Shown on one-shot surfaces (`/summary`) that have no session to pause: the
 * output is dropped and the next invocation starts clean, so telling the user
 * to "start a new chat" would be nonsense.
 */
export const MODERATION_BLOCKED_MESSAGE = 'safety filters blocked this response.';

/** Persona in data/aiPersonas.json holding the classifier's provider + model. */
const MODERATION_PERSONA = 'Moderation';

/** The classifier only needs enough text to judge; long PDFs/transcripts are cut. */
const MAX_SCREENED_CHARS = 8000;

/**
 * How many attached images go to the classifier. Deliberately equal to
 * `aiMedia`'s own per-request image cap: anything the chat model can be shown
 * must be screenable, so **never set this lower** — a smaller number here is an
 * unscreened gap an attacker can walk through by attaching one extra image.
 */
const MAX_MODERATION_IMAGES = MAX_MEDIA_IMAGES;

/** Labels are a handful of lines — plus an optional reasoning trace. */
const MODERATION_MAX_TOKENS = 512;

/** Classification is on the critical path of every message; don't wait long. */
const MODERATION_TIMEOUT_MS = 15_000;

/**
 * Total budget across retries, deliberately close to the per-attempt timeout.
 * `createChatCompletionWithRetry` retries on 429/5xx/network, and the screen runs
 * twice per turn — a generous overall budget would let a degraded free classifier
 * add minutes of latency before the turn fails open. This leaves room for one
 * fast retry on a transient blip and no more.
 */
const MODERATION_OVERALL_TIMEOUT_MS = 20_000;

export interface ModerationVerdict {
  /** False when the exchange must not continue — the only field callers must act on. */
  safe: boolean;
  /** Which side tripped the filter (undefined when `safe`). */
  flaggedSide?: 'user' | 'response';
  /** Comma-separated categories the classifier reported, when it reported any. */
  categories?: string;
}

const SAFE_VERDICT: ModerationVerdict = { safe: true };

/** True when the `ai_moderation` global switch is on. Defaults to off. */
export async function isModerationEnabled(db: Database | undefined | null): Promise<boolean> {
  if (!db) return false;
  try {
    const value = await db.globalConfig.getGlobalConfig(GLOBAL_CONFIG_KEYS.AI_MODERATION);
    return value === '1';
  } catch (err) {
    logError('[moderation] failed to read ai_moderation config; treating as off:', err);
    return false;
  }
}

function truncate(text: string): string {
  const trimmed = (text ?? '').toString().trim();
  return trimmed.length > MAX_SCREENED_CHARS ? trimmed.slice(0, MAX_SCREENED_CHARS) : trimmed;
}

/**
 * Strips a reasoning-mode `<think>…</think>` preamble from the classifier output.
 *
 * Handles the dangling-closer case too: some models emit only `</think>` because
 * the opening tag lives in the chat template. Everything before that closer is
 * reasoning — and a trace routinely *quotes* a label ("...so User Safety: unsafe
 * would be wrong here"), so failing to cut it lets `readLabel` pick a sentence
 * out of the model's deliberation instead of its verdict.
 */
function stripThinking(raw: string): string {
  const stripped = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
  const closeIdx = stripped.toLowerCase().lastIndexOf('</think>');
  return closeIdx === -1 ? stripped : stripped.slice(closeIdx + '</think>'.length).trim();
}

/**
 * Reads a label line. Takes the **last** match: the verdict is emitted at the
 * end, so if any reasoning survived stripping, the final occurrence is the one
 * that counts.
 */
function readLabel(raw: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...raw.matchAll(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'img'))];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

/**
 * Parses the classifier's plain-text labels. Anything that isn't a recognisable
 * "unsafe" is treated as safe — an unparseable response is a broken classifier,
 * not a verdict, and must not silently pause every chat on the bot.
 */
export function parseModerationOutput(rawOutput: string): ModerationVerdict {
  const raw = stripThinking(rawOutput || '');
  if (!raw) return SAFE_VERDICT;

  const userSafety = readLabel(raw, 'User Safety')?.toLowerCase();
  const responseSafety = readLabel(raw, 'Response Safety')?.toLowerCase();
  const categories = readLabel(raw, 'Safety Categories') ?? undefined;

  if (userSafety?.startsWith('unsafe')) {
    return { safe: false, flaggedSide: 'user', categories };
  }
  if (responseSafety?.startsWith('unsafe')) {
    return { safe: false, flaggedSide: 'response', categories };
  }
  return SAFE_VERDICT;
}

/**
 * Keeps the `image_url` parts the classifier can read, capped. Callers hand it
 * whatever `aiMedia` collected, so video/audio parts (which this model does not
 * accept, and which would fail the whole screen) are dropped here rather than
 * at each call site.
 */
export function selectModerationImages(imageParts: any[] = []): any[] {
  return imageParts
    .filter((p) => p?.type === 'image_url' && typeof p?.image_url?.url === 'string')
    .slice(0, MAX_MODERATION_IMAGES);
}

/**
 * Builds the classifier's user turn. Plain string when there are no images —
 * the classifier's chat template is happiest with the shape it was trained on
 * — and a text+image part array otherwise. An empty caption contributes no text
 * part: some providers reject `{ type: 'text', text: '' }`.
 */
export function buildModerationUserContent(text: string, images: any[] = []): any {
  if (images.length === 0) return text;
  return text ? [{ type: 'text', text }, ...images] : [...images];
}

/**
 * True for the errors that mean "this model/provider won't take the images",
 * as opposed to a transient failure. `createChatCompletionWithRetry` has
 * already exhausted its own retries by the time we see either.
 */
function isImageRejection(err: any): boolean {
  const status = err?.status;
  if (status === 400 || status === 404 || status === 413 || status === 415 || status === 422) return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('image') || msg.includes('modal') || msg.includes('vision');
}

/**
 * Screens one exchange. `assistantText` is omitted for the pre-generation pass;
 * `imageParts` carries the images attached to the user's turn (OpenRouter
 * `image_url` parts, already downloaded by `aiMedia` — screening reuses those
 * buffers and never re-fetches from Discord).
 *
 * Images are for the pre-screen: they cost a base64 upload of up to the media
 * budget, and the screen sits on the critical path of the reply with a tight
 * timeout. Sending them again on the output pass would double that latency to
 * re-judge a picture the inbound pass already ruled on — `Response Safety`
 * turns on the assistant's text.
 *
 * Fails open: a classifier outage, timeout, or garbled reply logs a warning and
 * returns safe. Blocking every AI conversation on the availability of a free
 * model would be a far worse failure than missing a screen. A model that
 * refuses the images specifically is retried once text-only, so a vision
 * regression degrades to the old caption-only screen instead of no screen.
 */
export async function moderateExchange(
  userText: string,
  assistantText?: string,
  imageParts: any[] = [],
): Promise<ModerationVerdict> {
  const userContent = truncate(userText);
  const assistantContent = truncate(assistantText ?? '');
  const images = selectModerationImages(imageParts);
  if (!userContent && !assistantContent && images.length === 0) return SAFE_VERDICT;

  const persona = await getPersonaByName(MODERATION_PERSONA);
  if (!persona) {
    logWarning(`[moderation] no "${MODERATION_PERSONA}" persona configured; skipping screen`);
    return SAFE_VERDICT;
  }
  if (persona.provider !== 'openrouter') {
    logWarning(`[moderation] persona provider "${persona.provider}" unsupported; skipping screen`);
    return SAFE_VERDICT;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    logWarning('[moderation] OPENROUTER_API_KEY not set; skipping screen');
    return SAFE_VERDICT;
  }

  // No system prompt — the classifier's chat template supplies its own.
  const runScreen = async (withImages: any[]): Promise<string> => {
    const messages: { role: 'user' | 'assistant'; content: any }[] = [
      { role: 'user', content: buildModerationUserContent(userContent, withImages) },
    ];
    if (assistantContent) {
      messages.push({ role: 'assistant', content: assistantContent });
    }
    const completion = await createChatCompletionWithRetry(getOpenRouterClient(), {
      model: persona.model,
      messages,
      max_tokens: MODERATION_MAX_TOKENS,
    }, {
      timeoutMs: MODERATION_TIMEOUT_MS,
      overallTimeoutMs: MODERATION_OVERALL_TIMEOUT_MS,
    });
    return completion.choices?.[0]?.message?.content ?? '';
  };

  try {
    let rawOutput: string;
    try {
      rawOutput = await runScreen(images);
    } catch (err: any) {
      // Text-only fallback only helps if there is text to judge; with none, the
      // outer catch fails the screen open as usual.
      if (images.length === 0 || !(userContent || assistantContent) || !isImageRejection(err)) throw err;
      logWarning(`[moderation] classifier rejected ${images.length} attached image(s); re-screening text only: ${err?.message ?? err}`);
      rawOutput = await runScreen([]);
    }
    const verdict = parseModerationOutput(rawOutput);
    // A non-empty reply with no label means a truncated or malformed
    // classification (e.g. a reasoning trace that ate the whole token budget).
    // That fails open by design — but silently, so say so. Test the *cleaned*
    // output: a label quoted inside a `<think>` preamble is not a verdict, and
    // testing the raw text would let it suppress this warning.
    if (rawOutput.trim() && !/User Safety\s*:/i.test(stripThinking(rawOutput))) {
      logWarning('[moderation] classifier returned no recognisable label; failing open');
    }
    if (!verdict.safe) {
      log(`[moderation] flagged ${verdict.flaggedSide} turn${verdict.categories ? ` (${verdict.categories})` : ''}`);
    }
    return verdict;
  } catch (err) {
    logError('[moderation] screen failed; allowing the turn through:', err);
    return SAFE_VERDICT;
  }
}

/**
 * Extensions the classifier accepts, mirroring `aiMedia`'s image whitelist.
 * Anything else — notably the WAV `generate_music` returns on the same
 * attachment list — is not an image and must not be handed to the classifier.
 */
const GENERATED_IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/**
 * Turns a generated attachment into an `image_url` part, or null when it isn't
 * an image. `runImageGeneration` names its output from the data URL's own MIME
 * type (`imgen-<ts>.png`), so the extension is the provider's answer, not a guess.
 */
export function generatedImagePart(file: { attachment: Buffer; name: string }): any | null {
  const ext = (file?.name || '').split('.').pop()?.toLowerCase() ?? '';
  const mime = GENERATED_IMAGE_MIMES[ext];
  if (!mime || !file?.attachment?.length) return null;
  return {
    type: 'image_url',
    image_url: { url: `data:${mime};base64,${file.attachment.toString('base64')}` },
  };
}

/**
 * Screens the images the bot itself produced (`generate_image`), which the
 * text output screen cannot see — a benign prompt over an attached source can
 * still return something unsafe, and a tool-driven turn may carry no text at all.
 *
 * The bytes go in as the **user** turn, not the assistant turn: that is the only
 * position the classifier is documented to accept images in, and providers
 * routinely reject `image_url` parts inside an assistant message. The verdict is
 * therefore reported back as `User Safety`, so it is re-attributed to
 * `flaggedSide: 'response'` — these are our output, whatever the label says.
 *
 * `promptText` is the prompt the model asked the tool for: it is the image's
 * true caption and gives the classifier context. It is already screened by the
 * text pass, so a duplicate flag here changes no outcome.
 *
 * Runs only on turns that actually generated an image (capped at
 * IMAGE_GEN_DAILY_LIMIT per user per day), so the extra call and the base64
 * upload stay off the critical path of ordinary chat.
 */
export async function moderateGeneratedImages(
  promptText: string,
  files: { attachment: Buffer; name: string }[] = [],
): Promise<ModerationVerdict> {
  const parts = files.map(generatedImagePart).filter(Boolean);
  if (parts.length === 0) return SAFE_VERDICT;

  const verdict = await moderateExchange(promptText, undefined, parts);
  if (verdict.safe) return verdict;
  return { ...verdict, flaggedSide: 'response' };
}
