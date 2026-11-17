/*
 * Toolora core logic.
 * Pure functions only (no DOM access) so everything here is unit-tested in Node.
 */

/* ============================================================
 * Numbers & percentages
 * ============================================================ */

/** Parse user input such as "1,500.50" into a number. Returns NaN when invalid. */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (typeof input !== 'string') return NaN;
  const s = input.trim().replace(/[\s,_ ]/g, '');
  if (s === '') return NaN;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Remove floating-point noise (0.1 + 0.2 -> 0.3). */
export function tidy(n) {
  return Number(Number(n).toPrecision(12));
}

const ok = (value, extra = {}) => ({ ok: true, value: tidy(value), ...extra });
const bad = (error) => ({ ok: false, error });

/** What is `percent`% of `number`? */
export function percentOf(percent, number) {
  return ok((percent * number) / 100);
}

/** `part` is what percent of `total`? */
export function whatPercent(part, total) {
  if (total === 0) return bad('total-zero');
  return ok((part / total) * 100);
}

/** Percentage change from `from` to `to`. */
export function percentChange(from, to) {
  if (from === 0) return bad('from-zero');
  const value = tidy(((to - from) / Math.abs(from)) * 100);
  return {
    ok: true,
    value,
    direction: value > 0 ? 'increase' : value < 0 ? 'decrease' : 'none',
  };
}

/** `number` increased by `percent`%. */
export function increaseBy(number, percent) {
  return ok(number + (number * percent) / 100);
}

/** `number` decreased by `percent`%. */
export function decreaseBy(number, percent) {
  return ok(number - (number * percent) / 100);
}

/** `value` is `percent`% of what number? */
export function findWhole(percent, value) {
  if (percent === 0) return bad('percent-zero');
  return ok((value * 100) / percent);
}

