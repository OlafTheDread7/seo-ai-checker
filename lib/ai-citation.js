// AI-citation check.
//
// The rest of the tool grades *readiness* — what a crawler sees on first load.
// This module measures an *outcome*: when a real buyer asks an AI answer engine
// a natural question ("who does X in Y?"), does the target site actually get
// named or cited — and if not, who does instead?
//
// It works by deriving the business's identity from the page (name, city,
// service), generating a handful of buyer-intent prompts, asking Perplexity
// (whose API returns explicit web citations), and checking whether the target
// domain shows up in the answer text or its sources.
//
// Requires a Perplexity API key (PERPLEXITY_API_KEY). Answers are
// non-deterministic, so results are reported as a frequency ("cited in 1 of 3
// searches"), never a single fixed rank.

import * as cheerio from 'cheerio';
import { registrableDomain, buildQuery } from './competitors.js';

// Aggregators / directories / social — useful to note, but not "a competitor".
const BIG_PLATFORMS = new Set([
  'yelp.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tripadvisor.com', 'angi.com', 'angieslist.com', 'thumbtack.com',
  'bbb.org', 'mapquest.com', 'nextdoor.com', 'reddit.com', 'wikipedia.org',
  'youtube.com', 'google.com', 'bing.com', 'yellowpages.com', 'manta.com',
  'houzz.com', 'homeadvisor.com', 'porch.com', 'expertise.com', 'birdeye.com',
  'foursquare.com', 'pinterest.com', 'tiktok.com', 'indeed.com', 'glassdoor.com',
]);

// US states (name -> USPS abbreviation) for detecting a business's city from
// the title/description when there's no schema address.
const STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};
const STATE_ABBRS = new Set(Object.values(STATES));

function detectCity(text) {
  if (!text) return '';
  const names = Object.keys(STATES).sort((a, b) => b.length - a.length);
  const alt = [...names, ...Object.values(STATES)]
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // "<City words>, ST" or "<City words> Virginia"
  const re = new RegExp(
    `\\b([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){0,2}),?\\s+(${alt})\\b`,
    'i'
  );
  const m = text.match(re);
  if (!m) return '';
  const cityWords = m[1].replace(/\s+/g, ' ').trim();
  const stateRaw = m[2].toLowerCase();
  const abbr = STATE_ABBRS.has(stateRaw.toUpperCase())
    ? stateRaw.toUpperCase()
    : STATES[stateRaw] || '';
  // Guard against grabbing a generic word as the "city".
  if (!abbr) return '';
  return `${cityWords}, ${abbr}`;
}

/**
 * Derive { name, city, service, targetReg } from a scanned page.
 * Prefers Schema.org business data, falls back to title/og/heuristics.
 */
