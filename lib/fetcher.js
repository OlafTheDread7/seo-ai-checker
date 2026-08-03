// Server-side fetching helpers. Doing this on the server (not the browser)
// sidesteps CORS and lets us read response headers, timing, and sibling
// resources like robots.txt / llms.txt.

// A clean, current Chrome identity. IMPORTANT: do not add "compatible", a bot
// name, or "+http…/bot" here — those tokens are exactly what WordPress security
// plugins (Wordfence et al.) and host WAFs block, which made legitimate sites
// look "unscannable" even though a real browser loads them fine. We fetch what a
// normal visitor's browser would see on first load.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Full browser-like header set. Several WAFs also key off the presence of the
// Sec-Fetch-* and Sec-CH-UA hints that every real Chrome navigation sends.
const BROWSER_HEADERS = {
  'User-Agent': UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-CH-UA': '"Google Chrome";v="126", "Chromium";v="126", "Not.A/Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
};

const TIMEOUT_MS = 20000;

// Statuses worth one retry: transient server errors, rate limiting, and 403 —
// some WAFs 403 the first hit from a cold IP but let a second request through.
const RETRY_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL with a timeout, a real-browser identity, and one automatic retry
 * on transient failures. Returns a normalized object even on network failure
 * (ok: false) so callers never have to try/catch.
 */
export async function fetchUrl(url, { method = 'GET', attempts = 2 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: BROWSER_HEADERS,
      });

      const elapsedMs = Date.now() - started;
      const contentType = res.headers.get('content-type') || '';
      const body = method === 'HEAD' ? '' : await res.text();

      last = {
        ok: true,
        status: res.status,
        finalUrl: res.url || url,
        redirected: res.redirected,
        contentType,
        headers: res.headers,
        body,
        elapsedMs,
      };

      // Retry once on a transient/blocking status, then return whatever we got.
      if (RETRY_STATUSES.has(res.status) && i < attempts - 1) {
        await sleep(500 * (i + 1));
        continue;
      }
      return last;
    } catch (err) {
      last = {
        ok: false,
        error: err.name === 'AbortError' ? 'Request timed out' : err.message,
        elapsedMs: Date.now() - started,
      };
      if (i < attempts - 1) {
        await sleep(500 * (i + 1));
        continue;
      }
      return last;
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

/** Normalize user input into a valid absolute http(s) URL. Throws on garbage. */
export function normalizeUrl(input) {
  if (!input || typeof input !== 'string') throw new Error('No URL provided');
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  const u = new URL(raw); // throws if invalid
  if (!/^https?:$/.test(u.protocol)) {
    throw new Error('Only http and https URLs are supported');
  }
  return u;
}
