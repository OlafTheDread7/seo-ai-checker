const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url');
const scanBtn = document.getElementById('scan-btn');
const errorBox = document.getElementById('error');
const hero = document.getElementById('hero');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const results = document.getElementById('results');
const tpl = document.getElementById('tpl-results');
const wholeSiteInput = document.getElementById('whole-site');

const CIRCUMFERENCE = 327; // 2πr, r=52

const LOADING_STEPS = [
  'Fetching the page…',
  'Parsing HTML & meta tags…',
  'Checking robots.txt, sitemap & llms.txt…',
  'Evaluating structured data & AI crawler access…',
  'Scoring & building your report…',
];

function colorFor(score) {
  if (score >= 80) return getVar('--pass');
  if (score >= 60) return getVar('--warn');
  return getVar('--fail');
}
function getVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    urlInput.value = chip.dataset.url;
    form.requestSubmit();
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  const wholeSite = wholeSiteInput && wholeSiteInput.checked;

  // Public mode: a whole-site scan is the gated, heavier path — capture an
  // email before running it. Single-page scans stay free and instant.
  if (wholeSite && window.requireLeadEmail) {
    const ok = await window.requireLeadEmail({ url, scanType: 'site' });
    if (!ok) return;
  }

  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  results.innerHTML = '';
  hero.classList.add('hidden');
  loading.classList.remove('hidden');
  scanBtn.disabled = true;

  if (wholeSite) runSiteScan(url);
  else runSingleScan(url);
});

async function runSingleScan(url) {
  let step = 0;
  loadingText.textContent = LOADING_STEPS[0];
  const stepTimer = setInterval(() => {
    step = Math.min(step + 1, LOADING_STEPS.length - 1);
    loadingText.textContent = LOADING_STEPS[step];
  }, 900);

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    clearInterval(stepTimer);

    if (!res.ok) {
      showError(data.error || 'Something went wrong.');
      return;
    }
    renderReport(data);
  } catch (err) {
    clearInterval(stepTimer);
    showError('Network error — is the server running?');
  } finally {
    scanBtn.disabled = false;
  }
}

// Whole-site scan over Server-Sent Events: live progress, then a final report.
function runSiteScan(url) {
  loadingText.textContent = 'Finding pages to scan…';
  let finished = false;
  const es = new EventSource('/api/scan-site?url=' + encodeURIComponent(url));

  es.addEventListener('progress', (e) => {
    const p = JSON.parse(e.data);
    let path = p.url;
    try {
      path = new URL(p.url).pathname || '/';
    } catch {}
    loadingText.textContent = `Scanning page ${p.done} of ${p.total}…  ${path}`;
  });

  es.addEventListener('done', (e) => {
    finished = true;
    es.close();
    scanBtn.disabled = false;
    renderSiteReport(JSON.parse(e.data));
  });

  es.addEventListener('failed', (e) => {
    finished = true;
    es.close();
    scanBtn.disabled = false;
    let msg = 'Site scan failed.';
    try {
      msg = JSON.parse(e.data).error || msg;
    } catch {}
    showError(msg);
  });

  es.onerror = () => {
    if (finished) return; // normal close after 'done'
    finished = true;
    es.close();
    scanBtn.disabled = false;
    showError('Lost connection during the site scan — is the server running?');
  };
}

