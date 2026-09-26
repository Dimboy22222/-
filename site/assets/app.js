/*
 * The editor: form binding, live preview, saving, PDF export and Pro upsell.
 */
(function () {
  'use strict';

  const Core = window.Core;
  const License = window.License;
  const PDF = window.PDFBuilder;
  const CFG = window.APP_CONFIG || {};
  const PRO = CFG.pro || {};
  const BRAND = CFG.brand || 'Tallyslip';
  const FREE_SAVES = 3;
  const LOCALE = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ---------- storage (every call survives blocked or full storage) ----------

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('tallyslip:' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('tallyslip:' + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  // ---------- state ----------

  const storedProfile = store.get('profile', null);
  let profile = Core.sanitizeProfile(storedProfile, LOCALE);
  let history = (store.get('history', []) || []).map((d) => Core.sanitizeDoc(d, LOCALE)).filter(Boolean);
  let counters = store.get('counters', {}) || {};

  // Landing pages (quote generator, UK VAT invoice...) set a starting document type and sample.
  const PRESET = readPreset();
  const PAGE_TYPE = Core.DOC_TYPES[PRESET.docType] ? PRESET.docType : 'invoice';

  function readPreset() {
    try {
      const el = document.getElementById('page-preset');
      return el ? JSON.parse(el.textContent) || {} : {};
    } catch (e) {
      return {};
    }
  }

  function presetSample() {
    const d = Core.sampleDoc(LOCALE);
    const p = PRESET;
    if (p.currency && Core.CURRENCIES.includes(p.currency)) d.currency = p.currency;
    ['taxLabel', 'taxRate', 'payment', 'notes'].forEach((k) => { if (typeof p[k] === 'string') d[k] = p[k]; });
    if (p.from) Object.assign(d.from, p.from);
    if (p.to) Object.assign(d.to, p.to);
    if (Array.isArray(p.items)) d.items = p.items.map((it) => Object.assign(Core.emptyItem(), it, { id: Core.uid() }));
    d.docType = PAGE_TYPE;
    d.number = Core.DOC_TYPES[PAGE_TYPE].prefix + '0042';
    return d;
  }

  const storedDraft = Core.sanitizeDoc(store.get('draft', null), LOCALE);
  let doc = storedDraft && !storedDraft.sample ? storedDraft : (storedProfile ? freshDoc(PAGE_TYPE) : presetSample());

  function nextNumberFor(type) {
    const known = history.filter((d) => d.docType === type).map((d) => d.number);
    if (counters[type]) known.push(counters[type]);
    const last = Core.latestNumber(known);
    return last ? Core.nextNumber(last, Core.DOC_TYPES[type].prefix) : Core.DOC_TYPES[type].prefix + '0001';
  }

  function freshDoc(type) {
    return Core.newDoc(profile, { docType: type, number: nextNumberFor(type) });
  }

  function isSaved(d) {
    return history.some((h) => h.id === d.id);
  }

  function hasContent(d) {
    return Core.computeTotals(d).lines.length > 0 || !!d.to.name.trim();
  }

  function needsSaving() {
    return !doc.sample && !isSaved(doc) && hasContent(doc);
  }

  function docLabel(d) {
    return Core.DOC_TYPES[d.docType].title + (d.number ? ' ' + d.number : '');
  }

  function saveHistory() {
    if (!store.set('history', history)) toast('Your browser storage is full, so this could not be saved. Delete old documents or remove your logo.');
  }

  function rememberNumber() {
    const known = [counters[doc.docType], doc.number].filter(Boolean);
    counters[doc.docType] = Core.latestNumber(known);
    store.set('counters', counters);
  }

  let persistTimer = 0;
  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 250);
  }

  function persist() {
    clearTimeout(persistTimer);
    doc.updatedAt = Date.now();
    store.set('draft', doc);
    if (!doc.sample) {
      // Remember business details so the next document starts pre-filled.
      Object.assign(profile, {
        from: Object.assign({}, doc.from), currency: doc.currency, paper: doc.paper, locale: doc.locale,
        taxLabel: doc.taxLabel, taxRate: doc.taxRate, payment: doc.payment, notes: doc.notes,
      });
      const days = Core.daysBetween(doc.issueDate, doc.dueDate);
      if (Core.DOC_TYPES[doc.docType].dueLabel && days != null && days >= 0 && days <= 365) profile.dueDays = days;
      store.set('profile', profile);
    }
    const i = history.findIndex((h) => h.id === doc.id);
    if (i > -1) {
      history[i] = clone(doc);
      saveHistory();
    }
  }

  function isPro() {
    return License.isPro();
  }

  function usesProStyle() {
    return !!profile.logo || profile.accent !== Core.DEFAULT_ACCENT || !profile.showCredit;
  }

  function creditLine() {
    let host = '';
    try { host = new URL(CFG.siteUrl).host; } catch (e) { /* no site URL set */ }
    return { text: 'Made with ' + BRAND + (host ? ' \u00b7 ' + host : ''), url: CFG.siteUrl || '' };
  }

  /** Styling for the document. Free downloads fall back to the free look. */
  function docStyle(forOutput) {
    const pro = isPro() || !forOutput;
    return {
      accent: pro ? profile.accent : Core.DEFAULT_ACCENT,
      logo: pro ? profile.logo : '',
      credit: pro && !profile.showCredit ? null : creditLine(),
    };
  }

  // ---------- form binding ----------

  const editor = $('#editor');

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  }

  function fillForm() {
    $$('[data-bind]').forEach((el) => {
      const v = getPath(doc, el.dataset.bind);
      el.value = v == null ? '' : v;
    });
    renderItems();
    syncTypeFields();
    syncBranding();
    $('#sample-note').hidden = !doc.sample;
  }

  function syncTypeFields() {
    const type = Core.DOC_TYPES[doc.docType];
    $('#f-number-label').textContent = type.numberLabel;
    $('#due-field').hidden = !type.dueLabel;
    if (type.dueLabel) $('#f-dueDate-label').textContent = type.dueLabel;
    $('#paid-field').hidden = doc.docType !== 'invoice';
  }

  function onTypeChange(previous) {
    const prevPrefix = Core.DOC_TYPES[previous].prefix;
    if (!doc.number.trim() || doc.number.startsWith(prevPrefix)) {
      doc.number = nextNumberFor(doc.docType);
      $('#f-number').value = doc.number;
    }
    if (Core.DOC_TYPES[doc.docType].dueLabel && !doc.dueDate) {
      doc.dueDate = Core.addDays(doc.issueDate, profile.dueDays);
      $('#f-dueDate').value = doc.dueDate;
    }
    syncTypeFields();
  }

  function knownClients() {
    const byName = new Map();
    history.forEach((d) => {
      const name = d.to.name.trim();
      if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), d.to);
    });
    return byName;
  }

  function fillClientList() {
    const list = $('#client-list');
    list.textContent = '';
    knownClients().forEach((to) => {
      const o = document.createElement('option');
      o.value = to.name;
      list.appendChild(o);
    });
  }

  function autofillClient() {
    const match = knownClients().get(doc.to.name.trim().toLowerCase());
    if (!match) return;
    const empty = ['email', 'phone', 'address', 'taxId'].every((k) => !doc.to[k].trim());
    if (!empty) return;
    ['email', 'phone', 'address', 'taxId'].forEach((k) => {
      doc.to[k] = match[k];
      $('#f-to-' + k).value = match[k];
    });
  }

  function markEdited() {
    if (doc.sample) {
      doc.sample = false;
      $('#sample-note').hidden = true;
    }
    updateSaveState();
  }

  editor.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.bind) {
      const previousType = doc.docType;
      setPath(doc, el.dataset.bind, el.value);
      if (el.dataset.bind === 'docType') onTypeChange(previousType);
      if (el.dataset.bind === 'to.name') autofillClient();
    } else if (el.closest('.item')) {
      onItemInput(el);
    } else {
      return;
    }
    markEdited();
    scheduleRender();
    persistSoon();
  });

  editor.addEventListener('submit', (e) => e.preventDefault());

  // ---------- line items ----------

  function itemRow(it) {
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.id = it.id;
    row.innerHTML =
      '<textarea class="item-desc" rows="1" aria-label="Description" placeholder="Description"></textarea>' +
      '<input class="item-qty num" inputmode="decimal" aria-label="Quantity" placeholder="1">' +
      '<input class="item-rate num" inputmode="decimal" aria-label="Rate" placeholder="0.00">' +
      '<output class="item-amt" aria-label="Amount"></output>' +
      '<button type="button" class="icon-btn item-del" aria-label="Remove item">\u00d7</button>';
    $('.item-desc', row).value = it.description;
    $('.item-qty', row).value = it.qty;
    $('.item-rate', row).value = it.rate;
    return row;
  }

  function renderItems() {
    const wrap = $('#items');
    wrap.textContent = '';
    doc.items.forEach((it) => wrap.appendChild(itemRow(it)));
    $$('.item-desc', wrap).forEach(autosize);
    renderItemAmounts();
  }

  function renderItemAmounts() {
    const digits = Core.currencyDigits(doc.currency);
    $$('#items .item').forEach((row) => {
      const it = doc.items.find((x) => x.id === row.dataset.id);
      if (!it) return;
      const amount = Core.round(Core.parseNumber(it.qty, doc.locale) * Core.parseNumber(it.rate, doc.locale), digits);
      $('.item-amt', row).textContent = Core.isBlankItem(it) ? '' : Core.formatMoney(amount, doc.currency, doc.locale);
    });
  }

  function onItemInput(el) {
    const row = el.closest('.item');
    const it = doc.items.find((x) => x.id === row.dataset.id);
    if (!it) return;
    if (el.classList.contains('item-desc')) { it.description = el.value; autosize(el); }
    if (el.classList.contains('item-qty')) it.qty = el.value;
    if (el.classList.contains('item-rate')) it.rate = el.value;
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }

  $('#items').addEventListener('click', (e) => {
    const btn = e.target.closest('.item-del');
    if (!btn) return;
    const id = btn.closest('.item').dataset.id;
    doc.items = doc.items.filter((x) => x.id !== id);
    if (!doc.items.length) doc.items.push(Core.emptyItem());
    renderItems();
    markEdited();
    scheduleRender();
    persistSoon();
  });

  $('#items').addEventListener('keydown', (e) => {
    // Enter in the last rate box adds a new row, like a spreadsheet.
    if (e.key !== 'Enter' || !e.target.classList.contains('item-rate')) return;
    const rows = $$('#items .item');
    if (e.target.closest('.item') !== rows[rows.length - 1]) return;
    e.preventDefault();
    addItem();
  });

  function addItem() {
    doc.items.push(Core.emptyItem());
    renderItems();
    const rows = $$('#items .item');
    $('.item-desc', rows[rows.length - 1]).focus();
    persistSoon();
  }
  $('#item-add').addEventListener('click', addItem);

  // ---------- preview ----------

  const sheet = $('#sheet');
  const frame = $('#sheet-frame');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function partyHtml(label, p, placeholder) {
    return '<div class="doc-party"><p class="doc-label">' + label + '</p>' +
      (p.name ? '<p class="name">' + esc(p.name) + '</p>' : '<p class="name ph">' + placeholder + '</p>') +
      p.lines.map((l) => '<p>' + esc(l) + '</p>').join('') + '</div>';
  }

  function renderSheet(view, style) {
    sheet.className = 'sheet' + (doc.paper === 'letter' ? ' letter' : '');
    const shades = Core.accentShades(style.accent);
    sheet.style.setProperty('--doc-ink', shades.ink);
    sheet.style.setProperty('--doc-tint', shades.tint);

    const brand = style.logo
      ? '<img src="' + esc(style.logo) + '" alt="">'
      : (view.from.name ? esc(view.from.name) : '<span class="ph">Your business</span>');

    const dates = view.dates.map((d) =>
      '<div><p class="doc-label">' + esc(d.label) + '</p><p class="val">' + esc(d.value) + '</p></div>').join('') +
      '<div><p class="doc-label">' + esc(view.headline.label) + '</p><p class="headline">' + esc(view.headline.value) + '</p></div>';

    const rows = view.items.length
      ? view.items.map((it) => '<tr><td>' + esc(it.description) + '</td><td>' + esc(it.qty) + '</td><td>' +
          esc(it.rate) + '</td><td>' + esc(it.amount) + '</td></tr>').join('')
      : '<tr class="empty"><td colspan="4">Add an item to get started.</td></tr>';

    const totals = view.rows.map((r) =>
      '<div class="' + (r.grand ? 'grand' : r.strong ? 'strong' : '') + '"><dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd></div>').join('');

    const blocks = [['Payment details', view.payment], ['Notes', view.notes]].filter((b) => b[1]);
    const notes = blocks.length
      ? '<section class="doc-notes' + (blocks.length === 1 ? ' single' : '') + '">' +
        blocks.map((b) => '<div><p class="doc-label">' + b[0] + '</p><p>' + esc(b[1]) + '</p></div>').join('') + '</section>'
      : '';

    const credit = style.credit
      ? (style.credit.url ? '<a href="' + esc(style.credit.url) + '">' + esc(style.credit.text) + '</a>' : esc(style.credit.text))
      : '';

    sheet.innerHTML =
      '<header class="doc-head"><div class="doc-brand">' + brand + '</div>' +
      '<div class="doc-title"><h2>' + esc(view.title) + '</h2>' + (view.number ? '<p>' + esc(view.number) + '</p>' : '') + '</div></header>' +
      '<section class="doc-parties">' + partyHtml('From', view.from, 'Your business') +
      partyHtml('Bill to', view.to, 'Client name') + '<div class="doc-dates">' + dates + '</div></section>' +
      '<table class="doc-items"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      '<div class="doc-bottom">' + (view.isPaid ? '<div class="doc-stamp">PAID</div>' : '<div></div>') +
      '<dl class="doc-totals">' + totals + '</dl></div>' + notes +
      '<footer class="doc-foot"><span>' + credit + '</span></footer>';
  }

  function renderTotalsMini(view) {
    $('#totals-mini').innerHTML = view.rows.map((r) =>
      '<dt class="' + (r.grand ? 'grand' : '') + '">' + esc(r.label) + '</dt><dd class="' + (r.grand ? 'grand' : '') + '">' + esc(r.value) + '</dd>').join('');
  }

  function fitSheet() {
    const avail = frame.parentElement.clientWidth - 8;
    if (avail <= 0) return;
    const w = sheet.offsetWidth;
    const h = sheet.offsetHeight;
    const scale = Math.min(1, avail / w);
    sheet.style.transform = 'scale(' + scale + ')';
    frame.style.width = w * scale + 'px';
    frame.style.height = h * scale + 'px';
  }

  function updatePreviewNote() {
    const note = $('#preview-note');
    const show = !isPro() && usesProStyle();
    note.hidden = !show;
    if (show) {
      note.innerHTML = 'Logo, color and hiding the footer are Pro features. Free downloads use the standard style. ' +
        '<button type="button" data-open-pro>Unlock Pro</button>';
    }
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    const totals = Core.computeTotals(doc);
    const view = Core.present(doc, totals);
    renderSheet(view, docStyle(false));
    renderTotalsMini(view);
    renderItemAmounts();
    updatePreviewNote();
    fitSheet();
  }

  if ('ResizeObserver' in window) new ResizeObserver(fitSheet).observe(frame.parentElement);
  window.addEventListener('resize', fitSheet);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSheet);

  // ---------- printing ----------

  const pageStyle = document.createElement('style');
  document.head.appendChild(pageStyle);

  window.addEventListener('beforeprint', () => {
    pageStyle.textContent = '@page { size: ' + (doc.paper === 'letter' ? 'letter' : 'A4') + '; margin: 48pt 48pt 40pt; }';
    renderSheet(Core.present(doc), docStyle(true));
  });
  window.addEventListener('afterprint', render);
  $('#act-print').addEventListener('click', () => {
    rememberNumber();
    window.print();
  });

  // ---------- PDF ----------

  function fileName() {
    const parts = [Core.DOC_TYPES[doc.docType].title, doc.number.trim(), doc.to.name.trim()].filter(Boolean);
    return parts.join(' ').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 120) + '.pdf';
  }

  async function downloadPdf(skipNudge) {
    if (!Core.computeTotals(doc).lines.length) {
      toast('Add at least one item before downloading.');
      return;
    }
    if (!skipNudge && !isPro() && usesProStyle()) {
      const choice = await ask('Keep your branding?',
        'Your logo, color and footer choice are Pro features. You can download now with the standard style, or unlock Pro to keep them.',
        [{ id: 'free', label: 'Download standard', kind: 'ghost' }, { id: 'pro', label: 'Unlock Pro', kind: 'primary' }]);
      if (choice === 'pro') openPro();
      if (choice === 'free') downloadPdf(true);
      return;
    }
    const btn = $('#act-pdf');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing\u2026';
    try {
      const style = docStyle(true);
      const result = await PDF.build(Core.present(doc), {
        paper: doc.paper, accent: style.accent, logo: style.logo, credit: style.credit, brand: BRAND,
      });
      PDF.save(result.blob, fileName());
      rememberNumber();
      toast(result.missingGlyphs
        ? 'Downloaded. Some characters are not supported in the PDF and show as \u201c?\u201d. For those, use Print and choose Save as PDF.'
        : 'PDF downloaded.');
    } catch (e) {
      console.error(e);
      toast(e && e.message ? e.message : 'The PDF could not be created. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  $('#act-pdf').addEventListener('click', () => downloadPdf(false));
  $('#act-pdf').addEventListener('pointerenter', () => PDF.preload(), { once: true });

  // ---------- saving and documents ----------

  function updateSaveState() {
    const saved = isSaved(doc);
    const btn = $('#act-save');
    btn.textContent = saved ? 'Saved \u2713' : 'Save';
    btn.setAttribute('aria-label', saved ? 'Saved. Changes save automatically.' : 'Save this document');
    $('#history-count').textContent = String(history.length);
  }

  function saveDoc() {
    if (isSaved(doc)) {
      persist();
      toast('Saved. Changes to this document now save automatically.');
      return true;
    }
    if (!isPro() && history.length >= FREE_SAVES) {
      openPro('The free plan keeps ' + FREE_SAVES + ' saved documents. Pro keeps as many as you like, or delete one under Saved.');
      return false;
    }
    doc.sample = false;
    doc.savedAt = Date.now();
    $('#sample-note').hidden = true;
    history.unshift(clone(doc));
    saveHistory();
    rememberNumber();
    persist();
    fillClientList();
    updateSaveState();
    toast(docLabel(doc) + ' saved.');
    return true;
  }
  $('#act-save').addEventListener('click', saveDoc);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveDoc();
    }
  });

  function loadDoc(d) {
    persist();
    doc = d;
    store.set('draft', doc);
    fillForm();
    render();
    updateSaveState();
    window.scrollTo({ top: 0 });
  }

  /** Ask before replacing an unsaved document. Resolves true when it is fine to continue. */
  async function confirmLeave(action) {
    if (!needsSaving()) return true;
    const choice = await ask(action, docLabel(doc) + " isn't saved. Save it first?", [
      { id: 'cancel', label: 'Cancel', kind: 'ghost' },
      { id: 'discard', label: "Don't save" },
      { id: 'save', label: 'Save', kind: 'primary' },
    ]);
    if (choice === 'discard') return true;
    if (choice === 'save') return saveDoc();
    return false;
  }

  $('#act-new').addEventListener('click', async () => {
    if (!(await confirmLeave('Start a new document?'))) return;
    loadDoc(freshDoc(doc.docType));
    toast('New ' + Core.DOC_TYPES[doc.docType].title.toLowerCase() + ' ' + doc.number + '.');
  });

  $('#sample-clear').addEventListener('click', () => {
    loadDoc(freshDoc(PAGE_TYPE));
    $('#f-from-name').focus();
  });

  // ---------- saved documents dialog ----------

  const historyDialog = $('#history-dialog');

  function renderHistory() {
    const pro = isPro();
    $('#history-limit').textContent = pro
      ? history.length + ' saved in this browser.'
      : history.length + ' of ' + FREE_SAVES + ' free saves used. Pro keeps unlimited documents.';
    $('#history-unsaved').hidden = !needsSaving();

    const list = $('#history-list');
    list.textContent = '';
    if (!history.length) {
      list.innerHTML = '<li class="history-empty">Nothing saved yet. Press Save on a document to keep it here.</li>';
      return;
    }
    const today = Core.todayISO();
    history.slice().sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.savedAt || 0) - (a.savedAt || 0))
      .forEach((d) => {
        const t = Core.computeTotals(d);
        const st = Core.status(d, t, today);
        const li = document.createElement('li');
        li.dataset.id = d.id;
        if (d.id === doc.id) li.className = 'current';
        li.innerHTML =
          '<div class="h-main"><span class="h-num">' + esc(d.number || 'No number') + '</span>' +
          '<span class="status status-' + st + '">' + esc(st) + '</span>' +
          '<span class="h-client">' + esc(d.to.name || 'No client') + '</span></div>' +
          '<div class="h-amt">' + esc(Core.formatMoney(Core.amountDue(d, t), d.currency, d.locale)) + '</div>' +
          '<div class="h-meta">' + esc(Core.DOC_TYPES[d.docType].title + ' \u00b7 ' + (Core.formatDate(d.issueDate, d.locale) || 'No date')) + '</div>' +
          '<div class="h-actions">' +
          '<button type="button" class="btn btn-small btn-ghost" data-act="open">Open</button>' +
          '<button type="button" class="btn btn-small btn-ghost" data-act="dup">Duplicate</button>' +
          '<button type="button" class="btn btn-small btn-ghost" data-act="del">Delete</button></div>';
        list.appendChild(li);
      });
  }

  $('#act-history').addEventListener('click', () => {
    renderHistory();
    historyDialog.showModal();
  });

  $('#history-save-current').addEventListener('click', () => {
    if (saveDoc()) renderHistory();
  });

  $('#history-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('li').dataset.id;
    const saved = history.find((h) => h.id === id);
    if (!saved) return;
    const act = btn.dataset.act;

    if (act === 'del') {
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = 'Confirm delete';
        btn.classList.add('danger');
        return;
      }
      history = history.filter((h) => h.id !== id);
      saveHistory();
      fillClientList();
      updateSaveState();
      renderHistory();
      toast(docLabel(saved) + ' deleted.');
      return;
    }

    if (saved.id === doc.id && act === 'open') {
      historyDialog.close();
      return;
    }
    if (!(await confirmLeave(act === 'open' ? 'Open another document?' : 'Duplicate this document?'))) return;
    historyDialog.close();
    if (act === 'open') {
      loadDoc(clone(saved));
      toast('Opened ' + docLabel(doc) + '.');
    } else {
      const copy = clone(saved);
      Object.assign(copy, {
        id: Core.uid(), number: nextNumberFor(copy.docType), issueDate: Core.todayISO(),
        dueDate: Core.addDays(Core.todayISO(), profile.dueDays), amountPaid: '', createdAt: Date.now(),
      });
      delete copy.savedAt;
      copy.items = copy.items.map((it) => Object.assign({}, it, { id: Core.uid() }));
      loadDoc(copy);
      toast('Copied as ' + docLabel(doc) + '. Save it when it is ready.');
    }
  });

  $('#history-csv').addEventListener('click', () => {
    if (!isPro()) {
      openPro('CSV export is a Pro feature. It gives your accountant every document in one spreadsheet.');
      return;
    }
    if (!history.length) {
      toast('Save a document first, then export.');
      return;
    }
    const csv = '\ufeff' + Core.toCSV(history, Core.todayISO());
    PDF.save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), BRAND.toLowerCase() + '-export-' + Core.todayISO() + '.csv');
    toast('Exported ' + history.length + ' documents.');
  });

  // ---------- branding ----------

  function syncBranding() {
    const thumb = $('#logo-thumb');
    thumb.style.backgroundImage = profile.logo ? 'url("' + profile.logo + '")' : '';
    thumb.classList.toggle('has-logo', !!profile.logo);
    $('#logo-remove').hidden = !profile.logo;
    $$('.swatch', $('#swatches')).forEach((s) => {
      const isCustom = s.classList.contains('swatch-custom');
      const on = isCustom ? !Core.ACCENTS.includes(profile.accent) : s.dataset.color === profile.accent;
      s.setAttribute('aria-checked', String(on));
      if (isCustom) s.style.background = on ? profile.accent : '';
    });
    $('#f-showCredit').checked = profile.showCredit;
  }

  function saveProfile() {
    if (!store.set('profile', profile)) toast('Your browser storage is full. Try a smaller logo.');
    syncBranding();
    render();
  }

  (function buildSwatches() {
    const box = $('#swatches');
    Core.ACCENTS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Accent ' + c);
      box.appendChild(b);
    });
    const custom = document.createElement('label');
    custom.className = 'swatch swatch-custom';
    custom.setAttribute('role', 'radio');
    custom.setAttribute('aria-label', 'Custom accent color');
    custom.innerHTML = '<input type="color" id="f-accent-custom" aria-label="Pick any color">';
    box.appendChild(custom);

    box.addEventListener('click', (e) => {
      const b = e.target.closest('button.swatch');
      if (!b) return;
      profile.accent = b.dataset.color;
      saveProfile();
    });
    $('#f-accent-custom').addEventListener('input', (e) => {
      profile.accent = e.target.value;
      saveProfile();
    });
  })();

  function readLogo(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error('That image is over 5 MB. Try a smaller file.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || 600;
        let h = img.naturalHeight || 240;
        const s = Math.min(1, 600 / w, 240 / h);
        w = Math.max(1, Math.round(w * s));
        h = Math.max(1, Math.round(h * s));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image. Try a PNG or JPG.'));
      };
      img.src = url;
    });
  }

  $('#f-logo').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      profile.logo = await readLogo(file);
      saveProfile();
      if (!isPro()) toast('Logo added to the preview. Unlock Pro to include it in downloads.');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#logo-remove').addEventListener('click', () => {
    profile.logo = '';
    saveProfile();
  });

  $('#f-showCredit').addEventListener('change', (e) => {
    profile.showCredit = e.target.checked;
    saveProfile();
  });

  // ---------- Pro ----------

  const proDialog = $('#pro-dialog');

  function syncPro() {
    const pro = isPro();
    $('#pro-open').dataset.proState = pro ? 'pro' : 'free';
    $('#pro-sell').hidden = pro;
    $('#pro-active').hidden = !pro;
    const info = License.info();
    $('#pro-email').textContent = pro && info && info.email ? ' for ' + info.email : '';
    const buy = $('#pro-buy');
    buy.hidden = !PRO.checkoutUrl;
    $('#pro-buy-missing').hidden = !!PRO.checkoutUrl;
    if (PRO.checkoutUrl) buy.href = PRO.checkoutUrl;
    buy.textContent = 'Buy Pro' + (PRO.price ? ' for ' + PRO.price : '');
  }

  function openPro(reason) {
    const r = $('#pro-reason');
    r.hidden = !reason;
    r.textContent = reason || '';
    const msg = $('#license-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    syncPro();
    if (!proDialog.open) proDialog.showModal();
  }

  $('#pro-open').addEventListener('click', () => openPro());
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-pro]')) openPro();
  });

  $('#license-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#license-submit');
    const msg = $('#license-msg');
    btn.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = 'Checking your key\u2026';
    const result = await License.activate($('#license-key').value);
    btn.disabled = false;
    if (result.ok) {
      msg.textContent = '';
      $('#license-key').value = '';
      $('#pro-reason').hidden = true;
      toast('Pro unlocked. Thank you!');
    } else {
      msg.className = 'form-msg error';
      msg.textContent = result.reason;
    }
  });

  $('#license-remove').addEventListener('click', () => {
    License.deactivate();
    toast('License removed from this browser.');
  });

  License.onChange(() => {
    syncPro();
    render();
    if (historyDialog.open) renderHistory();
  });

  // ---------- small UI helpers ----------

  let toastTimer = 0;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, Math.max(3000, text.length * 60));
  }

  function ask(title, text, actions) {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const box = $('#confirm-actions');
    box.textContent = '';
    return new Promise((resolve) => {
      let result = null;
      actions.forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (a.kind === 'primary' ? ' btn-primary' : a.kind === 'ghost' ? ' btn-ghost' : '');
        b.textContent = a.label;
        b.addEventListener('click', () => { result = a.id; dlg.close(); });
        box.appendChild(b);
      });
      dlg.addEventListener('close', () => resolve(result), { once: true });
      dlg.showModal();
    });
  }

  // Clicking the dimmed backdrop closes a dialog.
  $$('dialog').forEach((dlg) => dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  }));

  // Edit / Preview switch on narrow screens.
  function setView(view) {
    document.body.dataset.view = view;
    $('#tab-edit').setAttribute('aria-selected', String(view === 'edit'));
    $('#tab-preview').setAttribute('aria-selected', String(view === 'preview'));
    if (view === 'preview') requestAnimationFrame(fitSheet);
  }
  $('#tab-edit').addEventListener('click', () => setView('edit'));
  $('#tab-preview').addEventListener('click', () => setView('preview'));

  // ---------- start ----------

  (function fillCurrencies() {
    let names = null;
    try { names = new Intl.DisplayNames([LOCALE], { type: 'currency' }); } catch (e) { /* older browser */ }
    const sel = $('#f-currency');
    Core.CURRENCIES.forEach((code) => {
      const o = document.createElement('option');
      o.value = code;
      let name = '';
      try { name = names ? names.of(code) : ''; } catch (e) { /* unknown code */ }
      o.textContent = name && name !== code ? code + ' \u00b7 ' + name : code;
      sel.appendChild(o);
    });
  })();

  $$('[data-config]').forEach((el) => {
    const v = PRO[el.dataset.config];
    if (v) el.textContent = v;
  });
  $('#year').textContent = String(new Date().getFullYear());

  if (CFG.analytics && CFG.analytics.cloudflareToken) {
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: CFG.analytics.cloudflareToken }));
    document.head.appendChild(s);
  }

  setView('edit');
  fillForm();
  fillClientList();
  syncPro();
  updateSaveState();
  render();
  License.refresh();

  // Exposed for automated tests only.
  window.__app = { getDoc: () => doc, render };
})();
