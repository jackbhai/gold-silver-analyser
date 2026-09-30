/**
 * GoldSilverEngine — next-day price prediction for gold 24K (INR/g) and silver 999 (INR/kg).
 *
 * Pure dependency-free JS so the exact same file runs in Node (backtesting)
 * and in the browser (live app). No randomness anywhere: fully deterministic.
 *
 * Method: adaptive ensemble of 5 deterministic components —
 *   1. Holt's linear trend (double exponential smoothing)
 *   2. Ridge regression on engineered relative features
 *   3. Naive drift (recent mean daily change)
 *   4. Mean reversion toward the 10-day moving average
 *   5. EMA 12/26 crossover trend signal
 * Component weights adapt to each component's recent walk-forward error.
 *
 * Usage:
 *   const eng = new GoldSilverEngine(params);
 *   const out = eng.forecast(series); // series: [{date, gold, silver}, ...] ascending
 *   // out: { gold, silver, goldLo, goldHi, silverLo, silverHi, confidence, weights, components }
 */

export const DEFAULT_PARAMS = {
  // Frozen after grid search on Sept 2026 backtest (3 rolling timelines).
  // Score 1.2044: gold MAPE 0.635%, silver MAPE 0.949%, direction acc 73%.
  holtAlpha: 0.3,       // level smoothing
  holtBeta: 0.05,       // trend smoothing
  ridgeLambda: 8,        // L2 strength
  maShort: 5,
  maLong: 10,
  momLookback: 5,       // momentum window (days)
  volLookback: 10,      // volatility window (days)
  driftLookback: 7,     // naive drift window
  mrStrength: 0.1,      // mean-reversion pull (0..1)
  adaptWindow: 12,      // walk-forward window for adaptive weights
  weightFloor: 0.06,    // min ensemble weight per component
  ciZ: 1.28,            // 80% interval z-score
  emaGain: 7,            // EMA 12/26 signal gain
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const pct = (arr, i) => (arr[i - 1] === 0 ? 0 : (arr[i] - arr[i - 1]) / arr[i - 1]);

/** Solve (A + λI) w = b via Gaussian elimination with partial pivoting. */
function solveLinear(A, b, lambda) {
  const n = b.length;
  const M = A.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0)).concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

export class GoldSilverEngine {
  constructor(params = {}) {
    this.p = { ...DEFAULT_PARAMS, ...params };
  }

  /** Forward-fill gaps, drop nulls at the start. Returns numeric arrays. */
  preprocess(series) {
    const gold = [], silver = [], dates = [];
    let lg = null, ls = null;
    for (const r of series) {
      if (r.gold != null && Number.isFinite(r.gold)) lg = r.gold;
      if (r.silver != null && Number.isFinite(r.silver)) ls = r.silver;
      if (lg == null || ls == null) continue; // leading nulls
      gold.push(lg); silver.push(ls); dates.push(r.date);
    }
    return { gold, silver, dates };
  }

  // ---------- component 1: Holt's linear trend ----------
  holtForecast(arr) {
    const { holtAlpha: a, holtBeta: b } = this.p;
    if (arr.length < 2) return arr[arr.length - 1] ?? 0;
    let l = arr[0], tr = arr[1] - arr[0];
    for (let i = 1; i < arr.length; i++) {
      const lPrev = l;
      l = a * arr[i] + (1 - a) * (l + tr);
      tr = b * (l - lPrev) + (1 - b) * tr;
    }
    return l + tr;
  }

  // ---------- feature engineering (relative, scale-free) ----------
  features(arr, t) {
    // features describing state at end of day t-1, to predict day t
    const p = this.p;
    const n = t; // number of known points (indices 0..t-1)
    const px = (k) => arr[n - 1 - k] ?? arr[0];
    const ma = (w) => mean(arr.slice(Math.max(0, n - w), n));
    const r1 = pct(arr, n - 1), r2 = n > 2 ? pct(arr, n - 2) : 0, r3 = n > 3 ? pct(arr, n - 3) : 0;
    const maS = ma(p.maShort), maL = ma(p.maLong);
    const momW = Math.min(p.momLookback, n - 1);
    const mom = momW > 0 ? (px(0) - px(momW)) / (px(momW) || 1) : 0;
    const rets = [];
    for (let i = Math.max(1, n - p.volLookback); i < n; i++) rets.push(pct(arr, i));
    const vol = stdev(rets);
    const upFrac = rets.length ? rets.filter((r) => r > 0).length / rets.length : 0.5;
    return [1, r1, r2, r3, (px(0) - maS) / (maS || 1), (px(0) - maL) / (maL || 1), mom, vol, upFrac - 0.5];
  }

