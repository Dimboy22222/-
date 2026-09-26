/*
 * Core invoice logic: the document model, money math and formatting.
 * No DOM access, so the same file runs in the browser and in `node --test`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DOC_TYPES = {
    invoice: { title: 'Invoice', numberLabel: 'Invoice no.', dueLabel: 'Due date', totalLabel: 'Balance due', prefix: 'INV-' },
    quote: { title: 'Quote', numberLabel: 'Quote no.', dueLabel: 'Valid until', totalLabel: 'Total', prefix: 'QUO-' },
    estimate: { title: 'Estimate', numberLabel: 'Estimate no.', dueLabel: 'Valid until', totalLabel: 'Estimated total', prefix: 'EST-' },
    receipt: { title: 'Receipt', numberLabel: 'Receipt no.', dueLabel: null, totalLabel: 'Total paid', prefix: 'RCT-' },
  };

  const CURRENCIES = [
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'INR', 'SGD', 'HKD',
    'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ILS', 'AED', 'SAR', 'ZAR',
    'NGN', 'KES', 'GHS', 'EGP', 'MAD', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'PHP',
    'IDR', 'MYR', 'THB', 'VND', 'KRW', 'TWD', 'PKR', 'BDT', 'LKR', 'UAH',
  ];

  const ACCENTS = ['#0e6e5c', '#1f4e8c', '#5b3fa0', '#a3302f', '#b4561b', '#8a6d1d', '#2f3a45', '#0f7a8a'];
  const DEFAULT_ACCENT = ACCENTS[0];

  // ---------- numbers ----------

  function round(value, digits) {
    if (!isFinite(value)) return 0;
    const f = Math.pow(10, digits);
    const n = Math.round(Math.abs(value) * f + 1e-7) / f;
    return value < 0 ? -n : n;
  }

  const groupSepCache = new Map();
  function groupSeparator(locale) {
    if (!groupSepCache.has(locale)) {
      let sep = ',';
      try {
        const part = new Intl.NumberFormat(locale).formatToParts(1000000).find((p) => p.type === 'group');
        if (part) sep = part.value;
      } catch (e) { /* unknown locale: keep the default */ }
      groupSepCache.set(locale, sep);
    }
    return groupSepCache.get(locale);
  }

  /**
   * Parse what a person typed into a number field. Accepts "1,234.50",
   * "1.234,50", "1 234,5" and "12,5". A lone separator followed by exactly
   * three digits is read as a thousands separator only when it matches the
   * locale's own grouping character.
   */
  function parseNumber(input, locale) {
    if (typeof input === 'number') return isFinite(input) ? input : 0;
    if (input == null) return 0;
    let s = String(input).trim().replace(/[\s\u00a0\u202f']/g, '');
    if (!s) return 0;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (s[0] === '-' || s[0] === '\u2212') { negative = !negative; s = s.slice(1); }
    s = s.replace(/[^0-9.,]/g, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      const dec = lastDot > lastComma ? '.' : ',';
      const grp = dec === '.' ? ',' : '.';
      s = s.split(grp).join('').replace(dec, '.');
    } else if (lastDot > -1 || lastComma > -1) {
      const sep = lastDot > -1 ? '.' : ',';
      const parts = s.split(sep);
      const grouped = parts.length > 2 || (parts[1].length === 3 && sep === groupSeparator(locale || 'en-US'));
      s = grouped ? parts.join('') : parts[0] + '.' + parts.slice(1).join('');
    }
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return negative ? -n : n;
  }

  // ---------- formatting ----------

  const fmtCache = new Map();
  function cached(key, make) {
    if (!fmtCache.has(key)) fmtCache.set(key, make());
    return fmtCache.get(key);
  }

  function safeLocale(locale) {
    try {
      return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : 'en-US';
    } catch (e) {
      return 'en-US';
    }
  }

  function currencyDigits(currency) {
    return cached('digits:' + currency, () => {
      try {
        return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
      } catch (e) {
        return 2;
      }
    });
  }

  function formatMoney(value, currency, locale, display) {
    const digits = currencyDigits(currency);
    const loc = safeLocale(locale);
    const fmt = cached(['money', currency, loc, display || 'symbol'].join(':'), () => {
      try {
        return new Intl.NumberFormat(loc, {
          style: 'currency', currency, currencyDisplay: display || 'symbol',
          minimumFractionDigits: digits, maximumFractionDigits: digits,
        });
      } catch (e) {
        return null;
      }
    });
    const n = round(value, digits);
    // Avoid printing "-0.00" after rounding a tiny negative.
    const v = n === 0 ? 0 : n;
    return fmt ? fmt.format(v) : currency + ' ' + v.toFixed(digits);
  }

  function formatNumber(value, locale, maxDigits) {
    const loc = safeLocale(locale);
    const fmt = cached('num:' + loc + ':' + (maxDigits == null ? 4 : maxDigits), () =>
      new Intl.NumberFormat(loc, { maximumFractionDigits: maxDigits == null ? 4 : maxDigits }));
    return fmt.format(value);
  }

  function parseISODate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }

  function toISODate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function addDays(iso, days) {
    const d = parseISODate(iso) || new Date();
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  function daysBetween(fromISO, toISO) {
    const a = parseISODate(fromISO);
    const b = parseISODate(toISO);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  function formatDate(iso, locale) {
    const d = parseISODate(iso);
    if (!d) return '';
    const loc = safeLocale(locale);
    return cached('date:' + loc, () => new Intl.DateTimeFormat(loc, { dateStyle: 'medium' })).format(d);
  }

  // ---------- document model ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emptyParty() {
    return { name: '', email: '', phone: '', address: '', taxId: '' };
  }

  function emptyItem() {
    return { id: uid(), description: '', qty: '1', rate: '' };
  }

  function defaultPaper(locale) {
    return /^(en-US|en-CA|es-MX|fr-CA|en-PH)$/i.test(locale || '') ? 'letter' : 'a4';
  }

  function defaultCurrency(locale) {
    const region = String(locale || '').split('-')[1];
    const byRegion = {
      US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR', JP: 'JPY', CN: 'CNY', CH: 'CHF',
      SG: 'SGD', HK: 'HKD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON',
      TR: 'TRY', IL: 'ILS', AE: 'AED', SA: 'SAR', ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', EG: 'EGP',
      MA: 'MAD', BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', PH: 'PHP', ID: 'IDR',
      MY: 'MYR', TH: 'THB', VN: 'VND', KR: 'KRW', TW: 'TWD', PK: 'PKR', BD: 'BDT', LK: 'LKR', UA: 'UAH',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR', PT: 'EUR',
      FI: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR', MT: 'EUR',
      CY: 'EUR', HR: 'EUR', BG: 'EUR',
    };
    return byRegion[(region || '').toUpperCase()] || 'USD';
  }

  function defaultProfile(locale) {
    return {
      from: emptyParty(),
      logo: '',
      accent: DEFAULT_ACCENT,
      showCredit: true,
      currency: defaultCurrency(locale),
      locale: locale || 'en-US',
      paper: defaultPaper(locale),
      taxLabel: 'Tax',
      taxRate: '',
      dueDays: 14,
      notes: 'Thank you for your business.',
      payment: '',
    };
  }

  function sanitizeProfile(raw, locale) {
    const base = defaultProfile(locale);
    if (!raw || typeof raw !== 'object') return base;
    const p = Object.assign({}, base, pick(raw, Object.keys(base)));
    p.from = Object.assign(emptyParty(), pick(raw.from || {}, Object.keys(emptyParty())));
    if (!/^#[0-9a-f]{6}$/i.test(p.accent)) p.accent = DEFAULT_ACCENT;
    if (typeof p.logo !== 'string' || !/^data:image\//.test(p.logo)) p.logo = '';
    if (!CURRENCIES.includes(p.currency)) p.currency = base.currency;
    if (p.paper !== 'a4' && p.paper !== 'letter') p.paper = base.paper;
    p.dueDays = Number.isFinite(Number(p.dueDays)) ? Math.max(0, Math.min(365, Number(p.dueDays))) : 14;
    p.showCredit = p.showCredit !== false;
    return p;
  }

  function pick(obj, keys) {
    const out = {};
    keys.forEach((k) => {
      if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
    });
    return out;
  }

  function newDoc(profile, options) {
    const opts = options || {};
    const p = profile || defaultProfile(opts.locale);
    const docType = DOC_TYPES[opts.docType] ? opts.docType : 'invoice';
    const issueDate = todayISO();
    return {
      id: uid(),
      docType,
      number: opts.number || DOC_TYPES[docType].prefix + '0001',
      issueDate,
      dueDate: addDays(issueDate, p.dueDays == null ? 14 : p.dueDays),
      currency: p.currency,
      locale: p.locale,
      paper: p.paper,
      from: Object.assign(emptyParty(), p.from),
      to: emptyParty(),
      items: [emptyItem()],
      taxLabel: p.taxLabel,
      taxRate: p.taxRate,
      discountType: 'percent',
      discountValue: '',
      amountPaid: '',
      notes: p.notes,
      payment: p.payment,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function sanitizeDoc(raw, locale) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
    const base = newDoc(defaultProfile(locale));
    const d = Object.assign({}, base, pick(raw, Object.keys(base).concat(['sample', 'savedAt'])));
    d.from = Object.assign(emptyParty(), pick(raw.from || {}, Object.keys(emptyParty())));
    d.to = Object.assign(emptyParty(), pick(raw.to || {}, Object.keys(emptyParty())));
    d.items = raw.items
      .filter((it) => it && typeof it === 'object')
      .map((it) => ({
        id: typeof it.id === 'string' ? it.id : uid(),
        description: String(it.description == null ? '' : it.description),
        qty: String(it.qty == null ? '' : it.qty),
        rate: String(it.rate == null ? '' : it.rate),
      }));
    if (!d.items.length) d.items.push(emptyItem());
    if (!DOC_TYPES[d.docType]) d.docType = 'invoice';
    if (!CURRENCIES.includes(d.currency)) d.currency = base.currency;
    if (d.paper !== 'a4' && d.paper !== 'letter') d.paper = base.paper;
    if (d.discountType !== 'fixed') d.discountType = 'percent';
    ['number', 'issueDate', 'dueDate', 'taxLabel', 'taxRate', 'discountValue', 'amountPaid', 'notes', 'payment', 'locale']
      .forEach((k) => { d[k] = d[k] == null ? '' : String(d[k]); });
    if (!d.locale) d.locale = locale || 'en-US';
    return d;
  }

  function isBlankItem(it) {
    return !String(it.description || '').trim() && !parseNumber(it.rate);
  }

  function computeTotals(doc) {
    const digits = currencyDigits(doc.currency);
    const loc = doc.locale;
    const lines = doc.items.filter((it) => !isBlankItem(it)).map((it) => {
      const qty = parseNumber(it.qty, loc);
      const rate = parseNumber(it.rate, loc);
      return { id: it.id, description: String(it.description || '').trim(), qty, rate, amount: round(qty * rate, digits) };
    });
    const subtotal = round(lines.reduce((s, l) => s + l.amount, 0), digits);

    let discount = 0;
    let discountPct = null;
    const dv = parseNumber(doc.discountValue, loc);
    if (dv > 0 && subtotal > 0) {
      if (doc.discountType === 'fixed') {
        discount = Math.min(round(dv, digits), subtotal);
      } else {
        discountPct = Math.min(dv, 100);
        discount = round((subtotal * discountPct) / 100, digits);
      }
    }
    const taxable = round(subtotal - discount, digits);
    const taxRate = parseNumber(doc.taxRate, loc);
    const tax = taxRate ? round((taxable * taxRate) / 100, digits) : 0;
    const total = round(taxable + tax, digits);

    let paid = 0;
    if (doc.docType === 'invoice') paid = round(Math.max(parseNumber(doc.amountPaid, loc), 0), digits);
    if (doc.docType === 'receipt') paid = total;
    const balance = round(total - paid, digits);
    const isPaid = doc.docType === 'receipt' || (doc.docType === 'invoice' && total > 0 && balance <= 0);
    return { digits, lines, subtotal, discount, discountPct, taxable, taxRate, tax, total, paid, balance, isPaid };
  }

  /** What the document's headline amount is: balance for invoices, total otherwise. */
  function amountDue(doc, totals) {
    return doc.docType === 'invoice' ? totals.balance : totals.total;
  }

  function status(doc, totals, today) {
    const t = totals || computeTotals(doc);
    if (doc.docType === 'receipt') return 'paid';
    if (doc.docType !== 'invoice') return doc.docType;
    if (t.isPaid) return 'paid';
    if (t.paid > 0) return isOverdue(doc, today) ? 'overdue' : 'partial';
    return isOverdue(doc, today) ? 'overdue' : 'unpaid';
  }

  function isOverdue(doc, today) {
    const due = parseISODate(doc.dueDate);
    const now = parseISODate(today || todayISO());
    return !!(due && now && due < now);
  }

  /** "INV-0009" -> "INV-0010", "2026/7" -> "2026/8", "" -> prefix + "0001". */
  function nextNumber(previous, prefix) {
    const prev = String(previous || '').trim();
    const m = /^(.*?)(\d+)(\D*)$/.exec(prev);
    if (!m) return (prefix || '') + '0001';
    const next = String(Number(m[2]) + 1).padStart(m[2].length, '0');
    return m[1] + next + m[3];
  }

  /** The highest-numbered document of a type, compared by trailing digits. */
  function latestNumber(numbers) {
    let best = null;
    let bestN = -1;
    numbers.forEach((num) => {
      const m = /(\d+)\D*$/.exec(num || '');
      const n = m ? Number(m[1]) : -1;
      if (n >= bestN) { best = num; bestN = n; }
    });
    return best;
  }

  /**
   * Everything a renderer needs, already formatted. The on-screen preview and
   * the PDF both draw from this so they always agree.
   */
  function present(doc, totals) {
    const t = totals || computeTotals(doc);
    const type = DOC_TYPES[doc.docType];
    const money = (n) => formatMoney(n, doc.currency, doc.locale);
    const trim = (s) => String(s || '').trim();
    const taxName = trim(doc.taxLabel).toUpperCase();
    const taxIdLabel = /\bVAT\b/.test(taxName) ? 'VAT no.' : /\bGST\b/.test(taxName) ? 'GST no.' : 'Tax ID';
    const party = (p) => {
      const lines = String(p.address || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (trim(p.email)) lines.push(trim(p.email));
      if (trim(p.phone)) lines.push(trim(p.phone));
      if (trim(p.taxId)) lines.push(taxIdLabel + ': ' + trim(p.taxId));
      return { name: trim(p.name), lines };
    };

    const dates = [];
    if (doc.issueDate) dates.push({ label: 'Issue date', value: formatDate(doc.issueDate, doc.locale) });
    if (type.dueLabel && doc.dueDate) dates.push({ label: type.dueLabel, value: formatDate(doc.dueDate, doc.locale) });

    const rows = [{ label: 'Subtotal', value: money(t.subtotal) }];
    if (t.discount) {
      const pct = t.discountPct != null ? ' (' + formatNumber(t.discountPct, doc.locale, 2) + '%)' : '';
      rows.push({ label: 'Discount' + pct, value: money(-t.discount) });
    }
    if (t.taxRate) {
      rows.push({ label: (trim(doc.taxLabel) || 'Tax') + ' (' + formatNumber(t.taxRate, doc.locale, 3) + '%)', value: money(t.tax) });
    }
    let headline;
    if (doc.docType === 'invoice') {
      if (t.paid) {
        rows.push({ label: 'Total', value: money(t.total), strong: true });
        rows.push({ label: 'Amount paid', value: money(-t.paid) });
        rows.push({ label: 'Balance due', value: money(t.balance), grand: true });
      } else {
        rows.push({ label: 'Total due', value: money(t.total), grand: true });
      }
      headline = { label: 'Balance due', value: money(t.balance) };
    } else {
      rows.push({ label: type.totalLabel, value: money(t.total), grand: true });
      headline = { label: type.totalLabel, value: money(t.total) };
    }

    return {
      title: type.title,
      number: trim(doc.number),
      numberLabel: type.numberLabel,
      from: party(doc.from),
      to: party(doc.to),
      dates,
      headline,
      items: t.lines.map((l) => ({
        description: l.description,
        qty: formatNumber(l.qty, doc.locale),
        rate: money(l.rate),
        amount: money(l.amount),
      })),
      rows,
      isPaid: t.isPaid,
      notes: trim(doc.notes),
      payment: trim(doc.payment),
    };
  }

  // ---------- colour ----------

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = parseInt(m ? m[1] : DEFAULT_ACCENT.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  }

  function luminance(rgb) {
    const lin = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  /**
   * The accent as used on paper: `ink` is darkened until it reads on white
   * (contrast 4.5:1), `tint` is a pale wash for table headers and totals.
   */
  function accentShades(hex) {
    let ink = hexToRgb(hex);
    for (let i = 0; i < 20 && (1.05 / (luminance(ink) + 0.05)) < 4.5; i++) ink = ink.map((c) => c * 0.88);
    const tint = hexToRgb(hex).map((c) => c + (255 - c) * 0.9);
    return { ink: rgbToHex(ink), tint: rgbToHex(tint) };
  }

  function csvCell(value) {
    const s = value == null ? '' : String(value);
    // Neutralise spreadsheet formulas and quote anything with separators.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
    return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }

  function toCSV(docs, today) {
    const header = ['Type', 'Number', 'Status', 'Issue date', 'Due date', 'Client', 'Client email', 'Currency',
      'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance'];
    const rows = docs.map((d) => {
      const t = computeTotals(d);
      const fixed = (n) => n.toFixed(t.digits);
      return [DOC_TYPES[d.docType].title, d.number, status(d, t, today), d.issueDate,
        DOC_TYPES[d.docType].dueLabel ? d.dueDate : '', d.to.name, d.to.email, d.currency,
        fixed(t.subtotal), fixed(t.discount), fixed(t.tax), fixed(t.total), fixed(t.paid), fixed(t.balance)];
    });
    return [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function sampleDoc(locale) {
    const profile = defaultProfile(locale);
    const doc = newDoc(profile, { number: 'INV-0042' });
    doc.sample = true;
    doc.from = {
      name: 'Rivera Studio', email: 'hello@riverastudio.example', phone: '+1 555 0142',
      address: '18 Mercer Lane\nPortland, OR 97205', taxId: '',
    };
    doc.to = {
      name: 'Northwind Books', email: 'accounts@northwind.example', phone: '',
      address: '410 Harbor Street\nSeattle, WA 98101', taxId: '',
    };
    doc.items = [
      { id: uid(), description: 'Logo and wordmark design', qty: '1', rate: '1200' },
      { id: uid(), description: 'Brand guidelines, 12-page PDF', qty: '1', rate: '650' },
      { id: uid(), description: 'Revision rounds (hourly)', qty: '3.5', rate: '85' },
    ];
    doc.taxLabel = 'Sales tax';
    doc.taxRate = '8.5';
    doc.payment = 'Bank transfer: First Harbor Bank\nAccount 000123456 \u00b7 Routing 111000025';
    return doc;
  }

  return {
    DOC_TYPES, CURRENCIES, ACCENTS, DEFAULT_ACCENT,
    round, parseNumber, currencyDigits, formatMoney, formatNumber, formatDate,
    parseISODate, toISODate, todayISO, addDays, daysBetween,
    uid, emptyItem, emptyParty, defaultProfile, sanitizeProfile, newDoc, sanitizeDoc, sampleDoc,
    isBlankItem, computeTotals, amountDue, status, isOverdue, nextNumber, latestNumber, present, toCSV, csvCell,
    hexToRgb, accentShades,
  };
});
