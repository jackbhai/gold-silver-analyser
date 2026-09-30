/**
 * backtest.mjs — rolling-origin validation of GoldSilverEngine on Sept 2026 data.
 *
 * Timelines:
 *   A: train 2026-09-01..20 -> rolling predict 21..25
 *   B: train 2026-09-01..25 -> rolling predict 26..30   (the "predict 30 Sept" test)
 *   C: train 2026-09-10..25 -> rolling predict 26..30   (short-window sensitivity)
 *
 * Usage:
 *   node backtest.mjs                      # default params
 *   node backtest.mjs --grid               # hyperparameter grid search
 *   node backtest.mjs --params '{"holtAlpha":0.6,...}'
 */
import { readFileSync } from "fs";
import { GoldSilverEngine, DEFAULT_PARAMS } from "./engine.mjs";

const DATA = new URL("../data/history-sept-2026.json", import.meta.url);

function loadSeries() {
  const raw = JSON.parse(readFileSync(DATA, "utf8"));
  const dates = Object.keys(raw.gold_24k_per_gram).sort();
  return dates.map((d) => ({
    date: d,
    gold: raw.gold_24k_per_gram[d],
    silver: raw.silver_999_per_kg[d],
  }));
}

const TIMELINES = {
  A: { trainEnd: "2026-09-20", testStart: "2026-09-21", testEnd: "2026-09-25" },
  B: { trainEnd: "2026-09-25", testStart: "2026-09-26", testEnd: "2026-09-30" },
  C: { trainStart: "2026-09-10", trainEnd: "2026-09-25", testStart: "2026-09-26", testEnd: "2026-09-30" },
};

/** Rolling-origin: for each test day, forecast from all data before it.
 *  Days with no published quote (weekends/holiday) are skipped for metrics. */
function runTimeline(series, tl, params) {
  const eng = new GoldSilverEngine(params);
  const rows = [];
  for (const r of series) {
    if (r.date < tl.testStart || r.date > tl.testEnd) continue;
    if (r.gold == null || r.silver == null) continue; // no published quote: skip metrics
    let hist = series.filter((x) => x.date < r.date);
    if (tl.trainStart) hist = hist.filter((x) => x.date >= tl.trainStart);
    // need enough real quotes (not just nulls) to train
    const realCount = hist.filter((x) => x.gold != null).length;
    if (realCount < 8) continue;
    const f = eng.forecast(hist);
    const prev = hist.filter((x) => x.gold != null);
    const pg = prev[prev.length - 1].gold, ps = prev[prev.length - 1].silver;
    rows.push({
      date: r.date,
      goldActual: r.gold, goldPred: f.gold,
      goldErr: Math.abs((f.gold - r.gold) / r.gold) * 100,
      goldDir: Math.sign(f.gold - pg) === Math.sign(r.gold - pg),
      silverActual: r.silver, silverPred: f.silver,
      silverErr: Math.abs((f.silver - r.silver) / r.silver) * 100,
      silverDir: Math.sign(f.silver - ps) === Math.sign(r.silver - ps),
      goldInBand: r.gold >= f.goldLo && r.gold <= f.goldHi,
      silverInBand: r.silver >= f.silverLo && r.silver <= f.silverHi,
    });
  }
  return rows;
}

function metrics(rows, key) {
  const errs = rows.map((r) => r[key + "Err"]);
  const mape = errs.reduce((s, e) => s + e, 0) / errs.length;
  const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  const dirAcc = (rows.filter((r) => r[key + "Dir"]).length / rows.length) * 100;
  const bandHit = (rows.filter((r) => r[key + "InBand"]).length / rows.length) * 100;
  const worst = rows.reduce((a, b) => (a[key + "Err"] > b[key + "Err"] ? a : b));
  return { mape, rmse, dirAcc, bandHit, n: rows.length, worst: { date: worst.date, err: worst[key + "Err"] } };
}

