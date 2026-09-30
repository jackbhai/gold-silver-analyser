import { inr } from "../lib/data.js";
import { fmtDateTime } from "./TickerCard.jsx";

/**
 * Bottom sheet: full real tick history, newest first.
 * props: open, onClose, ticks [{t,v}], title, unitLabel
 */
export default function TickHistory({ open, onClose, ticks, title, unitLabel }) {
  if (!open) return null;
  const rows = [...ticks].reverse();
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div>
            <div className="sec-title">{title} <em>TICK HISTORY</em></div>
            <div className="tick-time" style={{ marginTop: 4 }}>
              {ticks.length} real ticks · har 60s me naya · koi simulated data nahi
            </div>
          </div>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-list">
          {rows.map((p, i) => {
            const prev = rows[i + 1];
            const d = prev ? p.v - prev.v : 0;
            return (
              <div className="tick-row" key={p.t}>
                <div>
                  <div className="tick-price">{inr(p.v)}<span className="per-unit"> {unitLabel}</span></div>
                  <div className="tick-time">⏱ {fmtDateTime(p.t)}</div>
                </div>
                {prev && (
                  <div className={`chg ${d >= 0 ? "up" : "down"}`} style={{ fontSize: 12 }}>
                    {d >= 0 ? "▲" : "▼"} {inr(Math.abs(d))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
