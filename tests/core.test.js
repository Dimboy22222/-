const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../site/assets/core.js');

function doc(overrides) {
  const d = Core.newDoc(Core.defaultProfile('en-US'));
  return Object.assign(d, { currency: 'USD', locale: 'en-US' }, overrides);
}

test('parseNumber reads common typing styles', () => {
  assert.equal(Core.parseNumber('1,234.50', 'en-US'), 1234.5);
  assert.equal(Core.parseNumber('1.234,50', 'de-DE'), 1234.5);
  assert.equal(Core.parseNumber('12,5', 'en-US'), 12.5);
  assert.equal(Core.parseNumber('12.50', 'de-DE'), 12.5);
  assert.equal(Core.parseNumber('1,000', 'en-US'), 1000);
  assert.equal(Core.parseNumber('1.000', 'de-DE'), 1000);
  assert.equal(Core.parseNumber('1 234,5', 'fr-FR'), 1234.5);
  assert.equal(Core.parseNumber('$ 85', 'en-US'), 85);
  assert.equal(Core.parseNumber('-40', 'en-US'), -40);
  assert.equal(Core.parseNumber('(40)', 'en-US'), -40);
  assert.equal(Core.parseNumber('', 'en-US'), 0);
  assert.equal(Core.parseNumber('abc', 'en-US'), 0);
});

test('round handles binary floating point edges', () => {
  assert.equal(Core.round(1.005, 2), 1.01);
  assert.equal(Core.round(-1.005, 2), -1.01);
  assert.equal(Core.round(0.1 + 0.2, 2), 0.3);
  assert.equal(Core.round(1234.5, 0), 1235);
});

test('computeTotals applies discount, tax and payments', () => {
  const d = doc({
    items: [
      { id: 'a', description: 'Design', qty: '2', rate: '100' },
      { id: 'b', description: 'Hours', qty: '1.5', rate: '33.33' },
      { id: 'c', description: '', qty: '1', rate: '' },
    ],
    discountType: 'percent', discountValue: '10', taxRate: '8.25', amountPaid: '50',
  });
  const t = Core.computeTotals(d);
  assert.equal(t.lines.length, 2, 'blank rows are ignored');
  assert.equal(t.lines[1].amount, 50);
  assert.equal(t.subtotal, 250);
  assert.equal(t.discount, 25);
  assert.equal(t.taxable, 225);
  assert.equal(t.tax, 18.56);
  assert.equal(t.total, 243.56);
  assert.equal(t.paid, 50);
  assert.equal(t.balance, 193.56);
  assert.equal(t.isPaid, false);
});

test('fixed discount never exceeds the subtotal', () => {
  const t = Core.computeTotals(doc({
    items: [{ id: 'a', description: 'x', qty: '1', rate: '80' }],
    discountType: 'fixed', discountValue: '120',
  }));
  assert.equal(t.discount, 80);
  assert.equal(t.total, 0);
});

test('zero-decimal currencies round to whole units', () => {
  const t = Core.computeTotals(doc({
    currency: 'JPY',
    items: [{ id: 'a', description: 'x', qty: '3', rate: '333.4' }],
    taxRate: '10',
  }));
  assert.equal(t.digits, 0);
  assert.equal(t.subtotal, 1000);
  assert.equal(t.tax, 100);
  assert.equal(t.total, 1100);
});

test('receipts and fully paid invoices count as paid', () => {
  const items = [{ id: 'a', description: 'x', qty: '1', rate: '10' }];
  assert.equal(Core.computeTotals(doc({ docType: 'receipt', items })).isPaid, true);
  assert.equal(Core.computeTotals(doc({ items, amountPaid: '10' })).isPaid, true);
  assert.equal(Core.computeTotals(doc({ docType: 'quote', items, amountPaid: '10' })).paid, 0);
});

test('status reflects due dates and partial payments', () => {
  const items = [{ id: 'a', description: 'x', qty: '1', rate: '10' }];
  const base = { items, issueDate: '2026-01-01', dueDate: '2026-01-15' };
  assert.equal(Core.status(doc(base), null, '2026-01-10'), 'unpaid');
  assert.equal(Core.status(doc(base), null, '2026-01-16'), 'overdue');
  assert.equal(Core.status(doc(Object.assign({ amountPaid: '4' }, base)), null, '2026-01-10'), 'partial');
  assert.equal(Core.status(doc(Object.assign({ amountPaid: '10' }, base)), null, '2026-02-01'), 'paid');
  assert.equal(Core.status(doc(Object.assign({ docType: 'quote' }, base)), null, '2026-02-01'), 'quote');
});

test('nextNumber keeps prefixes, suffixes and padding', () => {
  assert.equal(Core.nextNumber('INV-0009'), 'INV-0010');
  assert.equal(Core.nextNumber('2026/7'), '2026/8');
  assert.equal(Core.nextNumber('A-99-B'), 'A-100-B');
  assert.equal(Core.nextNumber('', 'QUO-'), 'QUO-0001');
  assert.equal(Core.nextNumber('Draft', 'INV-'), 'INV-0001');
  assert.equal(Core.latestNumber(['INV-0002', 'INV-0010', 'INV-0003']), 'INV-0010');
});

