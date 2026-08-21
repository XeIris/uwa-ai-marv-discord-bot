import {
  describe, test, expect, mock, afterAll,
} from 'bun:test';

/**
 * The retry path in `ensureResvgWasm` — a failed init clears the memo so the next
 * caller can try again — can't be exercised against the real module, because the
 * real `initWasm()` succeeds and then permanently refuses a second call.
 *
 * So this stands in a fake `@resvg/resvg-wasm` whose first init rejects, and pulls
 * in a *fresh* copy of `utils/resvgWasm` through a query-suffixed specifier. The
 * suffix is load-bearing: without it this shares the module instance (and therefore
 * the already-resolved memo) with `resvgWasm.test.ts`, which inits the wasm for
 * real. Relying on per-file isolation instead would work under `bun test --parallel`
 * and quietly fail under a shared-process runner.
 */
let initCalls = 0;

mock.module('@resvg/resvg-wasm', () => ({
  initWasm: async () => {
    initCalls += 1;
    if (initCalls === 1) throw new Error('wasm compile failed');
  },
}));

afterAll(() => { mock.restore(); });

describe('resvg wasm init retry', () => {
  test('a failed init is not memoised; the next call retries and then sticks', async () => {
    const fresh = `${import.meta.dir}/../../utils/resvgWasm.ts?retry-test`;
    const { ensureResvgWasm } = await import(fresh) as typeof import('../../utils/resvgWasm');

    // First attempt fails and must propagate rather than being swallowed.
    await expect(ensureResvgWasm()).rejects.toThrow('wasm compile failed');
    expect(initCalls).toBe(1);

    // The memo was cleared, so this retries for real instead of replaying the
    // rejection for the life of the process.
    await expect(ensureResvgWasm()).resolves.toBeUndefined();
    expect(initCalls).toBe(2);

    // Once it succeeds it is memoised again — a third caller must not reach
    // initWasm, since a second real call is what raises "Already initialized".
    await expect(ensureResvgWasm()).resolves.toBeUndefined();
    expect(initCalls).toBe(2);
  });
});
