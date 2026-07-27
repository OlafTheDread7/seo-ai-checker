// Whole-site discovery + scanning.
//
// Pages are discovered two ways and merged:
//   1. The XML sitemap (and sitemap-index children), if present.
//   2. Following same-origin <a href> links from each page we fetch.
//
// Everything is bounded by maxPages and a same-origin rule, and processed in
// concurrency-sized batches (breadth-first) so newly discovered links get
// scanned in later batches.

import * as cheerio from 'cheerio';
import { fetchUrl } from './fetcher.js';
import { analyze, fetchAllResources } from './analyze.js';

const SKIP_EXT =
  /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|rss|zip|gz|tar|mp4|webm|mp3|wav|woff2?|ttf|eot|dmg|exe)$/i;

// Normalize a candidate URL for crawling: same-origin only, drop the hash, and
// skip obvious non-HTML assets. We deliberately keep the path exactly as-is
// (trailing slashes and query strings included) because many sites serve
// directory-style URLs like /page/2/ and 404 without the slash, and paginate
// via ?page=. Dedup happens on the full href; maxPages bounds the total.
function normalize(candidate, base, origin) {
  try {
    const url = new URL(candidate, base);
    if (url.origin !== origin) return null;
    if (!/^https?:$/.test(url.protocol)) return null;
    if (SKIP_EXT.test(url.pathname)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function locsFrom(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

// Collect URLs from the sitemap (handling a sitemap index that points at child
// sitemaps) plus any Sitemap: entries in robots.txt. Bounded and best-effort.
async function sitemapUrls(resources, origin) {
  const urls = new Set();
  const candidates = [];

  if (resources.sitemap?.ok && resources.sitemap.status === 200) {
    candidates.push(resources.sitemap.body);
  }
  if (resources.robotsTxt?.ok && resources.robotsTxt.status === 200) {
    const refs = [...resources.robotsTxt.body.matchAll(/^\s*sitemap:\s*(.+)$/gim)]
      .map((m) => m[1].trim())
      .slice(0, 3);
    for (const ref of refs) {
      const r = await fetchUrl(ref);
      if (r.ok && r.status === 200) candidates.push(r.body);
    }
  }

  const childSitemaps = [];
  for (const xml of candidates) {
    if (/<sitemapindex/i.test(xml)) childSitemaps.push(...locsFrom(xml).slice(0, 5));
    else locsFrom(xml).forEach((u) => urls.add(u));
  }
  for (const child of childSitemaps.slice(0, 5)) {
    const r = await fetchUrl(child);
    if (r.ok && r.status === 200) locsFrom(r.body).forEach((u) => urls.add(u));
  }

  return [...urls].filter((u) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * Crawl and scan a whole site.
 * @param {object} opts
 * @param {string} opts.startUrl
 * @param {number} [opts.maxPages=25]
 * @param {number} [opts.concurrency=5]
 * @param {(p:{done:number,total:number,url:string})=>void} [opts.onProgress]
 * @returns {Promise<{pageReports:Array, origin:string, startUrl:string}>}
 */
export async function crawlAndScan({
  startUrl,
  maxPages = 25,
  concurrency = 5,
  onProgress,
}) {
  const start = new URL(startUrl);
  const origin = start.origin;
  const resources = await fetchAllResources(origin);

  const seen = new Set();
  const queue = [];
  const enqueue = (candidate, base = origin) => {
    const norm = normalize(candidate, base, origin);
    if (norm && !seen.has(norm) && seen.size < maxPages) {
      seen.add(norm);
      queue.push(norm);
    }
  };

  enqueue(start.href);
  for (const loc of await sitemapUrls(resources, origin)) enqueue(loc);

  const pageReports = [];
  let done = 0;

  while (queue.length && done < maxPages) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(
      batch.map(async (pageUrl) => {
        const page = await fetchUrl(pageUrl);
        done++;
        if (
          page.ok &&
          page.status < 400 &&
          /text\/html/i.test(page.contentType || '')
        ) {
          try {
            const finalUrl = new URL(page.finalUrl);
            if (finalUrl.origin === origin) {
              const report = await analyze(finalUrl, page, resources);
              pageReports.push({ url: finalUrl.href, report });
              // Discover more internal links from this page.
              const $ = cheerio.load(page.body);
              $('a[href]').each((_, el) => enqueue($(el).attr('href'), finalUrl.href));
            }
          } catch {
            /* skip pages that fail to parse */
          }
        }
        if (onProgress) onProgress({ done, total: seen.size, url: pageUrl });
      })
    );
  }

  // Sort reports by URL so the output order is stable.
  pageReports.sort((a, b) => a.url.localeCompare(b.url));
  return { pageReports, origin, startUrl: start.href };
}
