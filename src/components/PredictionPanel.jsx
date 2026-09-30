import { inr } from "../lib/data.js";

const COMP_LABELS = {
  holt: "Holt trend",
  ridge: "Ridge ML",
  drift: "Naive drift",
  mr: "Mean reversion",
  ema: "EMA 12/26 trend",
};

function PredCard({ title, unit, pred, lo, hi, weights, components, tone }) {
  return (
    <div className={`pred-card ${tone}`}>
      <div className="pred-label">{title.toUpperCase()} · KAL</div>
      <div className={`pred-value ${tone === "silver" ? "silvertxt" : "goldtxt"}`}>{inr(pred)}</div>
      <div className="pred-band">{unit} · 80% band {inr(lo)} – {inr(hi)}</div>
      <table className="comp-table">
        <tbody>
          {Object.keys(weights).map((k) => (
            <tr key={k}>
              <td style={{ color: "#d8d4c9", fontWeight: 600 }}>{COMP_LABELS[k] ?? k}</td>
              <td>{(weights[k] * 100).toFixed(1)}%</td>
              <td style={{ width: "34%" }}><div className="wbar"><div className="wfill" style={{ width: `${weights[k] * 100}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PredictionPanel({ forecast }) {
  if (!forecast) return null;
  const g = { pred: forecast.gold, lo: forecast.goldLo, hi: forecast.goldHi, weights: forecast.goldWeights, components: forecast.goldComponents };
  const s = { pred: forecast.silver, lo: forecast.silverLo, hi: forecast.silverHi, weights: forecast.silverWeights, components: forecast.silverComponents };
  return (
    <div className="section rise" style={{ animationDelay: ".25s" }}>
      <div className="sec-head">
        <div className="sec-title">PREDICTION <em>ENGINE</em></div>
        <div className="tick-time">1 Oct 2026</div>
      </div>
      <div className="pred-grid">
        <PredCard title="Gold 24K" unit="₹/gram" tone="gold" {...g} />
        <PredCard title="Silver 999" unit="₹/kg" tone="silver" {...s} />
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="tick-time">Engine confidence</span>
          <div className="conf-bar" style={{ flex: 1 }}><div className="conf-fill" style={{ width: `${forecast.confidence}%` }} /></div>
          <b className="goldtxt" style={{ fontSize: 15 }}>{forecast.confidence}%</b>
        </div>
        <p className="hint" style={{ margin: "10px 0 0" }}>
          Adaptive 5-model ensemble — weights har metal ke recent 12-day walk-forward error se auto-tune hote hain.
          22K ≈ 24K × 0.9169 · 18K ≈ 24K × 0.7508. Statistical estimate hai, financial advice nahi.
        </p>
      </div>
    </div>
  );
}