export function extractIdentity(finalUrl, html) {
  const $ = cheerio.load(html || '');
  const url = finalUrl instanceof URL ? finalUrl : new URL(finalUrl);
  const title = ($('head > title').first().text() || '').trim();
  const h1 = ($('h1').first().text() || '').trim();
  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  const ogSite = ($('meta[property="og:site_name"]').attr('content') || '').trim();

  // Walk JSON-LD for an Organization/LocalBusiness name + address.
  let schemaName = '';
  let locality = '';
  let region = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        const types = [].concat(o['@type'] || []).map(String);
        if (
          types.some((t) =>
            /Organization|LocalBusiness|Store|ProfessionalService|Service|Person/i.test(t)
          )
        ) {
          if (!schemaName && typeof o.name === 'string') schemaName = o.name.trim();
          const addr = Array.isArray(o.address) ? o.address[0] : o.address;
          if (addr && typeof addr === 'object') {
            if (!locality && addr.addressLocality) locality = String(addr.addressLocality).trim();
            if (!region && addr.addressRegion) region = String(addr.addressRegion).trim();
          }
        }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse($(el).contents().text()));
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  const targetReg = registrableDomain(url.hostname);
  const domainTok = targetReg.split('.')[0].toLowerCase();
  const collapse = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const domCollapsed = collapse(domainTok);

  // Split the title into segments. Only treat a *spaced* hyphen as a separator
  // so hyphenated brand names ("Re-Freshen") survive intact.
  const segs = title.split(/[|–—:·•>]+|\s-\s/).map((s) => s.trim()).filter(Boolean);
  const isBrand = (s) => {
    const c = collapse(s);
    return c.length > 2 && (c.includes(domCollapsed) || (domCollapsed.length > 3 && domCollapsed.includes(c)));
  };
  const brandSeg = segs.find(isBrand);
  const locSeg = segs.find((s) => detectCity(s)); // the "City State" segment, if any

  const name =
    schemaName ||
    ogSite ||
    brandSeg ||
    (domainTok ? domainTok.charAt(0).toUpperCase() + domainTok.slice(1) : '');

  // City: schema first, then detect from title/h1/description text.
  let city = '';
  if (locality) city = region ? `${locality}, ${region}` : locality;
  else city = detectCity(`${title} ${h1} ${desc}`);

  // Service: the non-brand, non-location title segment(s), cleaned of
  // boilerplate; fall back to h1, then the topic-keyword extractor.
  let service = segs.filter((s) => s !== brandSeg && s !== locSeg).join(' ');
  if (!service || collapse(service).length < 3) service = h1 || '';
  service = service
    .toLowerCase()
    .replace(/\b(services?|solutions?|company|companies|inc|llc|ltd|co|of|the|and|in)\b/g, ' ')
    .replace(/[|,].*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip city words out of the service phrase if they bled in.
  if (city) {
    for (const w of city.toLowerCase().replace(/,/g, '').split(/\s+/)) {
      service = service.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
    }
    service = service.replace(/\s+/g, ' ').trim();
  }
  // Drop any leftover full state names (e.g. "Virginia") that bled in.
  service = service
    .replace(new RegExp(`\\b(${Object.keys(STATES).join('|')})\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[&\s-]+|[&\s-]+$/g, '')
    .trim();
  if (!service || service.length < 3) {
    const kw = buildQuery(html, url);
    service = (kw || '').split(/\s+/).slice(0, 4).join(' ').trim();
  }

  return { name, city, service, targetReg };
}

/** Generate buyer-intent prompts (+ one branded awareness prompt). */
export function buildPrompts(identity) {
  const { name, city, service, targetReg } = identity;
  const where = city ? ` in ${city}` : '';
  const out = [];
  if (service) {
    out.push({ id: 'd1', kind: 'discovery', text: `Who are the best ${service} companies${where}? List a few with their websites.` });
    out.push({ id: 'd2', kind: 'discovery', text: `I need ${service}${where}. Which company should I hire, and why?` });
    out.push({ id: 'd3', kind: 'discovery', text: `Recommend a few reputable ${service} providers${where}.` });
  }
  if (name) {
    out.push({ id: 'b1', kind: 'branded', text: `What can you tell me about ${name}${where}? Are they reputable, and what do they do?` });
  }
  if (!out.length) {
    out.push({ id: 'd0', kind: 'discovery', text: `Tell me about ${targetReg} — what do they offer and are they reputable?` });
  }
  return out;
}

/** Decide whether the target appears in an answer, and who else does. */
export function analyzeAnswer({ answer = '', sources = [], identity }) {
  const targetReg = identity.targetReg;
  const srcRegs = [];
  for (const s of sources) {
    try {
      srcRegs.push(registrableDomain(new URL(s).hostname));
    } catch {
      /* ignore bad URLs */
    }
  }
  const cited = srcRegs.includes(targetReg);
  const lc = String(answer).toLowerCase();
  const nameHit =
    identity.name && identity.name.length >= 3 && lc.includes(identity.name.toLowerCase());
  const domainHit = lc.includes(targetReg.toLowerCase());
  const mentioned = Boolean(nameHit || domainHit);
  const competitorDomains = [...new Set(srcRegs)].filter(
    (d) => d && d !== targetReg && !BIG_PLATFORMS.has(d)
  );
  return { cited, mentioned, present: cited || mentioned, competitorDomains };
}

/** Query Perplexity's chat/completions API; returns { answer, sources } or { error }. */
export async function queryPerplexity(prompt, { apiKey, model = 'sonar', timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise local-search assistant. Recommend real, specific ' +
              'businesses and include their official website links when you can.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { error: `Perplexity API returned HTTP ${res.status}${t ? ': ' + t.slice(0, 140) : ''}` };
    }
    const data = await res.json();
    const answer = data?.choices?.[0]?.message?.content || '';
    let sources = [];
    if (Array.isArray(data?.search_results)) {
      sources = data.search_results.map((s) => s?.url).filter(Boolean);
    } else if (Array.isArray(data?.citations)) {
      sources = data.citations.filter((c) => typeof c === 'string');
    }
    return { answer, sources };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'Perplexity request timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function excerpt(text, n = 260) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

function buildVerdict(identity, total, cited, brandedKnown, competitors) {
  const who = identity.name || 'This site';
  let v;
  if (total === 0) {
    v = `${who} could not be tested for buyer-style searches automatically.`;
  } else if (cited === 0) {
    const rivals = competitors.slice(0, 3).map((c) => c.domain).join(', ');
    v = `${who} was not surfaced in any of the ${total} buyer-style AI searches` +
      (rivals ? ` — the AI recommended ${rivals} instead.` : ' — the AI named other businesses instead.');
  } else {
    v = `${who} was surfaced in ${cited} of ${total} buyer-style AI searches.`;
  }
  if (brandedKnown === false) v += ` The AI also didn't recognize it by name when asked directly.`;
  else if (brandedKnown === true) v += ` The AI does recognize it by name when asked directly.`;
  return v;
}

/**
 * Run the full AI-citation check for one site.
 * @returns {Promise<object>} report with identity, per-prompt results, summary.
 */
export async function runAiCitation({ finalUrl, html, apiKey, model = 'sonar', onProgress }) {
  const identity = extractIdentity(finalUrl, html);
  const prompts = buildPrompts(identity);
  const results = [];

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    if (onProgress) onProgress({ done: i, total: prompts.length, prompt: p.text });
    const q = await queryPerplexity(p.text, { apiKey, model });
    if (q.error) {
      results.push({ ...p, error: q.error });
      continue;
    }
    const a = analyzeAnswer({ answer: q.answer, sources: q.sources, identity });
    results.push({
      ...p,
      cited: a.cited,
      mentioned: a.mentioned,
      present: a.present,
      competitorDomains: a.competitorDomains,
      answerExcerpt: excerpt(q.answer),
      sources: q.sources.slice(0, 6),
    });
  }
  if (onProgress) onProgress({ done: prompts.length, total: prompts.length });

  const discovery = results.filter((r) => r.kind === 'discovery' && !r.error);
  const discoveryCited = discovery.filter((r) => r.present).length;
  const brand = results.find((r) => r.kind === 'branded' && !r.error);
  const brandedKnown = brand ? brand.present : null;

  const freq = new Map();
  for (const r of discovery) for (const d of r.competitorDomains) freq.set(d, (freq.get(d) || 0) + 1);
  const competitors = [...freq.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    mode: 'ai-citation',
    engine: `Perplexity · ${model}`,
    fetchedAt: new Date().toISOString(),
    identity,
    prompts: results,
    summary: {
      discoveryTotal: discovery.length,
      discoveryCited,
      brandedKnown,
      competitors,
      verdict: buildVerdict(identity, discovery.length, discoveryCited, brandedKnown, competitors),
    },
  };
}
