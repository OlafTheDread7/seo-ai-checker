// Core analysis engine.
//
// Each check returns a normalized result:
//   { id, label, status, score (0..1), weight, message, recommendation, detail? }
//
// status is one of: 'pass' | 'warn' | 'fail' | 'info'
// Checks are grouped into four categories; each category's score is a
// weighted average of its checks, and the overall score is a weighted
// average of the categories (see CATEGORY_WEIGHTS in scoring below).

import * as cheerio from 'cheerio';
import { fetchUrl } from './fetcher.js';

// Known AI / LLM crawler user-agents. Whether you WANT these allowed depends
// on your goals, but for "AI searchability" (being cited by AI answer engines)
// you generally want them allowed.
const AI_CRAWLERS = [
  'GPTBot', // OpenAI (ChatGPT training)
  'OAI-SearchBot', // OpenAI (ChatGPT search)
  'ChatGPT-User', // OpenAI (live browsing)
  'ClaudeBot', // Anthropic
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot', // Perplexity
  'Perplexity-User',
  'Google-Extended', // Google Gemini / Vertex
  'Applebot-Extended', // Apple Intelligence
  'CCBot', // Common Crawl (feeds many models)
  'Bytespider', // TikTok / Doubao
  'Amazonbot',
  'cohere-ai',
];

const AI_SCHEMA_TYPES = ['FAQPage', 'QAPage', 'HowTo', 'Question', 'Answer'];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return word.length ? 1 : 0;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const groups = word.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