test('formatMoney follows currency and locale conventions', () => {
  assert.equal(Core.formatMoney(1234.5, 'USD', 'en-US'), '$1,234.50');
  assert.equal(Core.formatMoney(1234.5, 'JPY', 'en-US'), '¥1,235');
  assert.equal(Core.formatMoney(-0.001, 'USD', 'en-US'), '$0.00');
  assert.match(Core.formatMoney(1234.5, 'EUR', 'de-DE'), /^1\.234,50\s€$/);
  assert.equal(Core.formatMoney(5, 'USD', 'not-a-locale!!'), '$5.00');
});

test('dates are handled as local calendar days', () => {
  assert.equal(Core.addDays('2026-01-30', 14), '2026-02-13');
  assert.equal(Core.daysBetween('2026-01-01', '2026-03-01'), 59);
  assert.equal(Core.formatDate('2026-09-26', 'en-US'), 'Sep 26, 2026');
  assert.equal(Core.formatDate('not a date', 'en-US'), '');
});

test('toCSV escapes values and neutralises formulas', () => {
  const d = doc({
    number: 'INV-0001', issueDate: '2026-01-01', dueDate: '2026-01-15',
    to: Object.assign(Core.emptyParty(), { name: 'Acme, "Inc"', email: '=HYPERLINK("x")' }),
    items: [{ id: 'a', description: 'x', qty: '1', rate: '10' }],
  });
  const lines = Core.toCSV([d], '2026-01-10').trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1],
    'Invoice,INV-0001,unpaid,2026-01-01,2026-01-15,"Acme, ""Inc""","\'=HYPERLINK(""x"")",USD,10.00,0.00,0.00,10.00,0.00,10.00');
});

test('sanitizeDoc repairs stored data and rejects garbage', () => {
  assert.equal(Core.sanitizeDoc(null), null);
  assert.equal(Core.sanitizeDoc({ foo: 1 }), null);
  const d = Core.sanitizeDoc({ items: [null, { description: 5, qty: 2 }], currency: 'XXX', docType: 'bogus', paper: 'a3' }, 'en-GB');
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].description, '5');
  assert.equal(d.items[0].qty, '2');
  assert.equal(d.currency, 'GBP');
  assert.equal(d.docType, 'invoice');
  assert.equal(d.paper, 'a4');
});

test('sanitizeProfile drops unsafe logos and bad colors', () => {
  const p = Core.sanitizeProfile({ logo: 'javascript:alert(1)', accent: 'red', currency: 'EUR' }, 'en-US');
  assert.equal(p.logo, '');
  assert.equal(p.accent, Core.DEFAULT_ACCENT);
  assert.equal(p.currency, 'EUR');
  assert.equal(p.paper, 'letter');
});

test('present formats what the renderers draw', () => {
  const v = Core.present(doc({
    docType: 'invoice', number: ' INV-0007 ', issueDate: '2026-09-01', dueDate: '2026-09-15',
    from: Object.assign(Core.emptyParty(), { name: 'Studio', address: 'Line 1\n\n Line 2 ', taxId: 'GB123' }),
    items: [{ id: 'a', description: 'Work', qty: '2', rate: '50' }],
    discountType: 'percent', discountValue: '10', taxLabel: 'VAT', taxRate: '20', amountPaid: '8',
  }));
  assert.equal(v.number, 'INV-0007');
  assert.deepEqual(v.from.lines, ['Line 1', 'Line 2', 'Tax ID: GB123']);
  assert.deepEqual(v.dates.map((d) => d.label), ['Issue date', 'Due date']);
  assert.deepEqual(v.rows.map((r) => [r.label, r.value]), [
    ['Subtotal', '$100.00'], ['Discount (10%)', '-$10.00'], ['VAT (20%)', '$18.00'],
    ['Total', '$108.00'], ['Amount paid', '-$8.00'], ['Balance due', '$100.00'],
  ]);
  assert.deepEqual(v.headline, { label: 'Balance due', value: '$100.00' });
  assert.deepEqual(v.items, [{ description: 'Work', qty: '2', rate: '$50.00', amount: '$100.00' }]);

  const q = Core.present(doc({ docType: 'receipt', items: [{ id: 'a', description: 'x', qty: '1', rate: '5' }] }));
  assert.equal(q.dates.length, 1, 'receipts have no due date');
  assert.equal(q.isPaid, true);
  assert.deepEqual(q.rows[q.rows.length - 1], { label: 'Total paid', value: '$5.00', grand: true });
});

test('accentShades keeps light accents readable on paper', () => {
  assert.deepEqual(Core.accentShades('#0e6e5c'), { ink: '#0e6e5c', tint: '#e7f1ef' });
  const yellow = Core.accentShades('#ffe000');
  const [r, g, b] = Core.hexToRgb(yellow.ink);
  assert.ok(r < 160 && g < 160 && b < 20, 'yellow is darkened to a readable olive: ' + yellow.ink);
});
