/* AI-visibility check — front-end.
 *
 * Self-contained: exposes window.mountAiVisibilityCTA(url, beforeEl), which
 * app.js calls when rendering a report. If the server has no Perplexity key
 * (config.aiCitation === false), the CTA simply doesn't appear.
 */
(function () {
  let cfgPromise;
  function config() {
    return (
      cfgPromise ||
      (cfgPromise = fetch('/api/config')
        .then((r) => r.json())
        .catch(() => ({})))
    );
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // One-time styles for the badges/rows that aren't in style.css.
  function injectStyles() {
    if (document.getElementById('aiv-styles')) return;
    const css = `
    .aiv-verdict{font-size:1.02rem;line-height:1.5;margin:2px 0 18px;padding:14px 16px;
      border-radius:12px;background:var(--glass,rgba(255,255,255,.04));
      border:1px solid var(--glass-border,rgba(255,255,255,.09));}
    .aiv-prompt{border:1px solid var(--glass-border,rgba(255,255,255,.09));border-radius:12px;
      padding:14px 16px;margin-bottom:12px;background:var(--glass,rgba(255,255,255,.03));}
    .aiv-prompt-q{font-weight:600;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;}
    .aiv-badge{font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
      padding:3px 9px;border-radius:99px;white-space:nowrap;}
    .aiv-excerpt{font-size:.9rem;color:var(--muted,#8fa3b8);line-height:1.5;margin-top:6px;}
    .aiv-rivals{font-size:.85rem;color:var(--muted,#8fa3b8);margin-top:8px;}
    .aiv-rivals b{color:var(--text,#e8eef5);}
    .aiv-disclaimer{font-size:.8rem;color:var(--muted,#8fa3b8);margin-top:10px;line-height:1.5;}
    .aiv-summary-rivals{margin:0 0 16px;font-size:.92rem;line-height:1.6;}
    .aiv-summary-rivals .aiv-chip{display:inline-block;padding:3px 10px;border-radius:99px;margin:3px 4px 0 0;
      background:rgba(229,57,27,.12);color:#e0836f;font-size:.82rem;}`;
    const el = document.createElement('style');
    el.id = 'aiv-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function badge(kind, present, cited) {
    // returns {text, color(css var or hex)}
    if (present) {
      return cited
        ? { text: 'Cited', color: 'var(--pass,#22c55e)' }
        : { text: 'Mentioned', color: 'var(--warn,#f59e0b)' };
    }
    return { text: 'Not shown', color: 'var(--fail,#ef4444)' };
  }

  function hexA() {
    return null;
  }

  function buildCard(url) {
    injectStyles();
    const card = document.createElement('div');
    card.className = 'competitor-cta aiv-card';
    card.innerHTML = `
      <h3>🤖 See if AI engines recommend you</h3>
      <p>We'll ask an AI answer engine a few real buyer questions about your
        business and check whether it names or cites <b>you</b> — or your
        competitors instead.</p>
      <div class="comp-input-row">
        <button class="compare-btn aiv-run" type="button">Check AI visibility</button>
      </div>`;
    card.querySelector('.aiv-run').addEventListener('click', () => runCheck(url, card));
    return card;
  }

  function setBusy(card, msg) {
    card.innerHTML = `
      <h3>🤖 Checking AI visibility…</h3>
      <p class="aiv-status">${esc(msg || 'Asking the AI…')}</p>`;
  }

  function runCheck(url, card) {
    setBusy(card, 'Reading the page…');
    let finished = false;
    const es = new EventSource('/api/ai-citation?url=' + encodeURIComponent(url));

    es.addEventListener('status', (e) => {
      try {
        const d = JSON.parse(e.data);
        const s = card.querySelector('.aiv-status');
        if (s) s.textContent = d.message || 'Working…';
      } catch {}
    });
    es.addEventListener('done', (e) => {
      finished = true;
      es.close();
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return renderError(card, url, 'Could not parse the AI-visibility result.');
      }
      renderResult(card, url, data);
    });
    es.addEventListener('failed', (e) => {
      finished = true;
      es.close();
      let msg = 'AI-visibility check failed.';
      try {
        msg = JSON.parse(e.data).error || msg;
      } catch {}
      renderError(card, url, msg);
    });
    es.onerror = () => {
      if (finished) return;
      finished = true;
      es.close();
      renderError(card, url, 'Lost connection during the AI-visibility check — is the server running?');
    };
  }

  function renderError(card, url, msg) {
    card.innerHTML = `
      <h3>🤖 AI visibility</h3>
      <div class="comp-error">${esc(msg)}</div>
      <div class="comp-input-row" style="margin-top:12px">
        <button class="compare-btn aiv-run" type="button">Try again</button>
      </div>`;
    card.querySelector('.aiv-run').addEventListener('click', () => runCheck(url, card));
  }

  function renderResult(card, url, data) {
    const s = data.summary || {};
    const identity = data.identity || {};
    const prompts = (data.prompts || []).filter((p) => !p.error);

    const idBits = [identity.service, identity.city].filter(Boolean).join(' · ');

    let html = `
      <h3>🤖 AI visibility — how answer engines see you</h3>
      <p style="color:var(--muted,#8fa3b8);margin-bottom:14px">
        Engine: ${esc(data.engine || 'AI')}${idBits ? ' · Read as: <b>' + esc(idBits) + '</b>' : ''}
      </p>
      <div class="aiv-verdict">${esc(s.verdict || '')}</div>`;

    if (s.competitors && s.competitors.length) {
      html += `<p class="aiv-summary-rivals">Businesses the AI recommended instead / alongside: ` +
        s.competitors
          .map((c) => `<span class="aiv-chip">${esc(c.domain)}${c.count > 1 ? ' ×' + c.count : ''}</span>`)
          .join('') +
        `</p>`;
    }

    for (const p of prompts) {
      const b = badge(p.kind, p.present, p.cited);
      const rivals = (p.competitorDomains || []).slice(0, 5);
      html += `
        <div class="aiv-prompt">
          <div class="aiv-prompt-q">
            <span class="aiv-badge" style="background:${b.color}22;color:${b.color}">${b.text}</span>
            <span>${esc(p.text)}</span>
          </div>
          ${p.answerExcerpt ? `<div class="aiv-excerpt">${esc(p.answerExcerpt)}</div>` : ''}
          ${rivals.length ? `<div class="aiv-rivals">Cited sources: <b>${rivals.map(esc).join('</b>, <b>')}</b></div>` : ''}
        </div>`;
    }

    html += `
      <p class="aiv-disclaimer">
        AI answers vary by user, region, and time, so this is a snapshot, not a fixed
        ranking — treat it as "how often you show up." Want to improve it? The AI
        Searchability fixes above are exactly what makes a site quotable by these engines.
      </p>
      <div class="comp-input-row" style="margin-top:12px">
        <button class="compare-btn aiv-run" type="button">Run again</button>
      </div>`;

    card.innerHTML = html;
    card.querySelector('.aiv-run').addEventListener('click', () => runCheck(url, card));
  }

  // Public entry point: called by app.js after a report renders.
  window.mountAiVisibilityCTA = function (url, beforeEl) {
    config().then((cfg) => {
      if (!cfg || !cfg.aiCitation) return; // feature hidden when no API key
      if (!beforeEl || !beforeEl.parentNode) return;
      beforeEl.parentNode.insertBefore(buildCard(url), beforeEl);
    });
  };
})();
