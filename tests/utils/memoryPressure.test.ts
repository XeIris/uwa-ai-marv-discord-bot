import {
  describe, test, expect, beforeEach,
} from 'bun:test';
import { handleMemoryPressure, resetMemoryPressureState } from '../../utils/memoryPressure';

function fakeClient() {
  const calls: { messages: number; users: number; keptUserIds: string[] } = {
    messages: 0, users: 0, keptUserIds: [],
  };
  const client = {
    user: { id: 'self' },
    sweepers: {
      sweepMessages(filter: (m: any) => boolean) {
        calls.messages += 1;
        return filter({ id: 'm1' }) ? 3 : 0;
      },
      sweepUsers(filter: (u: any) => boolean) {
        calls.users += 1;
        [{ id: 'self' }, { id: 'someone' }].forEach((u) => {
          if (!filter(u)) calls.keptUserIds.push(u.id);
        });
        return 2;
      },
    },
  };
  return { client, calls };
}

describe('handleMemoryPressure', () => {
  beforeEach(() => resetMemoryPressureState());

  test('sweeps caches on a critical notification', () => {
    const { client, calls } = fakeClient();
    expect(handleMemoryPressure(client, 'critical', 1_000_000)).toBe(true);
    expect(calls.messages).toBe(1);
    expect(calls.users).toBe(1);
  });

  test('never evicts the bot user itself', () => {
    const { client, calls } = fakeClient();
    handleMemoryPressure(client, 'critical', 1_000_000);
    expect(calls.keptUserIds).toEqual(['self']);
  });

  test('a warning is advisory only — no sweep', () => {
    const { client, calls } = fakeClient();
    expect(handleMemoryPressure(client, 'warning', 1_000_000)).toBe(false);
    expect(calls.messages).toBe(0);
  });

  test('bursts of notifications collapse into one sweep per cooldown', () => {
    const { client, calls } = fakeClient();
    expect(handleMemoryPressure(client, 'critical', 1_000_000)).toBe(true);
    expect(handleMemoryPressure(client, 'critical', 1_030_000)).toBe(false);
    expect(handleMemoryPressure(client, 'critical', 1_061_000)).toBe(true);
    expect(calls.messages).toBe(2);
  });

  test('a sweeper that throws does not take the process down', () => {
    const client = {
      user: { id: 'self' },
      sweepers: { sweepMessages() { throw new Error('cache exploded'); } },
    };
    expect(handleMemoryPressure(client, 'critical', 1_000_000)).toBe(true);
  });
});
