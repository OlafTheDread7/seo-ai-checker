// Competitor discovery.
//
// There's no keyless "give me this site's competitors" API, so we approximate
// the way a human would: figure out what the site is about (its topic keywords),
// search the web for that topic, and treat the other domains ranking for it as
// the competition. Search uses DuckDuckGo's HTML endpoint (no API key needed).
//
// This is a heuristic — good enough to benchmark against, not a definitive
// competitive-intelligence dataset.

import * as cheerio from 'cheerio';
import { fetchUrl } from './fetcher.js';

// Big platforms that show up for almost any query but aren't "the competition".
const DENYLIST = new Set([
  'wikipedia.org', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'linkedin.com', 'reddit.com', 'amazon.com', 'ebay.com',
  'pinterest.com', 'yelp.com', 'tripadvisor.com', 'apple.com', 'google.com',
  'bing.com', 'microsoft.com', 'github.com', 'medium.com', 'quora.com',
  'tiktok.com', 'wordpress.com', 'wordpress.org', 'blogspot.com', 'yahoo.com',
  'etsy.com', 'walmart.com', 'target.com', 'fandom.com', 'stackoverflow.com',
  'duckduckgo.com', 'archive.org', 'forbes.com', 'nytimes.com',
  // Dictionaries / reference — show up when a query word gets read as a term.
  'merriam-webster.com', 'cambridge.org', 'dictionary.com', 'thefreedictionary.com',
  'collinsdictionary.com', 'vocabulary.com', 'britannica.com', 'wiktionary.org',
]);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'our', 'with', 'from', 'that', 'this',
  'are', 'was', 'have', 'has', 'will', 'can', 'all', 'any', 'get', 'more',
  'best', 'top', 'new', 'now', 'home', 'welcome', 'official', 'site', 'website',
  'inc', 'llc', 'ltd', 'co', 'com', 'we', 'us', 'to', 'of', 'in', 'on', 'at',
  'by', 'is', 'it', 'or', 'an', 'a', 'shop', 'store', 'online', 'buy',
  'made', 'products', 'product', 'collection', 'collections', 'free',
  'shipping', 'quality', 'sale', 'discount', 'price', 'prices',
  'genuine', 'premium', 'authentic', 'luxury', 'custom', 'personalized',
  'great', 'trusted', 'leading', 'exclusive', 'affordable', 'handcrafted',
  'fine', 'quality', 'unique', 'beautiful', 'perfect', 'essential',
]);

