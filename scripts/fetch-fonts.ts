/**
 * Downloads the DejaVu fonts used by the diagram renderer (utils/diagramGen.ts)
 * into data/fonts/. Pinned to a matplotlib commit (which vendors the built TTFs)
 * and verified by SHA-256 so rendered output is reproducible.
 *
 * DejaVu is used rather than a prettier UI font because it actually has the
 * glyphs diagrams need — arrows (→ ← ↑ ↓), maths operators (Σ ∇ ∈ ≈ ≤ ∂), Greek
 * and box-drawing. Noto Sans silently drops every one of those.
 *
 * Usage: bun scripts/fetch-fonts.ts
 * (Run once for local dev; the Dockerfile runs it at build time.)
 */

const COMMIT = 'ba0ff3afcb1d9df725624256562e5c6a888ca46a';
const BASE = `https://raw.githubusercontent.com/matplotlib/matplotlib/${COMMIT}/lib/matplotlib/mpl-data/fonts/ttf`;
const DEST_DIR = `${import.meta.dir}/../data/fonts`;

const FONTS: { file: string; sha256: string }[] = [
  { file: 'DejaVuSans.ttf', sha256: '3fdf69cabf06049ea70a00b5919340e2ce1e6d02b0cc3c4b44fb6801bd1e0d22' },
  { file: 'DejaVuSans-Bold.ttf', sha256: 'b184b89e3c1075f22f6b71575b6fc20d4972b3cfd3b23322ca6fd596dcaef167' },
  { file: 'DejaVuSansMono.ttf', sha256: '602ec86b8948cfcd956482fe64f94c36c867770149ef2f791d4613f443bcecb3' },
];

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Docker builds run this on every cold cache — don't let one transient
 * network blip fail the whole image build. */
async function downloadWithRetry(url: string, attempts: number): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delayMs = attempt * 2000;
        console.log(`Attempt ${attempt} failed (${err instanceof Error ? err.message : err}) — retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => { setTimeout(resolve, delayMs); });
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchOne(font: { file: string; sha256: string }): Promise<void> {
  const dest = `${DEST_DIR}/${font.file}`;
  const existing = Bun.file(dest);
  if (await existing.exists()) {
    const hash = await sha256Hex(await existing.arrayBuffer());
    if (hash === font.sha256) {
      console.log(`Already present and verified: ${font.file}`);
      return;
    }
    console.log(`Existing ${font.file} failed checksum — re-downloading.`);
  }

  const url = `${BASE}/${font.file}`;
  console.log(`Downloading ${font.file} from ${url} ...`);
  const data = await downloadWithRetry(url, 3);
  const hash = await sha256Hex(data);
  if (hash !== font.sha256) {
    throw new Error(`Checksum mismatch for ${font.file}!\n  expected ${font.sha256}\n  got      ${hash}`);
  }
  await Bun.write(dest, data);
  console.log(`Saved ${(data.byteLength / 1024).toFixed(0)} KB to ${dest} (checksum OK)`);
}

async function main(): Promise<void> {
  for (const font of FONTS) {
    // Sequential on purpose: three small files, and a clear log order beats
    // shaving a second off a build step that only runs on a cold cache.
    // eslint-disable-next-line no-await-in-loop
    await fetchOne(font);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
