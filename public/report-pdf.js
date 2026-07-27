/* RVA Digital Works — branded PDF report generator for the Search Visibility Checker.
   Reads the last rendered report (single-page or whole-site) and produces a
   client-ready, branded PDF via jsPDF + autoTable. */
(function () {
  'use strict';

  // ---- Brand palette ------------------------------------------------------
  const NAVY = [13, 27, 42];
  const NAVY2 = [8, 15, 26];
  const TEAL = [20, 184, 166];
  const TEAL_L = [45, 212, 191];
  const INK = [30, 42, 56];
  const MUTED = [91, 107, 123];
  const LINE = [216, 224, 232];
  const PAPER = [244, 247, 250];
  const PASS = [46, 170, 120];
  const WARN = [216, 150, 40];
  const FAIL = [214, 70, 80];

  function scoreColor(s) {
    if (s >= 80) return PASS;
    if (s >= 60) return WARN;
    return FAIL;
  }
  function hostOf(u) {
    try { return new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, ''); }
    catch { return String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
  }
  function todayStr() {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ---- Mount the "Download PDF" button on a rendered report ---------------
  window.mountReportPdf = function (type, data) {
    window.__lastReport = { type, data };
    const head = document.querySelector('#results .report-head');
    if (!head || head.querySelector('.pdf-cta')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pdf-cta';
    btn.innerHTML = '<span class="pdf-cta-ic">&#8595;</span> Download branded PDF report';
    btn.addEventListener('click', openPdfModal);
    head.appendChild(btn);
  };

  // ---- Modal --------------------------------------------------------------
  const modal = document.getElementById('pdf-modal');
  const clientInput = document.getElementById('pdf-client');
  const contactInput = document.getElementById('pdf-contact');
  const notesInput = document.getElementById('pdf-notes');
  const includePass = document.getElementById('pdf-include-pass');

  function openPdfModal() {
    const r = window.__lastReport;
    if (r) {
      const url = r.type === 'site' ? r.data.origin : (r.data.finalUrl || r.data.url);
      if (clientInput && !clientInput.value) clientInput.value = hostOf(url);
    }
    modal.classList.remove('hidden');
    setTimeout(() => clientInput && clientInput.focus(), 40);
  }
  function closePdfModal() { modal.classList.add('hidden'); }

  if (modal) {
    document.getElementById('pdf-close').addEventListener('click', closePdfModal);
    document.getElementById('pdf-cancel').addEventListener('click', closePdfModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closePdfModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closePdfModal(); });
    document.getElementById('pdf-generate').addEventListener('click', () => {
      const r = window.__lastReport;
      if (!r) return;
      generatePdf(r.type, r.data, {
        client: (clientInput.value || '').trim(),
        contact: (contactInput.value || '').trim(),
        notes: (notesInput.value || '').trim(),
        includePass: includePass.checked,
      });
      closePdfModal();
    });
  }

  // ---- Normalise issues from either report shape --------------------------
  function collectIssues(type, data) {
    const out = [];
    if (type === 'site') {
      data.issues.forEach((iss) => {
        out.push({
          priority: iss.worst === 'fail' ? 'High' : 'Medium',
          label: iss.label,
          category: iss.category,
          scope: iss.scope === 'site' ? 'Site-wide' : `${iss.affectedCount} page${iss.affectedCount === 1 ? '' : 's'}`,
          recommendation: iss.recommendation,
        });
      });
    } else {
      data.categories.forEach((cat) => {
        cat.checks.forEach((c) => {
          if (c.status === 'fail' || c.status === 'warn') {
            out.push({
              priority: c.status === 'fail' ? 'High' : 'Medium',
              label: c.label,
              category: cat.title,
              scope: c.detail ? String(c.detail).slice(0, 60) : '—',
              recommendation: c.recommendation,
            });
          }
        });
      });
    }
    // High before Medium, keep category grouping otherwise
    out.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'High' ? -1 : 1));
    return out;
  }

  function collectPassing(type, data) {
    const out = [];
    if (type === 'site' && data.passingEverywhere) {
      data.passingEverywhere.forEach((c) => out.push([c.label, c.category]));
    } else if (data.categories) {
      data.categories.forEach((cat) => {
        (cat.checks || []).forEach((c) => {
          if (c.status === 'pass' || c.status === 'info') out.push([c.label, cat.title]);
        });
      });
    }
    return out;
  }

  // ---- Gauge (score ring) -------------------------------------------------
  function drawGauge(doc, cx, cy, r, pct, col) {
    const seg = 90;
    doc.setLineWidth(6);
    doc.setDrawColor(226, 232, 240);
    // track
    let prev = null;
    for (let i = 0; i <= seg; i++) {
      const a = -Math.PI / 2 + (i / seg) * Math.PI * 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (prev) doc.line(prev.x, prev.y, x, y);
      prev = { x, y };
    }
    // fill
    doc.setDrawColor(col[0], col[1], col[2]);
    prev = null;
    const fillSeg = Math.round(seg * (pct / 100));
    for (let i = 0; i <= fillSeg; i++) {
      const a = -Math.PI / 2 + (i / seg) * Math.PI * 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (prev) doc.line(prev.x, prev.y, x, y);
      prev = { x, y };
    }
  }

  // ---- Main builder -------------------------------------------------------
  function generatePdf(type, data, meta) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF library did not load — check your internet connection and try again.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const M = 48;

    const url = type === 'site' ? data.origin : (data.finalUrl || data.url);
    const grade = data.grade;
    const overall = data.overall;
    const counts = data.counts || { pass: 0, warn: 0, fail: 0 };
    const cats = data.categories || [];
    const pagesScanned = type === 'site' ? data.pagesScanned : 1;

    // ---- Header band ----
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 116, 'F');
    doc.setFillColor(...NAVY2);
    doc.circle(W - 40, 20, 74, 'F');
    // logo mark
    doc.setFillColor(...TEAL);
    doc.roundedRect(M, 30, 30, 30, 6, 6, 'F');
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(3);
    doc.setLineCap('round'); doc.setLineJoin('round');
    doc.line(M + 8, 47, M + 15, 38);
    doc.line(M + 15, 38, M + 22, 47);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(255, 255, 255);
    doc.text('RVA Digital Works', M + 42, 50);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...TEAL_L);
    doc.text('Search Visibility Report', M, 92);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(159, 179, 200);
    doc.text('SEO & AI Searchability Audit', M, 107);
    doc.setTextColor(159, 179, 200); doc.setFontSize(9);
    doc.text(todayStr(), W - M, 107, { align: 'right' });
    doc.setDrawColor(...TEAL); doc.setLineWidth(3);
    doc.line(0, 116, W, 116);

    let y = 150;

    // ---- Prepared-for line ----
    if (meta.client) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
      doc.text('PREPARED FOR', M, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK);
      doc.text(meta.client, M, y + 18);
      y += 34;
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(`Site: ${url}`, M, y);
    doc.text(`${pagesScanned} page${pagesScanned === 1 ? '' : 's'} scanned`, W - M, y, { align: 'right' });
    y += 15;
    if (meta.contact) {
      doc.setFontSize(9); doc.setTextColor(...MUTED);
      doc.text(`Prepared by ${meta.contact}`, M, y);
      y += 15;
    }

    // ---- Cover note ----
    if (meta.notes) {
      y += 6;
      doc.setFillColor(...PAPER);
      const noteLines = doc.splitTextToSize(meta.notes, W - 2 * M - 28);
      const noteH = noteLines.length * 13 + 24;
      doc.roundedRect(M, y, W - 2 * M, noteH, 6, 6, 'F');
      doc.setDrawColor(...TEAL); doc.setLineWidth(3);
      doc.line(M, y, M, y + noteH);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...INK);
      doc.text(noteLines, M + 16, y + 18);
      y += noteH + 10;
    }

    y += 12;

    // ---- Score block ----
    const gaugeCx = M + 46, gaugeCy = y + 42, gaugeR = 40;
    drawGauge(doc, gaugeCx, gaugeCy, gaugeR, overall, scoreColor(overall));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...scoreColor(overall));
    doc.text(String(overall), gaugeCx, gaugeCy + 4, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('/ 100', gaugeCx, gaugeCy + 16, { align: 'center' });

    const tx = gaugeCx + 74;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK);
    doc.text(`Overall score — Grade ${grade}`, tx, y + 22);
    // count chips
    const chips = [
      [`${counts.pass} passed`, PASS],
      [`${counts.warn} to improve`, WARN],
      [`${counts.fail} failing`, FAIL],
    ];
    let cxp = tx;
    doc.setFontSize(9);
    chips.forEach(([label, col]) => {
      const w = doc.getTextWidth(label) + 20;
      doc.setFillColor(col[0], col[1], col[2]);
      doc.roundedRect(cxp, y + 34, w, 18, 9, 9, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
      doc.text(label, cxp + 10, y + 46);
      cxp += w + 8;
    });
    y = gaugeCy + gaugeR + 26;

    // ---- Category bars ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text('Category scores', M, y);
    y += 16;
    const barX = M + 150, barW = W - M - barX - 40;
    cats.forEach((cat) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(String(cat.title), M, y + 8);
      doc.setFillColor(...PAPER);
      doc.roundedRect(barX, y, barW, 9, 4, 4, 'F');
      const col = scoreColor(cat.score);
      doc.setFillColor(col[0], col[1], col[2]);
      doc.roundedRect(barX, y, Math.max(6, (barW * cat.score) / 100), 9, 4, 4, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(String(cat.score), W - M, y + 8, { align: 'right' });
      y += 20;
    });

    y += 10;

    // ---- Issues table ----
    const issues = collectIssues(type, data);
    const scopeHead = type === 'site' ? 'Scope' : 'Detail';
    if (issues.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
      doc.text(`Priority fixes (${issues.length})`, M, y);
      y += 8;
      doc.autoTable({
        startY: y + 6,
        margin: { left: M, right: M },
        head: [['Priority', 'Issue', 'Category', scopeHead, 'What to do']],
        body: issues.map((i) => [i.priority, i.label, i.category, i.scope, i.recommendation]),
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, valign: 'top' },
        headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        alternateRowStyles: { fillColor: [249, 251, 252] },
        columnStyles: {
          0: { cellWidth: 48, fontStyle: 'bold' },
          1: { cellWidth: 96, fontStyle: 'bold' },
          2: { cellWidth: 72 },
          3: { cellWidth: 66, textColor: MUTED },
          4: { cellWidth: 'auto' },
        },
        didParseCell: (hook) => {
          if (hook.section === 'body' && hook.column.index === 0) {
            hook.cell.styles.textColor = hook.cell.raw === 'High' ? FAIL : WARN;
          }
        },
      });
      y = doc.lastAutoTable.finalY + 20;
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...PASS);
      doc.text('No priority issues found — excellent work.', M, y + 6);
      y += 26;
    }

    // ---- Per-page breakdown (site scans) ----
    if (type === 'site' && Array.isArray(data.pages) && data.pages.length) {
      if (y > 640) { doc.addPage(); y = 70; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
      doc.text('Pages scanned', M, y);
      doc.autoTable({
        startY: y + 8,
        margin: { left: M, right: M },
        head: [['Score', 'Grade', 'Page']],
        body: data.pages.map((p) => [String(p.overall), p.grade, shortPath(p.url)]),
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
        headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8.5 },
        columnStyles: { 0: { cellWidth: 44, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 44, halign: 'center' }, 2: { cellWidth: 'auto', textColor: MUTED } },
      });
      y = doc.lastAutoTable.finalY + 20;
    }

    // ---- Passing appendix ----
    if (meta.includePass) {
      const passing = collectPassing(type, data);
      if (passing.length) {
        if (y > 640) { doc.addPage(); y = 70; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...MUTED);
        doc.text(`Checks already passing (${passing.length})`, M, y);
        doc.autoTable({
          startY: y + 8,
          margin: { left: M, right: M },
          head: [['Passing check', 'Category']],
          body: passing,
          styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: MUTED, lineColor: LINE, lineWidth: 0.5 },
          headStyles: { fillColor: [237, 242, 246], textColor: MUTED, fontSize: 8 },
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 150 } },
        });
      }
    }

    // ---- Footers on every page ----
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      const H = doc.internal.pageSize.getHeight();
      if (p > 1) {
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, W, 30, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
        doc.text('RVA Digital Works · Search Visibility Report', M, 19);
        doc.setDrawColor(...TEAL); doc.setLineWidth(1.5); doc.line(0, 30, W, 30);
      }
      doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
      doc.line(M, H - 34, W - M, H - 34);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text('RVA Digital Works · rvadigitalworks.com · jake@rvadigitalworks.com · (804) 608-6508', M, H - 20);
      doc.text(`Page ${p} of ${pageCount}`, W - M, H - 20, { align: 'right' });
    }

    const fname = `RVA-Search-Report-${hostOf(url)}-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(fname);
  }

  function shortPath(u) {
    try { const url = new URL(u); return (url.pathname || '/') + (url.search || ''); }
    catch { return u; }
  }
})();