// Registrable domain (last two labels). A simple heuristic — good enough for
// grouping and dedup; not perfect for multi-part TLDs like .co.uk.
export function registrableDomain(hostname) {
  const parts = hostname.replace(/^www\./, '').toLowerCase().split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

// Build a topic search query from the homepage, stripping the brand name and
// stopwords so we search the niche, not the company itself.
export function buildQuery(html, targetUrl) {
  const $ = cheerio.load(html || '');
  const title = ($('head > title').first().text() || '').trim();
  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  const h1 = ($('h1').first().text() || '').trim();

  const domainToken = registrableDomain(targetUrl.hostname).split('.')[0].toLowerCase();
  const collapse = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wordsOf = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []);

  // Titles are usually "Brand | Category" (in either order). Split on
  // separators and drop the segment that is the brand — identified because its
  // collapsed form contains (or is contained by) the domain name, e.g.
  // "Holtz Leather Co" → "holtzleatherco" ⊇ "holtzleather".
  const segments = title.split(/[|\-–—:·•>]+/).map((s) => s.trim()).filter(Boolean);
  const isBrandSeg = (s) => {
    const c = collapse(s);
    return c.length > 2 && (c.includes(domainToken) || (c.length > 3 && domainToken.includes(c)));
  };
  const brandSegs = segments.filter(isBrandSeg);
  const topicSegs = segments.filter((s) => !isBrandSeg(s));

  // Brand words to exclude, but keep any that double as product words (a word
  // that also appears in a non-brand segment, like "leather" in "Galen Leather"
  // vs "Handmade Leather Goods").
  const brand = new Set([domainToken]);
  const topicWords = new Set(topicSegs.flatMap(wordsOf));
  brandSegs.flatMap(wordsOf).forEach((w) => {
    if (!topicWords.has(w)) brand.add(w);
  });

  // Prefer the title's category segment; fall back to h1/description.
  const source = [(topicSegs.length ? topicSegs : segments).join(' '), h1, desc]
    .filter(Boolean)
    .join(' ');
  const seen = new Set();
  const keywords = [];
  for (const tok of source.toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (tok.length < 3) continue;
    if (/^\d+$/.test(tok)) continue; // drop bare numbers like "100"
    if (STOPWORDS.has(tok) || brand.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    keywords.push(tok);
    if (keywords.length >= 6) break;
  }

  // Fall back to the title (minus brand) if we couldn't extract keywords.
  if (keywords.length < 2) {
    return (title || h1 || desc).replace(/[|\-–—:].*$/, '').trim().slice(0, 80);
  }
  return keywords.join(' ');
}

// DuckDuckGo wraps results in a redirect link carrying the real URL in a
// `uddg=` param. Pull that out regardless of whether the href is absolute,
// protocol-relative, or root-relative (the Lite endpoint uses the last form).
function decodeDuckLink(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  let u = href.startsWith('//') ? 'https:' + href : href;
  try {
    const url = new URL(u);
    return url.hostname.endsWith('duckduckgo.com') ? null : url.href;
  } catch {
    return null;
  }
}

async function fetchProvider(endpoint, query) {
  const res = await fetchUrl(endpoint + encodeURIComponent(query));
  // DDG returns 202 (no body results) when it rate-limits automated requests.
  if (!res.ok || res.status !== 200) return [];
  const out = [];
  for (const m of res.body.matchAll(/href="([^"]*uddg=[^"]+)"/g)) {
    const real = decodeDuckLink(m[1].replace(/&amp;/g, '&'));
    if (real) out.push(real);
  }
  return out;
}

// Bing wraps result links in a redirect: bing.com/ck/a?...&u=a1<base64url>.
function decodeBingLink(u) {
  let b = u.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  try {
    const s = Buffer.from(b, 'base64').toString('utf8');
    return /^https?:\/\//.test(s) ? s : null; // nav links decode to relative paths
  } catch {
    return null;
  }
}

async function bingSearch(query) {
  const res = await fetchUrl(
    'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=20&setlang=en'
  );
  if (!res.ok || res.status !== 200) return [];
  const out = [];
  // Only organic result title links carry class "tilk" — this skips Bing's
  // knowledge panels, definitions, "related searches" and ad blocks.
  for (const m of res.body.matchAll(/<a[^>]+class="[^"]*tilk[^"]*"[^>]*href="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, '&');
    const um = href.match(/[?&]u=(a1[^&]+)/);
    const real = um ? decodeBingLink(um[1]) : null;
    if (real) out.push(real);
  }
  return out;
}

// Search for a topic and return organic result URLs. Tries DuckDuckGo's Lite
// endpoint first (most tolerant of automated requests), then its HTML endpoint,
// then Bing — so a rate-limit on one source doesn't sink the feature.
export async function searchWeb(query) {
  const clean = (links) =>
    links.filter((u) => {
      try {
        const h = new URL(u).hostname;
        return !h.endsWith('duckduckgo.com') && !h.endsWith('bing.com');
      } catch {
        return false;
      }
    });

  const providers = [
    () => fetchProvider('https://lite.duckduckgo.com/lite/?q=', query),
    () => fetchProvider('https://html.duckduckgo.com/html/?q=', query),
    () => bingSearch(query),
  ];
  for (const run of providers) {
    const out = clean(await run());
    if (out.length) return out;
  }
  return [];
}

/**
 * Discover competitor homepages for a target site.
 * @returns {Promise<{query:string, competitors:string[]}>} competitor origins
 */
export async function discoverCompetitors(targetUrl, homepageHtml, maxCompetitors = 3) {
  const query = buildQuery(homepageHtml, targetUrl);
  const results = await searchWeb(query);

  const targetReg = registrableDomain(targetUrl.hostname);
  const seen = new Set();
  const competitors = [];

  for (const url of results) {
    let origin, reg;
    try {
      const u = new URL(url);
      origin = u.origin;
      reg = registrableDomain(u.hostname);
    } catch {
      continue;
    }
    if (reg === targetReg) continue;
    if (DENYLIST.has(reg)) continue;
    if (seen.has(reg)) continue;
    seen.add(reg);
    competitors.push(origin);
    if (competitors.length >= maxCompetitors) break;
  }

  return { query, competitors };
}
