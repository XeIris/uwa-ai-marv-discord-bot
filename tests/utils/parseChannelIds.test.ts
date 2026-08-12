import { describe, expect, test } from 'bun:test';
import { parseChannelIds, parseSnowflakeIds } from '../../utils/parseChannelIds';

const A = '100000000000000001';
const B = '100000000000000002';

describe('parseChannelIds', () => {
  test('parses a comma-separated list and trims', () => {
    expect(parseChannelIds(` ${A} , ${B} `)).toEqual([A, B]);
  });

  test('de-duplicates — a repeat would double-post a reminder', () => {
    expect(parseChannelIds(`${A},${A}`)).toEqual([A]);
    expect(parseChannelIds(`${A},${B},${A}`)).toEqual([A, B]);
  });

  test('keeps non-snowflake entries, so /serverconfig get still shows them', () => {
    expect(parseChannelIds(`${A},legacy-value`)).toEqual([A, 'legacy-value']);
  });

  test('handles empty and nullish input', () => {
    expect(parseChannelIds('')).toEqual([]);
    expect(parseChannelIds(null)).toEqual([]);
    expect(parseChannelIds(undefined)).toEqual([]);
    expect(parseChannelIds(',,,')).toEqual([]);
  });
});

describe('parseSnowflakeIds', () => {
  test('de-duplicates and keeps only well-formed snowflakes', () => {
    expect(parseSnowflakeIds(`${A},${A},nonsense,12,<#${B}>`)).toEqual([A]);
  });

  test('accepts the full snowflake length range', () => {
    expect(parseSnowflakeIds('12345678901234567')).toEqual(['12345678901234567']);
    expect(parseSnowflakeIds('12345678901234567890')).toEqual(['12345678901234567890']);
    expect(parseSnowflakeIds('1234567890123456')).toEqual([]);
    expect(parseSnowflakeIds('123456789012345678901')).toEqual([]);
  });
});
