import { describe, expect, test } from 'bun:test';
import { markStaleMediaPlaceholders } from '../../utils/aiMedia';

describe('markStaleMediaPlaceholders', () => {
  test('marks a live-shaped placeholder as no longer viewable', () => {
    const out = markStaleMediaPlaceholders('User bob said: what is this?\n[attached image: cat.png]');
    expect(out).toContain('[attached image: cat.png]');
    expect(out).toContain('NOT VIEWABLE');
  });

  test('handles every modality', () => {
    for (const kind of ['image', 'video', 'audio']) {
      expect(markStaleMediaPlaceholders(`[attached ${kind}: f.bin]`)).toContain('NOT VIEWABLE');
    }
  });

  test('marks each of several placeholders', () => {
    const out = markStaleMediaPlaceholders('[attached image: a.png]\n[attached image: b.png]');
    expect(out.match(/NOT VIEWABLE/g)?.length).toBe(2);
  });

  // The annotation an unreadable/edit-only placeholder already carries sits
  // after the closing bracket, which is exactly what keeps it out of the regex.
  test('leaves an already-annotated placeholder alone', () => {
    const annotated = '[attached image: a.png] (you cannot view this image, but your generate_image tool can edit it)';
    expect(markStaleMediaPlaceholders(annotated)).toBe(annotated);
  });

  test('is idempotent', () => {
    const once = markStaleMediaPlaceholders('[attached image: a.png]');
    expect(markStaleMediaPlaceholders(once)).toBe(once);
  });

  test('ignores ordinary prose that merely mentions an attachment', () => {
    const prose = 'I sent you [attached image: a.png] earlier in the day';
    expect(markStaleMediaPlaceholders(prose)).toBe(prose);
  });

  test('tolerates empty and nullish input', () => {
    expect(markStaleMediaPlaceholders('')).toBe('');
    expect(markStaleMediaPlaceholders(undefined as any)).toBe('');
  });
});
