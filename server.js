import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchUrl, normalizeUrl } from './lib/fetcher.js';
import { analyze, aggregateSite } from './lib/analyze.js';
import { crawlAndScan } from './lib/crawl.js';
import { discoverCompetitors } from './lib/competitors.js';
import { runAiCitation } from './lib/ai-citation.js';

const MAX_PAGES = 25;

// Analyze a single URL's homepage; returns { url, report } or throws.
async function scanOne(rawUrl) {
  const target = normalizeUrl(rawUrl);
  const page = await fetchUrl(target.href);
  if (!page.ok || page.status >= 400 || !/text\/html/i.test(page.contentType || '')) {
    throw new Error(`Could not analyze ${target.href}`);
  }
  const finalUrl = new URL(page.finalUrl);
  const report = await analyze(finalUrl, page);
  return { url: finalUrl.href, report, html: page.body };
}

// Turn a failed/empty whole-site crawl into a specific, honest reason using how
// the entered URL itself responded to our scanner.
function emptyScanReason(target, startFetch) {
  const host = target.hostname;
  if (!startFetch) {
    return 'No scannable HTML pages found at that address. Check the URL and try again.';
  }
  if (!startFetch.ok) {
    return `Could not reach ${host}: ${startFetch.error}. The site may be down, too slow, or blocking automated requests.`;
  }
  if (startFetch.status >= 400) {
    return `${host} returned HTTP ${startFetch.status} to the scanner — the site is likely blocking automated requests (a firewall or bot protection). It may still load fine for regular visitors.`;
  }
  if (!/text\/html/i.test(startFetch.contentType || '')) {
    return `${host} returned "${startFetch.contentType || 'unknown content'}", not an HTML page, so there was nothing to scan.`;
  }
  return 'No scannable HTML pages found at that address. Check the URL and try again.';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// PUBLIC_MODE turns on lead-gating, rate limiting, and the hire-us CTA for the
// public deployment. Left off, the tool runs fully open for internal use.
const PUBLIC_MODE = /^(1|true|yes)$/i.test(process.env.PUBLIC_MODE || '');
const WEB3FORMS_KEY = process.env.WEB3FORMS_KEY || '';

// AI-citation check requires a Perplexity API key. When unset, the feature is
// simply hidden in the UI and the endpoint returns a clear "not configured".
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || 'perplexity/sonar';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Lightweight in-memory rate limiter (per IP, sliding window). Protects server
// cost and discourages abuse on the public instance. No external dependency.
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    if (!PUBLIC_MODE) return next();
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
      .toString().split(',')[0].trim();
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retry = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.setHeader('Retry-After', retry);
      return res.status(429).json({
        error: `You've reached the free scan limit. Try again in ${Math.ceil(retry / 60)} minute(s), or contact RVA Digital Works for a full audit.`,
      });
    }
    arr.push(now);
    hits.set(ip, arr);
    // opportunistic cleanup
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}

const scanLimiter = rateLimiter({ windowMs: 60 * 60 * 1000, max: 10 }); // 10 single scans/hr
const heavyLimiter = rateLimiter({ windowMs: 60 * 60 * 1000, max: 4 }); // 4 site/competitor scans/hr

// Expose runtime config to the frontend. In public mode we also hand the
// Web3Forms key to the browser, because Web3Forms only accepts submissions
// client-side (server-side POSTs are blocked on the free plan). The key is a
// public form key by design — safe to expose.
app.get('/api/config', (req, res) => {
  res.json({
    publicMode: PUBLIC_MODE,
    web3formsKey: PUBLIC_MODE ? WEB3FORMS_KEY : '',
    // The AI-visibility check spends Perplexity credits, so it's internal-only:
    // available when a key is set AND we're not in public mode. On the public
    // (Railway) instance this is false, so the UI hides the button.
    aiCitation: !!PERPLEXITY_API_KEY && !PUBLIC_MODE,
  });
});

// Lightweight server-side log of captured leads (the actual email is sent from
// the browser via Web3Forms). Gives visibility in the Railway logs.
app.post('/api/lead', (req, res) => {
  const { email, url, scanType } = req.body || {};
  if (email) console.log('[lead]', email, '· scanned', url || '?', '·', scanType || 'single');
  res.json({ ok: true });
});