  // ---------- component 2: ridge regression on next-day return ----------
  ridgeForecast(arr) {
    const n = arr.length;
    if (n < 12) return this.holtForecast(arr);
    const X = [], y = [];
    for (let t = 8; t < n; t++) {
      X.push(this.features(arr, t));
      y.push(pct(arr, t));
    }
    const d = X[0].length;
    const XtX = Array.from({ length: d }, () => new Array(d).fill(0));
    const Xty = new Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let a = 0; a < d; a++) {
        Xty[a] += X[i][a] * y[i];
        for (let b2 = 0; b2 < d; b2++) XtX[a][b2] += X[i][a] * X[i][b2];
      }
    }
    const w = solveLinear(XtX, Xty, this.p.ridgeLambda);
    const f = this.features(arr, n);
    const retPred = f.reduce((s, v, i) => s + v * w[i], 0);
    // clamp return prediction to ±4× recent volatility (crash guard)
    const rets = [];
    for (let i = Math.max(1, n - this.p.volLookback); i < n; i++) rets.push(pct(arr, i));
    const cap = Math.max(0.02, 4 * stdev(rets));
    const rc = Math.max(-cap, Math.min(cap, retPred));
    return arr[n - 1] * (1 + rc);
  }

  // ---------- component 3: naive drift ----------
  driftForecast(arr) {
    const w = Math.min(this.p.driftLookback, arr.length - 1);
    if (w < 1) return arr[arr.length - 1];
    const diffs = [];
    for (let i = arr.length - w; i < arr.length; i++) diffs.push(arr[i] - arr[i - 1]);
    return arr[arr.length - 1] + mean(diffs);
  }

  // ---------- component 4: mean reversion to MA10 ----------
  mrForecast(arr) {
    const w = Math.min(this.p.maLong, arr.length);
    const maL = mean(arr.slice(arr.length - w));
    const last = arr[arr.length - 1];
    return last - this.p.mrStrength * (last - maL);
  }

  // ---------- component 5: EMA 12/26 crossover trend signal ----------
  emaForecast(arr) {
    const n = arr.length;
    const k12 = 2 / 13, k26 = 2 / 27;
    let e12 = arr[0], e26 = arr[0];
    for (let i = 1; i < n; i++) { e12 = arr[i] * k12 + e12 * (1 - k12); e26 = arr[i] * k26 + e26 * (1 - k26); }
    const sig = e26 ? (e12 - e26) / e26 : 0;
    const move = Math.max(-0.03, Math.min(0.03, (this.p.emaGain || 0) * sig));
    return arr[n - 1] * (1 + move);
  }

  componentForecasts(arr) {
    return {
      holt: this.holtForecast(arr),
      ridge: this.ridgeForecast(arr),
      drift: this.driftForecast(arr),
      mr: this.mrForecast(arr),
      ema: this.emaForecast(arr),
    };
  }

  /**
   * Walk-forward: for each day in the tail window, fit components on data
   * before that day and record absolute % errors. Returns adaptive weights.
   */
  adaptiveWeights(arr) {
    const keys = ["holt", "ridge", "drift", "mr", "ema"];
    const errs = { holt: [], ridge: [], drift: [], mr: [], ema: [] };
    const W = Math.min(this.p.adaptWindow, arr.length - 10);
    if (W < 4) return { holt: 0.28, ridge: 0.28, drift: 0.18, mr: 0.18, ema: 0.08 };
    const start = arr.length - W;
    for (let t = start; t < arr.length; t++) {
      const hist = arr.slice(0, t);
      const cf = this.componentForecasts(hist);
      for (const k of keys) {
        const e = arr[t] ? Math.abs((cf[k] - arr[t]) / arr[t]) : 0;
        errs[k].push(e);
      }
    }
    const inv = {};
    let sum = 0;
    for (const k of keys) {
      const rmse = Math.sqrt(mean(errs[k].map((e) => e * e))) || 1e-9;
      inv[k] = 1 / rmse;
      sum += inv[k];
    }
    const w = {};
    for (const k of keys) w[k] = Math.max(this.p.weightFloor, inv[k] / sum);
    const s2 = keys.reduce((s, k) => s + w[k], 0);
    for (const k of keys) w[k] /= s2;
    return w;
  }

  /** Full forecast for next day. Returns null when there is no usable data. */
  forecast(series) {
    const { gold, silver } = this.preprocess(series);
    if (!gold.length || !silver.length) return null;
    const out = {};
    for (const [name, arr] of [["gold", gold], ["silver", silver]]) {
      const cf = this.componentForecasts(arr);
      const w = this.adaptiveWeights(arr);
      const keys = Object.keys(cf);
      const price = keys.reduce((s, k) => s + w[k] * cf[k], 0);
      // residual-based 80% interval from walk-forward errors of ensemble
      const W = Math.min(this.p.adaptWindow, arr.length - 10);
      const res = [];
      const start = Math.max(10, arr.length - W);
      for (let t = start; t < arr.length; t++) {
        const hist = arr.slice(0, t);
        const c2 = this.componentForecasts(hist);
        const pw = this.adaptiveWeights(hist);
        const fp = keys.reduce((s, k) => s + pw[k] * c2[k], 0);
        res.push(arr[t] ? (fp - arr[t]) / arr[t] : 0);
      }
      const sigma = Math.max(stdev(res), 0.002);
      const band = this.p.ciZ * sigma * price;
      out[name] = price;
      out[name + "Lo"] = Math.max(0, price - band);
      out[name + "Hi"] = price + band;
      out[name + "Components"] = cf;
      out[name + "Weights"] = w;
      out[name + "Sigma"] = sigma;
    }
    const sig = Math.max(out.goldSigma, out.silverSigma);
    out.confidence = Math.max(5, Math.min(95, Math.round(100 * (1 - Math.min(1, sig * 18)))));
    return out;
  }
}
