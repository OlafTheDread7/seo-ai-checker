// Server-side fetching helpers. Doing this on the server (not the browser)
// sidesteps CORS and lets us read response headers, timing, and sibling
// resources like robots.txt / llms.txt.

const UA =
  'Mozilla/5.0 (compatible; SEO-AI-Checker/1.0; +https://example.com/bot) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TIMEOUT_MS = 15000;

/**
 * Fetch a URL with a timeout and a browser-like User-Agent.
 * Returns a normalized object even on network failure (ok: false).
 */
export async function fetchUrl(url, { method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const elapsedMs = Date.now() - started;
    const contentType = res.headers.get('content-type') || '';
    const body = method === 'HEAD' ? '' : await res.text();

    return {
      ok: true,
      status: res.status,
      finalUrl: res.url || url,
      redirected: res.redirected,
      contentType,
      headers: res.headers,
      body,
      elapsedMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'Request timed out' : err.message,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
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
