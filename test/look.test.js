import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readHints, aiRequest, aiAnswer, aiLook, validPalette, schema, MODEL } from '../src/look.js';
import { STYLES, PIECES, imageType } from '../src/icon.js';

const palette = { tints: ['#8fb8ff', '#ff8d6b', '#b9a8ff', '#7fe0b0', '#ffd36b', '#ff9ed0', '#a6e36f', '#9ad6ff'],
  roofs: { alpine: '#6a3f2a', stone: '#3b4356', citadel: '#a33a2a', umbra: '#1c2030' } };

test('a page head says how it looks', () => {
  const html = `<!doctype html><html lang="es" style="color-scheme: dark"><head>
    <title>Hallownest Calculator &amp; Planner</title>
    <meta name="description" content="Charms, damage and the 112 % checklist for Hollow Knight.">
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#07090e">
    <meta property="og:image" content="/assets/og.png"></head>`;
  assert.deepEqual(readHints(html, 'https://hallownestcalculator.com/'), {
    title: 'Hallownest Calculator & Planner', description: 'Charms, damage and the 112 % checklist for Hollow Knight.', lang: 'es',
    themeColor: '#07090e', scheme: 'dark', ogImage: 'https://hallownestcalculator.com/assets/og.png' });
  assert.deepEqual(readHints('', 'https://x.example/'), { title: '', description: '', lang: '', themeColor: null, scheme: '', ogImage: null });
  assert.equal(readHints('<meta property="og:image" content="javascript:alert(1)">', 'https://x.example/').ogImage, null);
});

test('the palette from the dashboard is eight colours and a roof per kit, or nothing', () => {
  assert.deepEqual(validPalette(palette), palette);
  assert.equal(validPalette({ ...palette, tints: palette.tints.slice(1) }), null);
  assert.equal(validPalette({ ...palette, roofs: { ...palette.roofs, umbra: 'black' } }), null);
  assert.equal(validPalette(null), null);
});

test('an og:image is looked at only as PNG, JPEG, GIF or WebP, and small', () => {
  assert.equal(imageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 100), 'image/gif');
  assert.equal(imageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 100), 'image/webp');
  assert.equal(imageType(new TextEncoder().encode('<svg/>'), 100), null);
  assert.equal(imageType(new Uint8Array(200).fill(0xff), 100), null);
});

const site = { hints: { title: 'Hallownest', description: '', lang: 'en', themeColor: '#07090e', scheme: 'dark', ogImage: null },
  icon: { type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, ogImage: null, palette };

test('the request to Claude: the model, structured output, the default fallback, the icon and the hints', () => {
  const req = aiRequest(site);
  assert.equal(req.model, MODEL);
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.effort, 'low');
  assert.deepEqual(req.output_config.format, { type: 'json_schema', schema: schema() });
  assert.ok(!('thinking' in req), 'adaptive by default on this model');
  const s = schema();
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.style.enum, STYLES);
  assert.deepEqual(s.properties.pieces.required, Object.keys(PIECES));
  const [label, img, text] = req.messages[0].content;
  assert.equal(label.type, 'text');
  assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } });
  assert.match(text.text, /theme colour: #07090e/);
  assert.match(text.text, /umbra #1c2030/);
  /* an ICO icon is not sent as an image */
  assert.ok(!aiRequest({ ...site, icon: { type: 'image/x-icon', bytes: new Uint8Array(4) } }).messages[0].content.some(b => b.type === 'image'));
});

const answer = (obj, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }], ...extra });
const good = { style: 'umbra', hue: 380, shade: -10, tint: 3, pieces: { spire: 'kit', wall: 'iron', roofs: 'kit', shade: 'deep', motes: 'kit' }, why: 'Dark theme and a gothic game.' };