/* ============================================================
 * Formatting & file names
 * ============================================================ */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const dp = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${Number(v.toFixed(dp))} ${units[u]}`;
}

/** File name without folders or extension, safe for use in a download name. */
export function baseName(filename) {
  const s = String(filename || '').replace(/^.*[\\/]/, '');
  const dot = s.lastIndexOf('.');
  const base = dot > 0 ? s.slice(0, dot) : s;
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100);
  return clean || 'file';
}

/** Make `name` unique within `used` (a Set of lower-case names), e.g. a.jpg -> a-2.jpg */
export function uniqueName(name, used) {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/* ============================================================
 * Image helpers (dimensions, file sniffing)
 * ============================================================ */

/** Scale down (never up) so the longest side is at most `maxSide`. 0/undefined = no limit. */
export function fitWithin(width, height, maxSide) {
  if (!maxSide || (width <= maxSide && height <= maxSide)) return { width, height };
  const scale = maxSide / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function heightForWidth(origW, origH, newW) {
  return Math.max(1, Math.round((origH * newW) / origW));
}

export function widthForHeight(origW, origH, newH) {
  return Math.max(1, Math.round((origW * newH) / origH));
}

export function scaleByPercent(width, height, percent) {
  return {
    width: Math.max(1, Math.round((width * percent) / 100)),
    height: Math.max(1, Math.round((height * percent) / 100)),
  };
}

/** Identify an image by its first bytes (never trust the file extension). */
export function sniffImageType(bytes) {
  const b = bytes;
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png';
  const ascii = (from, len) => String.fromCharCode(...b.slice(from, from + len));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp' && /^(avif|avis)$/.test(ascii(8, 4))) return 'image/avif';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp' && /^(heic|heix|mif1|msf1)$/.test(ascii(8, 4))) return 'image/heic';
  return null;
}

/* ============================================================
 * ZIP writer (store method, no compression – images are already compressed)
 * ============================================================ */

let crcTable = null;

export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/**
 * Build a ZIP archive.
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Uint8Array}
 */
export function buildZip(files, now = new Date()) {
  if (files.length > 65535) throw new Error('Too many files for ZIP');
  const enc = new TextEncoder();
  const dt = dosDateTime(now);
  const entries = files.map((f) => ({
    nameBytes: enc.encode(f.name),
    data: f.data,
    crc: crc32(f.data),
    offset: 0,
  }));

  let size = 22;
  for (const e of entries) size += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;
  if (size >= 0xffffffff) throw new Error('ZIP too large');

  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let p = 0;

  for (const e of entries) {
    e.offset = p;
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 0x0800, true); // UTF-8 names
    dv.setUint16(p + 8, 0, true); // stored
    dv.setUint16(p + 10, dt.time, true);
    dv.setUint16(p + 12, dt.date, true);
    dv.setUint32(p + 14, e.crc, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, e.nameBytes.length, true);
    dv.setUint16(p + 28, 0, true);
    p += 30;
    out.set(e.nameBytes, p);
    p += e.nameBytes.length;
    out.set(e.data, p);
    p += e.data.length;
  }

  const cdStart = p;
  for (const e of entries) {
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, dt.time, true);
    dv.setUint16(p + 14, dt.date, true);
    dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.nameBytes.length, true);
    dv.setUint16(p + 30, 0, true);
    dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true);
    dv.setUint16(p + 36, 0, true);
    dv.setUint32(p + 38, 0, true);
    dv.setUint32(p + 42, e.offset, true);
    p += 46;
    out.set(e.nameBytes, p);
    p += e.nameBytes.length;
  }

  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 4, 0, true);
  dv.setUint16(p + 6, 0, true);
  dv.setUint16(p + 8, entries.length, true);
  dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, p - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  dv.setUint16(p + 20, 0, true);
  return out;
}

/* ============================================================
 * JSON: strict parser (keeps numbers/strings exactly as written),
 * friendly errors, formatter, minifier and key sorter.
 * ============================================================ */

class JsonFail extends Error {
  constructor(code, message, pos, params) {
    super(message);
    this.code = code;
    this.pos = pos;
    this.params = params || {};
  }
}

function describeChar(ch) {
  if (ch === undefined) return 'the end of the input';
  if (ch === '\n') return 'a line break';
  if (ch === '\t') return 'a tab';
  if (ch === ' ') return 'a space';
  return `“${ch}”`;
}

export function lineColumn(text, offset) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

/** The offending line plus caret column, trimmed for very long lines. */
export function errorContext(source, offset) {
  const start = offset > 0 ? source.lastIndexOf('\n', offset - 1) + 1 : 0;
  let end = source.indexOf('\n', offset);
  if (end === -1) end = source.length;
  let line = source.slice(start, end).replace(/\r$/, '').replace(/\t/g, ' ');
  let col = offset - start;
  const MAX = 80;
  if (line.length > MAX) {
    const from = Math.max(0, col - 40);
    const to = Math.min(line.length, from + MAX);
    line = (from > 0 ? '…' : '') + line.slice(from, to) + (to < line.length ? '…' : '');
    col = col - from + (from > 0 ? 1 : 0);
  }
  return { line, col: Math.max(0, col) };
}

const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD_RE = /[A-Za-z_$][\w$]*/y;
// eslint-disable-next-line no-control-regex
const STR_SPECIAL = /["\\\u0000-\u001f]/g;
const MAX_DEPTH = 512;

/**
 * Parse JSON into a lightweight AST that preserves the original text of numbers and strings.
 * @returns {{ok: true, ast: object} | {ok: false, empty?: boolean, error?: object}}
 */
export function parseJSON(source) {
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = bom ? source.slice(1) : source;
  const n = text.length;
  if (text.trim() === '') return { ok: false, empty: true };

  let i = 0;
  let lastComma = -1;

  const fail = (code, message, pos = i, params = {}) => {
    throw new JsonFail(code, message, pos, params);
  };

  const skipWs = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  const unexpectedEnd = (what, startPos) => {
    const lc = lineColumn(text, startPos);
    fail('unexpected-end', `The input ended before ${what} was closed (it starts at line ${lc.line}, column ${lc.column}).`, n, { what, line: lc.line, column: lc.column });
  };

  function parseString() {
    const start = i;
    i++;
    for (;;) {
      STR_SPECIAL.lastIndex = i;
      const m = STR_SPECIAL.exec(text);
      if (!m) fail('unterminated-string', 'This string never ends — a closing double quote is missing.', start);
      i = m.index;
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return text.slice(start, i);
      }
      if (c === 92) {
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('bad-escape', 'Invalid \\u escape — it needs exactly four hexadecimal digits.', i);
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2;
        } else {
          fail('bad-escape', `Invalid escape sequence “\\${e ?? ''}”. Use \\\\ for a backslash.`, i, { found: `\\${e ?? ''}` });
        }
      } else {
        fail('control-char', 'A line break or control character appears inside a string — write it as an escape such as \\n.', i);
      }
    }
  }

  function parseNum() {
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(text);
    const junk = /[^\s,\]}:]*/y;
    junk.lastIndex = i;
    const token = junk.exec(text)[0] || text[i];
    if (!m) fail('bad-number', `“${token}” is not a valid number.`, i, { found: token });
    const end = i + m[0].length;
    const next = text[end];
    if (next !== undefined && !/[\s,\]}]/.test(next)) {
      if (/^-?0$/.test(m[0]) && /\d/.test(next)) fail('leading-zero', `Numbers can’t have leading zeros (“${token}”).`, i, { found: token });
      fail('bad-number', `“${token}” is not a valid number.`, i, { found: token });
    }
    const start = i;
    i = end;
    return { t: 'num', raw: text.slice(start, end) };
  }

  function parseValue(depth) {
    if (depth > MAX_DEPTH) fail('too-deep', `This JSON is nested more than ${MAX_DEPTH} levels deep.`, i);
    skipWs();
    if (i >= n) fail('unexpected-end', 'The input ended where a value was expected.', n, { what: 'a value' });
    const c = text[i];
    if (c === '{') return parseObject(depth);
    if (c === '[') return parseArray(depth);
    if (c === '"') return { t: 'str', raw: parseString() };
    if (c === '-' || (c >= '0' && c <= '9')) return parseNum();
    if (/[A-Za-z_$]/.test(c)) {
      WORD_RE.lastIndex = i;
      const w = WORD_RE.exec(text)[0];
      if (w === 'true' || w === 'false' || w === 'null') {
        i += w.length;
        return { t: 'lit', raw: w };
      }
      if (['true', 'false', 'null'].includes(w.toLowerCase())) fail('bad-literal', `Use lowercase “${w.toLowerCase()}” — JSON is case-sensitive.`, i, { found: w });
      if (w === 'undefined' || w === 'NaN' || w === 'Infinity') fail('bad-literal', `“${w}” is not valid JSON. Use null instead.`, i, { found: w });
      fail('unexpected-token', `Unexpected text “${w}”. Strings must be wrapped in double quotes.`, i, { found: w });
    }
    if (c === "'") fail('single-quote', 'JSON strings need double quotes (“) — single quotes (‘) are not allowed.', i);
    if (c === '/') fail('comment', 'Comments are not allowed in JSON. Remove the // or /* */ comment.', i);
    if (c === '+' || c === '.') fail('bad-number', `Numbers can’t start with “${c}”.`, i, { found: c });
    fail('unexpected-token', `Unexpected ${describeChar(c)} — a value was expected here.`, i, { found: describeChar(c) });
  }

  function parseArray(depth) {
    const start = i;
    i++;
    const items = [];
    skipWs();
    if (text[i] === ']') {
      i++;
      return { t: 'arr', items };
    }
    for (;;) {
      skipWs();
      if (i >= n) unexpectedEnd('the array', start);
      if (text[i] === ']' && items.length) fail('trailing-comma', 'Trailing comma — JSON does not allow a comma before “]”.', lastComma);
      items.push(parseValue(depth + 1));
      skipWs();
      const d = text[i];
      if (d === ',') {
        lastComma = i;
        i++;
        continue;
      }
      if (d === ']') {
        i++;
        return { t: 'arr', items };
      }
      if (i >= n) unexpectedEnd('the array', start);
      fail('expected-comma', `Expected “,” or “]” but found ${describeChar(d)}.${/["{[\d\-tfn]/.test(d) ? ' Is a comma missing between items?' : ''}`, i, { found: describeChar(d), close: ']' });
    }
  }

  function parseObject(depth) {
    const start = i;
    i++;
    const props = [];
    skipWs();
    if (text[i] === '}') {
      i++;
      return { t: 'obj', props };
    }
    for (;;) {
      skipWs();
      if (i >= n) unexpectedEnd('the object', start);
      const c = text[i];
      if (c !== '"') {
        if (c === '}' && props.length) fail('trailing-comma', 'Trailing comma — JSON does not allow a comma before “}”.', lastComma);
        if (c === "'") fail('single-quote', 'JSON keys need double quotes (“) — single quotes (‘) are not allowed.', i);
        if (/[A-Za-z_$]/.test(c)) fail('unquoted-key', 'Keys must be wrapped in double quotes.', i);
        fail('unexpected-token', `Unexpected ${describeChar(c)} — a double-quoted key was expected here.`, i, { found: describeChar(c) });
      }
      const key = parseString();
      skipWs();
      if (text[i] !== ':') {
        if (i >= n) unexpectedEnd('the object', start);
        fail('expected-colon', `Expected “:” after the key but found ${describeChar(text[i])}.`, i, { found: describeChar(text[i]) });
      }
      i++;
      const value = parseValue(depth + 1);
      props.push({ key, value });
      skipWs();
      const d = text[i];
      if (d === ',') {
        lastComma = i;
        i++;
        continue;
      }
      if (d === '}') {
        i++;
        return { t: 'obj', props };
      }
      if (i >= n) unexpectedEnd('the object', start);
      fail('expected-comma', `Expected “,” or “}” but found ${describeChar(d)}.${/["{[\d\-tfn]/.test(d) ? ' Is a comma missing between items?' : ''}`, i, { found: describeChar(d), close: '}' });
    }
  }

  try {
    const ast = parseValue(0);
    skipWs();
    if (i < n) fail('extra-data', `Unexpected ${describeChar(text[i])} after the end of the JSON value.`, i, { found: describeChar(text[i]) });
    return { ok: true, ast };
  } catch (err) {
    if (!(err instanceof JsonFail)) throw err;
    const offset = err.pos + bom;
    const { line, column } = lineColumn(source, offset);
    return {
      ok: false,
      error: { code: err.code, message: err.message, params: err.params, offset, line, column },
    };
  }
}

