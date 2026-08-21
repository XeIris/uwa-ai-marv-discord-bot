import { describe, test, expect } from 'bun:test';

/**
 * resvg-wasm's `initWasm()` is global to the module and throws
 * "Already initialized" if called twice. The welcome card and the diagram
 * renderer both rasterise through that one module instance, and both used to
 * carry their own init guard — so whichever rendered second in a process threw,
 * and went on throwing for the life of the process. In practice that meant one
 * join welcome permanently broke diagrams for that container, or vice versa.
 *
 * These assert the two properties that keep that from coming back: the init is
 * owned in one place, and neither renderer calls initWasm itself.
 */
describe('resvg wasm init', () => {
  test('both renderers share one init and it runs only once', async () => {
    const { ensureResvgWasm } = await import('../../utils/resvgWasm');

    // Deliberately no reset seam: the memo must never be cleared, because
    // clearing it would let a second real initWasm() through — which is the
    // bug itself. Repeat and concurrent callers all share the one init.
    const first = ensureResvgWasm();
    const second = ensureResvgWasm();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await expect(ensureResvgWasm()).resolves.toBeUndefined();
  });

  test('neither renderer initialises the wasm itself', async () => {
    const sources = await Promise.all([
      Bun.file(`${import.meta.dir}/../../utils/welcomeCard.ts`).text(),
      Bun.file(`${import.meta.dir}/../../utils/diagramGen.ts`).text(),
    ]);
    sources.forEach((src) => {
      expect(src).not.toContain('initWasm');
      expect(src).toContain('ensureResvgWasm');
    });
  });
});
