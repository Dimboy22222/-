#!/usr/bin/env node
/*
 * Builds the search landing pages (quote generator, receipt maker...) from
 * site/index.html, plus sitemap.xml and robots.txt, using siteUrl from
 * site/config.js.
 *
 *   node tools/pages.js          write the files
 *   node tools/pages.js --check  exit 1 if the committed files are out of date
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');

const PAGES = [
  {
    file: 'quote-generator.html',
    title: 'Free Quote Generator: Make a PDF Quote Online | Tallyslip',
    description: 'Make a professional quote for a client in minutes and download it as a PDF. Free, no sign-up, and your data stays in your browser.',
    h1: 'Free quote generator',
    intro: 'Price up a job, set how long the offer stands, and send your client a clean PDF quote. No sign-up, and nothing you type leaves this device.',
    preset: {
      docType: 'quote',
      items: [
        { description: 'Website redesign, 5 pages', qty: '1', rate: '2400' },
        { description: 'Copywriting (per page)', qty: '5', rate: '120' },
        { description: 'Hosting and domain setup', qty: '1', rate: '150' },
      ],
      notes: 'This quote is valid until the date shown. Work outside the agreed scope is quoted separately.',
    },
    guide: `
  <h2>What to put on a quote</h2>
  <ul>
    <li>Your business name and contact details, and your client's</li>
    <li>A quote number, the date, and how long the price is valid</li>
    <li>Each part of the job with its quantity and price</li>
    <li>Any tax, and the total your client will pay</li>
    <li>Terms: deposit, what is not included, and how to accept</li>
  </ul>
  <h3>Quote or estimate?</h3>
  <p>A quote is a fixed price your client can accept. An estimate is your best guess, and the final price can change. If you are not sure of the final cost, choose Estimate in the Type menu.</p>
  <h3>Turn an accepted quote into an invoice</h3>
  <p>Save the quote. When the client says yes, open Saved, choose Duplicate, and change the type to Invoice. The client and items carry over, and the invoice gets its own number.</p>`,
  },
  {
    file: 'estimate-generator.html',
    title: 'Free Estimate Maker: Create a Job Estimate PDF | Tallyslip',
    description: 'Write a job estimate with labour and materials, add tax, and download it as a PDF. Free, no sign-up, and your data stays in your browser.',
    h1: 'Free estimate maker',
    intro: 'Break a job down into labour and materials, add tax, and download a PDF estimate to send. No sign-up, and nothing you type leaves this device.',
    preset: {
      docType: 'estimate',
      from: { name: 'Oakline Carpentry', email: 'jobs@oakline.example', phone: '+1 555 0187', address: '22 Birch Road\nPortland, OR 97214' },
      to: { name: 'Dana Whitfield', email: 'dana@example.com', address: '91 Alder Street\nPortland, OR 97209' },
      items: [
        { description: 'Labour: remove and replace deck boards (hours)', qty: '16', rate: '65' },
        { description: 'Composite decking boards', qty: '42', rate: '38.50' },
        { description: 'Fixings, sealant and waste disposal', qty: '1', rate: '180' },
      ],
      taxRate: '',
      payment: '',
      notes: 'Based on a site visit on the issue date. The final price may change if hidden damage is found. We will agree any change with you before continuing.',
    },
    guide: `
  <h2>What makes a good estimate</h2>
  <ul>
    <li>Labour and materials on separate lines, so the client sees where the money goes</li>
    <li>Labour as hours times your hourly rate. Put the hours in Qty. Decimals like 2.5 work.</li>
    <li>Your assumptions in Notes, such as what you saw on the site visit</li>
    <li>A "valid until" date, because material prices change</li>
  </ul>
  <h3>Estimate or quote?</h3>
  <p>An estimate is your best guess and can change. A quote is a fixed price. When you can commit to a price, switch the Type to Quote.</p>
  <h3>When the job is done</h3>
  <p>Save the estimate, then use Duplicate under Saved and change the type to Invoice. Adjust any quantities that changed, and send it.</p>`,
  },
  {
    file: 'receipt-generator.html',
    title: 'Free Receipt Maker: Create a PDF Receipt Online | Tallyslip',
    description: 'Make a receipt for a payment, marked paid, and download it as a PDF. Free, no sign-up, and your data stays in your browser.',
    h1: 'Free receipt maker',
    intro: 'Give a customer a proper receipt for their payment, clearly marked paid, as a PDF. No sign-up, and nothing you type leaves this device.',
    preset: {
      docType: 'receipt',
      from: { name: 'Maple Yoga Studio', email: 'hello@mapleyoga.example', phone: '+1 555 0163', address: '5 Orchard Way\nPortland, OR 97211' },
      to: { name: 'Chris Lee', email: 'chris@example.com', address: '' },
      items: [
        { description: 'Private yoga session, 60 minutes', qty: '4', rate: '70' },
        { description: 'Mat rental', qty: '4', rate: '3' },
      ],
      taxRate: '',
      payment: '',
      notes: 'Paid by card. Thank you for coming to class!',
    },
    guide: `
  <h2>What a receipt should show</h2>
  <ul>
    <li>Who was paid and who paid</li>
    <li>The date of the payment</li>
    <li>What the payment was for, with quantities and prices</li>
    <li>The amount paid, including any tax</li>
    <li>How it was paid. Add the payment method in Notes, for example "Paid by card".</li>
  </ul>
  <h3>Receipt or invoice?</h3>
  <p>An invoice asks to be paid. A receipt confirms that you have been paid. If a client paid part of an invoice, keep it as an invoice and enter the payment in "Amount already paid". The invoice then shows the balance still due.</p>`,
  },
  {
    file: 'freelance-invoice-template.html',
    title: 'Freelance Invoice Template: Free PDF Invoice Maker | Tallyslip',
    description: 'A free invoice template for freelancers. Bill by the hour or by the project and download a PDF. No sign-up, and your data stays in your browser.',
    h1: 'Freelance invoice template',
    intro: 'Bill clients for hours or fixed-price work and send a clean PDF invoice. No sign-up, and nothing you type leaves this device.',
    preset: {
      docType: 'invoice',
      from: { name: 'Jordan Blake Writing', email: 'jordan@blakewriting.example', phone: '', address: '301 Pine Street, Apt 4\nPortland, OR 97204' },
      items: [
        { description: 'Copywriting: product pages (hours)', qty: '12', rate: '60' },
        { description: 'SEO audit, fixed price', qty: '1', rate: '450' },
      ],
      taxRate: '',
      notes: 'Thank you! Payment is due within 14 days.',
    },
    guide: `
  <h2>Invoicing tips for freelancers</h2>
  <h3>Billing by the hour</h3>
  <p>Put the hours in Qty and your hourly rate in Rate. Decimals work, so 1.5 hours is fine. For fixed-price work, use a quantity of 1.</p>
  <h3>Payment terms</h3>
  <p>The due date sets your terms. 14 and 30 days are common. Tallyslip remembers the gap you use and applies it to your next invoice.</p>
  <h3>Get paid faster</h3>
  <ul>
    <li>Put exact payment details in "How to pay you": bank details, a PayPal address or a payment link</li>
    <li>Keep invoice numbers in order. Tallyslip numbers new invoices for you.</li>
    <li>If a client pays part of an invoice, enter it in "Amount already paid" so the balance is clear</li>
    <li>Send the invoice as soon as the work is delivered</li>
  </ul>`,
  },
  {
    file: 'uk-vat-invoice-generator.html',
    title: 'UK VAT Invoice Generator: Free PDF Invoices | Tallyslip',
    description: 'Make an invoice in pounds with VAT added and your VAT number shown, then download it as a PDF. Free, no sign-up, and your data stays in your browser.',
    h1: 'UK VAT invoice generator',
    intro: 'Make an invoice in pounds with VAT added and your VAT number on it, ready to send as a PDF. No sign-up, and nothing you type leaves this device.',
    preset: {
      docType: 'invoice',
      currency: 'GBP',
      taxLabel: 'VAT',
      taxRate: '20',
      from: { name: 'Hartley Design Ltd', email: 'accounts@hartleydesign.example', phone: '+44 117 496 0000', address: '14 Queen Square\nBristol BS1 4NT', taxId: 'GB 123 4567 89' },
      to: { name: 'Kestrel Coffee Co.', email: 'finance@kestrelcoffee.example', address: '8 Castle Street\nLeeds LS1 2AB' },
      items: [
        { description: 'Brand identity design', qty: '1', rate: '1800' },
        { description: 'Packaging artwork (per product)', qty: '3', rate: '350' },
      ],
      payment: 'Bank transfer to Hartley Design Ltd\nSort code 00-00-00 · Account 12345678',
    },
    guide: `
  <h2>What goes on a UK VAT invoice</h2>
  <p>HMRC lists what a full VAT invoice must show. The main items are:</p>
  <ul>
    <li>A unique invoice number that follows on from the last one</li>
    <li>Your business name, address and VAT registration number</li>
    <li>The invoice date, and the time of supply (tax point) if it is different</li>
    <li>Your customer's name and address</li>
    <li>A description of what you supplied, with quantity and price before VAT</li>
    <li>The VAT rate, the total before VAT and the total VAT</li>
  </ul>
  <h3>How to fill it in here</h3>
  <p>Enter your VAT number in Tax ID and set the tax name to VAT. The number then prints as "VAT no." on the invoice. Keep the automatic numbering, and set the rate to 20% or the rate you charge.</p>
  <p>Tallyslip applies one VAT rate to the whole invoice. If lines have different rates, or the tax point differs from the invoice date, note it in Notes and check HMRC's guidance on VAT invoices. This page is general information, not tax advice.</p>
  <h3>Not VAT registered?</h3>
  <p>Only VAT-registered businesses can charge VAT. If you are not registered, set the tax rate to 0 and leave out a VAT number.</p>`,
  },
];

function siteUrl() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'config.js'), 'utf8'), sandbox);
  const url = String(sandbox.window.APP_CONFIG.siteUrl || '');
  if (!/^https?:\/\//.test(url)) throw new Error('Set siteUrl in site/config.js to the live address first.');
  return url.endsWith('/') ? url : url + '/';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replace(html, pattern, value, label) {
  if (!pattern.test(html)) throw new Error('index.html no longer contains the ' + label + '. Update tools/pages.js.');
  return html.replace(pattern, () => value);
}

function withUrl(html, url) {
  html = replace(html, /<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + url + '">', 'canonical link');
  return replace(html, /<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + url + '">', 'og:url tag');
}

function buildPage(template, page, base) {
  let h = withUrl(template, base + page.file);
  h = replace(h, /<title>[^<]*<\/title>/, '<title>' + esc(page.title) + '</title>', 'title');
  h = replace(h, /<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(page.description) + '">', 'description');
  h = replace(h, /<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(page.title) + '">', 'og:title');
  h = replace(h, /<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(page.description) + '">', 'og:description');
  const intro = /<h1>[^<]*<\/h1>(\s*)<p>[^<]*<\/p>/;
  if (!intro.test(h)) throw new Error('index.html no longer contains the intro heading. Update tools/pages.js.');
  h = h.replace(intro, (m, gap) => '<h1>' + esc(page.h1) + '</h1>' + gap + '<p>' + esc(page.intro) + '</p>');
  const preset = JSON.stringify(page.preset).replace(/</g, '\\u003c');
  h = replace(h, /<\/head>/, '<script type="application/json" id="page-preset">' + preset + '</script>\n</head>', 'head');
  h = replace(h, /<section class="content" id="how">/, '<section class="content guide" id="guide">' + page.guide + '\n</section>\n\n<section class="content" id="how">', 'how-it-works section');
  return '<!-- Generated by tools/pages.js from index.html. Edit those, not this file. -->\n' + h;
}

function outputs() {
  const base = siteUrl();
  const index = withUrl(fs.readFileSync(path.join(SITE, 'index.html'), 'utf8'), base);
  const files = { 'index.html': index };
  PAGES.forEach((p) => { files[p.file] = buildPage(index, p, base); });
  const urls = [base].concat(PAGES.map((p) => base + p.file));
  files['sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + u + '</loc></url>').join('\n') + '\n</urlset>\n';
  files['robots.txt'] = 'User-agent: *\nAllow: /\n\nSitemap: ' + base + 'sitemap.xml\n';
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = outputs();
  const stale = [];
  Object.keys(files).forEach((name) => {
    const target = path.join(SITE, name);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === files[name]) return;
    stale.push(name);
    if (!check) fs.writeFileSync(target, files[name]);
  });
  if (check && stale.length) {
    console.error('Out of date: ' + stale.join(', ') + '. Run: node tools/pages.js');
    process.exit(1);
  }
  console.log(check ? 'Landing pages are up to date.' : (stale.length ? 'Wrote ' + stale.join(', ') : 'Nothing to change.'));
}

if (require.main === module) main();
module.exports = { PAGES, outputs };
