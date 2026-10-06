import test from 'node:test';
import assert from 'node:assert/strict';
import { findIcons, iconType, ICON_MAX } from '../src/icon.js';

test('the icons a page links to: the largest up to 256 px first, then /favicon.ico', () => {
  const html = `<head>
    <link rel="icon" href="assets/site/icon-48.png" sizes="48x48" type="image/png">
    <link rel='icon' href='/assets/site/icon-192.png' sizes='192x192'>
    <link rel="apple-touch-icon" href="https://cdn.example/touch.png">
    <link rel="icon" href="huge.png" sizes="1024x1024">
    <link rel="stylesheet" href="style.css">
    <link data-href="/decoy.png" data-rel="x" href="/assets/site/icon-192.png" rel="icon" sizes="192x192">
    <link rel="icon" href="javascript:alert(1)">
  </head>`;
  assert.deepEqual(findIcons(html, 'https://site.example/calc/'), [
    'https://site.example/assets/site/icon-192.png',
    'https://cdn.example/touch.png',
    'https://site.example/calc/assets/site/icon-48.png',
    'https://site.example/calc/huge.png',
    'https://site.example/favicon.ico',
  ]);
  assert.deepEqual(findIcons('<p>no icons</p>', 'https://site.example/'), ['https://site.example/favicon.ico']);
});

test('an icon is kept only if its bytes say PNG, ICO or JPEG, and it is small', () => {
  assert.equal(iconType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  assert.equal(iconType(new Uint8Array([0, 0, 1, 0, 1, 0])), 'image/x-icon');
  assert.equal(iconType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(iconType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')), null, 'no SVG');
  assert.equal(iconType(new TextEncoder().encode('<!doctype html>')), null, 'a page, not an icon');
  assert.equal(iconType(new Uint8Array(0)), null);
  const big = new Uint8Array(ICON_MAX + 1); big.set([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(iconType(big), null, 'too big');
});
