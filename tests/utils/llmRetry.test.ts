import {
  describe, test, expect,
} from 'bun:test';
import {
  createChatCompletionWithRetry,
  isRetryableCompletionError,
  RETRY_DELAYS_MS,
} from '../../utils/llmRetry';

function fakeClient(behavior: ((call: number) => any)[]): { client: any; calls: () => number } {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async (_body: any, _options?: any) => {
          calls += 1;
          const step = behavior[Math.min(calls - 1, behavior.length - 1)];
          const result = step(calls);
          if (result instanceof Error) throw result;
          return result;
        },
      },
    },
  };
  return { client, calls: () => calls };
}

const noSleep = () => Promise.resolve();

function apiError(status: number | undefined, message = 'boom'): any {
  const err: any = new Error(message);
  err.status = status;
  return err;
}

describe('isRetryableCompletionError', () => {
  test('retries transient statuses', () => {
    for (const status of [408, 409, 429, 500, 502, 503, 504]) {
      expect(isRetryableCompletionError(apiError(status))).toBe(true);
    }
  });

  test('does not retry client errors', () => {
    for (const status of [400, 401, 402, 403, 404, 422]) {
      expect(isRetryableCompletionError(apiError(status))).toBe(false);
    }
  });

  test('retries network/timeout errors (no status)', () => {
    expect(isRetryableCompletionError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableCompletionError(new Error('request timeout'))).toBe(true);
    expect(isRetryableCompletionError({ name: 'APIConnectionError' })).toBe(true);
    expect(isRetryableCompletionError({ code: 'ECONNRESET' })).toBe(true);
  });

  test('does not retry local validation/type errors with no status', () => {
    expect(isRetryableCompletionError(new TypeError('Cannot read property of undefined'))).toBe(false);
    expect(isRetryableCompletionError(new Error('boom'))).toBe(false);
  });
});

describe('createChatCompletionWithRetry', () => {
  test('returns immediately on success', async () => {
    const { client, calls } = fakeClient([() => ({ ok: true })]);
    const res = await createChatCompletionWithRetry(client, {}, { sleep: noSleep });
    expect(res).toEqual({ ok: true });
    expect(calls()).toBe(1);
  });

  test('retries transient failures with the 2/4/8/16 backoff', async () => {
    const { client, calls } = fakeClient([
      () => apiError(500),
      () => apiError(429),
      () => ({ ok: true }),
    ]);
    const sleeps: number[] = [];
    const res = await createChatCompletionWithRetry(client, {}, {
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
    });
    expect(res).toEqual({ ok: true });
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
  });

  test('does not retry non-retryable errors', async () => {
    const { client, calls } = fakeClient([() => apiError(400, 'bad request')]);
    await expect(createChatCompletionWithRetry(client, {}, { sleep: noSleep }))
      .rejects.toThrow('bad request');
    expect(calls()).toBe(1);
  });

  test('gives up after the backoff schedule is exhausted', async () => {
    const { client, calls } = fakeClient([() => apiError(503)]);
    await expect(createChatCompletionWithRetry(client, {}, { sleep: noSleep }))
      .rejects.toThrow('boom');
    // 1 initial attempt + one per backoff delay
    expect(calls()).toBe(1 + RETRY_DELAYS_MS.length);
  });

  test('stops retrying once the overall time budget is exhausted', async () => {
    const { client, calls } = fakeClient([() => apiError(503)]);
    await expect(
      createChatCompletionWithRetry(client, {}, { sleep: noSleep, overallTimeoutMs: 0 }),
    ).rejects.toThrow('boom');
    // The first attempt always runs; with no budget left, no retry is allowed.
    expect(calls()).toBe(1);
  });

  test('passes the per-attempt timeout through to the SDK', async () => {
    let seenOptions: any;
    const client = {
      chat: {
        completions: {
          create: async (_body: any, options?: any) => { seenOptions = options; return { ok: true }; },
        },
      },
    };
    await createChatCompletionWithRetry(client, {}, { timeoutMs: 12345, sleep: noSleep });
    expect(seenOptions?.timeout).toBe(12345);
  });
});
