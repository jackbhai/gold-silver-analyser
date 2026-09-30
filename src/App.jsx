import { useEffect, useMemo, useState } from "react";
import { PriceFeed, CALIBRATION } from "./lib/feed.js";
import { METALS, dailySeries, engineSeries, lastClose, SOURCES, DATA_NOTES } from "./lib/data.js";
import { GoldSilverEngine } from "./lib/engine.mjs";
import {
  projectNextMinute, projectNextHour,
  logPrediction, resolvePredictions, getLog,
} from "./lib/predict.js";
import TickerCard, { fmtDateTime } from "./components/TickerCard.jsx";
import { DailyChart, IntradayChart } from "./components/MainChart.jsx";
import PredictionPanel from "./components/PredictionPanel.jsx";
import { PredictionStrip, TrackRecord } from "./components/Predictions.jsx";
import TickHistory from "./components/TickHistory.jsx";
import BacktestLab from "./components/BacktestLab.jsx";
import AiOutlook from "./components/AiOutlook.jsx";

const GOLD_UNITS = [
  { v: "g", label: "1g" },
  { v: "10g", label: "10g" },
];
const SILVER_UNITS = [
  { v: "g", label: "1g" },
  { v: "kg", label: "1kg" },
];

const SCREENS = [
  { id: "prices", label: "Prices", ico: "₹" },
  { id: "graph", label: "Graph", ico: "📈" },
  { id: "predict", label: "Predict", ico: "🎯" },
  { id: "ai", label: "AI", ico: "✦" },
  { id: "lab", label: "Lab", ico: "🧪" },
];

function useStored(key, initial) {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem(key) ?? initial; } catch { return initial; }
  });
  const set = (nv) => {
    setV(nv);
    try { localStorage.setItem(key, nv); } catch {}
  };
  return [v, set];
}