/** Serialise an AST. indent: 0 = minified, number = spaces, 'tab' = tabs. */
export function stringifyAST(ast, { indent = 2, sortKeys = false } = {}) {
  const pretty = indent === 'tab' || (typeof indent === 'number' && indent > 0);
  const unit = indent === 'tab' ? '\t' : pretty ? ' '.repeat(indent) : '';
  const decoded = new Map();
  const keyOf = (raw) => {
    if (!decoded.has(raw)) decoded.set(raw, JSON.parse(raw));
    return decoded.get(raw);
  };

  const write = (node, level) => {
    switch (node.t) {
      case 'str':
      case 'num':
      case 'lit':
        return node.raw;
      case 'arr': {
        if (!node.items.length) return '[]';
        if (!pretty) return `[${node.items.map((x) => write(x, level + 1)).join(',')}]`;
        const pad = unit.repeat(level + 1);
        return `[\n${node.items.map((x) => pad + write(x, level + 1)).join(',\n')}\n${unit.repeat(level)}]`;
      }
      default: {
        if (!node.props.length) return '{}';
        let props = node.props;
        if (sortKeys) {
          props = [...props].sort((a, b) => {
            const ka = keyOf(a.key);
            const kb = keyOf(b.key);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
          });
        }
        if (!pretty) return `{${props.map((p) => `${p.key}:${write(p.value, level + 1)}`).join(',')}}`;
        const pad = unit.repeat(level + 1);
        return `{\n${props.map((p) => `${pad}${p.key}: ${write(p.value, level + 1)}`).join(',\n')}\n${unit.repeat(level)}}`;
      }
    }
  };
  return write(ast, 0);
}