test('Claude’s answer becomes a look, or nothing', () => {
  assert.deepEqual(aiAnswer(answer(good)), { look: { style: 'umbra', hue: 20, shade: -10, tint: 3, pieces: { wall: 'iron', shade: 'deep' } }, why: 'Dark theme and a gothic game.' });
  assert.equal(aiAnswer(answer(good, { stop_reason: 'refusal' })), null, 'declined');
  assert.equal(aiAnswer({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{nope' }] }), null, 'not JSON');
  assert.equal(aiAnswer(answer({ ...good, style: 'gothic' })), null);
  assert.equal(aiAnswer(answer({ ...good, shade: 90 })), null);
  assert.equal(aiAnswer(answer({ ...good, tint: 0 })), null);
  assert.equal(aiAnswer(answer({ ...good, pieces: { ...good.pieces, wall: 'moat' } })), null);
});

test('aiLook: nothing without a key; the headers; errors become a short reason', async () => {
  let calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(answer(good)), { status: 200 }); };
  assert.deepEqual(await aiLook(fetchFn, '', site), {});
  assert.equal(calls.length, 0);
  const got = await aiLook(fetchFn, 'sk-test', site);
  assert.equal(got.ai.look.style, 'umbra');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-test');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const bad = async () => new Response(JSON.stringify({ type: 'error', error: { message: 'invalid x-api-key' } }), { status: 401 });
  assert.deepEqual(await aiLook(bad, 'sk-test', site), { aiError: 'invalid x-api-key' });
  const down = async () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await aiLook(down, 'sk-test', site), { aiError: 'not reached' });
  const refused = async () => new Response(JSON.stringify(answer(good, { stop_reason: 'refusal' })), { status: 200 });
  assert.deepEqual(await aiLook(refused, 'sk-test', site), { aiError: 'declined' });
});

/* public/look.js, the colour rules, run with a window of its own. */
const win = {};
vm.runInNewContext(readFileSync(new URL('../public/look.js', import.meta.url), 'utf8'), { window: win });
const { iconStats, suggestLook } = win.FootwornLook;
function px(colors) { const a = []; colors.forEach(([r, g, b, al = 255, n = 1]) => { for (let i = 0; i < n; i++) a.push(r, g, b, al); }); return new Uint8ClampedArray(a); }

test('an icon’s pixels: lightness, dark share, the hue it leans to; transparent pixels are not the icon', () => {
  const s = iconStats(px([[230, 120, 30, 255, 60], [20, 20, 20, 255, 40], [0, 0, 255, 0, 500]]));
  assert.ok(Math.abs(s.dark - .4) < 1e-9);
  assert.ok(s.hue > 20 && s.hue < 35, 'orange');
  assert.ok(Math.abs(s.colorful - .6) < 1e-9);
  assert.equal(iconStats(px([[0, 0, 0, 0, 10]])), null);
});

test('the colour rules: Hallownest is umbra, a warm site citadel, a grey one stone, none alpine', () => {
  const hk = suggestLook({ themeColor: '#07090e', scheme: '' }, iconStats(px([[15, 15, 20, 255, 80], [230, 230, 235, 255, 20]])), palette);
  assert.equal(hk.style, 'umbra');
  assert.equal(hk.shade, 0, 'umbra keeps its own dark');
  assert.match(hk.why, /near black \(#07090e\)/);
  const warm = suggestLook({ themeColor: '#e8631c' }, null, palette);
  assert.equal(warm.style, 'citadel');
  assert.equal(warm.tint, 2, 'the orange of the eight');
  const grey = suggestLook({ themeColor: '#9aa0a6' }, null, palette);
  assert.deepEqual([grey.style, grey.hue, grey.tint], ['stone', 0, null]);
  const green = suggestLook({}, iconStats(px([[60, 180, 70, 255, 50]])), palette);
  assert.equal(green.style, 'alpine');
  assert.ok(green.hue > 0, 'turned towards green');
  assert.equal(green.tint, 4, 'the nearest green of the eight');
  assert.deepEqual({ ...suggestLook({}, null, palette) }, { style: 'alpine', hue: 0, shade: 0, tint: null, pieces: null, why: 'Nothing marked in its colours: alpine, as it is.' });
  assert.equal(suggestLook({ scheme: 'dark' }, null, palette).style, 'umbra');
  assert.equal(suggestLook({ scheme: 'light dark' }, null, palette).style, 'alpine', 'both schemes: not a dark site');
});

test('Claude is told what every piece option looks like', async () => {
  const { PIECE_TEXT } = await import('../src/look.js');
  for (const k of Object.keys(PIECES)) for (const v of PIECES[k]) assert.ok(PIECE_TEXT[k] && PIECE_TEXT[k][v], `${k}: ${v}`);
  assert.match(aiRequest(site).system, /- wall: palisade \(alpine\), rampart \(stone\)/);
});

test('the village builds every piece option the server accepts', () => {
  const src = readFileSync(new URL('../public/village.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('var PIECES = {'), src.indexOf('function kitOf('));
  for (const k of Object.keys(PIECES)) for (const v of PIECES[k]) assert.match(block, new RegExp(`${k}: \\{[^\\n]*\\b${v}: \\{|\\b${v}: \\{`), `${k}: ${v}`);
});