app.post('/api/scan', scanLimiter, async (req, res) => {
  let target;
  try {
    target = normalizeUrl(req.body?.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const page = await fetchUrl(target.href);
  if (!page.ok) {
    return res
      .status(502)
      .json({ error: `Could not reach the site: ${page.error}` });
  }
  if (page.status >= 400) {
    return res.status(502).json({
      error: `The site returned HTTP ${page.status}. Check the URL and try again.`,
    });
  }
  if (!/text\/html/i.test(page.contentType)) {
    return res.status(415).json({
      error: `That URL returned "${page.contentType || 'unknown content'}", not an HTML page.`,
    });
  }

  try {
    const finalUrl = new URL(page.finalUrl);
    const report = await analyze(finalUrl, page);
    res.json(report);
  } catch (err) {
    console.error('Analysis failed:', err);
    res.status(500).json({ error: 'Analysis failed unexpectedly.' });
  }
});

// Whole-site scan. Streams progress via Server-Sent Events so the UI can show
// "Scanning 7 of 24…" and then a final aggregated report.
app.get('/api/scan-site', heavyLimiter, async (req, res) => {
  let target;
  try {
    target = normalizeUrl(req.query.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const { pageReports, origin, startUrl, startFetch } = await crawlAndScan({
      startUrl: target.href,
      maxPages: MAX_PAGES,
      concurrency: 5,
      onProgress: (p) => send('progress', p),
    });

    if (!pageReports.length) {
      send('failed', { error: emptyScanReason(target, startFetch) });
      return res.end();
    }

    const report = aggregateSite(pageReports, { startUrl, origin });
    send('done', report);
    res.end();
  } catch (err) {
    console.error('Site scan failed:', err);
    send('failed', { error: 'Site scan failed unexpectedly.' });
    res.end();
  }
});

// Competitor benchmark. Analyzes the target homepage, discovers competitors via
// a topic search, scans each competitor's homepage, and streams progress.
app.get('/api/competitors', heavyLimiter, async (req, res) => {
  let target;
  try {
    target = normalizeUrl(req.query.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('status', { message: 'Analyzing your site…' });
    const targetResult = await scanOne(target.href);
    const targetHost = new URL(targetResult.url).hostname.replace(/^www\./, '');

    // Manual competitors take precedence over auto-discovery.
    const rivalsParam = (req.query.rivals || '').trim();
    let query = null;
    let competitors = [];

    if (rivalsParam) {
      const seen = new Set();
      for (const raw of rivalsParam.split(/[\s,]+/).filter(Boolean)) {
        try {
          const u = normalizeUrl(raw);
          const host = u.hostname.replace(/^www\./, '');
          if (host === targetHost || seen.has(host)) continue;
          seen.add(host);
          competitors.push(u.origin);
        } catch {
          /* ignore unparseable entries */
        }
        if (competitors.length >= 5) break;
      }
      if (!competitors.length) {
        send('failed', { error: 'None of the competitor URLs you entered were valid.' });
        return res.end();
      }
    } else {
      send('status', { message: 'Searching for competitors…' });
      ({ query, competitors } = await discoverCompetitors(
        new URL(targetResult.url),
        targetResult.html,
        3
      ));
      if (!competitors.length) {
        send('failed', {
          error:
            'Could not automatically find competitors for this site. Enter a ' +
            'few competitor URLs manually and try again.',
          query,
          manual: true,
        });
        return res.end();
      }
    }

    send('status', {
      message: `Found ${competitors.length} competitor${competitors.length === 1 ? '' : 's'} — scanning…`,
    });

    const scanned = [];
    let i = 0;
    for (const origin of competitors) {
      i++;
      send('status', { message: `Scanning competitor ${i} of ${competitors.length}… ${origin}` });
      try {
        const r = await scanOne(origin);
        scanned.push({ url: r.url, report: r.report });
      } catch {
        /* skip competitors that fail to load */
      }
    }

    if (!scanned.length) {
      send('failed', { error: 'Found competitors, but none could be scanned.' });
      return res.end();
    }

    send('done', {
      query,
      target: { url: targetResult.url, report: targetResult.report },
      competitors: scanned,
    });
    res.end();
  } catch (err) {
    console.error('Competitor scan failed:', err);
    send('failed', { error: 'Competitor analysis failed unexpectedly.' });
    res.end();
  }
});

// AI-citation check. Asks an AI answer engine (Perplexity) a few buyer-intent
// questions about the site's category/location and reports whether the site
// gets named or cited — and who does instead. Streams progress via SSE.
app.get('/api/ai-citation', heavyLimiter, async (req, res) => {
  let target;
  try {
    target = normalizeUrl(req.query.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // The AI-visibility check spends real Perplexity credits, so it is disabled on
  // the public instance entirely — not just rate-limited. It runs only on the
  // internal/local tool (PUBLIC_MODE off).
  if (PUBLIC_MODE) {
    send('failed', {
      error: 'The AI-visibility check is not available on the public tool.',
    });
    return res.end();
  }

  if (!PERPLEXITY_API_KEY) {
    send('failed', {
      error:
        'The AI-visibility check is not configured on this server (no Perplexity API key). ' +
        'Add PERPLEXITY_API_KEY to enable it.',
    });
    return res.end();
  }

  try {
    send('status', { message: 'Reading the page…' });
    const page = await fetchUrl(target.href);
    if (!page.ok || page.status >= 400 || !/text\/html/i.test(page.contentType || '')) {
      const why = !page.ok
        ? `couldn't reach it (${page.error})`
        : page.status >= 400
        ? `it returned HTTP ${page.status}`
        : `it returned "${page.contentType || 'unknown content'}", not HTML`;
      send('failed', { error: `Could not read ${target.hostname} — ${why}.` });
      return res.end();
    }

    const finalUrl = new URL(page.finalUrl);
    const report = await runAiCitation({
      finalUrl,
      html: page.body,
      apiKey: PERPLEXITY_API_KEY,
      model: PERPLEXITY_MODEL,
      onProgress: (p) => {
        const msg = p.prompt
          ? `Asking AI (${p.done + 1} of ${p.total}): “${p.prompt.slice(0, 60)}${p.prompt.length > 60 ? '…' : ''}”`
          : 'Summarizing…';
        send('status', { message: msg, done: p.done, total: p.total });
      },
    });

    send('done', report);
    res.end();
  } catch (err) {
    console.error('AI-citation failed:', err);
    send('failed', { error: 'AI-visibility check failed unexpectedly.' });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`SEO + AI Searchability Checker running at http://localhost:${PORT}`);
});
