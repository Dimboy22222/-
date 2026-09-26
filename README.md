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

## Status

**Done:** the app, PDF export, Pro licensing, legal pages, 5 search landing pages, a sitemap, tests, and a workflow that publishes the site when Pages is on.

**Only the owner can do these two things**, because they involve the owner's identity, money and the decision to publish:

1. **Put the site online.** On github.com/Dimboy22222/-, go to **Settings → General → Danger Zone → Change visibility → Make public**. Then go to **Settings → Pages → Source → GitHub Actions**. Free GitHub accounts can only host websites from public repositories. The repository holds only the site's code, tests and docs, with no passwords or keys, and the site's code is visible to every visitor anyway. The site then appears at https://dimboy22222.github.io/-/ within a few minutes of the next push to `main`, or when the "Test and deploy" workflow is run again from the Actions tab.
2. **Create the Gumroad product that takes the money.** See the next section. Then give the product link to whoever maintains the site so it can be added to `site/config.js`.

## Selling Pro with Gumroad

Gumroad is the default because it is the simplest to set up. It takes a fee per sale and pays out to your bank or PayPal.

1. Sign up at gumroad.com.
2. Create a new product. Choose a digital product and name it "Tallyslip Pro". Set the price to $19.
3. In the product's content settings, turn on **Generate a unique license key per sale**. Gumroad then shows the product's ID in that section.
4. Publish the product.
5. Put the product page link in `checkoutUrl` and the product ID in `gumroad.productId` in `site/config.js`:

```js
pro: {
  price: '$19',
  checkoutUrl: 'https://yourname.gumroad.com/l/tallyslip-pro',
  provider: 'gumroad',
  gumroad: { productId: 'the ID from step 3' },
},
```

6. Set up payouts in Gumroad's settings so the money reaches your bank or PayPal.

The product ID is required. The site uses it to reject license keys from other people's products.

**Lemon Squeezy instead:** it takes lower fees and acts as merchant of record for VAT and sales tax, but store approval takes longer. Create a product with **Generate license keys** turned on, then set `provider: 'lemonsqueezy'`, the checkout link, and `lemonsqueezy: { storeId, productId }` (the numeric IDs from its dashboard).

**Test it once:** buy Pro yourself, paste the emailed key into the site's Pro dialog, and check that Pro unlocks. Refund yourself afterwards. The site re-checks keys about once a week, so a refunded key can keep working for up to a week in a browser that already unlocked Pro.

**Optional visitor counts:** create a free Cloudflare Web Analytics site and paste its token into `analytics.cloudflareToken`. It sets no cookies, which matches the privacy policy.

A custom domain (about $10 a year) helps trust and search ranking. After buying one, change `siteUrl` in `config.js` and run `npm run pages` to update the page links and sitemap.

## Getting customers

The software is only half the job. Traffic is the other half. [LAUNCH.md](LAUNCH.md) has ready-to-paste posts for each place below.

1. **Be findable.** "Invoice generator" is a crowded search term, so narrower pages exist too: a quote generator, an estimate maker, a receipt maker, a freelance invoice template and a UK VAT invoice generator. Each is built from `index.html` by `tools/pages.js`. To add another, add an entry to its `PAGES` list and run `npm run pages`. Submit `sitemap.xml` in Google Search Console once the site is live.
2. **List it everywhere tools get listed:** Product Hunt, AlternativeTo (as an alternative to paid invoicing apps), SaaSHub, Indie Hackers and "free tools for freelancers" roundups.
3. **Answer real questions.** Freelancer communities on Reddit, Facebook and Discord regularly ask "how do I make an invoice?". Helpful answers that mention the tool work. Read each community's self-promotion rules first.
4. **Let the footer work.** Every free PDF links back to your site through `siteUrl` in `config.js`.
5. **Change the price when the data says so.** Try $12, $19 and $29 over a few weeks each and keep the one that earns most. The store dashboard shows conversion.

**What to expect:** these numbers are an illustration, not a forecast. If 3,000 people use the tool in a month and 1% of them buy at $19, that is about $570 for the month. Traffic from search usually builds over months, not days.

## Rebranding

"Tallyslip" is a placeholder name. To use your own name, search and replace `Tallyslip` in the `site/` folder and set `brand` in `config.js`. The icon is `site/favicon.svg`, and the same mark is inline at the top of `index.html`. Also update the dates and wording in `privacy.html` and `terms.html`. They are a reasonable starting point, not legal advice.

## How it works

```
site/
  index.html         the app and landing page (template for the other landing pages)
  *-generator.html   search landing pages, generated by tools/pages.js
  config.js          your settings (price, checkout link, store IDs)
  privacy.html       privacy policy, required by payment stores
  terms.html         terms, including the refund policy
  assets/core.js     invoice math and formatting (shared by the preview, the PDF and the tests)
  assets/app.js      editor, preview, saving, Pro upsell
  assets/pdf.js      builds the PDF with jsPDF (loaded on first download)
  assets/license.js  checks license keys with Lemon Squeezy or Gumroad
  assets/vendor/     jsPDF 4.2.1 (MIT)
  assets/fonts/      Inter, subset to Latin, Greek and Cyrillic (SIL OFL)
tools/pages.js       builds the landing pages, sitemap.xml and robots.txt
tests/
  core.test.js       unit tests for the math
  e2e.test.js        browser tests: sample, PDF, save limit, Pro unlock, landing pages, phone layout
```

- **PDFs contain real text, not screenshots.** Clients can search and copy them, and accounting tools can read them. Scripts the bundled font lacks (for example Arabic or Chinese) are replaced with "?", and the app points users to Print → Save as PDF for those.
- **Pro is checked in the browser.** Someone determined could bypass it with developer tools. That is a normal trade-off for a low-priced tool with no server. The people who pay are the ones who value the product.
- **Saved documents live in the browser's local storage.** Clearing site data deletes them. The FAQ tells users this.

## Development

```sh
npm start            # serve site/ on http://localhost:8080
npm test             # unit tests, no install needed
npm run pages        # rebuild landing pages after editing index.html or config.js
npm install          # once, for the browser tests
npx playwright install chromium
npm run test:e2e     # browser tests
```

Opening `index.html` straight from disk mostly works, but browsers block the font files there, so PDFs fall back to Helvetica. Use `npm start` instead.