function readability(text) {
  const sentences = (text.match(/[.!?]+(?:\s|$)/g) || []).length || 1;
  const words = (text.match(/\b[\w'-]+\b/g) || []);
  const wordCount = words.length || 1;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  // Flesch Reading Ease
  const score =
    206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount);
  return { score: Math.round(score), sentences, wordCount };
}

function label(status) {
  return status;
}

// ---------------------------------------------------------------------------
// SEO fundamentals
// ---------------------------------------------------------------------------

function seoChecks($, ctx) {
  const checks = [];

  // Title
  const title = ($('head > title').first().text() || '').trim();
  if (!title) {
    checks.push({
      id: 'title',
      label: 'Title tag',
      status: 'fail',
      score: 0,
      weight: 3,
      message: 'No <title> tag found.',
      recommendation:
        'Add a unique, descriptive <title> (about 50–60 characters) — it is the single most important on-page SEO element and the clickable headline in search results.',
    });
  } else {
    const len = title.length;
    const good = len >= 30 && len <= 60;
    checks.push({
      id: 'title',
      label: 'Title tag',
      status: good ? 'pass' : 'warn',
      score: good ? 1 : 0.5,
      weight: 3,
      message: `Title is ${len} characters.`,
      detail: title,
      recommendation: good
        ? 'Length is in the ideal range.'
        : len < 30
        ? 'Title is short — aim for 30–60 characters and include your primary keyword.'
        : 'Title is long and may be truncated in search results — trim to 50–60 characters.',
    });
  }

  // Meta description
  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  if (!desc) {
    checks.push({
      id: 'meta-description',
      label: 'Meta description',
      status: 'fail',
      score: 0,
      weight: 2,
      message: 'No meta description found.',
      recommendation:
        'Add a compelling meta description (70–160 characters). It shapes the snippet in search results and answer engines, driving click-through.',
    });
  } else {
    const len = desc.length;
    const good = len >= 70 && len <= 160;
    checks.push({
      id: 'meta-description',
      label: 'Meta description',
      status: good ? 'pass' : 'warn',
      score: good ? 1 : 0.5,
      weight: 2,
      message: `Meta description is ${len} characters.`,
      detail: desc,
      recommendation: good
        ? 'Length is well within the ideal range.'
        : len < 70
        ? 'Description is thin — expand to 70–160 characters and summarize the page value.'
        : 'Description may be truncated — keep it under ~160 characters.',
    });
  }

  // H1
  const h1s = $('h1');
  if (h1s.length === 0) {
    checks.push({
      id: 'h1',
      label: 'H1 heading',
      status: 'fail',
      score: 0,
      weight: 2,
      message: 'No <h1> found.',
      recommendation:
        'Add exactly one <h1> that states the page topic. It anchors the page for both search crawlers and AI summarizers.',
    });
  } else {
    const one = h1s.length === 1;
    checks.push({
      id: 'h1',
      label: 'H1 heading',
      status: one ? 'pass' : 'warn',
      score: one ? 1 : 0.6,
      weight: 2,
      message: one ? 'Exactly one H1 present.' : `${h1s.length} H1 tags found.`,
      detail: h1s.first().text().trim().slice(0, 120),
      recommendation: one
        ? 'Good — a single, clear H1.'
        : 'Use a single H1 per page; convert the others to H2/H3 to keep a clean hierarchy.',
    });
  }

  // Heading structure
  const headingCount = $('h1,h2,h3,h4,h5,h6').length;
  checks.push({
    id: 'headings',
    label: 'Heading structure',
    status: headingCount >= 3 ? 'pass' : headingCount >= 1 ? 'warn' : 'fail',
    score: headingCount >= 3 ? 1 : headingCount >= 1 ? 0.5 : 0,
    weight: 1,
    message: `${headingCount} headings (H1–H6) on the page.`,
    recommendation:
      headingCount >= 3
        ? 'Content is well-segmented with headings.'
        : 'Break content into sections with descriptive H2/H3 headings — it helps both readers and AI extract structured answers.',
  });

  // Image alt text
  const imgs = $('img');
  const withAlt = imgs.filter((_, el) => ($(el).attr('alt') || '').trim().length > 0).length;
  const total = imgs.length;
  if (total === 0) {
    checks.push({
      id: 'img-alt',
      label: 'Image alt text',
      status: 'info',
      score: 1,
      weight: 1,
      message: 'No images on the page.',
      recommendation: 'No images to describe.',
    });
  } else {
    const ratio = withAlt / total;
    checks.push({
      id: 'img-alt',
      label: 'Image alt text',
      status: ratio >= 0.9 ? 'pass' : ratio >= 0.5 ? 'warn' : 'fail',
      score: ratio,
      weight: 1,
      message: `${withAlt} of ${total} images have alt text (${Math.round(ratio * 100)}%).`,
      recommendation:
        ratio >= 0.9
          ? 'Great alt-text coverage.'
          : 'Add descriptive alt text to remaining images — it aids accessibility, image search, and AI understanding.',
    });
  }

  // Canonical
  const canonical = $('link[rel="canonical"]').attr('href');
  checks.push({
    id: 'canonical',
    label: 'Canonical URL',
    status: canonical ? 'pass' : 'warn',
    score: canonical ? 1 : 0.5,
    weight: 1,
    message: canonical ? 'Canonical link present.' : 'No canonical link found.',
    detail: canonical,
    recommendation: canonical
      ? 'Canonical is set — good for avoiding duplicate-content issues.'
      : 'Add <link rel="canonical"> pointing to the preferred URL to consolidate ranking signals.',
  });

  // Open Graph
  const og = ['og:title', 'og:description', 'og:image'].filter(
    (p) => $(`meta[property="${p}"]`).attr('content')
  );
  checks.push({
    id: 'open-graph',
    label: 'Open Graph tags',
    status: og.length === 3 ? 'pass' : og.length >= 1 ? 'warn' : 'fail',
    score: og.length / 3,
    weight: 1,
    message: `${og.length}/3 key Open Graph tags present.`,
    detail: og.join(', ') || undefined,
    recommendation:
      og.length === 3
        ? 'Rich link previews are configured for social and messaging apps.'
        : 'Add og:title, og:description and og:image so shared links render rich previews.',
  });

  // Robots meta (noindex is a hard fail for searchability)
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase();
  const noindex = robotsMeta.includes('noindex');
  checks.push({
    id: 'meta-robots',
    label: 'Indexability',
    status: noindex ? 'fail' : 'pass',
    score: noindex ? 0 : 1,
    weight: 3,
    message: noindex
      ? 'Page is set to noindex — search engines are told NOT to index it.'
      : 'Page is indexable (no noindex directive).',
    detail: robotsMeta || undefined,
    recommendation: noindex
      ? 'Remove the noindex directive if you want this page to appear in search results.'
      : 'Good — the page can be indexed.',
  });

  return checks;
}

// ---------------------------------------------------------------------------
// AI searchability (GEO / AEO)
// ---------------------------------------------------------------------------

function aiChecks($, ctx) {
  const checks = [];

  // Structured data (JSON-LD)
  const ldNodes = $('script[type="application/ld+json"]');
  const schemaTypes = new Set();
  ldNodes.each((_, el) => {
    try {
      const json = JSON.parse($(el).contents().text());
      const collect = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) return obj.forEach(collect);
        if (obj['@type']) {
          [].concat(obj['@type']).forEach((t) => schemaTypes.add(t));
        }
        Object.values(obj).forEach(collect);
      };
      collect(json);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  checks.push({
    id: 'structured-data',
    label: 'Structured data (Schema.org)',
    status: schemaTypes.size > 0 ? 'pass' : 'fail',
    score: schemaTypes.size > 0 ? 1 : 0,
    weight: 3,
    message:
      schemaTypes.size > 0
        ? `${ldNodes.length} JSON-LD block(s); types: ${[...schemaTypes].slice(0, 8).join(', ')}.`
        : 'No JSON-LD structured data found.',
    recommendation:
      schemaTypes.size > 0
        ? 'Structured data helps AI engines understand and confidently cite your content.'
        : 'Add Schema.org JSON-LD (Organization, Article, Product, etc.). It is the clearest machine-readable signal for AI answer engines.',
  });

  // Answer-friendly schema (FAQ / HowTo / QA)
  const answerSchema = [...schemaTypes].filter((t) => AI_SCHEMA_TYPES.includes(t));
  checks.push({
    id: 'answer-schema',
    label: 'Answer-engine schema (FAQ / HowTo / QA)',
    status: answerSchema.length ? 'pass' : 'warn',
    score: answerSchema.length ? 1 : 0.4,
    weight: 1,
    message: answerSchema.length
      ? `Found: ${answerSchema.join(', ')}.`
      : 'No FAQ/HowTo/QA schema found.',
    recommendation: answerSchema.length
      ? 'Question/answer schema makes your content directly quotable by AI answer engines.'
      : 'If relevant, add FAQPage or HowTo schema. Q&A-structured content is disproportionately surfaced by AI answer engines.',
  });

  // llms.txt
  const llms = ctx.resources.llmsTxt;
  checks.push({
    id: 'llms-txt',
    label: 'llms.txt file',
    status: llms && llms.ok && llms.status === 200 ? 'pass' : 'warn',
    score: llms && llms.ok && llms.status === 200 ? 1 : 0.3,
    weight: 1,
    message:
      llms && llms.ok && llms.status === 200
        ? '/llms.txt is present.'
        : '/llms.txt not found.',
    recommendation:
      llms && llms.ok && llms.status === 200
        ? 'You publish an llms.txt guide for AI crawlers — a leading-edge signal.'
        : 'Consider adding /llms.txt (the emerging standard) to give LLMs a curated, plain-text map of your most important content.',
  });

  // AI crawler access via robots.txt
  const robots = ctx.resources.robotsTxt;
  let blocked = [];
  if (robots && robots.ok && robots.status === 200) {
    blocked = analyzeRobotsForAI(robots.body);
  }
  const anyBlocked = blocked.length > 0;
  checks.push({
    id: 'ai-crawlers',
    label: 'AI crawler access',
    status: anyBlocked ? 'warn' : 'pass',
    score: anyBlocked ? Math.max(0.3, 1 - blocked.length / AI_CRAWLERS.length) : 1,
    weight: 2,
    message: anyBlocked
      ? `robots.txt blocks ${blocked.length} AI crawler(s): ${blocked.slice(0, 6).join(', ')}${blocked.length > 6 ? '…' : ''}.`
      : 'No major AI crawlers are blocked in robots.txt.',
    recommendation: anyBlocked
      ? 'These AI engines cannot read your site, so they cannot cite you. If visibility in AI search is a goal, allow them in robots.txt.'
      : 'AI answer engines are free to crawl and cite your content.',
  });

  // Semantic HTML
  const semantic = ['main', 'article', 'section', 'header', 'nav', 'footer'].filter(
    (t) => $(t).length > 0
  );
  checks.push({
    id: 'semantic-html',
    label: 'Semantic HTML5',
    status: semantic.length >= 3 ? 'pass' : semantic.length >= 1 ? 'warn' : 'fail',
    score: Math.min(1, semantic.length / 3),
    weight: 1,
    message: `${semantic.length} semantic landmark(s): ${semantic.join(', ') || 'none'}.`,
    recommendation:
      semantic.length >= 3
        ? 'Semantic landmarks make your content structure legible to machines.'
        : 'Use <main>, <article>, <section>, <nav> instead of generic <div>s so crawlers can parse structure.',
  });

  // Author / E-E-A-T
  const author =
    $('meta[name="author"]').attr('content') ||
    $('[rel="author"]').first().text() ||
    (ctx.schemaHasAuthor ? 'schema author' : '');
  checks.push({
    id: 'author',
    label: 'Author / E-E-A-T signals',
    status: author ? 'pass' : 'warn',
    score: author ? 1 : 0.4,
    weight: 1,
    message: author ? 'Author information is present.' : 'No author metadata found.',
    recommendation: author
      ? 'Clear authorship supports experience/expertise/authority/trust signals.'
      : 'Attribute content to a named author (via meta author or Schema.org author). AI engines weight authoritative, attributable sources.',
  });

  // Freshness (dates)
  const hasDate =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[property="article:modified_time"]').attr('content') ||
    $('time[datetime]').length > 0;
  checks.push({
    id: 'freshness',
    label: 'Publish / update dates',
    status: hasDate ? 'pass' : 'warn',
    score: hasDate ? 1 : 0.5,
    weight: 1,
    message: hasDate ? 'Date metadata found.' : 'No published/modified date metadata.',
    recommendation: hasDate
      ? 'Dates signal freshness, which answer engines favor.'
      : 'Expose publish/updated dates (<time> or article:published_time). Freshness influences whether AI engines trust and cite a page.',
  });

  return checks;
}

function analyzeRobotsForAI(body) {
  // Parse robots.txt into user-agent groups and flag AI crawlers that are
  // disallowed from the root.
  const lines = body.split(/\r?\n/);
  const groups = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], disallows: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current.hasRules = true;
      current.disallows.push(value);
    } else if (field === 'allow' && current) {
      current.hasRules = true;
    }
  }

  const blocked = [];
  for (const crawler of AI_CRAWLERS) {
    const cl = crawler.toLowerCase();
    const group = groups.find((g) => g.agents.includes(cl));
    if (group && group.disallows.some((d) => d === '/' )) {
      blocked.push(crawler);
    }
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

function technicalChecks($, ctx) {
  const checks = [];
  const { page } = ctx;

  // HTTPS
  const isHttps = ctx.finalUrl.protocol === 'https:';
  checks.push({
    id: 'https',
    label: 'HTTPS',
    status: isHttps ? 'pass' : 'fail',
    score: isHttps ? 1 : 0,
    weight: 3,
    message: isHttps ? 'Served over HTTPS.' : 'Site is not served over HTTPS.',
    recommendation: isHttps
      ? 'Secure connection — a baseline ranking and trust signal.'
      : 'Install a TLS certificate and redirect all traffic to HTTPS. Non-secure sites are penalized and flagged as "Not secure".',
  });

  // Viewport (mobile)
  const viewport = $('meta[name="viewport"]').attr('content');
  checks.push({
    id: 'viewport',
    label: 'Mobile viewport',
    status: viewport ? 'pass' : 'fail',
    score: viewport ? 1 : 0,
    weight: 2,
    message: viewport ? 'Responsive viewport meta present.' : 'No viewport meta tag.',
    recommendation: viewport
      ? 'The page declares a responsive viewport.'
      : 'Add <meta name="viewport" content="width=device-width, initial-scale=1">. Mobile-friendliness is a direct ranking factor.',
  });

  // Response time
  const ms = page.elapsedMs;
  checks.push({
    id: 'response-time',
    label: 'Server response time',
    status: ms < 800 ? 'pass' : ms < 2000 ? 'warn' : 'fail',
    score: ms < 800 ? 1 : ms < 2000 ? 0.6 : 0.2,
    weight: 2,
    message: `HTML returned in ${ms} ms.`,
    recommendation:
      ms < 800
        ? 'Fast server response.'
        : 'Reduce time-to-first-byte via caching/CDN. Slow responses hurt Core Web Vitals and crawl efficiency.',
  });

  // Charset
  const charset =
    $('meta[charset]').attr('charset') ||
    ($('meta[http-equiv="Content-Type"]').attr('content') || '').match(/charset=([^;]+)/)?.[1];
  checks.push({
    id: 'charset',
    label: 'Character encoding',
    status: charset ? 'pass' : 'warn',
    score: charset ? 1 : 0.5,
    weight: 1,
    message: charset ? `Charset declared (${charset.trim()}).` : 'No charset declared.',
    recommendation: charset
      ? 'Encoding is declared.'
      : 'Declare <meta charset="utf-8"> as the first element in <head> to avoid rendering issues.',
  });

  // Lang attribute
  const lang = $('html').attr('lang');
  checks.push({
    id: 'lang',
    label: 'HTML lang attribute',
    status: lang ? 'pass' : 'warn',
    score: lang ? 1 : 0.5,
    weight: 1,
    message: lang ? `Language declared (${lang}).` : 'No lang attribute on <html>.',
    recommendation: lang
      ? 'Language is declared for assistive tech and localization.'
      : 'Add lang="en" (or the correct locale) to <html> for accessibility and localized search.',
  });

  // robots.txt
  const robots = ctx.resources.robotsTxt;
  const hasRobots = robots && robots.ok && robots.status === 200;
  checks.push({
    id: 'robots-txt',
    label: 'robots.txt',
    status: hasRobots ? 'pass' : 'warn',
    score: hasRobots ? 1 : 0.5,
    weight: 1,
    message: hasRobots ? '/robots.txt is present.' : '/robots.txt not found.',
    recommendation: hasRobots
      ? 'Crawlers have explicit crawl directives.'
      : 'Add a /robots.txt (even a permissive one) and reference your sitemap from it.',
  });

  // Sitemap
  const sitemapInRobots = hasRobots && /sitemap\s*:/i.test(robots.body);
  const sitemap = ctx.resources.sitemap;
  const hasSitemap = sitemapInRobots || (sitemap && sitemap.ok && sitemap.status === 200);
  checks.push({
    id: 'sitemap',
    label: 'XML sitemap',
    status: hasSitemap ? 'pass' : 'warn',
    score: hasSitemap ? 1 : 0.4,
    weight: 1,
    message: hasSitemap
      ? sitemapInRobots
        ? 'Sitemap referenced in robots.txt.'
        : '/sitemap.xml is present.'
      : 'No sitemap found.',
    recommendation: hasSitemap
      ? 'A sitemap helps crawlers discover all your pages.'
      : 'Publish an XML sitemap and reference it in robots.txt so crawlers can find every page.',
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Content quality
// ---------------------------------------------------------------------------

function contentChecks($, ctx) {
  const checks = [];

  // Extract visible body text
  const clone = cheerio.load($.html());
  clone('script, style, noscript, template').remove();
  const text = clone('body').text().replace(/\s+/g, ' ').trim();
  const { score: fk, wordCount } = readability(text);

  // Word count
  checks.push({
    id: 'word-count',
    label: 'Content depth',
    status: wordCount >= 600 ? 'pass' : wordCount >= 300 ? 'warn' : 'fail',
    score: wordCount >= 600 ? 1 : wordCount >= 300 ? 0.6 : 0.3,
    weight: 2,
    message: `~${wordCount.toLocaleString()} words of visible text.`,
    recommendation:
      wordCount >= 600
        ? 'Substantial content gives search and AI engines enough to work with.'
        : 'Thin content ranks poorly and is rarely cited by AI. Expand with genuinely useful, specific detail.',
  });

  // Readability (Flesch Reading Ease)
  let rStatus = 'pass';
  let rMsg = `Flesch reading ease ${fk} (fairly easy to read).`;
  if (fk < 30) {
    rStatus = 'warn';
    rMsg = `Flesch reading ease ${fk} (very difficult).`;
  } else if (fk < 50) {
    rStatus = 'warn';
    rMsg = `Flesch reading ease ${fk} (difficult).`;
  }
  checks.push({
    id: 'readability',
    label: 'Readability',
    status: rStatus,
    score: fk >= 50 ? 1 : fk >= 30 ? 0.6 : 0.4,
    weight: 1,
    message: rMsg,
    recommendation:
      fk >= 50
        ? 'Clear prose is easier for readers and for AI to summarize accurately.'
        : 'Shorten sentences and simplify wording. Clear, scannable writing is easier for AI answer engines to extract and quote.',
  });

  // Internal links
  const host = ctx.finalUrl.hostname;
  let internal = 0;
  let descriptiveAnchors = 0;
  let anchorsChecked = 0;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const anchorText = $(el).text().trim();
    try {
      const u = new URL(href, ctx.finalUrl.href);
      if (u.hostname === host) internal++;
    } catch {
      /* ignore */
    }
    if (anchorText) {
      anchorsChecked++;
      if (!/^(click here|read more|here|link|more)$/i.test(anchorText)) {
        descriptiveAnchors++;
      }
    }
  });

  checks.push({
    id: 'internal-links',
    label: 'Internal linking',
    status: internal >= 5 ? 'pass' : internal >= 1 ? 'warn' : 'fail',
    score: internal >= 5 ? 1 : internal >= 1 ? 0.6 : 0.2,
    weight: 1,
    message: `${internal} internal link(s) on the page.`,
    recommendation:
      internal >= 5
        ? 'Good internal linking spreads authority and aids crawl discovery.'
        : 'Add contextual internal links to related pages to help crawlers (and readers) navigate.',
  });

  const anchorRatio = anchorsChecked ? descriptiveAnchors / anchorsChecked : 1;
  checks.push({
    id: 'anchor-text',
    label: 'Descriptive link text',
    status: anchorRatio >= 0.9 ? 'pass' : anchorRatio >= 0.7 ? 'warn' : 'fail',
    score: anchorRatio,
    weight: 1,
    message: `${Math.round(anchorRatio * 100)}% of links use descriptive anchor text.`,
    recommendation:
      anchorRatio >= 0.9
        ? 'Anchor text describes destinations well.'
        : 'Replace generic "click here"/"read more" links with descriptive text — it tells crawlers and AI what the target is about.',
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const CATEGORY_WEIGHTS = {
  seo: 0.3,
  ai: 0.3,
  technical: 0.2,
  content: 0.2,
};

function scoreCategory(checks) {
  // 'info' checks don't drag the score; exclude zero-weight/info from denom
  const scored = checks.filter((c) => c.status !== 'info');
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0) || 1;
  const weighted = scored.reduce((s, c) => s + c.score * c.weight, 0);
  return Math.round((weighted / totalWeight) * 100);
}

function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

// Fetch the site-level resources (robots.txt, llms.txt, sitemap.xml) once.
// For a whole-site scan these are shared across every page instead of being
// re-fetched per page.
export async function fetchAllResources(origin) {
  const [robotsTxt, llmsTxt, sitemap] = await Promise.all([
    fetchUrl(origin + '/robots.txt'),
    fetchUrl(origin + '/llms.txt'),
    fetchUrl(origin + '/sitemap.xml'),
  ]);
  return { robotsTxt, llmsTxt, sitemap };
}

export async function analyze(finalUrl, page, preResources = null) {
  const $ = cheerio.load(page.body || '');
  const origin = finalUrl.origin;

  // Reuse shared resources when provided (site scan); otherwise fetch them.
  const resources = preResources || (await fetchAllResources(origin));

  const ctx = {
    finalUrl,
    page,
    resources,
  };

  const categories = [
    { key: 'seo', title: 'SEO Fundamentals', icon: '🔍', checks: seoChecks($, ctx) },
    { key: 'ai', title: 'AI Searchability', icon: '🤖', checks: aiChecks($, ctx) },
    { key: 'technical', title: 'Technical', icon: '⚙️', checks: technicalChecks($, ctx) },
    { key: 'content', title: 'Content Quality', icon: '✍️', checks: contentChecks($, ctx) },
  ].map((c) => ({ ...c, score: scoreCategory(c.checks) }));

  const overall = Math.round(
    categories.reduce((s, c) => s + c.score * CATEGORY_WEIGHTS[c.key], 0)
  );

  // Flatten the highest-impact issues for a "top fixes" list.
  const allChecks = categories.flatMap((c) =>
    c.checks.map((chk) => ({ ...chk, category: c.title }))
  );
  const topFixes = allChecks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => (b.weight * (1 - b.score)) - (a.weight * (1 - a.score)))
    .slice(0, 6);

  const counts = allChecks.reduce(
    (acc, c) => {
      if (c.status === 'pass') acc.pass++;
      else if (c.status === 'warn') acc.warn++;
      else if (c.status === 'fail') acc.fail++;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );

  return {
    url: finalUrl.href,
    finalUrl: page.finalUrl,
    fetchedAt: new Date().toISOString(),
    overall,
    grade: grade(overall),
    categories,
    topFixes,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Site aggregation
// ---------------------------------------------------------------------------

// Checks that are identical for every page on a domain (they read site-level
// resources), so we present them as "site-wide" rather than per-page.
const SITE_LEVEL_IDS = new Set([
  'https',
  'robots-txt',
  'sitemap',
  'llms-txt',
  'ai-crawlers',
]);

// Combine many single-page reports into one site report. The key move is
// grouping each failing/warning check by id across all the pages it affects,
// so the report (and the fix prompt) say "affects 12 pages" instead of
// repeating the same issue twelve times.
export function aggregateSite(pageReports, meta) {
  const n = pageReports.length;
  const catAgg = new Map(); // key -> { key, title, icon, scores: [] }
  const issueMap = new Map(); // checkId -> issue
  const universe = new Map(); // checkId -> { id, label, category } (all checks seen)
  const counts = { pass: 0, warn: 0, fail: 0 };
  const pages = [];

  for (const { url, report } of pageReports) {
    pages.push({
      url,
      overall: report.overall,
      grade: report.grade,
      counts: report.counts,
    });
    counts.pass += report.counts.pass;
    counts.warn += report.counts.warn;
    counts.fail += report.counts.fail;

    for (const cat of report.categories) {
      if (!catAgg.has(cat.key)) {
        catAgg.set(cat.key, { key: cat.key, title: cat.title, icon: cat.icon, scores: [] });
      }
      catAgg.get(cat.key).scores.push(cat.score);

      for (const chk of cat.checks) {
        if (!universe.has(chk.id)) {
          universe.set(chk.id, { id: chk.id, label: chk.label, category: cat.title });
        }
        if (chk.status !== 'warn' && chk.status !== 'fail') continue;

        if (!issueMap.has(chk.id)) {
          issueMap.set(chk.id, {
            id: chk.id,
            label: chk.label,
            category: cat.title,
            categoryKey: cat.key,
            recommendation: chk.recommendation,
            scope: SITE_LEVEL_IDS.has(chk.id) ? 'site' : 'page',
            worst: chk.status,
            pages: [], // { url, message, detail }
          });
        }
        const iss = issueMap.get(chk.id);
        if (chk.status === 'fail') iss.worst = 'fail';
        iss.pages.push({ url, message: chk.message, detail: chk.detail });
      }
    }
  }

  const catOrder = ['seo', 'ai', 'technical', 'content'];
  const categories = catOrder
    .filter((k) => catAgg.has(k))
    .map((k) => {
      const c = catAgg.get(k);
      const avg = Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length);
      return { key: c.key, title: c.title, icon: c.icon, score: avg };
    });

  const overall = Math.round(
    categories.reduce((s, c) => s + c.score * (CATEGORY_WEIGHTS[c.key] || 0), 0)
  );

  const sev = (s) => (s === 'fail' ? 2 : 1);
  const issues = [...issueMap.values()]
    .map((iss) => ({
      ...iss,
      affectedCount: iss.scope === 'site' ? n : iss.pages.length,
    }))
    .sort((a, b) => sev(b.worst) - sev(a.worst) || b.affectedCount - a.affectedCount);

  // Checks that never became an issue on any page = clean across the whole site.
  const passingEverywhere = [...universe.values()].filter((c) => !issueMap.has(c.id));

  return {
    mode: 'site',
    startUrl: meta.startUrl,
    origin: meta.origin,
    fetchedAt: new Date().toISOString(),
    pagesScanned: n,
    overall,
    grade: grade(overall),
    categories,
    pages: pages.sort((a, b) => a.overall - b.overall),
    issues,
    passingEverywhere,
    counts,
  };
}
