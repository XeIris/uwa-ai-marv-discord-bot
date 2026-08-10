import { describe, expect, test } from 'bun:test';
import {
  readTextLimited,
  normalizeUnitCode,
  handbookUrl,
  htmlToText,
  parseUnitPage,
  formatUnitDetails,
  runUnitLookup,
} from '../../utils/unitLookup';

describe('normalizeUnitCode', () => {
  test('accepts and upper-cases a valid code', () => {
    expect(normalizeUnitCode('cits3001')).toBe('CITS3001');
    expect(normalizeUnitCode('  STAT2062 ')).toBe('STAT2062');
    expect(normalizeUnitCode('cits 3001')).toBe('CITS3001');
  });

  test.each([
    ['a unit name', 'Advanced Algorithms'],
    ['too few digits', 'CITS300'],
    ['too many letters', 'CITSX3001'],
    ['empty', ''],
    ['a number', '3001'],
    ['non-string', 42 as any],
    ['path traversal', '../../etc/passwd'],
    ['a url', 'https://evil.example.com'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeUnitCode(input as any)).toBeNull();
  });
});

describe('handbookUrl', () => {
  test('builds the canonical handbook url', () => {
    expect(handbookUrl('CITS3001')).toBe('https://handbooks.uwa.edu.au/unitdetails?code=CITS3001');
  });
});

describe('runUnitLookup input validation', () => {
  test('refuses a non-code without making a request', async () => {
    const res = await runUnitLookup({ code: 'Advanced Algorithms' });
    expect(res).toMatch(/^Error:/);
    expect(res).toMatch(/four letters then four digits/);
    // Must tell the model to ask rather than invent a code.
    expect(res).toMatch(/do not guess/i);
  });

  test('refuses a missing code', async () => {
    expect(await runUnitLookup({})).toMatch(/^Error:/);
  });
});

describe('readTextLimited', () => {
  /** A chunked body with no Content-Length — the case the header check can't catch. */
  const streamed = (chunks: string[]): Response => new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );

  test('returns the body when it is under the cap', async () => {
    expect(await readTextLimited(streamed(['abc', 'def']), 100)).toBe('abcdef');
  });

  test('aborts an oversized chunked body that declares no Content-Length', async () => {
    const big = 'x'.repeat(5_000);
    expect(await readTextLimited(streamed([big, big, big]), 8_000)).toBeNull();
  });

  test('counts bytes, not characters', async () => {
    // 4 multi-byte chars = 12 bytes, over a 10-byte cap despite being 4 chars.
    expect(await readTextLimited(streamed(['€€€€']), 10)).toBeNull();
  });

  test('falls back to a size-checked read when there is no stream', async () => {
    const res = { body: null, text: async () => 'short' } as any;
    expect(await readTextLimited(res, 100)).toBe('short');
    const big = { body: null, text: async () => 'y'.repeat(50) } as any;
    expect(await readTextLimited(big, 10)).toBeNull();
  });
});

describe('htmlToText', () => {
  test('drops script and style bodies entirely', () => {
    const html = '<div>keep<script>var secret = 1;</script><style>.a{color:red}</style>also</div>';
    const text = htmlToText(html);
    expect(text).toContain('keep');
    expect(text).toContain('also');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('color:red');
  });

  test('decodes entities and collapses spaces without eating newlines', () => {
    expect(htmlToText('<p>a &amp;&nbsp;&nbsp; b</p><p>c</p>')).toBe('a & b\nc');
  });
});

describe('parseUnitPage', () => {
  // Shaped like the real handbook page (verified against the live site).
  const page = `<html><head><title>Advanced Algorithms [CITS3001] : Handbook 2026 : UWA</title></head>
    <body>
    <p>This unit covers the design and analysis of algorithms in depth for students.</p>
    <p>Credit 6 points</p>
    <p>Offering (see Timetable ) Availability Location Mode </p>
    <p>Semester 2 UWA (Perth) On-campus</p>
    <p>Details for undergraduate courses Level 3 core unit in the Computer Science major</p>
    <p>Prerequisites</p><p>Successful completion of CITS2200 Data Structures and Algorithms</p>
    <p>Outcomes</p><p>Students are able to (1) create computer algorithms.</p>
    </body></html>`;

  test('extracts the title without the bracketed code', () => {
    expect(parseUnitPage(page, 'CITS3001').title).toBe('Advanced Algorithms');
  });

  test('extracts credit points, offering, level and prerequisites', () => {
    const byLabel = new Map(parseUnitPage(page, 'CITS3001').fields.map((f) => [f.label, f.value]));
    expect(byLabel.get('Credit points')).toBe('6');
    expect(byLabel.get('Offered')).toBe('Semester 2 UWA (Perth) On-campus');
    expect(byLabel.get('Level')).toContain('3 core unit');
    expect(byLabel.get('Prerequisites')).toContain('CITS2200');
  });

  test('does not mistake the "content may change" boilerplate for the description', () => {
    const withBoilerplate = page.replace('<body>', '<body><p>Unit content may change. Students are recommended…</p>');
    const about = parseUnitPage(withBoilerplate, 'CITS3001').fields.find((f) => f.label === 'About');
    expect(about?.value).not.toMatch(/may change/);
    expect(about?.value).toContain('design and analysis');
  });

  test('returns an empty result for an unrelated page rather than inventing fields', () => {
    const details = parseUnitPage('<html><title>Search : UWA</title><body>No unit here</body></html>', 'ZZZZ9999');
    expect(details.title).toBeNull();
    expect(details.fields).toEqual([]);
  });
});

describe('formatUnitDetails', () => {
  test('always includes the handbook link and the change caveat', () => {
    const out = formatUnitDetails(
      { code: 'CITS3001', title: 'Advanced Algorithms', fields: [{ label: 'Credit points', value: '6' }] },
      handbookUrl('CITS3001'),
    );
    expect(out).toContain('https://handbooks.uwa.edu.au/unitdetails?code=CITS3001');
    expect(out).toMatch(/can change/i);
    expect(out).toContain('**Advanced Algorithms** (CITS3001)');
  });

  test('still links out when nothing could be extracted', () => {
    const out = formatUnitDetails({ code: 'CITS3001', title: null, fields: [] }, handbookUrl('CITS3001'));
    expect(out).toContain('unitdetails?code=CITS3001');
    expect(out).toMatch(/no structured details/i);
  });
});
