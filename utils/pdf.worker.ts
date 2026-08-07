// CLI subprocess entrypoint: process.exit is the contract with the parent.
/* eslint-disable no-process-exit */
import { extractText, getDocumentProxy } from 'unpdf';

const MAX_COMBINED_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDFS_PER_MESSAGE = 5;
const MAX_CHARS_PER_PDF = 50_000;
const MIN_USEFUL_TEXT_CHARS = 50;
const PDF_MAGIC = '%PDF-';

const ALLOWED_CDN_HOSTNAMES = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
]);

function isValidDiscordCdnUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_CDN_HOSTNAMES.has(parsed.hostname);
}

interface AttachmentInfo {
  name: string;
  url: string;
  size: number;
}

interface WorkerInput {
  attachments: AttachmentInfo[];
}

interface WorkerOutput {
  blocks: string[];
  notices: string[];
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

async function extractOne(att: AttachmentInfo): Promise<{ block?: string; notice?: string }> {
  const { name } = att;

  if (!isValidDiscordCdnUrl(att.url)) {
    return { notice: `Couldn't download **${name}** — skipping it. (untrusted source)` };
  }

  let pdfBytes: Uint8Array | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(att.url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pdfBytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { notice: `Couldn't download **${name}** — skipping it. (${(err as Error).message})` };
  } finally {
    clearTimeout(timer);
  }

  if (!hasPdfMagic(pdfBytes)) {
    pdfBytes = null;
    return { notice: `**${name}** is not a valid PDF — skipping it.` };
  }

  let rawText = '';
  let originalLength = 0;
  let doc: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    doc = await getDocumentProxy(pdfBytes);
    const result = await extractText(doc, { mergePages: true });
    originalLength = result.text.length;
    rawText = originalLength > MAX_CHARS_PER_PDF
      ? result.text.slice(0, MAX_CHARS_PER_PDF)
      : result.text;
  } catch {
    return { notice: `Couldn't read **${name}** (encrypted or corrupt) — skipping it.` };
  } finally {
    if (doc) {
      try { await doc.destroy(); } catch { /* best-effort */ }
    }
    doc = null;
    pdfBytes = null;
  }

  const cleaned = rawText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  rawText = '';

  if (cleaned.length < MIN_USEFUL_TEXT_CHARS) {
    return { notice: `**${name}** had no extractable text (likely scanned images) — skipping it.` };
  }

  const body = originalLength > MAX_CHARS_PER_PDF
    ? `${cleaned}\n\n[...truncated, original was ${originalLength} chars]`
    : cleaned;

  const safeName = name
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, ' ');
  return { block: `<<PDF_ATTACHMENT name="${safeName}">>\n${body}\n<</PDF_ATTACHMENT>>` };
}

async function handle(input: WorkerInput): Promise<WorkerOutput> {
  const notices: string[] = [];
  let candidates = input.attachments;

  if (candidates.length > MAX_PDFS_PER_MESSAGE) {
    notices.push(`You attached ${candidates.length} PDFs — only processing the first ${MAX_PDFS_PER_MESSAGE}.`);
    candidates = candidates.slice(0, MAX_PDFS_PER_MESSAGE);
  }

  const accepted: AttachmentInfo[] = [];
  let cumulative = 0;
  for (const att of candidates) {
    if (cumulative + att.size > MAX_COMBINED_PDF_BYTES) {
      notices.push(`Skipped **${att.name}** — combined PDF size would exceed 10 MB.`);
      // eslint-disable-next-line no-continue
      continue;
    }
    accepted.push(att);
    cumulative += att.size;
  }

  const blocks: string[] = [];
  for (const att of accepted) {
    // eslint-disable-next-line no-await-in-loop
    const r = await extractOne(att);
    if (r.block) blocks.push(r.block);
    if (r.notice) notices.push(r.notice);
  }

  return { blocks, notices };
}

// Subprocess entrypoint: read JSON payload from stdin, write JSON result to
// stdout, exit. Run as `bun utils/pdf.worker.ts` from the parent process. The
// process exit is what reclaims memory back to the OS — that's the whole point.
async function main(): Promise<void> {
  const inputJson = await Bun.stdin.text();
  let input: WorkerInput;
  try {
    input = JSON.parse(inputJson);
  } catch {
    process.stdout.write(JSON.stringify({ error: 'invalid input json' }));
    process.exit(1);
  }
  try {
    const out = await handle(input);
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: (err as Error).message || 'unknown error' }));
    process.exit(1);
  }
}

main();