function evaluate(series, params, verbose = true) {
  const all = [];
  const perTl = {};
  for (const [name, tl] of Object.entries(TIMELINES)) {
    const rows = runTimeline(series, tl, params);
    perTl[name] = rows;
    all.push(...rows);
  }
  const gm = metrics(all, "gold"), sm = metrics(all, "silver");
  const score = gm.mape + 0.6 * sm.mape; // combined objective (silver weighted less: more volatile)
  if (verbose) {
    console.log("=== Backtest results (rolling origin) ===");
    for (const [name, rows] of Object.entries(perTl)) {
      const g = metrics(rows, "gold"), s = metrics(rows, "silver");
      console.log(`Timeline ${name}: gold MAPE ${g.mape.toFixed(3)}% | silver MAPE ${s.mape.toFixed(3)}% | gold dir ${g.dirAcc.toFixed(0)}% | silver dir ${s.dirAcc.toFixed(0)}%`);
    }
    console.log(`\nOVERALL: gold MAPE ${gm.mape.toFixed(3)}% (RMSE ${gm.rmse.toFixed(3)}%), dir ${gm.dirAcc.toFixed(0)}%, band-hit ${gm.bandHit.toFixed(0)}%`);
    console.log(`OVERALL: silver MAPE ${sm.mape.toFixed(3)}% (RMSE ${sm.rmse.toFixed(3)}%), dir ${sm.dirAcc.toFixed(0)}%, band-hit ${sm.bandHit.toFixed(0)}%`);
    console.log(`Gold worst day: ${gm.worst.date} err ${gm.worst.err.toFixed(2)}% | Silver worst day: ${sm.worst.date} err ${sm.worst.err.toFixed(2)}%`);
    console.log(`Combined score: ${score.toFixed(4)}`);
    // detail: timeline B gold day-by-day (the "predict 30 Sept" test)
    console.log("\nTimeline B detail (train ..25 Sep, predict 26-30 Sep):");
    for (const r of perTl.B) {
      console.log(`  ${r.date}  gold actual ${r.goldActual.toFixed(0)} pred ${r.goldPred.toFixed(0)} err ${r.goldErr.toFixed(2)}% ${r.goldDir ? "▲dir-ok" : "▽dir-miss"} | silver actual ${(r.silverActual / 1000).toFixed(1)}k pred ${(r.silverPred / 1000).toFixed(1)}k err ${r.silverErr.toFixed(2)}%`);
    }
  }
  return { gm, sm, score, perTl };
}

function gridSearch(series) {
  const grid = [];
  for (const holtAlpha of [0.4, 0.55, 0.7])
    for (const holtBeta of [0.1, 0.18, 0.3])
      for (const ridgeLambda of [0.5, 1.5, 4])
        for (const mrStrength of [0.2, 0.35, 0.5])
          grid.push({ holtAlpha, holtBeta, ridgeLambda, mrStrength });
  console.log(`Grid search over ${grid.length} combos...`);
  let best = null;
  for (const g of grid) {
    const params = { ...DEFAULT_PARAMS, ...g };
    const { score } = evaluate(series, params, false);
    if (!best || score < best.score) best = { score, params };
  }
  console.log("\n*** BEST PARAMS ***");
  console.log(JSON.stringify(best.params, null, 2));
  console.log(`score ${best.score.toFixed(4)}`);
  evaluate(series, best.params, true);
  return best.params;
}

const series = loadSeries();
console.log(`Loaded ${series.length} days: ${series[0].date} .. ${series[series.length - 1].date}`);
const args = process.argv.slice(2);

if (args.includes("--grid")) {
  const best = gridSearch(series);
  const ei = args.indexOf("--export");
  if (ei >= 0) writeExport(best, args[ei + 1]);
} else if (args[0] === "--params") {
  const params = { ...DEFAULT_PARAMS, ...JSON.parse(args[1]) };
  evaluate(series, params, true);
  const ei = args.indexOf("--export");
  if (ei >= 0) writeExport(params, args[ei + 1]);
} else {
  evaluate(series, DEFAULT_PARAMS, true);
  const ei = args.indexOf("--export");
  if (ei >= 0) writeExport(DEFAULT_PARAMS, args[ei + 1]);
}

function writeExport(params, path) {
  const { perTl, gm, sm } = evaluate(series, params, false);
  const out = { params, timelines: {}, overall: { gold: gm, silver: sm } };
  for (const [name, rows] of Object.entries(perTl)) {
    out.timelines[name] = {
      rows: rows.map((r) => ({
        date: r.date, goldActual: r.goldActual, goldPred: r.goldPred,
        silverActual: r.silverActual, silverPred: r.silverPred,
      })),
      gold: metrics(rows, "gold"),
      silver: metrics(rows, "silver"),
    };
  }
  import("fs").then((fs) => {
    fs.writeFileSync(path, JSON.stringify(out));
    console.log(`Exported backtest results -> ${path}`);
  });
}
