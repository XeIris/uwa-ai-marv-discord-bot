/**
 * Downloads the GeneralUser GS General MIDI soundfont used by the JAYDON
 * music generator (utils/musicGen.ts) into data/soundfonts/. Pinned to a
 * commit and verified by SHA-256 so the audio output is reproducible.
 *
 * Usage: bun scripts/fetch-soundfont.ts
 * (Run once for local dev; the Dockerfile runs it at build time.)
 */

const COMMIT = '97049183643d5fc5a9322a69c5b09efb667c6c3a';
const URL = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${COMMIT}/GeneralUser-GS.sf2`;
const SHA256 = '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe';
const DEST = `${import.meta.dir}/../data/soundfonts/GeneralUser-GS.sf2`;

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

async function main(): Promise<void> {
  const existing = Bun.file(DEST);
  if (await existing.exists()) {
    const hash = await sha256Hex(await existing.arrayBuffer());
    if (hash === SHA256) {
      console.log(`Soundfont already present and verified: ${DEST}`);
      return;
    }
    console.log('Existing soundfont failed checksum — re-downloading.');
  }

  console.log(`Downloading GeneralUser GS (~31 MB) from ${URL} ...`);
  const data = await downloadWithRetry(URL, 3);
  const hash = await sha256Hex(data);
  if (hash !== SHA256) {
    throw new Error(`Checksum mismatch!\n  expected ${SHA256}\n  got      ${hash}`);
  }
  await Bun.write(DEST, data);
  console.log(`Saved ${(data.byteLength / 1e6).toFixed(1)} MB to ${DEST} (checksum OK)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
