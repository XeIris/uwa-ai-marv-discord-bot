import { describe, test, expect } from 'bun:test';
import { Collection } from 'discord.js';
import { extractPdfsFromMessage } from '../../utils/pdf';

const WORKER = `${import.meta.dir}/../../utils/pdf.worker.ts`;

/** Runs the worker exactly the way utils/pdf.ts does: JSON on stdin, JSON on stdout. */
async function runWorker(payload: string): Promise<{ out: any; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, WORKER],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(payload);
  await proc.stdin.end();
  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { out: JSON.parse(text), exitCode };
}

/**
 * utils/pdf.ts spawns utils/pdf.worker.ts as a subprocess. The worker was lost
 * in this fork's squashed import, so every PDF attachment failed to the generic
 * "PDF processing failed" notice and nobody noticed — a missing file is invisible
 * to typecheck and lint alike. These tests exist so it can't vanish again.
 */
describe('pdf worker', () => {
  test('the worker file utils/pdf.ts spawns actually exists', async () => {
    expect(await Bun.file(WORKER).exists()).toBe(true);
  });

  test('returns an empty result for an empty batch', async () => {
    const { out, exitCode } = await runWorker('{"attachments":[]}');
    expect(exitCode).toBe(0);
    expect(out).toEqual({ blocks: [], notices: [] });
  });

  test('reports invalid input as an error rather than crashing', async () => {
    const { out, exitCode } = await runWorker('not json');
    expect(exitCode).toBe(1);
    expect(out.error).toBe('invalid input json');
  });

  test.each([
    ['https://example.com/x.pdf', 'arbitrary host'],
    ['http://cdn.discordapp.com/x.pdf', 'plain http'],
    ['https://cdn.discordapp.com.evil.test/x.pdf', 'lookalike hostname'],
    ['file:///etc/passwd', 'local file scheme'],
  ])('refuses to fetch %p (%s)', async (url) => {
    const { out } = await runWorker(JSON.stringify({
      attachments: [{ name: 'x.pdf', url, size: 100 }],
    }));
    expect(out.blocks).toEqual([]);
    expect(out.notices[0]).toContain('untrusted source');
  });

  test('caps the batch at 5 PDFs and says so', async () => {
    const attachments = Array.from({ length: 7 }, (_, i) => ({
      name: `f${i}.pdf`,
      url: 'https://example.com/x.pdf',
      size: 10,
    }));
    const { out } = await runWorker(JSON.stringify({ attachments }));
    expect(out.notices[0]).toContain('only processing the first 5');
  });

  test('skips attachments once the combined size would exceed 10 MB', async () => {
    const attachments = [
      { name: 'big.pdf', url: 'https://example.com/x.pdf', size: 9 * 1024 * 1024 },
      { name: 'toobig.pdf', url: 'https://example.com/x.pdf', size: 9 * 1024 * 1024 },
    ];
    const { out } = await runWorker(JSON.stringify({ attachments }));
    expect(out.notices.some((n: string) => n.includes('toobig.pdf') && n.includes('10 MB'))).toBe(true);
  });
});

describe('extractPdfsFromMessage', () => {
  test('short-circuits with no spawn when the message has no PDFs', async () => {
    const message = { attachments: new Collection() } as any;
    expect(await extractPdfsFromMessage(message)).toEqual({ blocks: [], notices: [] });
  });

  test('ignores non-PDF attachments', async () => {
    const message = {
      attachments: new Collection([
        ['1', {
          contentType: 'image/png', name: 'cat.png', url: 'https://cdn.discordapp.com/cat.png', size: 10,
        }],
      ]),
    } as any;
    expect(await extractPdfsFromMessage(message)).toEqual({ blocks: [], notices: [] });
  });

  test('detects a PDF by .pdf suffix even when contentType is missing', async () => {
    // Reaches the spawn path, so this also proves parent → worker IPC works.
    const message = {
      attachments: new Collection([
        ['1', {
          contentType: null, name: 'notes.pdf', url: 'https://example.com/notes.pdf', size: 100,
        }],
      ]),
    } as any;
    const result = await extractPdfsFromMessage(message);
    expect(result.blocks).toEqual([]);
    expect(result.notices[0]).toContain('untrusted source');
  });
});