export function jsonStats(ast) {
  let keys = 0;
  let values = 0;
  let maxDepth = 0;
  const walk = (node, depth) => {
    values++;
    if (depth > maxDepth) maxDepth = depth;
    if (node.t === 'arr') node.items.forEach((x) => walk(x, depth + 1));
    else if (node.t === 'obj') {
      keys += node.props.length;
      node.props.forEach((p) => walk(p.value, depth + 1));
    }
  };
  walk(ast, 1);
  const type = ast.t === 'arr' ? 'array' : ast.t === 'obj' ? 'object' : ast.t === 'str' ? 'string' : ast.t === 'num' ? 'number' : 'literal';
  return { type, keys, values, depth: maxDepth, size: ast.t === 'arr' ? ast.items.length : ast.t === 'obj' ? ast.props.length : 0 };
}

/** Validate and (re)format JSON text in one step. */
export function formatJSON(text, options = {}) {
  const parsed = parseJSON(text);
  if (!parsed.ok) return parsed;
  return { ok: true, output: stringifyAST(parsed.ast, options), stats: jsonStats(parsed.ast) };
}

/* ============================================================
 * Text analysis (word counter)
 * ============================================================ */

const HAS_ALNUM = /[\p{L}\p{N}]/u;
const NEEDS_SEGMENTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const TERMINATORS = new Set(['.', '!', '?', '…', '।', '॥', '。', '！', '？']);
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»', '」', '』']);

