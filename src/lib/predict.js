/**
 * predict.js — short-horizon projections + persistent prediction tracker.
 *
 * Projections are computed ONLY from real received ticks (never simulated).
 * They are honest statistical projections with wide bands — minute-level
 * bullion moves are close to a random walk, so no engine can promise
 * direction. Every projection is logged, and when its horizon elapses the
 * actual tick is compared — the track record shows the REAL % match.
 */

const LOG_KEY = "bsa_predlog_v1";
const MAX_LOG = 200;

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const stdev = (a) => {
  const m = avg(a);
  return Math.sqrt(avg(a.map((v) => (v - m) ** 2)));
};

/** series: [{t, v}] newest last. Returns projection or null (not enough data). */
export function projectNextMinute(series) {
  const n = Math.min(series.length - 1, 15);
  if (n < 5) return null;
  const rets = [];
  for (let i = series.length - n; i < series.length; i++) {
    rets.push((series[i].v - series[i - 1].v) / series[i - 1].v);
  }
  const sd = stdev(rets) || 1e-6;
  // shrink drift toward 0: minute moves are ~random walk
  const mu = avg(rets) * (n / (n + 10));
  const last = series[series.length - 1];
  const pred = last.v * (1 + mu);
  const hw = last.v * 1.28 * sd; // 80% band
  return {
    pred, lo: pred - hw, hi: pred + hw,
    madeAt: Date.now(), targetAt: last.t + 60000,
    n, sigma1mPct: sd * 100,
    method: "last-15-min drift (shrunk to 0) ± 80% band",
  };
}

/** 60-minute projection: damped linear trend + pull to session mean. */
export function projectNextHour(series) {
  const n = Math.min(series.length, 60);
  if (n < 10) return null;
  const pts = series.slice(-n);
  const xs = pts.map((_, i) => i);
  const ys = pts.map((p) => Math.log(p.v));
  const mx = avg(xs), my = avg(ys);
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
    (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1);
  const rets = [];
  for (let i = 1; i < pts.length; i++) rets.push((pts[i].v - pts[i - 1].v) / pts[i - 1].v);
  const sd = stdev(rets) || 1e-6;
  const last = pts[pts.length - 1];
  // damp trend 50%, 15% pull toward session mean
  const trendPart = slope * 60 * 0.5;
  const mrPart = (my - Math.log(last.v)) * 0.15;
  const pred = last.v * Math.exp(trendPart + mrPart);
  const hw = last.v * 1.28 * sd * Math.sqrt(60);
  return {
    pred, lo: Math.max(0, pred - hw), hi: pred + hw,
    madeAt: Date.now(), targetAt: last.t + 3600000,
    n, sigma1hPct: sd * Math.sqrt(60) * 100,
    method: "damped 60-min trend + session mean pull ± 80% band",
  };
}

/* ---------------- prediction log (localStorage) ---------------- */

export function getLog() {
  try {
    const j = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

function saveLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, MAX_LOG))); } catch {}
}

export function logPrediction({ horizon, metal, metalLabel, pred, lo, hi, targetAt }) {
  const log = getLog();
  log.unshift({
    id: `${Date.now()}-${horizon}-${metal}`,
    horizon, metal, metalLabel,
    pred, lo, hi, targetAt,
    madeAt: Date.now(),
    resolved: false, actual: null, errPct: null,
  });
  saveLog(log);
  return log;
}

/**
 * Resolve pending predictions against real ticks.
 * seriesByMetal: { gold24: [{t,v}], silver: [{t,v}] }
 * Returns updated log.
 */
export function resolvePredictions(seriesByMetal) {
  const log = getLog();
  let changed = false;
  const now = Date.now();
  for (const e of log) {
    if (e.resolved || e.targetAt > now) continue;
    const series = seriesByMetal[e.metal];
    if (!series || series.length < 2) continue;
    const tol = e.horizon === "1m" ? 120000 : e.horizon === "1h" ? 900000 : Infinity;
    if (e.horizon === "1d") continue; // resolves against daily fixing, not ticks
    let best = null, bestD = Infinity;
    for (const p of series) {
      const d = Math.abs(p.t - e.targetAt);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD <= tol && best.t > e.madeAt) {
      e.actual = best.v;
      e.actualT = best.t;
      e.errPct = Math.abs(e.pred - best.v) / best.v * 100;
      e.matchPct = Math.max(0, 100 - e.errPct);
      e.resolved = true;
      changed = true;
    } else if (now - e.targetAt > tol * 3) {
      // target long past with no tick nearby — mark unresolved-expired
      e.resolved = true; e.expired = true; changed = true;
    }
  }
  if (changed) saveLog(log);
  return log;
}

export function trackStats(log) {
  const done = log.filter((e) => e.resolved && !e.expired && e.matchPct != null);
  if (!done.length) return null;
  return {
    count: done.length,
    avgMatch: avg(done.map((e) => e.matchPct)),
    best: Math.max(...done.map((e) => e.matchPct)),
  };
}

export const HORIZON_LABEL = { "1m": "Next minute", "1h": "Next hour", "1d": "Tomorrow" };
