/*
 * Draws a document as a real, text-based PDF with jsPDF. jsPDF and the fonts
 * load on the first download only, so the page itself stays light.
 */
(function () {
  'use strict';

  const JSPDF_SRC = 'assets/vendor/jspdf.umd.min.js';
  const FONT_FILES = ['assets/fonts/Inter-Regular.ttf', 'assets/fonts/Inter-SemiBold.ttf'];

  // Code points in the bundled Inter subset (Latin, Greek, Cyrillic, currency
  // symbols, punctuation). Regenerate with fontTools if the fonts change.
  const INTER_RANGES = [[32, 126], [160, 172], [174, 328], [330, 451], [453, 591], [601, 601], [699, 700],
    [710, 710], [730, 730], [732, 732], [768, 769], [771, 771], [777, 777], [803, 803], [884, 886], [890, 895],
    [900, 906], [908, 908], [910, 929], [931, 983], [988, 989], [1008, 1014], [1017, 1018], [1020, 1145],
    [1152, 1181], [1184, 1279], [1327, 1327], [7680, 7835], [7837, 7935], [8192, 8203], [8208, 8231],
    [8239, 8277], [8279, 8279], [8287, 8287], [8352, 8367], [8369, 8373], [8376, 8378], [8380, 8383],
    [8448, 8449], [8451, 8451], [8453, 8454], [8457, 8457], [8467, 8467], [8470, 8471], [8478, 8482],
    [8486, 8486], [8490, 8491], [8494, 8494], [8498, 8498], [8507, 8507], [8525, 8525], [8592, 8595],
    [8722, 8722], [8776, 8776], [8800, 8800], [8804, 8805], [9679, 9679], [10003, 10003]];

  // Built-in Helvetica only covers Latin-1; used when the fonts cannot be
  // fetched (for example when index.html is opened straight from disk).
  const LATIN1_SUBSTITUTES = {
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-',
    '\u2212': '-', '\u2026': '...', '\u2009': ' ', '\u202f': ' ', '\u2002': ' ', '\u2003': ' ', '\u20ac': 'EUR ',
  };
  const INVISIBLE = /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff\u061c\u00ad]/g;

  let assetsPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('The PDF engine did not load. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }

  async function fetchBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Font request failed: ' + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function loadAssets() {
    if (!assetsPromise) {
      assetsPromise = Promise.all([
        window.jspdf ? null : loadScript(JSPDF_SRC),
        Promise.all(FONT_FILES.map(fetchBase64)).catch(() => null),
      ]).then((r) => r[1]);
      assetsPromise.catch(() => { assetsPromise = null; });
    }
    return assetsPromise;
  }

  function inRanges(cp) {
    let lo = 0;
    let hi = INTER_RANGES.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp < INTER_RANGES[mid][0]) hi = mid - 1;
      else if (cp > INTER_RANGES[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  function isLatin1(cp) {
    return (cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255);
  }

  /**
   * @param view   Core.present() output
   * @param opts   { paper, accent, logo, credit: { text, url } | null, brand, filename }
   * @returns      { blob, missingGlyphs }
   */
  async function build(view, opts) {
    const fonts = await loadAssets();
    const JsPDF = window.jspdf.jsPDF;
    const pdf = new JsPDF({ unit: 'pt', format: opts.paper === 'letter' ? 'letter' : 'a4', compress: true });

    let family = 'helvetica';
    let canDraw = isLatin1;
    if (fonts) {
      pdf.addFileToVFS('Inter-Regular.ttf', fonts[0]);
      pdf.addFont('Inter-Regular.ttf', 'Inter', 'normal');
      pdf.addFileToVFS('Inter-SemiBold.ttf', fonts[1]);
      pdf.addFont('Inter-SemiBold.ttf', 'Inter', 'bold');
      family = 'Inter';
      canDraw = inRanges;
    }

    let missingGlyphs = false;
    function clean(value) {
      let s = String(value == null ? '' : value).normalize('NFC').replace(INVISIBLE, '');
      if (!fonts) s = s.replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2212\u2026\u2009\u202f\u2002\u2003\u20ac]/g, (c) => LATIN1_SUBSTITUTES[c]);
      let out = '';
      for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp === 10 || canDraw(cp)) out += ch;
        else { out += '?'; missingGlyphs = true; }
      }
      return out;
    }

    const Core = window.Core;
    const shades = Core.accentShades(opts.accent);
    const ACCENT = Core.hexToRgb(shades.ink);
    const TINT = Core.hexToRgb(shades.tint);
    const INK = [23, 31, 38];
    const MUTED = [96, 106, 115];
    const FAINT = [140, 148, 155];
    const RULE = [222, 226, 230];
    const PAID = [22, 120, 72];

    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 48;
    const CW = W - 2 * M;
    const LIMIT = H - M;
    const PAD = 8;

    function font(size, weight, color) {
      pdf.setFont(family, weight || 'normal');
      pdf.setFontSize(size);
      pdf.setTextColor.apply(pdf, color || INK);
    }
    function text(str, x, y, align) {
      pdf.text(str, x, y, { baseline: 'top', align: align || 'left' });
    }
    function lines(str, width) {
      return str ? pdf.splitTextToSize(clean(str), width) : [];
    }
    function newPage() {
      pdf.addPage();
      return M;
    }

    // ---- header: logo or business name, and the document title ----
    let y = M;
    let leftBottom = y;
    let drewLogo = false;
    if (opts.logo) {
      try {
        const props = pdf.getImageProperties(opts.logo);
        const s = Math.min(170 / props.width, 60 / props.height);
        pdf.addImage(opts.logo, 'PNG', M, y, props.width * s, props.height * s);
        leftBottom = y + props.height * s;
        drewLogo = true;
      } catch (e) { /* unreadable image: fall back to the name */ }
    }
    if (!drewLogo && view.from.name) {
      font(17, 'bold');
      const nameLines = lines(view.from.name, CW * 0.55).slice(0, 2);
      nameLines.forEach((ln, i) => text(ln, M, y + i * 21));
      leftBottom = y + nameLines.length * 21;
    }
    font(26, 'bold', ACCENT);
    text(clean(view.title), W - M, y - 2, 'right');
    let rightBottom = y + 30;
    if (view.number) {
      font(10, 'normal', MUTED);
      text(clean(view.number), W - M, y + 34, 'right');
      rightBottom = y + 48;
    }
    y = Math.max(leftBottom, rightBottom) + 30;

    // ---- parties and dates ----
    const colW = CW * 0.34;
    function party(x, label, p) {
      let yy = y;
      font(7.5, 'bold', MUTED);
      text(label.toUpperCase(), x, yy);
      yy += 14;
      if (p.name) {
        font(10, 'bold');
        lines(p.name, colW - 18).forEach((ln) => { text(ln, x, yy); yy += 14; });
      }
      font(9, 'normal', MUTED);
      p.lines.forEach((l) => lines(l, colW - 18).forEach((ln) => { text(ln, x, yy); yy += 12.6; }));
      return yy;
    }
    let partiesBottom = Math.max(party(M, 'From', view.from), party(M + colW, 'Bill to', view.to));

    let dy = y;
    view.dates.forEach((d) => {
      font(7.5, 'bold', MUTED);
      text(clean(d.label.toUpperCase()), W - M, dy, 'right');
      font(10, 'normal');
      text(clean(d.value), W - M, dy + 11, 'right');
      dy += 32;
    });
    font(7.5, 'bold', MUTED);
    text(clean(view.headline.label.toUpperCase()), W - M, dy, 'right');
    font(15, 'bold', ACCENT);
    text(clean(view.headline.value), W - M, dy + 11, 'right');
    dy += 30;
    y = Math.max(partiesBottom, dy) + 26;

    // ---- line items ----
    const qtyW = 46;
    const rateW = 90;
    const amtW = 96;
    const descW = CW - qtyW - rateW - amtW;
    const xQty = M + descW + qtyW - PAD;
    const xRate = M + descW + qtyW + rateW - PAD;
    const xAmt = M + CW - PAD;

    function tableHeader() {
      pdf.setFillColor.apply(pdf, TINT);
      pdf.rect(M, y, CW, 22, 'F');
      font(7.5, 'bold', ACCENT);
      text('DESCRIPTION', M + PAD, y + 7.5);
      text('QTY', xQty, y + 7.5, 'right');
      text('RATE', xRate, y + 7.5, 'right');
      text('AMOUNT', xAmt, y + 7.5, 'right');
      y += 22;
    }
    tableHeader();

    pdf.setDrawColor.apply(pdf, RULE);
    pdf.setLineWidth(0.6);
    view.items.forEach((it) => {
      font(9.5, 'normal');
      const desc = lines(it.description, descW - 2 * PAD);
      const rowH = Math.max(desc.length, 1) * 13.3 + 16;
      if (y + rowH > LIMIT && y > M + 40) {
        y = newPage();
        tableHeader();
        pdf.setDrawColor.apply(pdf, RULE);
        pdf.setLineWidth(0.6);
      }
      font(9.5, 'normal');
      desc.forEach((ln, i) => text(ln, M + PAD, y + 8 + i * 13.3));
      text(clean(it.qty), xQty, y + 8, 'right');
      text(clean(it.rate), xRate, y + 8, 'right');
      font(9.5, 'bold');
      text(clean(it.amount), xAmt, y + 8, 'right');
      y += rowH;
      pdf.line(M, y, M + CW, y);
    });

    // ---- totals ----
    y += 14;
    const rowHeights = view.rows.map((r) => (r.grand ? 32 : 21));
    const totalsH = rowHeights.reduce((a, b) => a + b, 0);
    if (y + totalsH > LIMIT) y = newPage();
    const tw = 236;
    const tx = W - M - tw;
    const totalsTop = y;
    view.rows.forEach((r, i) => {
      const h = rowHeights[i];
      if (r.grand) {
        y += 4;
        pdf.setFillColor.apply(pdf, TINT);
        pdf.rect(tx, y, tw, h - 4, 'F');
        font(10, 'bold', ACCENT);
        text(clean(r.label), tx + PAD + 2, y + 9);
        font(13, 'bold', ACCENT);
        text(clean(r.value), W - M - PAD - 2, y + 7, 'right');
        y += h - 4;
        return;
      }
      if (r.strong) {
        pdf.setDrawColor.apply(pdf, RULE);
        pdf.line(tx, y, W - M, y);
      }
      font(9.5, r.strong ? 'bold' : 'normal', r.strong ? INK : MUTED);
      text(clean(r.label), tx + PAD + 2, y + 5);
      font(9.5, r.strong ? 'bold' : 'normal');
      text(clean(r.value), W - M - PAD - 2, y + 5, 'right');
      y += h;
    });

    if (view.isPaid) {
      pdf.setDrawColor.apply(pdf, PAID);
      pdf.setLineWidth(1.6);
      pdf.roundedRect(M + 2, totalsTop + 6, 86, 34, 4, 4, 'S');
      font(17, 'bold', PAID);
      text('PAID', M + 45, totalsTop + 14, 'center');
    }

    // ---- notes and payment details ----
    y += 30;
    const blocks = [['Payment details', view.payment], ['Notes', view.notes]].filter((b) => b[1]);
    const LH = 13;
    if (blocks.length) {
      const twoCols = blocks.length === 2;
      const colW2 = twoCols ? (CW - 28) / 2 : CW * 0.7;
      font(9, 'normal');
      const wrapped = blocks.map((b) => lines(b[1], colW2));
      const height = 16 + Math.max.apply(null, wrapped.map((w) => w.length)) * LH;
      if (height <= LIMIT - M) {
        // Keep the blocks together: move them to a new page rather than split them.
        if (y + height > LIMIT) y = newPage();
        blocks.forEach((b, i) => {
          const x = M + i * (colW2 + 28);
          font(7.5, 'bold', MUTED);
          text(b[0].toUpperCase(), x, y);
          font(9, 'normal');
          wrapped[i].forEach((ln, j) => text(ln, x, y + 16 + j * LH));
        });
      } else {
        // Longer than a page: stack them and let the lines flow across pages.
        blocks.forEach((b) => {
          if (y + 16 + LH > LIMIT) y = newPage();
          font(7.5, 'bold', MUTED);
          text(b[0].toUpperCase(), M, y);
          y += 16;
          font(9, 'normal');
          lines(b[1], CW * 0.7).forEach((ln) => {
            if (y + LH > LIMIT) { y = newPage(); font(9, 'normal'); }
            text(ln, M, y);
            y += LH;
          });
          y += 18;
        });
      }
    }

    // ---- footer on every page ----
    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i);
      font(7.5, 'normal', FAINT);
      if (opts.credit) {
        const credit = clean(opts.credit.text);
        text(credit, M, H - 30);
        if (opts.credit.url) pdf.link(M, H - 31, pdf.getTextWidth(credit), 11, { url: opts.credit.url });
      }
      if (pages > 1) text(clean((view.number ? view.number + '  \u00b7  ' : '') + 'Page ' + i + ' of ' + pages), W - M, H - 30, 'right');
    }

    pdf.setProperties({
      title: clean([view.title, view.number].filter(Boolean).join(' ')),
      author: clean(view.from.name),
      creator: clean(opts.brand || ''),
    });

    return { blob: pdf.output('blob'), missingGlyphs };
  }

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.PDFBuilder = { build, save, preload: () => loadAssets().catch(() => null) };
})();
