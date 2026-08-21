import { initWasm } from '@resvg/resvg-wasm';
import { log } from './log';

/**
 * Single owner of the resvg-wasm module init.
 *
 * `initWasm()` is global to the `@resvg/resvg-wasm` module and throws
 * "Already initialized" on the second call. Both rasterising features —
 * the join welcome card and the AI diagram renderer — import that same
 * module instance, so each keeping its own init guard meant whichever
 * rendered second in a process threw, and kept throwing for the life of
 * the process. Both call this instead, so the init happens exactly once
 * no matter which feature gets there first.
 */

let wasmReady: Promise<void> | null = null;

export function ensureResvgWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
      await initWasm(await Bun.file(wasmPath).arrayBuffer());
      log('[resvg] wasm initialised');
    })().catch((err) => {
      // A failed init isn't necessarily permanent — let the next call retry.
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}