export default function App() {
  const [metalId, setMetalId] = useState("gold24");
  const [tick, setTick] = useState(null);
  const [minutes, setMinutes] = useState([]);
  const [stale, setStale] = useState(false);
  const [staleSince, setStaleSince] = useState(null);
  const [goldUnit, setGoldUnit] = useStored("bsa_gold_unit", "g");
  const [silverUnit, setSilverUnit] = useStored("bsa_silver_unit", "kg");
  const [sheetMetal, setSheetMetal] = useState(null);
  const [screen, setScreen] = useState("prices");
  const go = (id) => { setScreen(id); window.scrollTo(0, 0); };
  const [predLog, setPredLog] = useState([]);
  const metal = METALS.find((m) => m.id === metalId);

  const daily = useMemo(dailySeries, []);
  const forecast = useMemo(() => {
    try { return new GoldSilverEngine().forecast(engineSeries()); }
    catch { return null; }
  }, []);

  useEffect(() => {
    setPredLog(getLog());
    const feed = new PriceFeed((evt) => {
      if (evt.kind === "tick") {
        const mins = [...feed.minutes];
        setTick({ ...evt.tick });
        setMinutes(mins);
        setStale(false);
        setStaleSince(null);
        // log fresh short-horizon projections, then resolve due ones — all real ticks
        const gS = mins.map((m) => ({ t: m.t, v: m.gold24 }));
        const sS = mins.map((m) => ({ t: m.t, v: m.silver }));
        const jobs = [
          ["1m", "gold24", "Gold 24K", projectNextMinute(gS)],
          ["1m", "silver", "Silver 999", projectNextMinute(sS)],
          ["1h", "gold24", "Gold 24K", projectNextHour(gS)],
          ["1h", "silver", "Silver 999", projectNextHour(sS)],
        ];
        for (const [horizon, mkey, label, p] of jobs) {
          if (p) logPrediction({ horizon, metal: mkey, metalLabel: label, pred: p.pred, lo: p.lo, hi: p.hi, targetAt: p.targetAt });
        }
        setPredLog(resolvePredictions({ gold24: gS, silver: sS }));
      } else {
        setStale(true);
        setStaleSince(evt.lastT);
      }
    });
    feed.start(60000);
    return () => feed.stop();
  }, []);

  const lc = lastClose();
  const sparkFor = (key) => minutes.map((m) => m[key]);
  const prevTick = minutes.length >= 2 ? minutes[minutes.length - 2] : null;
  const unitFor = (m) => (m.id === "silver" ? silverUnit : goldUnit);
  const setUnitFor = (m) => (m.id === "silver" ? setSilverUnit : setGoldUnit);
  const unitsFor = (m) => (m.id === "silver" ? SILVER_UNITS : GOLD_UNITS);
  const hero = METALS[0];
  const rest = METALS.slice(1);
  const sheetM = sheetMetal ? METALS.find((m) => m.id === sheetMetal) : null;

  // marquee ticker data — live prices, direction vs previous tick
  const mq = METALS.map((m) => {
    const px = tick?.[m.series] ?? lc[m.series];
    const pv = prevTick?.[m.series];
    const dir = px != null && pv != null ? (px >= pv ? "up" : "down") : "";
    return {
      label: m.label,
      text: px != null ? `₹${Math.round(px).toLocaleString("en-IN")}${m.unit.slice(1)}` : "—",
      dir,
      arrow: dir === "up" ? "▲" : dir === "down" ? "▼" : "•",
    };
  });

  // showcase-style scroll reveal
  useEffect(() => {
    const root = document.querySelector(".app");
    if (!root) return;
    const els = root.querySelectorAll(".rv");
    const show = () => els.forEach((el) => el.classList.add("in"));
    if (!("IntersectionObserver" in window)) { show(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.06, rootMargin: "0px 0px -6% 0px" });
    els.forEach((el) => io.observe(el));
    const t = setTimeout(show, 3000);
    return () => { io.disconnect(); clearTimeout(t); };
  }, [screen]);

  const cardProps = (m) => ({
    metal: m, tick, dayOpen: lc[m.series], sparkData: sparkFor(m.series),
    unit: unitFor(m), onUnit: setUnitFor(m), unitOptions: unitsFor(m),
    prevPrice: prevTick?.[m.series] ?? null, prevT: prevTick?.t ?? null,
    onHistory: () => setSheetMetal(m.id),
  });

  return (
    <div className="app">
      <div className="aurora" aria-hidden="true"><span className="b1" /><span className="b2" /><span className="b3" /></div>

      <nav className="side" aria-label="Sections">
        <div className="side-brand">
          <div className="brand-mark">◈</div>
          <div>
            <div className="brand-name">BULLION<em>AI</em></div>
            <div className="brand-sub">GOLD · SILVER · INDIA</div>
          </div>
        </div>
        {SCREENS.map((s) => (
          <button key={s.id} className={`nav-item ${screen === s.id ? "on" : ""}`} onClick={() => go(s.id)}>
            <span className="ico">{s.ico}</span>{s.label}
          </button>
        ))}
        <div className="side-foot">Live ticks har 60s ·<br />Violet + Cyan edition</div>
      </nav>

      <div className="app-inner">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">◈</div>
          <div>
            <div className="brand-name">BULLION<em>AI</em></div>
            <div className="brand-sub">GOLD · SILVER · INDIA</div>
          </div>
        </div>
        <div className={`live-pill ${stale ? "stale" : ""}`}>
          <span className="live-dot" />
          {stale ? "STALE" : tick ? "LIVE" : "···"}
        </div>
      </header>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <div className="mq-half" key={dup}>
              {mq.map((q, i) => (
                <span className="mq-item" key={i}>
                  <b>{q.label}</b> {q.text} <span className={q.dir}>{q.arrow}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {stale && (
        <div className="offline-bar">
          ⚠ Live API unreachable — koi fake price nahi dikhaya ja raha.
          <br />Last real tick: {staleSince ? fmtDateTime(staleSince) : "—"}
        </div>
      )}

      {/* ============ SCREENS ============ */}
      <div key={screen} className="screen-enter">
        {screen === "prices" && (<>

      {/* HERO — Gold 24K */}
      <div style={{ marginTop: 4 }}>
        <TickerCard hero {...cardProps(hero)} />
      </div>

      {/* Grid — 22K / 18K / Silver */}
      <div className="grid">
        {rest.map((m, i) => (
          <div key={m.id} className="rise" style={{ animationDelay: `${0.08 * (i + 1)}s` }}>
            <TickerCard {...cardProps(m)} />
          </div>
        ))}
        <div className="rise" style={{ animationDelay: ".32s" }}>
          <div className="tcard gold" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100%" }}>
            <div className="metal-name">NEXT UPDATE</div>
            <div className="tick-time" style={{ marginTop: 8, lineHeight: 1.7 }}>
              Har 60 second me<br />real tick aata hai.<br />
              <span style={{ color: "#f5c451", fontWeight: 700 }}>Unit apne hisab se<br />badal sakte ho ↑</span>
            </div>
          </div>
        </div>
      </div>
        </>)}
        {screen === "graph" && (<>

      {/* LIVE INTRADAY */}
      <div className="section rv" style={{ "--d": ".05s" }}>
        <div className="sec-head">
          <div className="sec-title">LIVE <em>INTRADAY</em></div>
          <div className="tabs">
            {METALS.map((m) => (
              <button key={m.id} className={m.id === metalId ? "on" : ""} onClick={() => setMetalId(m.id)}>
                {m.id === "silver" ? "Silver" : m.id.replace("gold", "")}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <IntradayChart minutes={minutes} metal={metal} />
        </div>
      </div>

      {/* DAILY HISTORY */}
      <div className="section rv" style={{ "--d": ".1s" }}>
        <div className="sec-head">
          <div className="sec-title">SEPTEMBER <em>HISTORY</em></div>
          <div className="tick-time">IBJA daily fixing</div>
        </div>
        <div className="panel">
          {forecast && <DailyChart daily={daily} metal={metal} forecast={forecast} />}
          <div className="chart-note">
            Daily closes + engine ka kal (1 Oct) ka prediction · shaded area = 80% confidence band · dashed = predicted.
          </div>
        </div>
      </div>

        </>)}
        {screen === "predict" && (<>
      <div style={{ marginTop: 6 }}><PredictionStrip minutes={minutes} forecast={forecast} /></div>
      <div className="rv" style={{ "--d": ".06s" }}><PredictionPanel forecast={forecast} /></div>
      <div className="rv" style={{ "--d": ".08s" }}><TrackRecord log={predLog} /></div>
        </>)}
        {screen === "ai" && (<>
      <div className="rv" style={{ "--d": ".1s" }}><AiOutlook tick={tick} minutes={minutes} daily={dailySeries()} /></div>
        </>)}
        {screen === "lab" && (<>
      <div className="rv" style={{ "--d": ".12s" }}><BacktestLab /></div>

      <div className="section rv" style={{ "--d": ".12s" }}>
        <div className="sec-head"><div className="sec-title">ENGINE <em>KAISA KAAM KARTA HAI</em></div></div>
        <div className="panel method">
          <h4>5-model adaptive ensemble (daily)</h4>
          <p>Holt's linear trend · Ridge regression (9 features) · Naive drift · Mean reversion · EMA 12/26 trend signal. Har metal ke weights uske recent 12-day walk-forward error se set hote hain — jo model recent me accurate, uska vote zyada.</p>
          <h4>Short-horizon projections (1 min / 1 hour)</h4>
          <p>Sirf real ticks se — drift + volatility bands. Minute-level moves lagbhag random walk hote hain, isliye ye projections wide bands ke saath aate hain aur har ek ka actual result Track Record me log hota hai.</p>
          <h4>Honest validation</h4>
          <p>3 timelines pe rolling-origin backtest, zero data leakage. Grid search se params tab tak tune kiye jab tak error converge na ho jaye — gold MAPE 0.635%, silver MAPE 0.949%. Koi engine har tick pe 99% guarantee nahi de sakta — isliye har prediction ka real % match yahin dikhta hai, verify khud karo.</p>
        </div>
      </div>
        </>)}
      </div>

      <footer className="footer">
        <b>Live calculation (disclosed):</b> spot XAU/XAG (gold-api.com → fawaz currency-api direct-INR fallback) × USD/INR (frankfurter.dev → open.er-api.com → fawaz-fx). Sabhi providers CORS-verified, free, no key.
        Factor IBJA 30-Sep-2026 fixing se calibrated (gold ₹{CALIBRATION.gold24PerGram.toLocaleString("en-IN")}/g,
        silver ₹{CALIBRATION.silverPerKg.toLocaleString("en-IN")}/kg) — indicative retail reference hai, dealer quote nahi.
        22K = 24K × 916/999 · 18K = 24K × 750/999. GST/making charges excluded.
        <br /><b>History:</b> {DATA_NOTES}
        <br />Ye statistical analysis hai — financial advice nahi.
      </footer>

      </div>

      <nav className="tabbar" aria-label="Sections">
        {SCREENS.map((s) => (
          <button key={s.id} className={`tab ${screen === s.id ? "on" : ""}`} onClick={() => go(s.id)}>
            <span className="ico">{s.ico}</span>{s.label}
          </button>
        ))}
      </nav>

      <TickHistory
        open={!!sheetM}
        onClose={() => setSheetMetal(null)}
        ticks={sheetM ? minutes.map((m) => {
          const rawV = m[sheetM.series];
          const v = sheetM.id === "silver"
            ? (silverUnit === "g" ? rawV / 1000 : rawV)
            : (goldUnit === "10g" ? rawV * 10 : rawV);
          return { t: m.t, v };
        }) : []}
        title={sheetM ? sheetM.label.toUpperCase() : ""}
        unitLabel={sheetM ? (sheetM.id === "silver" ? (silverUnit === "kg" ? "/kg" : "/g") : (goldUnit === "10g" ? "/10g" : "/g")) : ""}
      />
    </div>
  );
}
