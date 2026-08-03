# SearchLens — SEO & AI Searchability Checker

Scan any website and get a **score (0–100 + letter grade)** plus an actionable
report card covering both **traditional SEO** and **AI searchability** (how well
AI answer engines like ChatGPT, Perplexity, and Gemini can read and cite the page).

The server fetches the page's HTML (avoiding browser CORS limits), parses it with
Cheerio, and also pulls `robots.txt`, `sitemap.xml`, and `llms.txt` to grade the
site across four weighted categories.

## Two scan modes

- **Whole site (default)** — discovers pages from the sitemap and by following
  same-origin links (bounded to 25 pages), scans each, and streams live progress.
  The report aggregates every issue **across the pages it affects**
  (e.g. "Missing meta description — affects 12 pages"), lists each page's score,
  and builds a single site-wide fix prompt. Site-wide issues (HTTPS, robots.txt,
  sitemap, llms.txt, AI-crawler access) are flagged as such rather than repeated
  per page.
- **Single page** — untick "Scan the whole site" to audit just the one URL.

Either way, the **Fix-it prompt for Claude** aggregates the flagged items into a
copy-to-clipboard prompt (with an optional toggle to include passing checks as a
full audit record).

## Competitor benchmark

From any report, **Benchmark against competitors** compares your SEO and AI
searchability against rivals:

- **Auto-discover** — derives your site's topic keywords from its title, searches
  the web (DuckDuckGo Lite → HTML → Bing, whichever responds), and scans the top
  distinct domains. This is best-effort: keyless web search gets rate-limited and
  keyword results are imperfect.
- **Manual** — enter competitor URLs (comma-separated) to compare exactly who you
  choose. This is the reliable path and always available.

The result is a side-by-side score table (overall + each category, column leaders
highlighted), plus **takeaways** and an **opportunities** list — specific things
competitors do that your site doesn't (e.g. "2/2 competitors have Semantic
HTML5 — you fall short").

It also generates a **competitor-aware fix prompt** to copy into Claude. Unlike
the plain fix prompt, it splits the work into **Priority 1: competitive gaps**
(checks rivals pass that you don't — each with the concrete thing a named
competitor does, to emulate) and **Priority 2: your other issues**. So Claude
doesn't just fix your site, it closes the gap on named competitors.

## AI-visibility check (does AI actually recommend you?)

Every check above measures *readiness* — what a crawler sees. The **AI visibility**
button (on any report) measures the *outcome*: it derives the business's name,
city, and service from the page, asks an AI answer engine a handful of real
buyer-intent questions ("who are the best {service} in {city}?"), and reports
whether the site gets **named or cited** — and which competitors show up instead.

Because AI answers are non-deterministic, results are a frequency ("cited in 1 of
3 searches"), never a fixed rank. It also asks one branded question to see if the
engine recognizes the business by name at all.

This feature uses Perplexity's **Agent API** (`/v1/agent`) — it returns a
web-grounded answer *with* the sources it grounded on in one call, which is what
makes the check verifiable. Set it via environment:

```
PERPLEXITY_API_KEY=pplx-xxxxxxxx      # required to enable the feature
PERPLEXITY_MODEL=perplexity/sonar     # optional, defaults to "perplexity/sonar"
```

When the key is unset the button simply doesn't appear, and the rest of the tool
runs exactly as before. Cost is a few cents per check (a handful of API calls).

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

## Run it (local, just for you)

**Easiest — double-click `Start SearchLens.bat`.**
It installs dependencies the first time, starts the server, and opens
http://localhost:3000 in your browser. Leave the black window open while you use
it; close it to stop the app.

**Or from a terminal:**

```bash
npm install   # first time only
npm start
```

Then open **http://localhost:3000** and enter a URL.

To use a different port: `PORT=8080 npm start`.

Runs entirely on your machine — nothing is uploaded or shared, and the only
outbound requests are to the site you're scanning.

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
