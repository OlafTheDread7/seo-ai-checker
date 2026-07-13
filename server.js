import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchUrl, normalizeUrl } from './lib/fetcher.js';
import { analyze } from './lib/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Allow the Vercel frontend (or any origin — this is a public, auth-less tool)
// to call the API directly. The Vercel rewrite proxy makes this same-origin in
// practice, but CORS keeps direct calls working too.
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check — Railway pings this to confirm the service is up.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'seo-ai-checker', time: new Date().toISOString() });
});

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

app.listen(PORT, () => {
  console.log(`SEO + AI Searchability Checker running at http://localhost:${PORT}`);
});
