import { describe, expect, test } from 'bun:test';
import {
  tokenizeMarkup,
  parseStyleAttr,
  parseRestrictedHtml,
  sanitizeSvg,
  checkDimensions,
  clampDimension,
  sanitizeTitle,
  extractDiagramText,
  MAX_WIDTH,
  MIN_WIDTH,
  MAX_HEIGHT,
  MIN_HEIGHT,
} from '../../utils/diagramGen';

describe('tokenizeMarkup', () => {
  test('rejects doctype, comments and processing instructions', () => {
    for (const src of [
      '<!DOCTYPE svg><svg width="300" height="100"></svg>',
      '<!-- hi --><div></div>',
      '<!ENTITY a "aaa"><div></div>',
      '<![CDATA[x]]><div></div>',
      '<?xml version="1.0"?><svg></svg>',
    ]) {
      const res = tokenizeMarkup(src);
      expect(res.ok).toBe(false);
    }
  });

  test('rejects an unterminated tag', () => {
    expect(tokenizeMarkup('<div style="color:red"').ok).toBe(false);
  });

  test('parses attributes with any quoting style', () => {
    const res = tokenizeMarkup('<rect x="1" y=\'2\' r=3/>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [token] = res.tokens;
    expect(token.kind).toBe('open');
    if (token.kind !== 'open') return;
    expect(token.selfClosing).toBe(true);
    expect(token.attrs).toEqual([
      { name: 'x', value: '1' },
      { name: 'y', value: '2' },
      { name: 'r', value: '3' },
    ]);
  });
});

describe('parseStyleAttr', () => {
  test('accepts allowlisted properties and coerces bare numbers', () => {
    const res = parseStyleAttr('display:flex; font-size:16px; flex-grow:1; color:#fff');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.style).toEqual({
      display: 'flex', fontSize: '16px', flexGrow: 1, color: '#fff',
    });
  });

  test('camel-cases hyphenated properties', () => {
    const res = parseStyleAttr('flex-direction:row;border-top-left-radius:4px');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.style)).toEqual(['flexDirection', 'borderTopLeftRadius']);
  });

  test.each([
    ['url() reference', 'background:url(http://169.254.169.254/)'],
    ['local file url()', 'background-image:url(file:///etc/passwd)'],
    ['css variable', 'color:var(--x)'],
    ['import', 'background:@import "x"'],
    ['javascript scheme', 'background:javascript:alert(1)'],
    ['ie expression', 'width:expression(alert(1))'],
    ['unlisted property', '-webkit-binding:x'],
    ['position fixed is not a property issue but display is', 'display:grid'],
    ['unknown font family', 'font-family:Comic Sans MS'],
    ['empty value', 'color:'],
    ['no colon', 'color'],
  ])('rejects %s', (_label, css) => {
    expect(parseStyleAttr(css).ok).toBe(false);
  });

  test('rejects an over-long value', () => {
    expect(parseStyleAttr(`background:${'a'.repeat(300)}`).ok).toBe(false);
  });
});

