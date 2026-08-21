/**
 * Event images, stored as a Discord message reference rather than a URL.
 *
 * Discord attachment URLs are signed and expire (the same reason
 * keywordsBehaviorHandler notes generated-image links last ~24h), so persisting
 * `attachment.url` gives you a link that works today and 404s tomorrow. Instead
 * we store `channelId` + `messageId` + `attachmentId` of the bot's own
 * confirmation message and re-fetch it whenever the image is needed: the API
 * hands back a freshly signed URL every time.
 *
 * The one thing this depends on is the confirmation message continuing to exist
 * — which is exactly what organisers are told when they add the image. If it's
 * deleted, resolution fails cleanly and the stored reference is dropped so we
 * stop retrying a dead lookup on every reminder.
 */

import { logError, log } from './log';
import type { EventEntry } from '../database/models/EventModel';

export interface EventImageRef {
  channelId: string;
  messageId: string;
  attachmentId: string;
}

/** The stored reference, or null when the event has no image. */
export function imageRefFor(event: EventEntry): EventImageRef | null {
  if (!event.imageChannelId || !event.imageMessageId || !event.imageAttachmentId) return null;
  return {
    channelId: event.imageChannelId,
    messageId: event.imageMessageId,
    attachmentId: event.imageAttachmentId,
  };
}

/**
 * Re-resolves a fresh, signed CDN URL for an event's image.
 *
 * Returns null when the event has no image or the source message is gone. In the
 * gone case the caller is told via `missing: true` so it can clear the stored
 * reference — a deleted confirmation message is permanent, and retrying it on
 * every reminder tick is pure noise.
 */
export async function resolveEventImageUrl(
  client: any,
  event: EventEntry,
): Promise<{ url: string | null; missing: boolean }> {
  const ref = imageRefFor(event);
  if (!ref) return { url: null, missing: false };

  try {
    const channel = await client.channels.fetch(ref.channelId);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      log(`[eventimage] channel ${ref.channelId} for event ${event.id} is gone or not a text channel`);
      return { url: null, missing: true };
    }

    const message = await channel.messages.fetch(ref.messageId);
    const attachment = message?.attachments?.get(ref.attachmentId);
    if (!attachment?.url) {
      log(`[eventimage] attachment ${ref.attachmentId} no longer on message ${ref.messageId} (event ${event.id})`);
      return { url: null, missing: true };
    }
    return { url: attachment.url, missing: false };
  } catch (err: any) {
    // 10003 Unknown Channel / 10008 Unknown Message — the message was deleted.
    const code = err?.code ?? err?.rawError?.code;
    if (code === 10003 || code === 10008) {
      log(`[eventimage] source message for event ${event.id} was deleted (code ${code})`);
      return { url: null, missing: true };
    }
    // Anything else (rate limit, network, permissions) may be transient — keep
    // the reference and try again next time.
    logError(`[eventimage] failed to resolve image for event ${event.id}:`, err);
    return { url: null, missing: false };
  }
}

/**
 * Resolves an image URL and drops the stored reference if the source is gone.
 *
 * The prune is conditional on the reference still being the one that failed —
 * an organiser can run `/event setimage` between the resolve and the prune, and
 * an unconditional clear would delete that brand-new reference.
 */
export async function resolveAndPrune(client: any, db: any, event: EventEntry): Promise<string | null> {
  const ref = imageRefFor(event);
  const { url, missing } = await resolveEventImageUrl(client, event);
  if (missing && ref) {
    await db.event.clearImageIfMatches(event.serverId, event.id, ref).catch((err: any) => {
      logError(`[eventimage] failed to clear dead image ref for event ${event.id}:`, err);
    });
  }
  return url;
}

/** Discord's own attachment content types we accept as an event image. */
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Filename extension per accepted type — Discord renders by extension, not header. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Downloads an event's image as raw bytes, ready to attach to a new message.
 *
 * `resolveAndPrune` hands back a *signed* CDN URL that expires in about a day —
 * fine for a reminder that is read within the hour, wrong for an announcement
 * that stays in the channel as the event's permanent notice. Re-uploading the
 * bytes onto the announcement itself gives it an attachment of its own, which
 * never goes stale and survives the original confirmation message being deleted.
 *
 * Returns null when the event has no image or it couldn't be fetched; callers
 * post without it rather than failing.
 */
export async function fetchEventImageFile(
  client: any,
  db: any,
  event: EventEntry,
): Promise<{ attachment: Buffer; name: string } | null> {
  const url = await resolveAndPrune(client, db, event).catch(() => null);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logError(`[eventimage] image download for event ${event.id} returned HTTP ${response.status}`);
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      // Can't happen through our own upload path (validateImageAttachment caps
      // it), but this is a network read — don't trust the far end's size.
      logError(`[eventimage] image for event ${event.id} is ${bytes.byteLength} bytes — over the limit, skipping`);
      return null;
    }
    const contentType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const extension = EXTENSION_BY_TYPE[contentType] ?? 'png';
    return { attachment: bytes, name: `event-${event.id}.${extension}` };
  } catch (err) {
    logError(`[eventimage] failed to download image for event ${event.id}:`, err);
    return null;
  }
}

export const IMAGE_KEEP_WARNING = '⚠ **Don\'t delete this message** — the event\'s image is stored by pointing at it. '
  + 'If this message goes, the image goes with it (the event itself stays).';

/** Validates an uploaded attachment before we re-post it. Returns an error string, or null. */
export function validateImageAttachment(attachment: any): string | null {
  if (!attachment) return null;
  const contentType = String(attachment.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    return `That attachment is \`${contentType || 'unknown'}\`. Event images must be one of: ${ALLOWED_IMAGE_TYPES.join(', ')}.`;
  }
  if (typeof attachment.size === 'number' && attachment.size > MAX_IMAGE_BYTES) {
    return `That image is ${(attachment.size / 1e6).toFixed(1)} MB — the limit is 8 MB.`;
  }
  return null;
}
