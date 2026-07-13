const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url');
const scanBtn = document.getElementById('scan-btn');
const errorBox = document.getElementById('error');
const hero = document.getElementById('hero');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const results = document.getElementById('results');
const tpl = document.getElementById('tpl-results');

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

  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  results.innerHTML = '';
  hero.classList.add('hidden');
  loading.classList.remove('hidden');
  scanBtn.disabled = true;

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
});

function showError(msg) {
  loading.classList.add('hidden');
  hero.classList.remove('hidden');
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function statusClass(s) {
  return { pass: 'pass', warn: 'warn', fail: 'fail', info: 'info' }[s] || 'info';
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
      <div class="cat-bar-label">${cat.icon} ${cat.title}</div>
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
    topFixes.querySelector('h3').textContent = '🎉 No major issues found — nice work!';
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

  // Category cards
  const cats = node.querySelector('.categories');
  data.categories.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'cat-card' + (i === 0 ? ' open' : '');
    const badgeColor = colorFor(cat.score);

    const header = document.createElement('div');
    header.className = 'cat-header';
    header.innerHTML = `
      <span class="cat-icon">${cat.icon}</span>
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
