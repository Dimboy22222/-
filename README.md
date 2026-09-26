# Tallyslip: a free invoice generator that sells a Pro upgrade

Tallyslip is a web app where freelancers and small businesses make invoices, quotes, estimates and receipts, then download them as PDFs. It is free to use, which brings in visitors. You earn from a **one-time Pro upgrade ($19 by default)**, sold through Lemon Squeezy or Gumroad.

- **No server and no monthly costs.** It is a static site, so GitHub Pages, Cloudflare Pages or Netlify can host it for free.
- **No customer database to look after.** The store takes payment, handles sales tax and emails the buyer a license key. The site checks that key directly with the store's public API.
- **Your users' data stays in their browser**, which is a selling point and means you hold no personal data.

## What's free and what's Pro

| Free | Pro (one-time) |
| --- | --- |
| Unlimited invoices, quotes, estimates and receipts | Logo on documents |
| PDF download and printing | Brand color |
| 46 currencies, tax, discounts, partial payments | Removes the "Made with Tallyslip" line |
| 3 saved documents | Unlimited saved documents |
| | CSV export |

Free users can try the Pro features on the preview. When they download, the app offers Pro before giving them the standard version. The free plan keeps 3 saved documents. Trying to save a fourth also opens the upgrade. Every free PDF carries a "Made with Tallyslip" link, so each invoice a free user sends advertises the site to their client.

## Start selling (about an hour)

### 1. Create the product in a store

**Lemon Squeezy** (recommended: it acts as merchant of record, so it collects and pays VAT and sales tax for you. Check their pricing page for current fees.)

1. Sign up at lemonsqueezy.com and create a store. Store activation asks for a website with a privacy policy, terms and refund policy. This site already has them in `site/privacy.html` and `site/terms.html`.
2. Create a product called "Tallyslip Pro" as a single payment of $19.
3. In the product's settings, turn on **Generate license keys**. Set the activation limit to unlimited, or a generous number like 5, and set no expiry.
4. Publish it and copy the product's **checkout link** (Share button).
5. Note your numeric **Store ID** (in your store settings) and the **Product ID** (shown for each product in the dashboard).

**Gumroad** (simpler setup, higher fees)

1. Create a digital product and set the price.
2. In the product's content settings, turn on **Generate a unique license key per sale**. Gumroad then shows the product's `product_id` in that section.
3. Copy the product page URL as your checkout link.

### 2. Fill in `site/config.js`

```js
siteUrl: 'https://your-domain.com',
supportEmail: 'you@your-domain.com',
pro: {
  price: '$19',
  checkoutUrl: 'https://yourstore.lemonsqueezy.com/buy/...',
  provider: 'lemonsqueezy',            // or 'gumroad'
  lemonsqueezy: { storeId: 12345, productId: 67890 },
  gumroad: { productId: '' },          // when using Gumroad
},
```

At least one Lemon Squeezy ID (or the Gumroad product ID) is required. The site uses it to reject keys from other stores.

### 3. Put it online

**GitHub Pages:** merge this branch into `main`, then go to **Settings → Pages → Source → GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) runs the tests and publishes `site/` on every push to `main`. On the free GitHub plan, Pages only works for public repositories.

**Cloudflare Pages or Netlify:** drag the `site` folder into their "deploy manually" screen.

A custom domain (about $10 a year) is worth it for trust and search ranking. Update `siteUrl` in `config.js` when you have one.

### 4. Test a purchase

Switch your store to test mode, buy Pro with a test card, paste the emailed key into the site's Pro dialog, and check that Pro unlocks. Then refund the test order and check that Pro turns off. The site re-checks keys about once a week, so this can take up to a week in a browser that already unlocked Pro.

### 5. Optional: count visitors

Create a free Cloudflare Web Analytics site and paste its token into `analytics.cloudflareToken`. It sets no cookies, which matches the privacy policy.

## Getting customers

The software is only half the job. Traffic is the other half. These tactics fit this kind of tool:

1. **Be findable.** "Invoice generator" is a crowded search term. Narrower pages win sooner, for example "invoice template for photographers", "UK VAT invoice generator" or "receipt maker for cleaners". Copy `index.html` into pages like these, change the title, heading and intro, and set the matching document type or currency. Each extra page is another way to be found.
2. **List it everywhere tools get listed:** Product Hunt, AlternativeTo (as an alternative to paid invoicing apps), SaaSHub, Indie Hackers and "free tools for freelancers" roundups.
3. **Answer real questions.** Freelancer communities on Reddit, Facebook and Discord regularly ask "how do I make an invoice?". Helpful answers that mention the tool work. Read each community's self-promotion rules first.
4. **Let the footer work.** Every free PDF links back to your site. Set `siteUrl` to your real domain before launch so those links count.
5. **Change the price when the data says so.** Try $12, $19 and $29 over a few weeks each and keep the one that earns most. The store dashboard shows conversion.

**What to expect:** these numbers are an illustration, not a forecast. If 3,000 people use the tool in a month and 1% of them buy at $19, that is about $570 for the month. Traffic from search usually builds over months, not days.

## Rebranding

"Tallyslip" is a placeholder name. To use your own name, search and replace `Tallyslip` in the `site/` folder and set `brand` in `config.js`. The icon is `site/favicon.svg`, and the same mark is inline at the top of `index.html`. Also update the dates and wording in `privacy.html` and `terms.html`. They are a reasonable starting point, not legal advice.

## How it works

```
site/
  index.html         the app and landing page
  config.js          your settings (price, checkout link, store IDs)
  privacy.html       privacy policy, required by payment stores
  terms.html         terms, including the refund policy
  assets/core.js     invoice math and formatting (shared by the preview, the PDF and the tests)
  assets/app.js      editor, preview, saving, Pro upsell
  assets/pdf.js      builds the PDF with jsPDF (loaded on first download)
  assets/license.js  checks license keys with Lemon Squeezy or Gumroad
  assets/vendor/     jsPDF 4.2.1 (MIT)
  assets/fonts/      Inter, subset to Latin, Greek and Cyrillic (SIL OFL)
tests/
  core.test.js       unit tests for the math
  e2e.test.js        browser tests: sample, PDF download, save limit, Pro unlock, phone layout
```

- **PDFs contain real text, not screenshots.** Clients can search and copy them, and accounting tools can read them. Scripts the bundled font lacks (for example Arabic or Chinese) are replaced with "?", and the app points users to Print → Save as PDF for those.
- **Pro is checked in the browser.** Someone determined could bypass it with developer tools. That is a normal trade-off for a low-priced tool with no server. The people who pay are the ones who value the product.
- **Saved documents live in the browser's local storage.** Clearing site data deletes them. The FAQ tells users this.

## Development

```sh
npm start            # serve site/ on http://localhost:8080
npm test             # unit tests, no install needed
npm install          # once, for the browser tests
npx playwright install chromium
npm run test:e2e     # browser tests
```

Opening `index.html` straight from disk mostly works, but browsers block the font files there, so PDFs fall back to Helvetica. Use `npm start` instead.