describe('parseRestrictedHtml', () => {
  test('builds a satori vnode tree', () => {
    const res = parseRestrictedHtml('<div style="flex-direction:row"><span style="color:#fff">hi</span></div>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const outer = res.node.props.children[0];
    expect(outer.type).toBe('div');
    expect(outer.props.style.flexDirection).toBe('row');
    expect(outer.props.children[0].type).toBe('span');
    expect(outer.props.children[0].props.children[0]).toBe('hi');
  });

  test('defaults code/pre to the mono family and b/i to weight/style', () => {
    const res = parseRestrictedHtml('<code>x</code><b>y</b><em>z</em>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [code, bold, italic] = res.node.props.children;
    expect(code.props.style.fontFamily).toBe('mono');
    expect(bold.props.style.fontWeight).toBe(700);
    expect(italic.props.style.fontStyle).toBe('italic');
  });

  test.each([
    ['img', '<div><img src="file:///etc/passwd"/></div>'],
    ['script', '<div><script>fetch("http://evil")</script></div>'],
    ['style element', '<div><style>@import url(http://evil)</style></div>'],
    ['anchor', '<div><a href="http://evil">x</a></div>'],
    ['table', '<table><tr><td>x</td></tr></table>'],
    ['iframe', '<iframe src="http://evil"></iframe>'],
  ])('rejects <%s>', (_label, src) => {
    expect(parseRestrictedHtml(src).ok).toBe(false);
  });

  test('rejects every attribute except style', () => {
    expect(parseRestrictedHtml('<div class="x">y</div>').ok).toBe(false);
    expect(parseRestrictedHtml('<div id="x">y</div>').ok).toBe(false);
    expect(parseRestrictedHtml('<div onclick="alert(1)">y</div>').ok).toBe(false);
  });

  test('rejects unbalanced tags and empty output', () => {
    expect(parseRestrictedHtml('<div><span>x</span>').ok).toBe(false);
    expect(parseRestrictedHtml('</div>').ok).toBe(false);
    expect(parseRestrictedHtml('   ').ok).toBe(false);
  });
});

describe('sanitizeSvg', () => {
  test('re-serialises an allowlisted document and reports its size', () => {
    const res = sanitizeSvg('<svg width="400" height="200"><rect x="1" y="2" width="10" height="10" fill="#fff"/></svg>', 900);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.width).toBe(400);
    expect(res.height).toBe(200);
    expect(res.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(res.svg).toContain('<rect x="1" y="2" width="10" height="10" fill="#fff"/>');
  });

  test('allows same-document paint and href references', () => {
    const src = '<svg width="400" height="200"><defs><marker id="a"><polygon points="0 0, 5 5, 0 5"/></marker></defs>'
      + '<line x1="1" y1="1" x2="9" y2="9" marker-end="url(#a)"/><use href="#a"/></svg>';
    expect(sanitizeSvg(src, 900).ok).toBe(true);
  });

  test('allows a same-document ref preceded by another token', () => {
    // A single anchored match rejected this, because of the "l" in "blue".
    const src = '<svg width="400" height="200"><rect width="9" height="9" fill="blue url(#a)"/></svg>';
    expect(sanitizeSvg(src, 900).ok).toBe(true);
  });

  test('rejects a value whose SECOND url() is external', () => {
    // Validating only the first url() let this through — every occurrence counts.
    const src = '<svg width="400" height="200">'
      + '<rect width="9" height="9" stroke="url(#a) url(http://evil.example/#b)"/></svg>';
    expect(sanitizeSvg(src, 900).ok).toBe(false);
  });

  test('rejects an external ref that appears after a "u" earlier in the value', () => {
    const src = '<svg width="400" height="200"><rect width="9" height="9" fill="blue url(http://evil/#g)"/></svg>';
    expect(sanitizeSvg(src, 900).ok).toBe(false);
  });

  test.each([
    ['script element', '<svg width="400" height="200"><script>alert(1)</script></svg>'],
    ['style element', '<svg width="400" height="200"><style>@import url(http://evil)</style></svg>'],
    ['image element', '<svg width="400" height="200"><image href="file:///etc/passwd"/></svg>'],
    ['foreignObject', '<svg width="400" height="200"><foreignObject></foreignObject></svg>'],
    ['event handler', '<svg width="400" height="200" onload="alert(1)"></svg>'],
    ['external href', '<svg width="400" height="200"><use href="http://evil/x#a"/></svg>'],
    ['external paint ref', '<svg width="400" height="200"><rect width="9" height="9" fill="url(http://evil/#g)"/></svg>'],
    ['data uri', '<svg width="400" height="200"><rect width="9" height="9" fill="data:text/html,x"/></svg>'],
    ['unlisted attribute', '<svg width="400" height="200"><rect width="9" height="9" requiredExtensions="x"/></svg>'],
    ['missing dimensions', '<svg viewBox="0 0 10 10"><rect width="9" height="9"/></svg>'],
    ['non-svg root', '<div><svg width="400" height="200"></svg></div>'],
    ['two roots', '<svg width="400" height="200"></svg><svg width="400" height="200"></svg>'],
    ['mismatched close', '<svg width="400" height="200"><g></defs></svg>'],
    ['unclosed element', '<svg width="400" height="200"><g>'],
  ])('rejects %s', (_label, src) => {
    expect(sanitizeSvg(src, 900).ok).toBe(false);
  });

  test('escapes text content rather than trusting it', () => {
    const res = sanitizeSvg('<svg width="400" height="200"><text>a &amp; b</text></svg>', 900);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.svg).toContain('a &amp; b');
  });
});

describe('checkDimensions', () => {
  test('accepts an in-range canvas', () => {
    expect(checkDimensions(900, 500)).toBeNull();
  });

  test.each([
    ['too narrow', MIN_WIDTH - 1, 500],
    ['too wide', MAX_WIDTH + 1, 500],
    ['too short', 900, MIN_HEIGHT - 1],
    ['too tall', 900, MAX_HEIGHT + 1],
    ['over the pixel budget', 1600, 1500],
    ['not a number', Number.NaN, 500],
  ])('rejects %s', (_label, width, height) => {
    expect(checkDimensions(width, height)).toBeTruthy();
  });
});

describe('clampDimension', () => {
  test('clamps into range and truncates', () => {
    expect(clampDimension(50, 200, 1600, 900)).toBe(200);
    expect(clampDimension(9999, 200, 1600, 900)).toBe(1600);
    expect(clampDimension('640.7', 200, 1600, 900)).toBe(640);
  });

  test('falls back when absent or unparseable', () => {
    expect(clampDimension(undefined, 200, 1600, 900)).toBe(900);
    expect(clampDimension('wide', 200, 1600, null)).toBeNull();
  });
});

describe('sanitizeTitle', () => {
  test('strips path and shell characters and falls back', () => {
    expect(sanitizeTitle('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeTitle('my chart!')).toBe('my-chart');
    expect(sanitizeTitle('')).toBe('diagram');
    expect(sanitizeTitle(undefined)).toBe('diagram');
    expect(sanitizeTitle('%^&*')).toBe('diagram');
  });
});

describe('extractDiagramText', () => {
  test('pulls the labels out of html markup', () => {
    const out = extractDiagramText('<div class="box" style="fill:#fff"><span>Login</span><span>Database</span></div>');
    expect(out).toBe('Login Database');
  });

  test('drops css bodies rather than reading them as prose', () => {
    const out = extractDiagramText('<style>.a { fill: red; content: "xyz"; }</style><p>Real label</p>');
    expect(out).toBe('Real label');
  });

  test('reads svg text nodes and decodes entities', () => {
    const out = extractDiagramText('<svg><text x="10" y="20">A &amp; B</text><text>C &lt; D</text></svg>');
    expect(out).toBe('A & B C < D');
  });

  test('keeps attribute values out — they are geometry, not prose', () => {
    expect(extractDiagramText('<rect x="10" y="20" width="30" fill="#1e1f22" />')).toBe('');
  });

  test('caps the output so one screening call cannot become several', () => {
    const long = `<p>${'word '.repeat(5000)}</p>`;
    expect(extractDiagramText(long, 4000).length).toBe(4000);
  });

  test('tolerates empty and nullish source', () => {
    expect(extractDiagramText('')).toBe('');
    expect(extractDiagramText(undefined as any)).toBe('');
  });
});
