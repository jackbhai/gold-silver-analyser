/**
 * feed.js — live bullion price feed for India. REAL TICKS ONLY.
 *
 * IMPORTANT (verified 2026-09-30): browsers enforce CORS, curl does not.
 * A provider that answers curl is USELESS in the app unless it sends
 * `Access-Control-Allow-Origin`. CORS-verified working in browsers:
 *   gold-api.com ✅ · frankfurter.dev ✅ · open.er-api.com ✅ ·
 *   jsdelivr (fawaz currency-api) ✅
 * CORS-blocked (removed): Swissquote public feed, Yahoo Finance chart API.
 * Dead: stooq CSV (404), goldprice.org (403), metals.live (empty), allorigins/codetabs proxies (unreliable).
 *
 * Fallback chain (all free, no key):
 *   Leg 1 — gold-api.com XAU/XAG (USD/oz, tick-level)
 *     × FX leg: frankfurter.dev → open.er-api.com → fawaz usd.json (daily)
 *   Leg 2 — fawaz currency-api via jsdelivr (XAU/XAG priced DIRECTLY in INR,
 *     daily snapshot; honest last resort, shown as via:"fawaz")
 *
 * Conversion: (INR/oz / 31.1034768) * India premium factor.
 * Premium factor calibration (disclosed, 30 Sep 2026):
 *   IBJA Fine Gold (999) AM fixing ₹14,838/g and Silver (999) ₹2,22,273/kg
 *   vs spot XAU $4,199.70 / XAG $61.308 and USD/INR 95.98 at the same time.
 *   Covers import duty + GST + dealer premium; FIXED — the live number moves
 *   only with real ticks. Indicative retail reference, not a dealer quote.
 *
 * Polls every 60s (+1 quick retry 12s after a full failure). If every provider
 * fails: NO simulated ticks — the last real tick is kept and flagged STALE
 * with its exact timestamp.
 */

const OZ_G = 31.1034768;

export const CALIBRATION = {
  gold24PerGram: 14838,  // IBJA Fine Gold 999 AM fixing, 30 Sep 2026 (₹/g)
  silverPerKg: 222273,   // IBJA Silver 999 AM fixing, 30 Sep 2026 (₹/kg)
  spotXau: 4199.70,
  spotXag: 61.308,
  usdinr: 95.98,
  calibratedAt: "2026-09-30",
};

export const GOLD_PREMIUM =
  CALIBRATION.gold24PerGram / ((CALIBRATION.spotXau / OZ_G) * CALIBRATION.usdinr);
export const SILVER_PREMIUM =
  CALIBRATION.silverPerKg / 1000 / ((CALIBRATION.spotXag / OZ_G) * CALIBRATION.usdinr);

export const PURITY = { "24K": 1, "22K": 916 / 999, "18K": 750 / 999 };

// sanity bounds — reject garbage payloads instead of displaying them
const sane = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

const GOLD_API_XAU = "https://api.gold-api.com/price/XAU";
const GOLD_API_XAG = "https://api.gold-api.com/price/XAG";
const FAWAZ_XAU = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json";
const FAWAZ_XAG = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xag.json";
const FAWAZ_USD = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";

const FX_SOURCES = [
  {
    name: "frankfurter",
    url: "https://api.frankfurter.dev/v1/latest?from=USD&to=INR",
    parse: (j) => (sane(j?.rates?.INR, 40, 200) ? j.rates.INR : null),
  },
  {
    name: "er-api",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: (j) => (sane(j?.rates?.INR, 40, 200) ? j.rates.INR : null),
  },
  {
    name: "fawaz-fx",
    url: FAWAZ_USD,
    parse: (j) => (sane(j?.usd?.inr, 40, 200) ? j.usd.inr : null),
  },
];

/** Fawaz daily snapshots carry their own date — reject if older than 7 days. */
function fawazFresh(j) {
  if (!j?.date) return false;
  const ageDays = (Date.now() - new Date(j.date + "T12:00:00Z").getTime()) / 86400000;
  return ageDays >= -1 && ageDays <= 7;
}

async function getJSON(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Try providers in order; return {value, via} of first sane result. */
async function firstSane(sources, fetcher) {
  for (const s of sources) {
    try {
      const v = await fetcher(s);
      if (v != null) return { value: v, via: s.name };
    } catch { /* next provider */ }
  }
  return { value: null, via: null };
}

/**
 * Returns { goldInrOz, silverInrOz, via } or null.
 * Leg 1: gold-api (USD/oz) × FX chain. Leg 2: fawaz direct INR/oz.
 */
async function getSpot() {
  try {
    const [a, b] = await Promise.all([getJSON(GOLD_API_XAU), getJSON(GOLD_API_XAG)]);
    if (sane(a?.price, 500, 15000) && sane(b?.price, 1, 1000)) {
      const fx = await firstSane(FX_SOURCES, async (s) => s.parse(await getJSON(s.url)));
      if (fx.value) {
        return {
          goldInrOz: a.price * fx.value,
          silverInrOz: b.price * fx.value,
          via: `gold-api+${fx.via}`,
        };
      }
    }
  } catch { /* leg 2 */ }
  try {
    const [xauJ, xagJ] = await Promise.all([getJSON(FAWAZ_XAU), getJSON(FAWAZ_XAG)]);
    const gi = xauJ?.xau?.inr, si = xagJ?.xag?.inr;
    if (fawazFresh(xauJ) && fawazFresh(xagJ) && sane(gi, 100000, 1500000) && sane(si, 2000, 30000)) {
      return { goldInrOz: gi, silverInrOz: si, via: "fawaz" };
    }
  } catch { /* all failed */ }
  return null;
}

export class PriceFeed {
  constructor(onEvent) {
    this.onEvent = onEvent; // ({kind:'tick',tick} | {kind:'stale',lastT,failCount})
    this.last = null;
    this.minutes = [];      // REAL ticks only
    this.stale = false;
    this.failCount = 0;
    this.timer = null;
    this.retryTimer = null;
  }

  snapshot(goldInrOz, silverInrOz, via) {
    const g24 = (goldInrOz / OZ_G) * GOLD_PREMIUM;
    const silverKg = (silverInrOz / OZ_G) * SILVER_PREMIUM * 1000;
    return {
      t: Date.now(),
      gold24: g24,
      gold22: g24 * PURITY["22K"],
      gold18: g24 * PURITY["18K"],
      silver: silverKg,
      inrOz: goldInrOz, via,
    };
  }

  async pollOnce() {
    const spot = await getSpot();

    if (spot) {
      const tick = this.snapshot(spot.goldInrOz, spot.silverInrOz, spot.via);
      const prev = this.last;
      tick.chg1m = prev ? tick.gold24 - prev.gold24 : 0;
      tick.chg1mSilver = prev ? tick.silver - prev.silver : 0;
      this.last = tick;
      this.minutes.push(tick);
      if (this.minutes.length > 1440) this.minutes.shift();
      this.stale = false;
      this.failCount = 0;
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      this.onEvent?.({ kind: "tick", tick });
      return tick;
    }

    // all providers failed — one quick retry, then honest stale
    this.failCount += 1;
    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (!this.last || this.stale) this.pollOnce();
      }, 12000);
    }
    this.stale = true;
    this.onEvent?.({ kind: "stale", lastT: this.last?.t ?? null, failCount: this.failCount });
    return null;
  }

  start(intervalMs = 60000) {
    this.stop();
    this.pollOnce();
    this.timer = setInterval(() => this.pollOnce(), intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
  }
}
