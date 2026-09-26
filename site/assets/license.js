/*
 * Pro license checks. Keys are issued by Lemon Squeezy or Gumroad when someone
 * buys, and verified here against the store's public license API, so the site
 * needs no server of its own.
 */
(function () {
  'use strict';

  const cfg = (window.APP_CONFIG && window.APP_CONFIG.pro) || {};
  const STORAGE_KEY = 'tallyslip:license';
  const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
  const listeners = [];

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return v && typeof v.key === 'string' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function write(value) {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* storage blocked: Pro lasts for this visit only */ }
  }

  let current = read();

  function provider() {
    return cfg.provider === 'gumroad' ? 'gumroad' : 'lemonsqueezy';
  }

  /** True when the owner has filled in enough settings for keys to be checked safely. */
  function configured() {
    if (provider() === 'gumroad') return !!(cfg.gumroad && cfg.gumroad.productId);
    const ls = cfg.lemonsqueezy || {};
    return !!(ls.storeId || ls.productId);
  }

  class NetworkError extends Error {}

  async function post(url, fields) {
    let res;
    try {
      // A form-encoded POST is a "simple" CORS request, so no preflight is needed.
      res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(fields) });
    } catch (e) {
      throw new NetworkError('Could not reach the license server. Check your connection and try again.');
    }
    try {
      return await res.json();
    } catch (e) {
      throw new NetworkError('The license server sent an unexpected reply. Try again in a minute.');
    }
  }

  async function checkLemonSqueezy(key) {
    const ls = cfg.lemonsqueezy || {};
    const data = await post('https://api.lemonsqueezy.com/v1/licenses/validate', { license_key: key });
    if (!data || data.valid !== true) {
      return { ok: false, reason: 'That license key was not found. Copy it from your receipt email and try again.' };
    }
    const meta = data.meta || {};
    if ((ls.storeId && Number(meta.store_id) !== Number(ls.storeId)) ||
        (ls.productId && Number(meta.product_id) !== Number(ls.productId))) {
      return { ok: false, reason: 'That key is for a different product.' };
    }
    const status = data.license_key && data.license_key.status;
    if (status === 'disabled' || status === 'expired') {
      return { ok: false, reason: 'That license key is ' + status + '.' };
    }
    return { ok: true, email: meta.customer_email || '' };
  }

  async function checkGumroad(key) {
    const data = await post('https://api.gumroad.com/v2/licenses/verify', {
      product_id: cfg.gumroad.productId, license_key: key, increment_uses_count: 'false',
    });
    if (!data || data.success !== true) {
      return { ok: false, reason: 'That license key was not found. Copy it from your receipt email and try again.' };
    }
    const p = data.purchase || {};
    if (p.refunded || p.chargebacked || p.disputed) {
      return { ok: false, reason: 'That purchase was refunded, so the key no longer works.' };
    }
    if (p.subscription_ended_at || p.subscription_failed_at) {
      return { ok: false, reason: 'That subscription has ended.' };
    }
    return { ok: true, email: p.email || '' };
  }

  function check(key) {
    return provider() === 'gumroad' ? checkGumroad(key) : checkLemonSqueezy(key);
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(isPro()); } catch (e) { /* a listener failing must not block others */ }
    });
  }

  function isPro() {
    return !!current;
  }

  async function activate(rawKey) {
    const key = String(rawKey || '').trim();
    if (!key) return { ok: false, reason: 'Paste your license key first.' };
    if (!configured()) return { ok: false, reason: 'License checks are not set up on this site yet.' };
    try {
      const result = await check(key);
      if (result.ok) {
        current = { key, provider: provider(), email: result.email, checkedAt: Date.now() };
        write(current);
        emit();
      }
      return result;
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  function deactivate() {
    current = null;
    write(null);
    emit();
  }

  /** Re-check a saved key now and then, so refunded keys stop working. Offline is fine. */
  async function refresh() {
    if (!current || !configured()) return;
    if (Date.now() - (current.checkedAt || 0) < RECHECK_AFTER_MS) return;
    try {
      const result = await check(current.key);
      if (result.ok) {
        current.checkedAt = Date.now();
        write(current);
      } else {
        deactivate();
      }
    } catch (e) { /* offline or store down: keep Pro and try again next visit */ }
  }

  window.License = {
    configured,
    isPro,
    info: () => (current ? { email: current.email, provider: current.provider } : null),
    activate,
    deactivate,
    refresh,
    onChange: (fn) => listeners.push(fn),
  };
})();
