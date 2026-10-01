import test from 'node:test';
import assert from 'node:assert/strict';
import { isBot, parseUA } from '../src/ua.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const EDGE_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

test('browser and OS families', () => {
  assert.deepEqual(parseUA(CHROME_WIN), { browser: 'Chrome', os: 'Windows' });
  assert.deepEqual(parseUA(SAFARI_IOS), { browser: 'Safari', os: 'iOS' });
  assert.deepEqual(parseUA(FIREFOX_LINUX), { browser: 'Firefox', os: 'Linux' });
  assert.deepEqual(parseUA(EDGE_MAC), { browser: 'Edge', os: 'macOS' });
  assert.deepEqual(parseUA(CHROME_ANDROID), { browser: 'Chrome', os: 'Android' });
  assert.deepEqual(parseUA(''), { browser: null, os: null });
});

test('bots', () => {
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36'), true);
  assert.equal(isBot('curl/8.5.0'), true);
  assert.equal(isBot(''), true);
  assert.equal(isBot(CHROME_WIN), false);
  assert.equal(isBot(SAFARI_IOS), false);
});
