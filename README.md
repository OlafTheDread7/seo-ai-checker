# SearchLens — SEO & AI Searchability Checker

Scan any website and get a **score (0–100 + letter grade)** plus an actionable
report card covering both **traditional SEO** and **AI searchability** (how well
AI answer engines like ChatGPT, Perplexity, and Gemini can read and cite the page).

The server fetches the page's HTML (avoiding browser CORS limits), parses it with
Cheerio, and also pulls `robots.txt`, `sitemap.xml`, and `llms.txt` to grade the
site across four weighted categories.

## What it checks

**🔍 SEO Fundamentals** — title tag, meta description, H1, heading structure,
image alt text, canonical URL, Open Graph tags, indexability (noindex).

**🤖 AI Searchability (GEO/AEO)** — Schema.org structured data (JSON-LD),
answer-engine schema (FAQ/HowTo/QA), `llms.txt`, AI-crawler access in `robots.txt`
(GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, and more), semantic
HTML5 landmarks, author/E-E-A-T signals, and publish/update dates.

**⚙️ Technical** — HTTPS, mobile viewport, server response time, charset,
`lang` attribute, `robots.txt`, XML sitemap.

**✍️ Content Quality** — content depth (word count), readability (Flesch reading
ease), internal linking, and descriptive anchor text.

Scores are weighted: SEO 30%, AI 30%, Technical 20%, Content 20%.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** and enter a URL.

To change the port: `PORT=8080 npm start`.

## How it works

```
server.js            Express server + /api/scan endpoint
lib/fetcher.js       URL normalization + timed fetch with a browser-like UA
lib/analyze.js       All checks, scoring, and the report orchestrator
public/              Single-page frontend (no build step)
```

## Notes & limitations

- Analyzes the **static HTML** returned on first load — it sees what a crawler
  sees, not content injected later by client-side JavaScript.
- Heuristic, not affiliated with any search engine. Use it as a prioritized
  checklist, not a guarantee of rankings.
- The `robots.txt` AI-crawler check flags crawlers disallowed from the site root
  (`Disallow: /`). Whether you *want* AI crawlers allowed depends on your goals;
  for maximum visibility in AI answer engines, you generally do.
