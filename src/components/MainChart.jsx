import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ReferenceDot,
} from "recharts";
import { inr } from "../lib/data.js";
import { fmtDateTime } from "./TickerCard.jsx";

const GRID = "rgba(255,255,255,0.07)";
const TICK = { fill: "#8e8a80", fontSize: 10 };

const fmtD = (d) => {
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function DailyChart({ daily, metal, forecast }) {
  const key = metal.series;
  const hist = daily.map((d) => ({ date: fmtD(d.date), full: d.date, value: d[key] }));
  const last = hist[hist.length - 1];
  const isSilver = metal.id === "silver";
  const basePred = isSilver ? forecast.silver : forecast.gold;
  const purityScale = metal.id === "gold22" ? 916 / 999 : metal.id === "gold18" ? 750 / 999 : 1;
  const predVal = basePred * purityScale;
  const sigma = forecast[isSilver ? "silverSigma" : "goldSigma"] ?? 0.01;
  const lo = predVal * (1 - 1.28 * sigma), hi = predVal * (1 + 1.28 * sigma);
  const data = [...hist, { date: "Oct 01*", full: "2026-10-01 (predicted)", value: null, pred: predVal }];
  const conn = [
    { date: last.date, value: last.value },
    { date: "Oct 01*", value: predVal },
  ];
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={TICK} interval={4} />
        <YAxis
          tick={TICK} domain={["auto", "auto"]}
          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))}
          width={48}
        />
        <Tooltip
          contentStyle={{ background: "#0a0a0c", border: "1px solid rgba(245,196,81,.3)", borderRadius: 12 }}
          labelStyle={{ color: "#f5c451" }}
          formatter={(v) => (v != null ? inr(v) : "—")}
        />
        <Line type="monotone" dataKey="value" stroke={metal.color} strokeWidth={2.4} dot={false} name={metal.label} connectNulls />
        <Line data={conn} type="monotone" dataKey="value" stroke={metal.color} strokeWidth={2} strokeDasharray="6 4" dot={false} />
        <ReferenceArea x1={last.date} x2="Oct 01*" y1={lo} y2={hi} fill={metal.color} fillOpacity={0.14} stroke="none" />
        <ReferenceDot x="Oct 01*" y={predVal} r={6} fill={metal.color} stroke="#000" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Two-line tick: time on top, date below — har point ka time + date. */
function DateTimeTick({ x, y, payload }) {
  const d = new Date(payload.value);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <g transform={`translate(${x},${y})`}>
      <text y={13} textAnchor="middle" fill="#a09c92" fontSize={10} fontWeight={700}>{time}</text>
      <text y={26} textAnchor="middle" fill="#5f5b53" fontSize={9}>{date}</text>
    </g>
  );
}

function LiveTooltip({ active, payload, metal }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: "#0a0a0c", border: "1px solid rgba(245,196,81,.35)", borderRadius: 12, padding: "9px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 800, color: metal.color, fontVariantNumeric: "tabular-nums" }}>
        {inr(p.v)}{metal.id === "silver" ? "/kg" : "/g"}
      </div>
      <div style={{ color: "#8e8a80", marginTop: 3, fontSize: 11 }}>⏱ {fmtDateTime(p.t)}</div>
    </div>
  );
}

export function IntradayChart({ minutes, metal }) {
  const key = metal.series;
  const data = minutes.map((m) => ({ t: m.t, v: m[key] }));
  const lastTick = minutes[minutes.length - 1];

  if (data.length < 2) {
    return (
      <div className="chart-note" style={{ padding: "26px 10px", textAlign: "center" }}>
        {lastTick ? (
          <>● Live tick mil gaya ({fmtDateTime(lastTick.t)}) —<br />chart har minute me bharega, thoda wait karo.</>
        ) : (
          <>Live API se connect ho raha hai…</>
        )}
      </div>
    );
  }

  const n = data.length;
  const renderDot = (props) => {
    const { cx, cy, index } = props;
    if (index !== n - 1) return <g key={index} />;
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={11} fill={metal.color} opacity={0.22} className="pulse-dot" />
        <circle cx={cx} cy={cy} r={5} fill={metal.color} stroke="#000" strokeWidth={2} />
      </g>
    );
  };

  return (
    <>
      <div className="live-tag">
        <span className="pulse" />
        LIVE&nbsp;·&nbsp;{inr(lastTick[key])}{metal.id === "silver" ? "/kg" : "/g"}
        <small>⏱ {fmtDateTime(lastTick.t)}{lastTick.via ? ` · ${lastTick.via}` : ""}</small>
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="t" type="category" tick={<DateTimeTick />} interval={Math.max(0, Math.floor(n / 5) - 1)} height={40} />
          <YAxis tick={TICK} domain={["auto", "auto"]} width={48}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))} />
          <Tooltip content={<LiveTooltip metal={metal} />} />
          <Area type="monotone" dataKey="v" stroke={metal.color} fill={metal.color}
            fillOpacity={0.16} strokeWidth={2.2} dot={renderDot} activeDot={{ r: 5, fill: metal.color, stroke: "#000" }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="chart-note">
        Har 60 second me real tick — X-axis pe har point ka <b>time + date</b> hai. Kisi bhi point pe tap karo, exact timestamp dikhega.
      </div>
    </>
  );
}