let wordSegmenter;
let graphemeSegmenter;
const getWordSegmenter = () => {
  if (wordSegmenter === undefined) wordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  return wordSegmenter;
};
const getGraphemeSegmenter = () => {
  if (graphemeSegmenter === undefined) graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  return graphemeSegmenter;
};

export const STOP_WORDS = new Set(
  ('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself').split(' ')
);

/** Words as people count them: whitespace-separated tokens, with CJK/Thai segmented properly. */
export function tokenizeWords(text) {
  const out = [];
  for (const tok of text.split(/\s+/)) {
    if (!tok || !HAS_ALNUM.test(tok)) continue;
    if (NEEDS_SEGMENTER.test(tok)) {
      const seg = getWordSegmenter();
      if (seg) {
        for (const s of seg.segment(tok)) if (s.isWordLike) out.push(s.segment);
        continue;
      }
    }
    out.push(tok);
  }
  return out;
}

/** Number of user-perceived characters (an emoji or Hindi conjunct counts as one). */
export function countCharacters(text) {
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-\u007f]*$/.test(text)) return text.length;
  const seg = getGraphemeSegmenter();
  if (seg) {
    let c = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of seg.segment(text)) c++;
    return c;
  }
  return Array.from(text).length;
}

export function countSentences(text) {
  const n = text.length;
  let count = 0;
  let hasContent = false;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (!hasContent && HAS_ALNUM.test(ch)) hasContent = true;
    if (TERMINATORS.has(ch)) {
      let j = i + 1;
      while (j < n && (TERMINATORS.has(text[j]) || CLOSERS.has(text[j]))) j++;
      // "3.14" and "example.com" are not sentence ends: a terminator must be followed by whitespace or the end.
      if (j >= n || /\s/.test(text[j])) {
        if (hasContent) count++;
        hasContent = false;
        i = j - 1;
      }
    } else if (ch === '\n') {
      let j = i + 1;
      while (j < n && text[j] !== '\n' && /\s/.test(text[j])) j++;
      if (j < n && text[j] === '\n') {
        // blank line = boundary
        if (hasContent) count++;
        hasContent = false;
        i = j - 1;
      }
    }
  }
  if (hasContent) count++;
  return count;
}

export function countParagraphs(text) {
  return text.split(/\n\s*\n/).filter((p) => HAS_ALNUM.test(p)).length;
}

function normalizeWord(tok) {
  return tok
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
}

export function topKeywords(words, { limit = 10, ignoreStopWords = true, minCount = 2 } = {}) {
  const freq = new Map();
  for (const tok of words) {
    const w = normalizeWord(tok);
    if (!w || (ignoreStopWords && STOP_WORDS.has(w))) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const total = words.length || 1;
  return [...freq.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count, percent: Math.round((count / total) * 1000) / 10 }));
}

export const READING_WPM = 200;
export const SPEAKING_WPM = 130;

export function analyzeText(input, { ignoreStopWords = true, keywordLimit = 10 } = {}) {
  const text = String(input).replace(/\r\n?/g, '\n');
  const words = tokenizeWords(text);
  return {
    words: words.length,
    characters: countCharacters(text),
    charactersNoSpaces: countCharacters(text.replace(/\s+/g, '')),
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    readingSeconds: Math.round((words.length / READING_WPM) * 60),
    speakingSeconds: Math.round((words.length / SPEAKING_WPM) * 60),
    keywords: topKeywords(words, { limit: keywordLimit, ignoreStopWords }),
  };
}

/* ============================================================
 * Images → PDF (minimal, dependency-free PDF 1.4 writer)
 * ============================================================ */

export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};
export const MAX_PDF_PAGE_POINTS = 14400; // PDF 1.4 viewers support up to 200 inches

/**
 * Read what a PDF needs to know about a JPEG without decoding it:
 * size, number of colour components, bit depth and EXIF orientation (1–8, or null).
 * Returns null if the structure is not a readable JPEG.
 */
