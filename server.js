import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchUrl, normalizeUrl } from './lib/fetcher.js';
import { analyze, aggregateSite } from './lib/analyze.js';
import { crawlAndScan } from './lib/crawl.js';
import { discoverCompetitors } from './lib/competitors.js';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/scan', async (req, res) => {
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
app.get('/api/scan-site', async (req, res) => {
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
    const { pageReports, origin, startUrl } = await crawlAndScan({
      startUrl: target.href,
      maxPages: MAX_PAGES,
      concurrency: 5,
      onProgress: (p) => send('progress', p),
    });

    if (!pageReports.length) {
      send('failed', {
        error:
          'No scannable HTML pages found at that address. Check the URL and try again.',
      });
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
app.get('/api/competitors', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`SEO + AI Searchability Checker running at http://localhost:${PORT}`);
});
