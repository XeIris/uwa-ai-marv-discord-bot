import type { Message, Attachment } from 'discord.js';
import { fileURLToPath } from 'url';
import { logError } from './log';

const SUBPROCESS_TIMEOUT_MS = 60_000;
const WORKER_PATH = fileURLToPath(new URL('./pdf.worker.ts', import.meta.url));

export interface PdfExtractionResult {
  blocks: string[];
  notices: string[];
}

interface WorkerSuccess {
  blocks: string[];
  notices: string[];
}
interface WorkerFailure {
  error: string;
}
type WorkerResponse = WorkerSuccess | WorkerFailure;

function isPdfAttachment(att: Attachment): boolean {
  if (att.contentType === 'application/pdf') return true;
  return typeof att.name === 'string' && att.name.toLowerCase().endsWith('.pdf');
}

/**
 * Extract text from PDF attachments on a Discord message.
 *
 * Spawns a Bun child *process* per batch, pipes JSON in, reads JSON out, then
 * lets the process exit. Process exit is the only reliable way to return
 * unpdf/pdfjs's parsed-document memory back to the OS — Worker isolates free
 * the V8 heap but Bun's process-level allocator often retains the pages.
 *
 * Skipped (no spawn) when the message has no PDF attachments — zero overhead.
 */
export async function extractPdfsFromMessage(message: Message): Promise<PdfExtractionResult> {
  const allPdfs = message.attachments.filter(isPdfAttachment);
  if (allPdfs.size === 0) return { blocks: [], notices: [] };

  const payload = JSON.stringify({
    attachments: [...allPdfs.values()].map((a) => ({
      name: a.name || 'attachment.pdf',
      url: a.url,
      size: a.size,
    })),
  });

  let proc;
  try {
    proc = Bun.spawn({
      cmd: [process.execPath, WORKER_PATH],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
    });
  } catch (err) {
    logError('[pdf] failed to spawn subprocess:', err);
    return { blocks: [], notices: ['Could not start PDF processor — proceeding without attachments.'] };
  }

  const killTimer = setTimeout(() => {
    try { proc.kill(); } catch { /* already gone */ }
  }, SUBPROCESS_TIMEOUT_MS);

  let stdoutText = '';
  let exitCode: number | null = null;
  try {
    proc.stdin.write(payload);
    await proc.stdin.end();
    stdoutText = await new Response(proc.stdout).text();
    exitCode = await proc.exited;
  } catch (err) {
    logError('[pdf] subprocess i/o failed:', err);
    return { blocks: [], notices: ['PDF processing failed — proceeding without attachments.'] };
  } finally {
    clearTimeout(killTimer);
  }

  if (exitCode !== 0 && !stdoutText) {
    logError(`[pdf] subprocess exited with code ${exitCode} and no output`);
    return { blocks: [], notices: ['PDF processing failed — proceeding without attachments.'] };
  }

  let result: WorkerResponse;
  try {
    result = JSON.parse(stdoutText);
  } catch (err) {
    logError('[pdf] subprocess returned invalid JSON:', err);
    return { blocks: [], notices: ['PDF processing failed — proceeding without attachments.'] };
  }

  if ('error' in result) {
    logError('[pdf] subprocess error:', result.error);
    return { blocks: [], notices: ['PDF processing failed — proceeding without attachments.'] };
  }

  return { blocks: result.blocks, notices: result.notices };
}
