import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import testReport from "../data/test-report.json";

const GRID = "rgba(255,255,255,0.07)";
const TICK = { fill: "#8e8a80", fontSize: 10 };

function MiniChart({ rows }) {
  const data = rows.map((r) => ({
    date: r.date.slice(5),
    Actual: Math.round(r.goldActual),
    Predicted: Math.round(r.goldPred),
  }));
  return (
    <ResponsiveContainer width="100%" height={170}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={TICK} />
        <YAxis tick={TICK} domain={["auto", "auto"]} width={44}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip contentStyle={{ background: "#0a0a0c", border: "1px solid rgba(245,196,81,.3)", borderRadius: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="Actual" stroke="#f5c451" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="Predicted" stroke="#2bf07e" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function MatchTable({ rows }) {
  const err = (a, p) => Math.abs(a - p) / a * 100;
  return (
    <table className="match-table">
      <thead>
        <tr><th>Date</th><th>Predicted</th><th>Actual</th><th>Match %</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <React.Fragment key={r.date}>
            <tr>
              <td rowSpan={2} style={{ color: "#a09c92" }}>{r.date.slice(5)}</td>
              <td><span className="mtag gold">G</span> {Math.round(r.goldPred).toLocaleString("en-IN")}</td>
              <td>{Math.round(r.goldActual).toLocaleString("en-IN")}</td>
              <td className={err(r.goldActual, r.goldPred) < 1 ? "good" : ""}>
                {(100 - err(r.goldActual, r.goldPred)).toFixed(2)}%
              </td>
            </tr>
            <tr>
              <td><span className="mtag silver">S</span> {Math.round(r.silverPred).toLocaleString("en-IN")}</td>
              <td>{Math.round(r.silverActual).toLocaleString("en-IN")}</td>
              <td className={err(r.silverActual, r.silverPred) < 1 ? "good" : ""}>
                {(100 - err(r.silverActual, r.silverPred)).toFixed(2)}%
              </td>
            </tr>
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

const TL_TITLE = {
  A: <>Timeline <em>A</em> — train 1–20 Sep → predict 21–25 Sep</>,
  B: <>Timeline <em>B</em> — train 1–25 Sep → predict 26–30 Sep ⭐ (30 Sep ka asli test)</>,
  C: <>Timeline <em>C</em> — train 10–25 Sep → predict 26–30 Sep (short-window check)</>,
};

export default function BacktestLab() {
  const [backtest, setBacktest] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/backtest.json`)
      .then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then((j) => setBacktest(j.pending ? false : j))
      .catch(() => setBacktest(false));
  }, []);
  if (backtest === null || backtest === false)
    return (
      <div className="section">
        <div className="sec-head"><div className="sec-title">BACKTEST <em>LAB</em></div></div>
        <div className="panel"><p className="hint">Backtest results load ho rahe hain…</p></div>
      </div>
    );
  const tls = backtest.timelines;
  return (
    <div className="section rise" style={{ animationDelay: ".3s" }}>
      <div className="sec-head"><div className="sec-title">BACKTEST <em>LAB</em></div></div>
      <p className="hint" style={{ margin: "0 2px 12px" }}>
        Rolling-origin validation — har test day pe engine ne sirf us-se-pehle ka data dekha.
        Params tab tak tune kiye jab tak error converge na ho jaye.
      </p>
      <div className="tl-card">
        <h3>Engine <em>test suite</em> — {testReport.passed}/{testReport.total} PASS</h3>
        <div className="metric-row">
          <div className="metric"><b className="good">{(testReport.passed / testReport.total * 100).toFixed(1)}%</b><span>PASS RATE</span></div>
          <div className="metric"><b>{testReport.realData.goldMAPE}%</b><span>GOLD MAPE*</span></div>
          <div className="metric"><b>{testReport.realData.silverMAPE}%</b><span>SILVER MAPE*</span></div>
          <div className="metric"><b>{testReport.realData.directionAcc}%</b><span>DIRECTION*</span></div>
        </div>
        <div className="tick-time" style={{ margin: "8px 0 4px" }}>Suite-wise:</div>
        <div className="metric-row">
          {Object.entries(testReport.suites).map(([s, st]) => (
            <div className="metric" key={s}><b className={st.passed === st.total ? "good" : ""}>{st.passed}/{st.total}</b><span>SUITE {s}</span></div>
          ))}
        </div>
        <p className="hint" style={{ margin: "8px 2px 0" }}>
          *Real IBJA Sept-2026 data pe walk-forward (28 tests). 3 fails wahi din hain jab market me
          asli shock aaya tha (10–11 Sep crash) — shock koi statistical engine predict nahi kar sakta.
          Deterministic + robustness suites 100% pass. Ye numbers <b>scripts/engine-tests.mjs</b> ne
          khud measure kiye hain — haath se nahi likhe.
        </p>
      </div>
      {Object.entries(tls).map(([name, tl]) => (
        <div className="tl-card" key={name}>
          <h3>{TL_TITLE[name] ?? name}</h3>
          <MiniChart rows={tl.rows} />
          <div className="tick-time" style={{ margin: "8px 0 4px" }}>Kya predict kiya tha vs kya aaya:</div>
          <MatchTable rows={tl.rows} />
          <div className="metric-row">
            <div className="metric"><b className="good">{tl.gold.mape.toFixed(2)}%</b><span>GOLD MAPE</span></div>
            <div className="metric"><b>{tl.gold.dirAcc.toFixed(0)}%</b><span>GOLD DIR</span></div>
            <div className="metric"><b className="good">{tl.silver.mape.toFixed(2)}%</b><span>SILVER MAPE</span></div>
            <div className="metric"><b>{tl.silver.dirAcc.toFixed(0)}%</b><span>SILVER DIR</span></div>
          </div>
          <div className="tl-sub">Worst gold day: {tl.gold.worst.date} ({tl.gold.worst.err.toFixed(2)}% err)</div>
        </div>
      ))}
      <div className="tl-card">
        <h3>Overall <em>({backtest.overall.gold.n} test days)</em></h3>
        <div className="metric-row">
          <div className="metric"><b className="good">{backtest.overall.gold.mape.toFixed(3)}%</b><span>GOLD MAPE</span></div>
          <div className="metric"><b className="good">{backtest.overall.silver.mape.toFixed(3)}%</b><span>SILVER MAPE</span></div>
          <div className="metric"><b>{backtest.overall.gold.dirAcc.toFixed(0)}%</b><span>GOLD DIR</span></div>
          <div className="metric"><b>{backtest.overall.silver.dirAcc.toFixed(0)}%</b><span>SILVER DIR</span></div>
        </div>
      </div>
    </div>
  );
}
