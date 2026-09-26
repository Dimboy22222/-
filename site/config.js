/*
 * Site settings. This is the only file you need to edit to start selling.
 * See README.md, "Start selling", for where each value comes from.
 */
window.APP_CONFIG = {
  brand: 'Tallyslip',
  // Your live site address. It is printed in the "Made with" line on free PDFs.
  siteUrl: 'https://dimboy22222.github.io/-/',
  supportEmail: '',

  pro: {
    price: '$19',
    priceNote: 'one-time payment, lifetime updates',

    // The checkout link from Gumroad or Lemon Squeezy. Leave empty to hide the Buy button.
    checkoutUrl: '',

    // Which store issues your license keys: 'gumroad' or 'lemonsqueezy'.
    provider: 'gumroad',

    // Lemon Squeezy: the numeric IDs from your dashboard. At least one is required so
    // keys from other people's stores are rejected.
    lemonsqueezy: { storeId: null, productId: null },

    // Gumroad: the product ID shown on the product's edit page (not the permalink).
    gumroad: { productId: '' },
  },

  analytics: {
    // Optional, free, cookie-free page view counts: Cloudflare dashboard > Web Analytics.
    cloudflareToken: '',
  },
};
