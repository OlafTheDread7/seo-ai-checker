// Server-side fetching helpers. Doing this on the server (not the browser)
// sidesteps CORS and lets us read response headers, timing, and sibling
// resources like robots.txt / llms.txt.
//
// SSRF guard: this is a public tool that fetches any URL a visitor types, so
// every fetch here (the page, robots.txt/llms.txt/sitemap.xml, crawled pages,
// Sitemap: refs from robots.txt, and every redirect hop) may only reach public
// internet addresses. Three layers:
//   1. assertPublicUrl(): http/https only, normal web ports, no localhost-style
//      names, and IP-literal hosts must be public.
//   2. The connection's DNS lookup (guardedLookup) refuses any hostname that
//      resolves to a private/reserved address. It runs at connect time, so a
//      hostname can't pass a check and then rebind to an internal address.
//   3. Redirects are followed by hand (max 5), and each hop goes through 1 and 2.

import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch } from 'undici';

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
const MAX_REDIRECTS = 5;

// Statuses worth one retry: transient server errors, rate limiting, and 403 —
// some WAFs 403 the first hit from a cold IP but let a second request through.
const RETRY_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

const BLOCKED_MSG = "That address isn't on the public internet, so it can't be scanned.";

// Ports a public website can sensibly be on. Everything else is refused.
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

// Hostnames that never point at the public internet.
const BLOCKED_NAMES = /^(localhost|metadata|metadata\.google\.internal)$|\.(localhost|local|internal|lan|intranet|home\.arpa)$/i;

// Private, loopback, link-local (incl. cloud metadata 169.254.169.254),
// carrier-grade NAT, documentation, benchmarking, multicast and reserved ranges.
const blockList = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockList.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
]) blockList.addSubnet(addr, prefix, 'ipv6');

/** True only for addresses on the public internet. */
export function isPublicAddress(address) {
  if (typeof address !== 'string') return false;
  let ip = address.replace(/^\[|\]$/g, '').split('%')[0];
  const type = net.isIP(ip);
  if (!type) return false;
  if (type === 6) {
    // IPv4-mapped / -compatible IPv6 (::ffff:10.0.0.1, ::ffff:a00:1): judge the IPv4 inside.
    const lower = ip.toLowerCase();
    const dotted = lower.match(/^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPublicAddress(dotted[1]);
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^::ffff:/.test(lower)) return false;
    return !blockList.check(ip, 'ipv6');
  }
  return !blockList.check(ip, 'ipv4');
}

class BlockedAddressError extends Error {
  constructor(detail) {
    super(BLOCKED_MSG);
    this.code = 'EBLOCKED';
    this.detail = detail;
  }
}

/** Throws BlockedAddressError unless the URL can only point at the public web. */
export function assertPublicUrl(input) {
  const u = input instanceof URL ? input : new URL(input);
  if (!/^https?:$/.test(u.protocol)) throw new BlockedAddressError(`protocol ${u.protocol}`);
  if (u.username || u.password) throw new BlockedAddressError('credentials in URL');
  if (!ALLOWED_PORTS.has(u.port)) throw new BlockedAddressError(`port ${u.port}`);
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || BLOCKED_NAMES.test(host)) throw new BlockedAddressError(`host ${host}`);
  if (net.isIP(host) && !isPublicAddress(host)) throw new BlockedAddressError(`address ${host}`);
  // Hostnames written as a bare number or hex (http://2130706433/) resolve to IPs.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) throw new BlockedAddressError(`numeric host ${host}`);
  return u;
}

// DNS lookup used for every outbound connection: resolves, then refuses the
// connection if ANY address for the name is private or reserved.
function guardedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length) {
      const e = new Error(`No address found for ${hostname}`);
      e.code = 'ENOTFOUND';
      return callback(e);
    }
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad) return callback(new BlockedAddressError(`${hostname} -> ${bad.address}`));
    let list = addresses;
    if (options && (options.family === 4 || options.family === 6)) {
      list = addresses.filter((a) => a.family === options.family);
      if (!list.length) {
        const e = new Error(`No IPv${options.family} address for ${hostname}`);
        e.code = 'ENOTFOUND';
        return callback(e);
      }
    }
    if (options && options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const dispatcher = new Agent({ connect: { lookup: guardedLookup } });

function blockedFrom(err) {
  for (let e = err, i = 0; e && i < 5; e = e.cause, i++) {
    if (e.code === 'EBLOCKED') return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

// One request, following redirects by hand so every hop is checked.
async function fetchOnce(url, method, signal) {
  let current = assertPublicUrl(url);
  let redirected = false;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current.href, {
      method,
      redirect: 'manual',
      signal,
      headers: BROWSER_HEADERS,
      dispatcher,
    });
    const location = res.headers.get('location');
    if (REDIRECT_STATUSES.has(res.status) && location) {
      if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      current = assertPublicUrl(new URL(location, current));
      redirected = true;
      if (res.status === 303 && method !== 'HEAD') method = 'GET';
      continue;
    }
    return { res, finalUrl: current.href, redirected };
  }
}

/**
 * Fetch a URL with a timeout, a real-browser identity, and one automatic retry
 * on transient failures. Returns a normalized object even on network failure
 * (ok: false) so callers never have to try/catch. Addresses that aren't on the
 * public internet come back as ok: false with blocked: true, and aren't retried.
 */
export async function fetchUrl(url, { method = 'GET', attempts = 2 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();
    try {
      const { res, finalUrl, redirected } = await fetchOnce(url, method, controller.signal);

      const elapsedMs = Date.now() - started;
      const contentType = res.headers.get('content-type') || '';
      const body = method === 'HEAD' ? '' : await res.text();

      last = {
        ok: true,
        status: res.status,
        finalUrl: finalUrl || url,
        redirected,
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
      const blocked = blockedFrom(err);
      if (blocked) {
        return { ok: false, blocked: true, error: BLOCKED_MSG, elapsedMs: Date.now() - started };
      }
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
  try {
    assertPublicUrl(u);
  } catch (err) {
    if (err.code === 'EBLOCKED') throw new Error(BLOCKED_MSG);
    throw err;
  }
  return u;
}
