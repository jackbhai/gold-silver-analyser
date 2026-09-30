import { useMemo, useState } from "react";
import { inr } from "../lib/data.js";
import { RollingDigits, fmtDateTime } from "./TickerCard.jsx";
import {
  projectNextMinute, projectNextHour, trackStats, HORIZON_LABEL,
} from "../lib/predict.js";

const HORIZONS = [
  { v: "1m", label: "Next Minute" },
  { v: "1h", label: "Next Hour" },
  { v: "1d", label: "Tomorrow" },
];

function projFor(h, series) {
  return h === "1m" ? projectNextMinute(series) : projectNextHour(series);
}

function MiniPred({ label, proj, accent, unitLabel }) {
  if (!proj)
    return (
      <div className="pred-card gold" style={{ opacity: 0.7 }}>
        <div className="pred-label">{label}</div>
        <div className="hint" style={{ margin: "10px 0" }}>Ticks accumulate ho rahe hain…</div>
      </div>
    );
  return (
    <div className={`pred-card ${accent}`}>
      <div className="pred-label">{label}</div>
      <div className="price-wrap" style={{ margin: "8px 0 2px" }}>
        <span className={`rupee ${accent === "silver" ? "silver" : ""}`} style={{ fontSize: 20 }}>₹</span>
        <RollingDigits value={proj.pred} className={`price-lg ${accent === "silver" ? "silvertxt" : "goldtxt"}`} />
        <span className="per-unit">{unitLabel}</span>
      </div>
      <div className="pred-band">80% band {inr(proj.lo)} – {inr(proj.hi)}</div>
      <div className="tick-time" style={{ marginTop: 6 }}>⏱ made {fmtDateTime(proj.madeAt)}</div>
    </div>
  );
}

export function PredictionStrip({ minutes, forecast }) {
  const [h, setH] = useState("1m");
  const gSeries = useMemo(() => minutes.map((m) => ({ t: m.t, v: m.gold24 })), [minutes]);
  const sSeries = useMemo(() => minutes.map((m) => ({ t: m.t, v: m.silver })), [minutes]);

  const gProj = h === "1d" ? null : projFor(h, gSeries);
  const sProj = h === "1d" ? null : projFor(h, sSeries);

  return (
    <div className="section rise" style={{ animationDelay: ".05s" }}>
      <div className="sec-head">
        <div className="sec-title">PREDICTIONS <em>LIVE</em></div>
        <div className="tabs">
          {HORIZONS.map((x) => (
            <button key={x.v} className={h === x.v ? "on" : ""} onClick={() => setH(x.v)}>{x.label}</button>
          ))}
        </div>
      </div>
      {h === "1d" ? (
        <div className="pred-grid">
          <div className="pred-card gold">
            <div className="pred-label">GOLD 24K · TOMORROW</div>
            <div className="price-wrap" style={{ margin: "8px 0 2px" }}>
              <span className="rupee" style={{ fontSize: 20 }}>₹</span>
              {forecast && <RollingDigits value={forecast.gold} className="price-lg goldtxt" />}
              <span className="per-unit">/g</span>
            </div>
            {forecast && <div className="pred-band">80% band {inr(forecast.goldLo)} – {inr(forecast.goldHi)}</div>}
          </div>
          <div className="pred-card silver">
            <div className="pred-label">SILVER 999 · TOMORROW</div>
            <div className="price-wrap" style={{ margin: "8px 0 2px" }}>
              <span className="rupee silver" style={{ fontSize: 20 }}>₹</span>
              {forecast && <RollingDigits value={forecast.silver} className="price-lg silvertxt" />}
              <span className="per-unit">/kg</span>
            </div>
            {forecast && <div className="pred-band">80% band {inr(forecast.silverLo)} – {inr(forecast.silverHi)}</div>}
          </div>
        </div>
      ) : (
        <div className="pred-grid">
          <MiniPred label={`GOLD 24K · ${HORIZON_LABEL[h].toUpperCase()}`} proj={gProj} accent="gold" unitLabel="/g" />
          <MiniPred label={`SILVER 999 · ${HORIZON_LABEL[h].toUpperCase()}`} proj={sProj} accent="silver" unitLabel="/kg" />
        </div>
      )}
      <p className="hint" style={{ margin: "8px 2px 0" }}>
        {h === "1d"
          ? "Daily engine ka validated forecast — neeche poora model breakdown hai."
          : "Short-horizon statistical projection hai — minute-level moves lagbhag random walk hote hain, isliye band wide hai. Har projection log hoti hai aur actual se match % neeche Track Record me dikhta hai."}
      </p>
    </div>
  );
}

export function TrackRecord({ log }) {
  const stats = trackStats(log);
  const done = log.filter((e) => e.resolved && !e.expired && e.matchPct != null).slice(0, 30);
  const pending = log.filter((e) => !e.resolved).slice(0, 6);
  return (
    <div className="section rise" style={{ animationDelay: ".35s" }}>
      <div className="sec-head">
        <div className="sec-title">TRACK <em>RECORD</em></div>
        <div className="tick-time">predicted vs actual</div>
      </div>
      <div className="panel">
        {stats ? (
          <div className="metric-row" style={{ marginTop: 0 }}>
            <div className="metric"><b className="good">{stats.avgMatch.toFixed(2)}%</b><span>AVG MATCH</span></div>
            <div className="metric"><b>{stats.count}</b><span>RESOLVED</span></div>
            <div className="metric"><b className="good">{stats.best.toFixed(2)}%</b><span>BEST MATCH</span></div>
            <div className="metric"><b>{pending.length}</b><span>PENDING</span></div>
          </div>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            Abhi koi prediction resolve nahi hui — har tick pe nayi 1-minute / 1-hour projections log hoti hain,
            horizon beetne pe actual tick se compare hokar yahan % match aa jayega.
          </p>
        )}
        {done.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {done.map((e) => (
              <div className="kv" key={e.id}>
                <span>{HORIZON_LABEL[e.horizon]} · {e.metalLabel} · {new Date(e.madeAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
                <b className={e.matchPct >= 99 ? "good" : ""} style={{ color: e.matchPct >= 99 ? "#2bf07e" : "#f4f1ea" }}>
                  {e.matchPct.toFixed(2)}% match
                </b>
              </div>
            ))}
          </div>
        )}
        {pending.length > 0 && (
          <>
            <div className="tick-time" style={{ margin: "10px 0 4px" }}>Pending — horizon beetne pe resolve hoga:</div>
            {pending.map((e) => (
              <div className="kv" key={e.id}>
                <span>{HORIZON_LABEL[e.horizon]} · {e.metalLabel}</span>
                <b>{inr(e.pred)}</b>
              </div>
            ))}
          </>
        )}
        <p className="hint" style={{ margin: "10px 0 0" }}>
          Match % = 100 − |predicted − actual| / actual × 100, sirf real ticks se. Ye numbers khud verify kar sakte ho — koi दावा nahi, sirf record.
        </p>
      </div>
    </div>
  );
}
