/* A User-Agent → { browser, os } reader, and the bot filter. Only families: the dashboard shows
   "Chrome", not "Chrome 129". Nothing of the UA string itself is ever stored. */

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|fetch|scrape|curl\/|wget\/|python-|java\/|go-http|okhttp|facebookexternalhit|whatsapp|telegrambot|discordbot|phantomjs|prerender|yandex|baidu|bingpreview|ahrefs|semrush|mj12|dotbot|petalbot/i;

export function isBot(ua) {
  if (!ua) return true;
  return BOT.test(ua);
}

const BROWSERS = [
  ['Edge', /\bEdg(e|A|iOS)?\//],
  ['Opera', /\bOPR\/|\bOpera\b/],
  ['Samsung Internet', /\bSamsungBrowser\//],
  ['Firefox', /\bFirefox\/|\bFxiOS\//],
  ['Chrome', /\bChrome\/|\bCriOS\//],
  ['Safari', /\bSafari\//],   // after Chrome: Chrome's UA also says Safari
];

const SYSTEMS = [
  ['iOS', /\b(iPhone|iPad|iPod)\b/],
  ['Android', /\bAndroid\b/],
  ['Windows', /\bWindows\b/],
  ['macOS', /\bMacintosh\b|\bMac OS X\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['Linux', /\bLinux\b|\bX11\b/],
];

export function parseUA(ua) {
  ua = ua || '';
  let browser = null, os = null;
  for (const [name, re] of BROWSERS) if (re.test(ua)) { browser = name; break; }
  for (const [name, re] of SYSTEMS) if (re.test(ua)) { os = name; break; }
  return { browser, os };
}
