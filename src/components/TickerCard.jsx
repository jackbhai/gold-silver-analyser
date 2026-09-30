import { useEffect, useRef, useState } from "react";
import { pctStr } from "../lib/data.js";

/** Odometer-style rolling digits. Separators (",", ".") stay static. */
export function RollingDigits({ value, className = "" }) {
  const text = Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return (
    <span className={`roll ${className}`}>
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="roll-digit">
            <span className="roll-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
              {"0123456789".split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} className="roll-sep">{ch}</span>
        )
      )}
    </span>
  );
}

export function Spark({ data, color, w = 300, h = 64 }) {
  const d = data.slice(-60);
  if (d.length < 2) return null;
  const min = Math.min(...d), max = Math.max(...d), rg = max - min || 1;
  const pts = d.map((v, i) => `${(i / (d.length - 1)) * w},${h - ((v - min) / rg) * (h - 6) - 3}`).join(" ");
  const id = `sg-${color.replace("#", "")}-${w}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export const fmtTime = (t) =>
  new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const fmtDateTime = (t) =>
  new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

function UnitToggle({ options, value, onChange }) {
  return (
    <span className="units">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * props: metal {id,label,series,color,isSilver}, tick, dayOpen, sparkData,
 *        unit, onUnit, unitOptions, hero (bool)
 */
export default function TickerCard({ metal, tick, dayOpen, sparkData, unit, onUnit, unitOptions, hero, prevPrice, prevT, onHistory }) {
  const key = metal.series;
  const raw = tick ? tick[key] : null;
  const [flash, setFlash] = useState("");
  const prevRef = useRef(raw);

  // flash on tick direction
  useEffect(() => {
    if (prevRef.current != null && raw != null && raw !== prevRef.current) {
      setFlash(raw > prevRef.current ? "up" : "down");
      const t = setTimeout(() => setFlash(""), 1150);
      prevRef.current = raw;
      return () => clearTimeout(t);
    }
    prevRef.current = raw;
  }, [raw]);

  const isSilver = metal.id === "silver";
  const conv = (v) => (v == null ? null : isSilver && unit === "g" ? v / 1000 : !isSilver && unit === "10g" ? v * 10 : v);
  const value = conv(raw);
  const lastVal = conv(prevPrice);
  const perUnit = isSilver ? (unit === "kg" ? "/kg" : "/g") : unit === "10g" ? "/10g" : "/g";
  const dayChg = raw != null && dayOpen ? ((raw - dayOpen) / dayOpen) * 100 : 0;

  return (
    <div className={`${hero ? "hero" : `tcard ${isSilver ? "silver" : "gold"}`} flash ${flash} rise`}>
      <div className="hero-top">
        <div>
          <div className={`metal-name ${isSilver ? "silver" : ""}`}>{metal.label.toUpperCase()}</div>
          <div className="metal-sub">
            {isSilver ? "999 fine silver" : `${metal.id === "gold24" ? "999" : metal.id === "gold22" ? "916" : "750"} fine gold`} · India ref
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {!isSilver && <span className="purity">{metal.id.replace("gold", "")}</span>}
          {isSilver && <span className="purity silver">999</span>}
          <UnitToggle options={unitOptions} value={unit} onChange={onUnit} />
        </div>
      </div>

      <div className="price-wrap">
        <span className={`rupee ${isSilver ? "silver" : ""}`}>₹</span>
        {value != null ? (
          <RollingDigits value={value} className={hero ? "price-xl" : `price-lg ${isSilver ? "silvertxt" : "goldtxt"}`} />
        ) : (
          <span className={hero ? "price-xl" : "price-lg"}>—</span>
        )}
        <span className="per-unit">{perUnit}</span>
      </div>

      <div className="chg-row">
        <span className={`chg ${dayChg >= 0 ? "up" : "down"}`}>
          {dayChg >= 0 ? "▲" : "▼"} {pctStr(dayChg)} today
        </span>
        <span className="tick-time">
          {tick ? `⏱ ${fmtDateTime(tick.t)}` : "connecting…"}
        </span>
      </div>

      {lastVal != null && (
        <button className="lastprice" onClick={onHistory}>
          <span>Last: <b>₹{Number(lastVal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}{perUnit}</b></span>
          <span className="tick-time">{prevT ? fmtTime(prevT) : ""} · full history →</span>
        </button>
      )}

      <Spark data={sparkData} color={metal.color} />
    </div>
  );
}
