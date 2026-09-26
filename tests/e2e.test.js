// Browser tests. Run with `npm run test:e2e` (needs `npm install` and a Playwright Chromium).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain' };

let server;
let baseUrl;
let browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url.endsWith('/') ? url + 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
  server.close();
});

async function openApp(options) {
  const opts = options || {};
  const context = await browser.newContext({ acceptDownloads: true, locale: 'en-US', viewport: opts.viewport || { width: 1360, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (opts.config) {
    await page.route('**/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: opts.config }));
  }
  await page.goto(baseUrl);
  return { page, context, errors };
}

test('first visit shows a filled sample invoice', async () => {
  const { page, context, errors } = await openApp();
  await assert.doesNotReject(page.waitForSelector('#sheet .doc-items tbody tr'));
  assert.equal(await page.locator('#sample-note').isVisible(), true);
  assert.equal(await page.locator('#sheet .doc-brand').innerText(), 'Rivera Studio');
  // 1200 + 650 + 297.50 = 2147.50; 8.5% tax = 182.54
  assert.equal(await page.locator('#sheet .doc-totals .grand dd').innerText(), '$2,330.04');
  assert.deepEqual(errors, []);
  await context.close();
});

test('editing items updates the preview and the PDF downloads', async () => {
  const { page, context, errors } = await openApp();
  await page.click('#sample-clear');
  await page.fill('#f-from-name', 'Ada Consulting');
  await page.fill('#f-to-name', 'Client Ltd');
  const row = page.locator('#items .item').first();
  await row.locator('.item-desc').fill('Strategy workshop');
  await row.locator('.item-qty').fill('2');
  await row.locator('.item-rate').fill('450');
  await page.fill('#f-taxRate', '10');
  await page.fill('#f-discountValue', '50');
  await page.selectOption('#f-discountType', 'fixed');
  await page.waitForFunction(() => document.querySelector('#sheet .doc-totals .grand dd').textContent === '$935.00');
  assert.equal(await page.locator('#sample-note').isVisible(), false);

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#act-pdf')]);
  assert.equal(download.suggestedFilename(), 'Invoice INV-0001 Client Ltd.pdf');
  const file = await download.path();
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 20000, 'PDF embeds the fonts');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the free plan keeps three saved documents', async () => {
  const { page, context } = await openApp();
  await page.click('#sample-clear');
  for (let i = 0; i < 3; i++) {
    await page.locator('#items .item-desc').first().fill('Job ' + i);
    await page.locator('#items .item-rate').first().fill('100');
    await page.click('#act-save');
    await page.click('#act-new');
  }
  assert.equal(await page.locator('#history-count').innerText(), '3');
  await page.locator('#items .item-desc').first().fill('Job 4');
  await page.locator('#items .item-rate').first().fill('100');
  await page.click('#act-save');
  await page.waitForSelector('#pro-dialog[open]');
  assert.match(await page.locator('#pro-reason').innerText(), /keeps 3 saved documents/);
  assert.equal(await page.locator('#history-count').innerText(), '3');
  await context.close();
});

test('a valid Lemon Squeezy key unlocks Pro and a foreign key does not', async () => {
  const config = "window.APP_CONFIG = { brand: 'Tallyslip', siteUrl: 'https://example.com', pro: { price: '$19', " +
    "checkoutUrl: 'https://example.com/buy', provider: 'lemonsqueezy', lemonsqueezy: { storeId: 42, productId: 7 } } };";
  const { page, context } = await openApp({ config });
  await page.route('https://api.lemonsqueezy.com/v1/licenses/validate', async (route) => {
    const key = new URLSearchParams(route.request().postData()).get('license_key');
    const body = key === 'GOOD-KEY'
      ? { valid: true, license_key: { status: 'active' }, meta: { store_id: 42, product_id: 7, customer_email: 'buyer@example.com' } }
      : { valid: true, license_key: { status: 'active' }, meta: { store_id: 99, product_id: 1 } };
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });

  await page.click('#pro-open');
  assert.equal(await page.locator('#pro-buy').getAttribute('href'), 'https://example.com/buy');
  await page.fill('#license-key', 'OTHER-STORE-KEY');
  await page.click('#license-submit');
  await page.waitForFunction(() => document.querySelector('#license-msg').textContent.includes('different product'));

  await page.fill('#license-key', 'GOOD-KEY');
  await page.click('#license-submit');
  await page.waitForSelector('#pro-active:not([hidden])');
  assert.match(await page.locator('#pro-active').innerText(), /buyer@example\.com/);
  assert.equal(await page.locator('#pro-open').getAttribute('data-pro-state'), 'pro');

  // Pro survives a reload.
  await page.reload();
  assert.equal(await page.locator('#pro-open').getAttribute('data-pro-state'), 'pro');
  await context.close();
});

test('the layout fits a phone screen', async () => {
  const { page, context, errors } = await openApp({ viewport: { width: 390, height: 844 } });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0, 'no sideways scrolling');
  await page.click('#tab-preview');
  assert.equal(await page.locator('#editor').isVisible(), false);
  const box = await page.locator('#sheet').boundingBox();
  assert.ok(box.width <= 390, 'the sheet is scaled to fit');
  assert.deepEqual(errors, []);
  await context.close();
});
