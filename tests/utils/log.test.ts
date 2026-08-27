import { describe, test, expect } from 'bun:test';
import { sanitizeRejectionReason } from '../../utils/log';

describe('sanitizeRejectionReason', () => {
  test('keeps an ordinary error readable', () => {
    const out = sanitizeRejectionReason(new Error('connection reset'));
    expect(out).toContain('connection reset');
  });

  test('stringifies a non-Error reason', () => {
    expect(sanitizeRejectionReason('plain string reason')).toBe('plain string reason');
    expect(sanitizeRejectionReason(42)).toBe('42');
  });

  test('redacts an Authorization bearer token', () => {
    const out = sanitizeRejectionReason(
      new Error('401 from provider: Authorization: Bearer sk-or-v1-abcdef0123456789abcdef0123456789'),
    );
    expect(out).not.toContain('abcdef0123456789');
    expect(out).toContain('[redacted]');
  });

  test('redacts a bare API key', () => {
    const out = sanitizeRejectionReason('key sk-or-v1-0123456789abcdef0123456789abcdef rejected');
    expect(out).not.toContain('0123456789abcdef');
    expect(out).toContain('[redacted]');
  });

  test('caps a runaway payload instead of writing it all to disk', () => {
    // A rejected provider call can carry a multi-MB base64 image in its message.
    const out = sanitizeRejectionReason(`data:image/png;base64,${'A'.repeat(50_000)}`);
    expect(out.length).toBeLessThan(4_200);
    expect(out).toContain('truncated');
  });

  test('handles null and undefined without throwing', () => {
    expect(sanitizeRejectionReason(undefined)).toBe('undefined');
    expect(sanitizeRejectionReason(null)).toBe('null');
  });
});