function showError(msg) {
  loading.classList.add('hidden');
  hero.classList.remove('hidden');
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function statusClass(s) {
  return { pass: 'pass', warn: 'warn', fail: 'fail', info: 'info' }[s] || 'info';
}
// Inline stroke SVG icons (no emoji — Rule 10). Keys come from analyze.js categories.
const CAT_SVG = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  ai: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};
function catIcon(key, size) {
  const d = CAT_SVG[key] || CAT_SVG.search;
  const px = size || 16;
  return `<svg class="cat-svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function statusGlyph(s) {
  return { pass: '✓', warn: '!', fail: '✕', info: 'i' }[s] || 'i';
}

function renderReport(data) {
  loading.classList.add('hidden');

  const node = tpl.content.cloneNode(true);

  // URL + counts
  node.querySelector('.scanned-url').textContent = data.finalUrl || data.url;
  node.querySelector('.c-pass').textContent = data.counts.pass;
  node.querySelector('.c-warn').textContent = data.counts.warn;
  node.querySelector('.c-fail').textContent = data.counts.fail;
  node.querySelector('.gauge-grade').textContent = 'Grade ' + data.grade;

  // Category bars
  const bars = node.querySelector('.cat-bars');
  data.categories.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'cat-bar-row';
    row.innerHTML = `
      <div class="cat-bar-label">${catIcon(cat.icon)} ${cat.title}</div>
      <div class="cat-bar-track"><div class="cat-bar-fill"></div></div>
      <div class="cat-bar-val">${cat.score}</div>`;
    const fill = row.querySelector('.cat-bar-fill');
    fill.style.background = colorFor(cat.score);
    bars.appendChild(row);
    requestAnimationFrame(() => {
      setTimeout(() => (fill.style.width = cat.score + '%'), 120);
    });
  });

  // Top fixes
  const fixesList = node.querySelector('.fixes-list');
  const topFixes = node.querySelector('.top-fixes');
  if (data.topFixes.length === 0) {
    topFixes.querySelector('h3').textContent = 'No major issues found — nice work.';
    fixesList.remove();
  } else {
    data.topFixes.forEach((fix) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="fix-title">${escapeHtml(fix.label)}</span>
        <span class="fix-cat">· ${escapeHtml(fix.category)}</span>
        <div class="fix-rec">${escapeHtml(fix.recommendation)}</div>`;
      fixesList.appendChild(li);
    });
  }

  // Fix-it prompt for Claude
  const promptCard = node.querySelector('.fix-prompt');
  const issueCount = data.counts.warn + data.counts.fail;
  if (issueCount === 0) {
    promptCard.remove();
  } else {
    const promptEl = node.querySelector('.fix-prompt-text');
    const countEl = node.querySelector('.fix-prompt-count');
    const toggle = node.querySelector('.include-pass-toggle');
    countEl.textContent = `${issueCount} issue${issueCount === 1 ? '' : 's'}`;

    // Regenerate the prompt whenever the "include passing" toggle changes.
    const render = () => {
      promptEl.textContent = buildFixPrompt(data, toggle.checked);
    };
    render();
    toggle.addEventListener('change', render);

    const copyBtn = node.querySelector('.copy-btn');
    // Copy whatever is currently shown, so it respects the toggle state.
    copyBtn.addEventListener('click', () => copyText(promptEl.textContent, copyBtn));
  }

  // Category cards
  const cats = node.querySelector('.categories');
  data.categories.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'cat-card' + (i === 0 ? ' open' : '');
    const badgeColor = colorFor(cat.score);

    const header = document.createElement('div');
    header.className = 'cat-header';
    header.innerHTML = `
      <span class="cat-icon">${catIcon(cat.icon, 20)}</span>
      <span class="cat-title">${cat.title}</span>
      <span class="cat-score-badge" style="background:${hexA(badgeColor, 0.16)};color:${badgeColor}">${cat.score}</span>
      <span class="cat-caret">▸</span>`;
    header.addEventListener('click', () => card.classList.toggle('open'));

    const checksWrap = document.createElement('div');
    checksWrap.className = 'cat-checks';
    const inner = document.createElement('div');
    inner.className = 'cat-checks-inner';

    cat.checks.forEach((chk) => {
      const c = statusClass(chk.status);
      const el = document.createElement('div');
      el.className = 'check';
      el.innerHTML = `
        <div class="check-dot dot-${c}">${statusGlyph(chk.status)}</div>
        <div class="check-body">
          <div class="check-label">${escapeHtml(chk.label)}</div>
          <div class="check-msg">${escapeHtml(chk.message)}</div>
          ${chk.detail ? `<div class="check-detail">${escapeHtml(chk.detail)}</div>` : ''}
          <div class="check-rec">${escapeHtml(chk.recommendation)}</div>
        </div>`;
      inner.appendChild(el);
    });

    checksWrap.appendChild(inner);
    card.appendChild(header);
    card.appendChild(checksWrap);
    cats.appendChild(card);
  });

  // Competitor benchmark CTA
  const rescanSingle = node.querySelector('.rescan');
  rescanSingle.parentNode.insertBefore(
    makeCompetitorCTA(data.finalUrl || data.url),
    rescanSingle
  );
  // AI-visibility CTA (only appears if the server has a Perplexity key).
  if (window.mountAiVisibilityCTA) {
    window.mountAiVisibilityCTA(data.finalUrl || data.url, rescanSingle);
  }

  // Rescan
  node.querySelector('#rescan-btn').addEventListener('click', () => {
    results.classList.add('hidden');
    hero.classList.remove('hidden');
    urlInput.focus();
    urlInput.select();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  results.appendChild(node);
  results.classList.remove('hidden');

  if (window.publicGateReport) window.publicGateReport('single', data);
  else if (window.mountReportPdf) window.mountReportPdf('single', data);

  // Animate gauge
  const gaugeFill = results.querySelector('.gauge-fill');
  const gaugeScore = results.querySelector('.gauge-score');
  const col = colorFor(data.overall);
  gaugeFill.style.stroke = col;
  results.querySelector('.gauge-grade').style.color = col;
  requestAnimationFrame(() => {
    setTimeout(() => {
      gaugeFill.style.strokeDashoffset =
        CIRCUMFERENCE - (CIRCUMFERENCE * data.overall) / 100;
    }, 150);
  });
  animateNumber(gaugeScore, data.overall, 1100);

  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function animateNumber(el, to, duration) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * to);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// --------------------------------------------------------------------------
// Whole-site report
// --------------------------------------------------------------------------

function shortPath(u) {
  try {
    const url = new URL(u);
    return (url.pathname || '/') + (url.search || '');
  } catch {
    return u;
  }
}

function renderSiteReport(data) {
  loading.classList.add('hidden');

  const container = document.createElement('div');
  const hasIssues = data.issues.length > 0;

  container.innerHTML = `
    <div class="report-head">
      <div class="score-block">
        <div class="gauge">
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle class="gauge-track" cx="60" cy="60" r="52"></circle>
            <circle class="gauge-fill" cx="60" cy="60" r="52"></circle>
          </svg>
          <div class="gauge-center">
            <span class="gauge-score">0</span>
            <span class="gauge-grade">Grade ${escapeHtml(data.grade)}</span>
          </div>
        </div>
        <div class="score-meta">
          <h2>Site score</h2>
          <p class="scanned-url">${escapeHtml(data.origin)} · ${data.pagesScanned} page${data.pagesScanned === 1 ? '' : 's'} scanned</p>
          <div class="pill-row">
            <span class="pill"><b class="c-pass">${data.counts.pass}</b> passed</span>
            <span class="pill"><b class="c-warn">${data.counts.warn}</b> to improve</span>
            <span class="pill"><b class="c-fail">${data.counts.fail}</b> failing</span>
          </div>
        </div>
      </div>
      <div class="cat-bars"></div>
    </div>

    <div class="pages-scanned">
      <h3>Pages scanned (${data.pagesScanned})</h3>
      <div class="page-list"></div>
    </div>

    <div class="fix-prompt">
      <div class="fix-prompt-head">
        <div class="fix-prompt-title">
          <h3>Fix-it prompt for Claude</h3>
          <span class="fix-prompt-count"></span>
        </div>
        <button class="copy-btn" type="button">Copy to clipboard</button>
      </div>
      <p class="fix-prompt-sub">
        A ready-to-use prompt covering every flagged issue across the whole
        site. Paste it into Claude (e.g. Cowork) to fix them in your code.
      </p>
      <label class="toggle include-pass">
        <input type="checkbox" class="include-pass-toggle" />
        <span class="switch"></span>
        <span class="toggle-label">Include passing checks (full audit record)</span>
      </label>
      <pre class="fix-prompt-text"></pre>
    </div>

    <div class="site-issues">
      <h3>Issues across the site (${data.issues.length})</h3>
      <div class="issue-list"></div>
    </div>

    <div class="rescan">
      <button id="rescan-btn">Scan another site</button>
    </div>`;

  // Category bars
  const bars = container.querySelector('.cat-bars');
  data.categories.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'cat-bar-row';
    row.innerHTML = `
      <div class="cat-bar-label">${catIcon(cat.icon)} ${escapeHtml(cat.title)}</div>
      <div class="cat-bar-track"><div class="cat-bar-fill"></div></div>
      <div class="cat-bar-val">${cat.score}</div>`;
    const fill = row.querySelector('.cat-bar-fill');
    fill.style.background = colorFor(cat.score);
    bars.appendChild(row);
    requestAnimationFrame(() =>
      setTimeout(() => (fill.style.width = cat.score + '%'), 120)
    );
  });

  // Per-page list (worst first)
  const pageList = container.querySelector('.page-list');
  data.pages.forEach((p) => {
    const col = colorFor(p.overall);
    const row = document.createElement('div');
    row.className = 'page-row';
    row.innerHTML = `
      <span class="page-score" style="color:${col};background:${hexA(col, 0.16)}">${p.overall}</span>
      <a class="page-url" href="${encodeURI(p.url)}" target="_blank" rel="noopener" title="${escapeHtml(p.url)}">${escapeHtml(shortPath(p.url))}</a>
      <span class="page-grade">${escapeHtml(p.grade)}</span>`;
    pageList.appendChild(row);
  });

  // Fix-it prompt (+ include-passing toggle)
  const promptCard = container.querySelector('.fix-prompt');
  if (!hasIssues) {
    promptCard.remove();
  } else {
    const promptEl = container.querySelector('.fix-prompt-text');
    const countEl = container.querySelector('.fix-prompt-count');
    const toggle = container.querySelector('.include-pass-toggle');
    countEl.textContent = `${data.issues.length} issue${data.issues.length === 1 ? '' : 's'}`;
    const render = () => {
      promptEl.textContent = buildSiteFixPrompt(data, toggle.checked);
    };
    render();
    toggle.addEventListener('change', render);
    const copyBtn = container.querySelector('.copy-btn');
    copyBtn.addEventListener('click', () => copyText(promptEl.textContent, copyBtn));
  }

  // Issue cards (grouped across pages)
  const issueList = container.querySelector('.issue-list');
  if (!hasIssues) {
    issueList.innerHTML =
      '<p class="no-issues">No issues found on any scanned page — excellent.</p>';
  }
  data.issues.forEach((iss) => {
    const c = statusClass(iss.worst);
    const card = document.createElement('div');
    card.className = 'issue-card';

    const scopeText =
      iss.scope === 'site'
        ? 'Site-wide (whole domain)'
        : `Affects ${iss.affectedCount} page${iss.affectedCount === 1 ? '' : 's'}`;

    const canExpand = iss.scope !== 'site' && iss.pages.length > 0;

    card.innerHTML = `
      <div class="issue-head">
        <div class="check-dot dot-${c}">${statusGlyph(iss.worst)}</div>
        <div class="issue-main">
          <div class="issue-label">${escapeHtml(iss.label)}<span class="fix-cat"> · ${escapeHtml(iss.category)}</span></div>
          <div class="issue-scope">${scopeText}</div>
        </div>
        ${canExpand ? '<button class="issue-expand" type="button">Show pages ▸</button>' : ''}
      </div>
      <div class="issue-rec">${escapeHtml(iss.recommendation)}</div>
      ${canExpand ? '<ul class="affected-list hidden"></ul>' : ''}`;

    if (canExpand) {
      const ul = card.querySelector('.affected-list');
      iss.pages.forEach((p) => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${encodeURI(p.url)}" target="_blank" rel="noopener">${escapeHtml(shortPath(p.url))}</a>`;
        ul.appendChild(li);
      });
      const btn = card.querySelector('.issue-expand');
      btn.addEventListener('click', () => {
        const hidden = ul.classList.toggle('hidden');
        btn.textContent = hidden ? 'Show pages ▸' : 'Hide pages ▾';
      });
    }

    issueList.appendChild(card);
  });

  // Competitor benchmark CTA
  const rescanSite = container.querySelector('.rescan');
  container.insertBefore(makeCompetitorCTA(data.origin), rescanSite);
  // AI-visibility CTA (only appears if the server has a Perplexity key).
  if (window.mountAiVisibilityCTA) {
    window.mountAiVisibilityCTA(data.origin, rescanSite);
  }

  // Rescan
  container.querySelector('#rescan-btn').addEventListener('click', () => {
    results.classList.add('hidden');
    hero.classList.remove('hidden');
    urlInput.focus();
    urlInput.select();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  results.appendChild(container);
  results.classList.remove('hidden');

  if (window.publicGateReport) window.publicGateReport('site', data);
  else if (window.mountReportPdf) window.mountReportPdf('site', data);

  // Animate gauge
  const gaugeFill = results.querySelector('.gauge-fill');
  const gaugeScore = results.querySelector('.gauge-score');
  const col = colorFor(data.overall);
  gaugeFill.style.stroke = col;
  results.querySelector('.gauge-grade').style.color = col;
  requestAnimationFrame(() =>
    setTimeout(() => {
      gaugeFill.style.strokeDashoffset =
        CIRCUMFERENCE - (CIRCUMFERENCE * data.overall) / 100;
    }, 150)
  );
  animateNumber(gaugeScore, data.overall, 1100);

  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Build a whole-site fix prompt: issues grouped across pages, with affected
// page lists and site-wide issues flagged.
function buildSiteFixPrompt(data, includePassing = false) {
  const L = [];
  L.push(
    "You are helping me improve my website's SEO and AI-searchability — how " +
      'well it ranks in traditional search AND how well AI answer engines ' +
      '(ChatGPT, Perplexity, Google Gemini, Claude) can read, understand, and ' +
      'cite it.'
  );
  L.push('');
  L.push(
    `I audited my whole site at ${data.origin} — ${data.pagesScanned} page` +
      `${data.pagesScanned === 1 ? '' : 's'} scanned, starting from ` +
      `${data.startUrl}. The site scored ${data.overall}/100 (grade ` +
      `${data.grade}). Category averages: ` +
      data.categories.map((c) => `${c.title} ${c.score}/100`).join(', ') +
      '.'
  );
  L.push('');
  L.push(
    'Please fix the issues below across the site, in priority order (High ' +
      'before Medium). Many issues affect multiple pages — when a fix belongs ' +
      'in a shared layout, template, or component, change it once there rather ' +
      'than editing each page. For each issue: locate the relevant file(s), ' +
      'make the change, and briefly note what you changed and why. If a fix ' +
      'needs information only I have (page copy, a brand or author name, ' +
      'publish dates, canonical URLs), ask me instead of guessing.'
  );
  L.push('');
  L.push('Issues, grouped across the site:');

  let n = 0;
  for (const iss of data.issues) {
    n++;
    const pr = iss.worst === 'fail' ? 'High' : 'Medium';
    L.push('');
    if (iss.scope === 'site') {
      L.push(`${n}. [${pr}] ${iss.label} (${iss.category}) — site-wide (applies to the whole domain).`);
      if (iss.pages[0]?.message) L.push(`   Detail: ${iss.pages[0].message}`);
      L.push(`   What to do: ${iss.recommendation}`);
    } else {
      L.push(`${n}. [${pr}] ${iss.label} (${iss.category}) — affects ${iss.affectedCount} page(s).`);
      L.push(`   What to do: ${iss.recommendation}`);
      const urls = iss.pages.map((p) => p.url);
      const show = urls.slice(0, 15);
      L.push('   Affected pages:');
      show.forEach((u) => L.push(`     - ${u}`));
      if (urls.length > show.length) {
        L.push(`     …and ${urls.length - show.length} more`);
      }
    }
  }

  L.push('');
  L.push(
    'When you are done, give me a concise summary of every change you made, ' +
      'grouped by file, and flag anything you could not fix automatically.'
  );

  if (includePassing && data.passingEverywhere && data.passingEverywhere.length) {
    L.push('');
    L.push('---');
    L.push('');
    L.push(
      `APPENDIX — checks that PASS on all ${data.pagesScanned} scanned pages ` +
        '(no changes needed; included so this is a complete audit record):'
    );
    for (const c of data.passingEverywhere) {
      L.push(`- [OK] ${c.label} (${c.category})`);
    }
  }

  return L.join('\n');
}

// --------------------------------------------------------------------------
// Competitor benchmark
// --------------------------------------------------------------------------

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

function checkMap(report) {
  const m = {};
  report.categories.forEach((c) =>
    c.checks.forEach((ch) => {
      m[ch.id] = {
        status: ch.status,
        label: ch.label,
        category: c.title,
        recommendation: ch.recommendation,
        message: ch.message,
        detail: ch.detail,
      };
    })
  );
  return m;
}

// A call-to-action panel appended to any report, offering auto-discovery or
// manual competitor entry.
function makeCompetitorCTA(url) {
  const el = document.createElement('div');
  el.className = 'competitor-cta';
  el.innerHTML = `
    <h3>Benchmark against competitors</h3>
    <p>See how your SEO &amp; AI searchability compares. We'll try to find
      competitors automatically — or enter their URLs to compare exactly who
      you choose.</p>
    <div class="comp-input-row">
      <input class="rivals-input" type="text" spellcheck="false"
        placeholder="optional: competitor1.com, competitor2.com" />
      <button class="compare-btn" type="button">Compare competitors</button>
    </div>`;
  const input = el.querySelector('.rivals-input');
  el.querySelector('.compare-btn').addEventListener('click', () => {
    startCompetitorScan(url, input.value.trim() || null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startCompetitorScan(url, input.value.trim() || null);
  });
  return el;
}

function startCompetitorScan(url, rivals) {
  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  results.innerHTML = '';
  hero.classList.add('hidden');
  loading.classList.remove('hidden');
  loadingText.textContent = rivals ? 'Scanning competitors…' : 'Finding competitors…';
  scanBtn.disabled = true;

  let finished = false;
  const q =
    '/api/competitors?url=' +
    encodeURIComponent(url) +
    (rivals ? '&rivals=' + encodeURIComponent(rivals) : '');
  const es = new EventSource(q);

  es.addEventListener('status', (e) => {
    try {
      loadingText.textContent = JSON.parse(e.data).message;
    } catch {}
  });
  es.addEventListener('done', (e) => {
    finished = true;
    es.close();
    scanBtn.disabled = false;
    renderCompetitorScreen({ url, data: JSON.parse(e.data) });
  });
  es.addEventListener('failed', (e) => {
    finished = true;
    es.close();
    scanBtn.disabled = false;
    let d = {};
    try {
      d = JSON.parse(e.data);
    } catch {}
    renderCompetitorScreen({
      url,
      error: d.error || 'Competitor analysis failed.',
      prefill: rivals || '',
    });
  });
  es.onerror = () => {
    if (finished) return;
    finished = true;
    es.close();
    scanBtn.disabled = false;
    renderCompetitorScreen({
      url,
      error: 'Lost connection during competitor analysis — is the server running?',
      prefill: rivals || '',
    });
  };
}

function renderCompetitorScreen({ url, data, error, prefill }) {
  loading.classList.add('hidden');
  const container = document.createElement('div');

  container.innerHTML = `
    <div class="competitor-head">
      <h2>Competitor benchmark</h2>
      <p class="scanned-url">Your site: ${escapeHtml(url)}</p>
    </div>
    <div class="competitor-manual">
      <label class="cm-label">Compare specific competitors</label>
      <div class="comp-input-row">
        <input class="rivals-input" type="text" spellcheck="false"
          placeholder="competitor1.com, competitor2.com" value="${escapeHtml(prefill || '')}" />
        <button class="compare-btn" type="button">Compare</button>
      </div>
      <p class="cm-hint">Leave blank and click Compare to auto-find competitors.</p>
    </div>
    <div class="competitor-body"></div>
    <div class="rescan"><button id="rescan-btn">New scan</button></div>`;

  const input = container.querySelector('.rivals-input');
  container.querySelector('.compare-btn').addEventListener('click', () =>
    startCompetitorScan(url, input.value.trim() || null)
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startCompetitorScan(url, input.value.trim() || null);
  });
  container.querySelector('#rescan-btn').addEventListener('click', () => {
    results.classList.add('hidden');
    hero.classList.remove('hidden');
    urlInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const body = container.querySelector('.competitor-body');
  if (error) {
    body.innerHTML = `<div class="comp-error">${escapeHtml(error)}</div>`;
  } else if (data) {
    body.appendChild(buildComparison(data));
  }

  results.innerHTML = '';
  results.appendChild(container);
  results.classList.remove('hidden');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildComparison(data) {
  const frag = document.createDocumentFragment();
  const catKeys = data.target.report.categories.map((c) => c.key);
  const catMeta = data.target.report.categories;

  const sites = [
    { host: 'Your site', url: data.target.url, report: data.target.report, isYou: true },
    ...data.competitors.map((c) => ({
      host: hostOf(c.url),
      url: c.url,
      report: c.report,
      isYou: false,
    })),
  ];

  const catScore = (report, key) =>
    (report.categories.find((c) => c.key === key) || {}).score ?? 0;

  // Column maxima (for bolding the leader in each column)
  const maxByCol = { overall: Math.max(...sites.map((s) => s.report.overall)) };
  catKeys.forEach((k) => {
    maxByCol[k] = Math.max(...sites.map((s) => catScore(s.report, k)));
  });

  // Table
  const table = document.createElement('div');
  table.className = 'cmp-table-wrap';
  const header =
    '<div class="cmp-row cmp-head">' +
    '<div class="cmp-site">Site</div>' +
    '<div class="cmp-cell">Overall</div>' +
    catMeta.map((c) => `<div class="cmp-cell" title="${escapeHtml(c.title)}">${catIcon(c.icon)}</div>`).join('') +
    '</div>';

  const rows = sites
    .map((s) => {
      const cells = [
        { key: 'overall', val: s.report.overall },
        ...catKeys.map((k) => ({ key: k, val: catScore(s.report, k) })),
      ]
        .map((c) => {
          const col = colorFor(c.val);
          const lead = c.val === maxByCol[c.key] ? ' cmp-lead' : '';
          return `<div class="cmp-cell"><span class="cmp-score${lead}" style="color:${col};background:${hexA(col, 0.16)}">${c.val}</span></div>`;
        })
        .join('');
      const name = s.isYou
        ? '<b>Your site</b>'
        : `<a href="${encodeURI(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.host)}</a>`;
      return `<div class="cmp-row${s.isYou ? ' cmp-you' : ''}"><div class="cmp-site">${name}</div>${cells}</div>`;
    })
    .join('');
  table.innerHTML =
    header +
    rows +
    `<div class="cmp-legend">Columns: Overall · ${catMeta
      .map((c) => `${catIcon(c.icon, 13)} ${escapeHtml(c.title)}`)
      .join(' · ')}</div>`;
  frag.appendChild(table);

  // Takeaways
  const rivals = data.competitors.map((c) => c.report);
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const target = data.target.report;
  const takeaways = [];

  const rivalAvgOverall = avg(rivals.map((r) => r.overall));
  if (target.overall >= rivalAvgOverall) {
    takeaways.push(
      `Your overall score (${target.overall}) beats the competitor average (${rivalAvgOverall}).`
    );
  } else {
    takeaways.push(
      `Your overall score (${target.overall}) trails the competitor average (${rivalAvgOverall}) by ${rivalAvgOverall - target.overall}.`
    );
  }

  catMeta.forEach((c) => {
    const rAvg = avg(rivals.map((r) => catScore(r, c.key)));
    const t = catScore(target, c.key);
    if (t < rAvg - 4) {
      takeaways.push(
        `${c.title}: you score ${t} vs competitor average ${rAvg}.`
      );
    }
  });

  // Opportunities: things competitors do that you don't
  const tm = checkMap(target);
  const rivalMaps = rivals.map(checkMap);
  const opps = [];
  for (const id of Object.keys(tm)) {
    if (tm[id].status !== 'fail' && tm[id].status !== 'warn') continue;
    const passCount = rivalMaps.filter((rm) => rm[id] && rm[id].status === 'pass').length;
    if (passCount > 0) opps.push({ ...tm[id], passCount, total: rivals.length });
  }
  opps.sort((a, b) => b.passCount - a.passCount);

  const takeawayHtml = takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  const oppHtml = opps
    .slice(0, 6)
    .map(
      (o) =>
        `<li><b>${o.passCount}/${o.total}</b> competitors have <b>${escapeHtml(o.label)}</b> — you ${o.status === 'fail' ? "don't" : 'fall short'}. <span class="opp-rec">${escapeHtml(o.recommendation)}</span></li>`
    )
    .join('');

  const insights = document.createElement('div');
  insights.className = 'takeaways';
  insights.innerHTML =
    '<h3>Takeaways</h3><ul class="takeaway-list">' +
    takeawayHtml +
    '</ul>' +
    (opps.length
      ? '<h3>What competitors do that you don\'t</h3><ul class="opp-list">' +
        oppHtml +
        '</ul>'
      : '');
  frag.appendChild(insights);

  // Competitor-aware fix prompt
  const issueCount = target.counts.warn + target.counts.fail;
  const card = document.createElement('div');
  card.className = 'fix-prompt';
  card.innerHTML = `
    <div class="fix-prompt-head">
      <div class="fix-prompt-title">
        <h3>Competitor-aware fix prompt</h3>
        <span class="fix-prompt-count"></span>
      </div>
      <button class="copy-btn" type="button">Copy to clipboard</button>
    </div>
    <p class="fix-prompt-sub">
      Fixes your issues <b>and</b> closes the gaps your competitors have opened —
      with a concrete competitor to emulate for each. Paste into Claude (e.g. Cowork).
    </p>
    <label class="toggle include-pass">
      <input type="checkbox" class="include-pass-toggle" />
      <span class="switch"></span>
      <span class="toggle-label">Include passing checks (full audit record)</span>
    </label>
    <pre class="fix-prompt-text"></pre>`;
  const promptEl = card.querySelector('.fix-prompt-text');
  const toggle = card.querySelector('.include-pass-toggle');
  card.querySelector('.fix-prompt-count').textContent =
    `${issueCount} issue${issueCount === 1 ? '' : 's'}`;
  const renderPrompt = () => {
    promptEl.textContent = buildCompetitorFixPrompt(data, toggle.checked);
  };
  renderPrompt();
  toggle.addEventListener('change', renderPrompt);
  const copyBtn = card.querySelector('.copy-btn');
  copyBtn.addEventListener('click', () => copyText(promptEl.textContent, copyBtn));
  frag.appendChild(card);

  return frag;
}

// Build a fix prompt that folds in competitive intelligence: your issues split
// into "competitive gaps" (things rivals do that you don't, with a competitor
// example to emulate) and "other issues".
function buildCompetitorFixPrompt(data, includePassing = false) {
  const target = data.target.report;
  const rivals = data.competitors;
  const catScore = (r, k) => (r.categories.find((c) => c.key === k) || {}).score ?? 0;
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const L = [];

  L.push(
    "You are helping me improve my website's SEO and AI-searchability, with the " +
      'explicit goal of matching or beating the named competitors below. Both ' +
      'traditional search ranking and how well AI answer engines (ChatGPT, ' +
      'Perplexity, Gemini, Claude) can read and cite the site matter.'
  );
  L.push('');
  L.push(`My site: ${data.target.url} — overall ${target.overall}/100 (grade ${target.grade}).`);
  L.push(`My category scores: ${target.categories.map((c) => `${c.title} ${c.score}`).join(', ')}.`);
  L.push('');
  L.push('Competitors I want to match or beat:');
  rivals.forEach((r) => {
    L.push(
      `  - ${hostOf(r.url)} — overall ${r.report.overall} ` +
        `(${r.report.categories.map((c) => `${c.title.split(' ')[0]} ${c.score}`).join(', ')})`
    );
  });
  L.push(`  Competitor average overall: ${avg(rivals.map((r) => r.report.overall))}.`);

  const trailing = target.categories
    .filter((c) => catScore(target, c.key) < avg(rivals.map((r) => catScore(r.report, c.key))) - 4)
    .map((c) => c.title);
  if (trailing.length) L.push(`Where I most need to catch up: ${trailing.join(', ')}.`);
  L.push('');
  L.push(
    'Fix everything below. For each item, find the relevant file(s), make the ' +
      'change, and note what you changed and why. If a fix needs information only ' +
      'I have (page copy, a brand or author name, publish dates, canonical URLs), ' +
      'ask me instead of guessing.'
  );

  const tm = checkMap(target);
  const rms = rivals.map((r) => ({ host: hostOf(r.url), map: checkMap(r.report) }));
  const gaps = [];
  const others = [];
  for (const id of Object.keys(tm)) {
    const s = tm[id].status;
    if (s !== 'fail' && s !== 'warn') continue;
    const passers = rms.filter((rm) => rm.map[id] && rm.map[id].status === 'pass');
    (passers.length ? gaps : others).push({ id, ...tm[id], passers });
  }
  const sev = (s) => (s === 'fail' ? 2 : 1);
  gaps.sort((a, b) => b.passers.length - a.passers.length || sev(b.status) - sev(a.status));
  others.sort((a, b) => sev(b.status) - sev(a.status));

  let n = 0;
  L.push('');
  L.push('== PRIORITY 1: Competitive gaps (competitors do this, my site does not) ==');
  if (!gaps.length) L.push('None — my site already matches competitors on every check they pass.');
  for (const g of gaps) {
    n++;
    const pr = g.status === 'fail' ? 'High' : 'Medium';
    L.push('');
    L.push(`${n}. [${pr}] ${g.label} (${g.category}) — ${g.passers.length}/${rivals.length} competitors do this; I do not.`);
    L.push(`   My status: ${g.message}`);
    const ex = g.passers[0];
    const exCheck = ex && ex.map[g.id];
    if (exCheck && exCheck.message) {
      L.push(
        `   Competitor to emulate — ${ex.host}: ${exCheck.message}` +
          (exCheck.detail ? ` (${exCheck.detail})` : '')
      );
    }
    L.push(`   What to do: ${g.recommendation}`);
  }

  L.push('');
  L.push('== PRIORITY 2: My other issues (not a competitor gap, still worth fixing) ==');
  if (!others.length) L.push('None.');
  for (const o of others) {
    n++;
    const pr = o.status === 'fail' ? 'High' : 'Medium';
    L.push('');
    L.push(`${n}. [${pr}] ${o.label} (${o.category}) — ${o.message}`);
    L.push(`   What to do: ${o.recommendation}`);
  }

  L.push('');
  L.push(
    'When done, summarize every change grouped by file, note anything you could ' +
      'not fix automatically, and tell me which competitor gaps I have now closed.'
  );

  if (includePassing) {
    const passing = target.categories.flatMap((c) =>
      c.checks
        .filter((ch) => ch.status === 'pass' || ch.status === 'info')
        .map((ch) => ({ label: ch.label, category: c.title }))
    );
    if (passing.length) {
      L.push('');
      L.push('---');
      L.push('');
      L.push('APPENDIX — checks my site already passes (no changes needed):');
      passing.forEach((p) => L.push(`- [OK] ${p.label} (${p.category})`));
    }
  }

  return L.join('\n');
}

// Aggregate every flagged item (fail + warn) into one actionable prompt that
// can be pasted into Claude to fix the issues in the site's code.
function buildFixPrompt(data, includePassing = false) {
  const url = data.finalUrl || data.url;
  const priority = (s) => (s === 'fail' ? 'High' : 'Medium');
  const L = [];

  L.push(
    "You are helping me improve my website's SEO and AI-searchability — how " +
      'well it ranks in traditional search AND how well AI answer engines ' +
      '(ChatGPT, Perplexity, Google Gemini, Claude) can read, understand, and ' +
      'cite it.'
  );
  L.push('');
  L.push(
    `I audited ${url} with an SEO + AI-searchability checker. It scored ` +
      `${data.overall}/100 (grade ${data.grade}). The category scores were: ` +
      data.categories.map((c) => `${c.title} ${c.score}/100`).join(', ') +
      '.'
  );
  L.push('');
  L.push(
    "Please fix the issues listed below in my website's code. Work through " +
      'them in priority order (High before Medium). For each issue: locate the ' +
      'relevant file(s), make the change, and then briefly note what you ' +
      'changed and why. If a fix needs information only I have (page copy, a ' +
      'brand or author name, publish dates, a canonical URL, etc.), ask me ' +
      'instead of guessing.'
  );
  L.push('');
  L.push('Issues to fix, grouped by area:');

  let n = 0;
  for (const cat of data.categories) {
    const issues = cat.checks.filter(
      (c) => c.status === 'fail' || c.status === 'warn'
    );
    if (!issues.length) continue;
    L.push('');
    L.push(`## ${cat.title} (currently ${cat.score}/100)`);
    for (const c of issues) {
      n++;
      L.push('');
      L.push(`${n}. [${priority(c.status)}] ${c.label} — ${c.message}`);
      L.push(`   What to do: ${c.recommendation}`);
      if (c.detail) L.push(`   Current value found: ${c.detail}`);
    }
  }

  L.push('');
  L.push(
    'When you are done, give me a concise summary of every change you made, ' +
      'grouped by file, and flag anything you could not fix automatically.'
  );

  // Optional appendix: everything that already passes, as a full audit record.
  if (includePassing) {
    const passLines = [];
    for (const cat of data.categories) {
      const passing = cat.checks.filter(
        (c) => c.status === 'pass' || c.status === 'info'
      );
      if (!passing.length) continue;
      passLines.push('');
      passLines.push(`## ${cat.title}`);
      for (const c of passing) {
        passLines.push(`- [OK] ${c.label} — ${c.message}`);
      }
    }
    if (passLines.length) {
      L.push('');
      L.push('---');
      L.push('');
      L.push(
        'APPENDIX — checks that already PASS (no changes needed; included so ' +
          'this prompt is a complete audit record):'
      );
      L.push(...passLines);
    }
  }

  return L.join('\n');
}

// Copy text to the clipboard with a graceful fallback + button feedback.
async function copyText(text, btn) {
  const done = () => {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = btn.dataset.label;
      btn.classList.remove('copied');
    }, 1800);
  };

  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      btn.textContent = 'Press Ctrl+C to copy';
    }
    document.body.removeChild(ta);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Convert a CSS color (hex) to rgba with alpha.
function hexA(hex, alpha) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---- Quiz handoff ----------------------------------------------------------
// rvadigitalworks.com's lead quiz deep-links here as ?url=<site>&src=quiz once
// the lead has already been captured (name/email/phone/answers went out via the
// quiz's own Web3Forms submission). We auto-run a single-page scan and, when
// src=quiz, public-gate.js treats the report as already unlocked and keeps the
// branded PDF available. No personal data rides in the URL on purpose.
(function quizHandoff() {
  try {
    const p = new URLSearchParams(location.search);
    const u = (p.get('url') || '').trim();
    if (p.get('src') === 'quiz') window.__QUIZ_LEAD = { source: 'quiz' };
    if (!u) return;
    urlInput.value = u;
    // Quiz payoff is the instant single-page report; the whole-site crawl is
    // the heavy, gated path and would re-prompt for an email.
    if (wholeSiteInput) wholeSiteInput.checked = false;
    const go = () => (form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  } catch (e) { /* never block the tool over a bad param */ }
})();