export function parseJpegInfo(bytes) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  let orientation = null;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan: no SOF found before pixels
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > n) return null;
    const seg = i + 4;
    if (marker === 0xe1 && len >= 16 && bytes[seg] === 0x45 && bytes[seg + 1] === 0x78 && bytes[seg + 2] === 0x69 && bytes[seg + 3] === 0x66) {
      const t = seg + 6; // TIFF header
      const little = bytes[t] === 0x49;
      const u16 = (o) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
      const u32 = (o) => (little ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      if (ifd + 2 <= seg + len - 2 + 2 && ifd + 2 <= n) {
        const count = u16(ifd);
        for (let k = 0; k < count && ifd + 2 + k * 12 + 12 <= n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) orientation = u16(e + 8);
        }
      }
    }
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (len < 8) return null;
      return {
        precision: bytes[seg],
        height: (bytes[seg + 1] << 8) | bytes[seg + 2],
        width: (bytes[seg + 3] << 8) | bytes[seg + 4],
        components: bytes[seg + 5],
        orientation,
        arithmetic: marker >= 0xc9, // arithmetic coding is not supported by PDF
      };
    }
    i += 2 + len;
  }
  return null;
}

/** Can this JPEG be placed in a PDF byte-for-byte (DCTDecode), or must it be re-encoded first? */
export function jpegCanEmbedDirectly(info) {
  return !!info && info.width > 0 && info.height > 0 && info.precision === 8 && (info.components === 1 || info.components === 3) && !info.arithmetic && (info.orientation === null || info.orientation === 1);
}

/**
 * Work out the page size and where the image sits on it. All values are PDF points (1/72 inch).
 * @param {number} imgW pixels  @param {number} imgH pixels
 * @param {{size?: 'a4'|'letter'|'fit', orientation?: 'auto'|'portrait'|'landscape', margin?: number}} opts
 */
export function layoutPage(imgW, imgH, { size = 'a4', orientation = 'auto', margin = 0 } = {}) {
  let pageW;
  let pageH;
  let w;
  let h;
  if (size === 'fit') {
    // Page hugs the image (96 px = 1 inch), scaled down if it would exceed the PDF page limit.
    let scale = 0.75;
    const longest = Math.max(imgW, imgH) * scale + margin * 2;
    if (longest > MAX_PDF_PAGE_POINTS) scale *= (MAX_PDF_PAGE_POINTS - margin * 2) / (Math.max(imgW, imgH) * scale);
    w = imgW * scale;
    h = imgH * scale;
    pageW = w + margin * 2;
    pageH = h + margin * 2;
  } else {
    const base = PAGE_SIZES[size] || PAGE_SIZES.a4;
    const landscape = orientation === 'landscape' || (orientation === 'auto' && imgW > imgH);
    pageW = landscape ? base.height : base.width;
    pageH = landscape ? base.width : base.height;
    const areaW = pageW - margin * 2;
    const areaH = pageH - margin * 2;
    const scale = Math.min(areaW / imgW, areaH / imgH);
    w = imgW * scale;
    h = imgH * scale;
  }
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

const num = (n) => String(Math.round(n * 100) / 100);

/**
 * Build a PDF as a list of byte chunks (so large files never need to be copied into one big buffer;
 * pass the chunks straight to `new Blob(parts)`).
 * @param {{pageW:number,pageH:number,x:number,y:number,w:number,h:number,
 *          image:{data:Uint8Array,width:number,height:number,components:1|3}}[]} pages
 * @returns {{parts: Uint8Array[], size: number}}
 */
export function buildPdfParts(pages) {
  if (!pages.length) throw new Error('No pages');
  const enc = new TextEncoder();
  const parts = [];
  let size = 0;
  const offsets = [];
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    size += bytes.length;
  };
  const beginObj = (id) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
  };

  // Object numbers: 1 catalog, 2 page tree, 3 info, then (page, content, image) for each page.
  const pageId = (k) => 4 + k * 3;
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + binary marker
  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObj(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, k) => `${pageId(k)} 0 R`).join(' ')}] >>\nendobj\n`);
  beginObj(3);
  push('<< /Producer (Toolora) >>\nendobj\n');

  pages.forEach((p, k) => {
    const id = pageId(k);
    beginObj(id);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.pageW)} ${num(p.pageH)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`);
    const content = `q ${num(p.w)} 0 0 ${num(p.h)} ${num(p.x)} ${num(p.y)} cm /Im0 Do Q\n`;
    beginObj(id + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    beginObj(id + 2);
    const { image } = p;
    push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`);
    push(image.data);
    push('\nendstream\nendobj\n');
  });

  const total = 4 + pages.length * 3;
  const xref = size;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return { parts, size };
}

/** Same as buildPdfParts but returns one Uint8Array (used by tests and small jobs). */
export function buildPdf(pages) {
  const { parts, size } = buildPdfParts(pages);
  const out = new Uint8Array(size);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
