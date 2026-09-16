/* RVA Digital Works — public lead-gate layer for the Search Visibility tool.
   Active only when the server reports PUBLIC_MODE. It (1) lets a single-page
   scan run free but hides the full issue list + PDF behind an email, (2) requires
   an email before a whole-site scan runs, and (3) adds a hire-us CTA to results.
   In internal mode this file does nothing. */
(function () {
  'use strict';

  window.PUBLIC_MODE = false;
  window.__W3F_KEY = '';
  const QUOTE_URL = 'https://rvadigitalworks.com/#contact';

  // Discover runtime mode + the Web3Forms key. Fire immediately.
  fetch('/api/config')
    .then((r) => r.json())
    .then((c) => {
      window.PUBLIC_MODE = !!c.publicMode;
      window.__W3F_KEY = c.web3formsKey || '';
      if (window.PUBLIC_MODE) stripPaidFeatures();
    })
    .catch(() => {});

  // In public mode we remove the features we sell rather than give away: the
  // "Fix-it prompt for Claude" and the branded PDF download button. This strips
  // them from the single-page report, the whole-site report, AND the competitor
  // view (which builds its own), now and whenever new results render.
  function stripPaidFeatures() {
    // Quiz leads (arrived via rvadigitalworks.com's lead quiz, contact already
    // captured) earn the branded PDF; anonymous visitors still don't. The
    // Claude fix-prompt stays a paid feature for everyone.
    const strip = (el) => el && el.querySelectorAll(window.__QUIZ_LEAD ? '.fix-prompt' : '.fix-prompt, .pdf-cta').forEach((n) => n.remove());
    const results = document.getElementById('results');
    if (!results) {
      document.addEventListener('DOMContentLoaded', stripPaidFeatures, { once: true });
      return;
    }
    strip(results);
    new MutationObserver(() => strip(results)).observe(results, { childList: true, subtree: true });
  }

  function issueCount(type, data) {
    if (type === 'site') return (data.issues || []).length;
    return (data.counts?.warn || 0) + (data.counts?.fail || 0);
  }
  function scannedUrl(type, data) {
    return type === 'site' ? data.origin : (data.finalUrl || data.url);
  }

  // Send the lead from the browser (Web3Forms only accepts client-side calls on
  // the free plan). Also ping the server for a Railway-log record. Email delivery
  // is best-effort — we never block the visitor from seeing their report over it.
  async function postLead(payload) {
    const key = window.__W3F_KEY;
    // Server-side log record (fire-and-forget).
    fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});

    if (key) {
      try {
        const isQuiz = payload.source === 'quiz';
        await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            access_key: key,
            subject: isQuiz
              ? `Quiz lead scan result — ${payload.url || '(unknown site)'}`
              : `New Search Visibility lead — ${payload.email}`,
            from_name: 'RVA Digital Works — Search Visibility Tool',
            email: payload.email || (isQuiz ? '(see matching quiz lead email for this site)' : ''),
            source: isQuiz ? 'Lead quiz (rvadigitalworks.com)' : 'Search Visibility tool',
            scanned_site: payload.url || '(unknown)',
            scan_type: payload.scanType || 'single',
            score: payload.score != null ? `${payload.score}/100 (grade ${payload.grade || '?'})` : 'n/a',
          }),
        });
      } catch {
        /* best-effort — still unlock */
      }
    }
    return { ok: true };
  }

  // ---- CTA block appended to every result ---------------------------------
  function makeCta() {
    const el = document.createElement('div');
    el.className = 'hire-cta';
    el.innerHTML = `
      <div class="hire-cta-inner">
        <div>
          <h3>Want these issues fixed — for real?</h3>
          <p>RVA Digital Works builds and optimizes websites so they rank on Google
             <em>and</em> get read and cited by AI answer engines. Get a free, no-pressure quote.</p>
        </div>
        <a class="hire-cta-btn" href="${QUOTE_URL}" target="_blank" rel="noopener">Get a free quote &rarr;</a>
      </div>`;
    return el;
  }

  // ---- Gate a completed single/site report --------------------------------
  // Hides the detail sections and shows an email unlock card. On unlock: reveal,
  // mount the PDF button, and append the CTA.
  window.publicGateReport = function (type, data) {
    // Always append the CTA (visible before and after unlock).
    if (!window.PUBLIC_MODE) {
      if (window.mountReportPdf) window.mountReportPdf(type, data);
      appendCta();
      return;
    }

    // Quiz lead: contact was already captured by the quiz, so no email gate.
    // Reveal everything, mount the branded PDF, and send a score record keyed
    // to the scanned URL so it can be matched to the quiz lead email.
    if (window.__QUIZ_LEAD) {
      if (window.mountReportPdf) window.mountReportPdf(type, data);
      appendCta();
      postLead({ source: 'quiz', url: scannedUrl(type, data), scanType: type, score: data.overall, grade: data.grade });
      return;
    }

    const root = document.getElementById('results');
    const head = root.querySelector('.report-head');
    const detailSelectors = ['.top-fixes', '.categories', '.pages-scanned', '.site-issues', '.competitor-cta', '.rescan'];
    const hidden = [];
    detailSelectors.forEach((sel) => root.querySelectorAll(sel).forEach((n) => { n.style.display = 'none'; hidden.push(n); }));

    const n = issueCount(type, data);
    const gate = document.createElement('div');
    gate.className = 'lead-gate';
    gate.innerHTML = `
      <div class="lead-gate-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" width="34" height="34">
          <rect x="1" y="1" width="38" height="38" rx="9" fill="#14b8a6"/>
          <path d="M11 24 L20 13 L29 24" fill="none" stroke="#0d1b2a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h3>${n > 0 ? `We found ${n} thing${n === 1 ? '' : 's'} to improve` : 'See your full report'}</h3>
      <p>Enter your email to unlock the full issue list${n > 0 ? ' and prioritized, plain-English fixes' : ''}.</p>
      <form class="lead-form">
        <input type="email" class="lead-email" placeholder="you@business.com" required autocomplete="email" spellcheck="false" />
        <button type="submit" class="lead-btn">Unlock full report</button>
      </form>
      <p class="lead-fine">No spam. We'll only reach out if you ask us to.</p>
      <div class="lead-err"></div>`;
    head.insertAdjacentElement('afterend', gate);

    const form = gate.querySelector('.lead-form');
    const errEl = gate.querySelector('.lead-err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = gate.querySelector('.lead-email').value.trim();
      const btn = gate.querySelector('.lead-btn');
      btn.disabled = true; btn.textContent = 'Unlocking…';
      const res = await postLead({
        email, url: scannedUrl(type, data), scanType: type,
        score: data.overall, grade: data.grade,
      });
      if (!res.ok) {
        errEl.textContent = res.error || 'Something went wrong — try again.';
        btn.disabled = false; btn.textContent = 'Unlock full report';
        return;
      }
      gate.remove();
      hidden.forEach((el) => { el.style.display = ''; });
      appendCta();
      const target = root.querySelector('.top-fixes, .site-issues, .categories');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function _noop() {}
    appendCta(); // CTA shows even before unlock
  };

  function appendCta() {
    const root = document.getElementById('results');
    if (!root || root.querySelector('.hire-cta')) return;
    const rescan = root.querySelector('.rescan');
    if (rescan) rescan.parentNode.insertBefore(makeCta(), rescan);
    else root.appendChild(makeCta());
  }

  // ---- Require an email before a heavy (whole-site) scan ------------------
  // Returns a promise resolving true (proceed) or false (cancelled).
  window.requireLeadEmail = function ({ url, scanType }) {
    if (!window.PUBLIC_MODE) return Promise.resolve(true);
    // Quiz leads already gave their contact in the quiz — never re-gate them.
    if (window.__QUIZ_LEAD) return Promise.resolve(true);
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML = `
        <div class="modal-card lead-modal">
          <button class="modal-close" type="button" aria-label="Close">&times;</button>
          <div class="modal-brand">
            <svg viewBox="0 0 40 40" width="26" height="26"><rect x="1" y="1" width="38" height="38" rx="9" fill="#14b8a6"/><path d="M11 24 L20 13 L29 24" fill="none" stroke="#0d1b2a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>RVA Digital Works</span>
          </div>
          <h3>Run a full-site scan</h3>
          <p class="modal-sub">Enter your email and we'll scan up to 25 pages, then unlock the full report.</p>
          <form class="lead-form">
            <input type="email" class="lead-email modal-input" placeholder="you@business.com" required autocomplete="email" spellcheck="false" />
            <div class="modal-actions">
              <button type="button" class="modal-btn-ghost lead-cancel">Cancel</button>
              <button type="submit" class="modal-btn">Scan my site</button>
            </div>
          </form>
          <div class="lead-err"></div>
        </div>`;
      document.body.appendChild(ov);
      const close = (val) => { ov.remove(); resolve(val); };
      ov.querySelector('.modal-close').addEventListener('click', () => close(false));
      ov.querySelector('.lead-cancel').addEventListener('click', () => close(false));
      ov.addEventListener('click', (e) => { if (e.target === ov) close(false); });
      const form = ov.querySelector('.lead-form');
      const errEl = ov.querySelector('.lead-err');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = ov.querySelector('.lead-email').value.trim();
        const btn = form.querySelector('.modal-btn');
        btn.disabled = true; btn.textContent = 'Starting…';
        const res = await postLead({ email, url, scanType });
        if (!res.ok) {
          errEl.textContent = res.error || 'Something went wrong — try again.';
          btn.disabled = false; btn.textContent = 'Scan my site';
          return;
        }
        close(true);
      });
      setTimeout(() => ov.querySelector('.lead-email').focus(), 40);
    });
  };
})();
