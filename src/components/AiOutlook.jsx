import { useEffect, useMemo, useState } from "react";
import { buildDataPack, fetchAiOutlook } from "../lib/aiAnalyst.js";

const KEY_LS = "bsa_groq_key";
const PROXY_URL_LS = "bsa_groq_proxy_url";
const PROXY_SEC_LS = "bsa_groq_proxy_secret";
const HIST_LS = "bsa_ai_outlooks_v1";
const DEFAULT_PROXY_URL = "https://bullion-groq-proxy.omni-jackbhai.workers.dev";

const loadHist = () => {
  try { return JSON.parse(localStorage.getItem(HIST_LS) || "[]"); } catch { return []; }
};

const RISK_COLOR = ["", "#4ade80", "#a3e635", "#fbbf24", "#fb923c", "#f87171"];
const BIAS_COLOR = { bullish: "#4ade80", bearish: "#f87171", neutral: "#fbbf24" };

function JumpMeter({ level }) {
  return (
    <div className="risk-meter">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ background: i <= level ? RISK_COLOR[level] : "rgba(255,255,255,.08)" }} />
      ))}
    </div>
  );
}

const aiFmtT = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const aiFmtD = (t) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const aiInr = (v) => (v == null ? "—" : "₹" + Math.round(v).toLocaleString("en-IN"));
const aiShort = (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`);

/** AI ka 24h future price chart — sirf AI ke diye hue path se, kuch banavati nahi. */
function AiFutureChart({ outlook, nowGold, nowSilver }) {
  const [m, setM] = useState("gold");
  const isG = m === "gold";
  const path = outlook.pricePath;
  const nowV = isG ? nowGold : nowSilver;
  const tg = outlook.targets || {};

  const pts = useMemo(() => {
    const arr = [{ t: Date.now(), v: nowV, lo: nowV, hi: nowV, now: true },
      ...path.map((p) => ({ t: p.t, v: isG ? p.gold : p.silver, lo: isG ? p.goldLo : p.silverLo, hi: isG ? p.goldHi : p.silverHi }))];
    return arr;
  }, [path, isG, nowV]);

  const W = 340, H = 218, PL = 46, PR = 10, PT = 12, PB = 38;
  const iw = W - PL - PR, ih = H - PT - PB;
  const allV = pts.flatMap((p) => [p.v, p.lo, p.hi]).filter(Number.isFinite);
  let mn = Math.min(...allV), mx = Math.max(...allV);
  if (!(mx > mn)) { mx = mn + 1; }
  const pad = (mx - mn) * 0.18; mn -= pad; mx += pad;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = (t) => PL + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * iw;
  const Y = (v) => PT + (1 - (v - mn) / (mx - mn)) * ih;
  const line = pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const band = pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.hi).toFixed(1)}`).join(" ") + " " +
    [...pts].reverse().map((p) => `${X(p.t).toFixed(1)},${Y(p.lo).toFixed(1)}`).join(" ");
  const d0 = aiFmtD(t0);
  const xIdx = pts.map((_, i) => i).filter((i) => i % 2 === 0 || i === pts.length - 1);

  // targets — AI ke diye, na ho to uske path ke min/max se
  const vals = path.map((p) => (isG ? p.gold : p.silver));
  const iMax = vals.indexOf(Math.max(...vals)), iMin = vals.indexOf(Math.min(...vals));
  const k = isG ? "gold" : "silver";
  const HIGH = tg[`${k}High24h`] ?? vals[iMax], HIGH_T = tg[`${k}HighAt`] ?? path[iMax].t;
  const LOW = tg[`${k}Low24h`] ?? vals[iMin], LOW_T = tg[`${k}LowAt`] ?? path[iMin].t;
  const DIP_T = tg[`${k}DipAt`] ?? path[iMin].t, DIP_P = tg[`${k}DipPrice`] ?? vals[iMin];
  const RAL_T = tg[`${k}RallyAt`] ?? path[iMax].t, RAL_P = tg[`${k}RallyPrice`] ?? vals[iMax];
  const unit = isG ? "/g" : "/kg";

  return (
    <div className="ai-future">
      <div className="tabs" style={{ marginBottom: 8 }}>
        <button className={isG ? "on" : ""} onClick={() => setM("gold")}>Gold</button>
        <button className={!isG ? "on" : ""} onClick={() => setM("silver")}>Silver</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        <defs>
          <linearGradient id="aiPath" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b3dff" />
            <stop offset="100%" stopColor="#00c2a8" />
          </linearGradient>
          <linearGradient id="aiBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b3dff" stopOpacity=".28" />
            <stop offset="100%" stopColor="#00c2a8" stopOpacity=".06" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((i) => {
          const v = mx - (i * (mx - mn)) / 2, y = Y(v);
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" />
              <text x={PL - 6} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="#8e8a80">{aiShort(v)}</text>
            </g>
          );
        })}
        <polygon points={band} fill="url(#aiBand)" />
        <polyline points={line} fill="none" stroke="url(#aiPath)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        {xIdx.map((i) => {
          const p = pts[i], x = X(p.t), lbl = aiFmtT(p.t), dl = aiFmtD(p.t);
          return (
            <g key={i}>
              <text x={x} y={H - 22} textAnchor="middle" fontSize={10} fontWeight={700} fill="#a09c92">{lbl}</text>
              {dl !== d0 && <text x={x} y={H - 9} textAnchor="middle" fontSize={9} fill="#5f5b53">{dl}</text>}
            </g>
          );
        })}
        <circle cx={X(pts[0].t)} cy={Y(pts[0].v)} r={9} fill="#00c2a8" opacity={0.25} className="pulse-dot" />
        <circle cx={X(pts[0].t)} cy={Y(pts[0].v)} r={4.5} fill="#00c2a8" stroke="#000" strokeWidth={1.5} />
        <text x={X(pts[0].t)} y={Y(pts[0].v) - 12} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#5eead4">NOW</text>
        <circle cx={X(pts[pts.length - 1].t)} cy={Y(pts[pts.length - 1].v)} r={4.5} fill="#8b3dff" stroke="#000" strokeWidth={1.5} />
      </svg>
      <div className="ai-tg-grid">
        <div className="ai-tg hi">
          <span>AI 24H HIGH <i>{isG ? "gold" : "silver"}</i></span>
          <b>{aiInr(HIGH)}{unit}</b>
          <i>≈ {aiFmtT(HIGH_T)}{aiFmtD(HIGH_T) !== d0 ? ` · ${aiFmtD(HIGH_T)}` : ""}</i>
        </div>
        <div className="ai-tg lo">
          <span>AI 24H LOW <i>{isG ? "gold" : "silver"}</i></span>
          <b>{aiInr(LOW)}{unit}</b>
          <i>≈ {aiFmtT(LOW_T)}{aiFmtD(LOW_T) !== d0 ? ` · ${aiFmtD(LOW_T)}` : ""}</i>
        </div>
        <div className="ai-tg dip">
          <span>📉 GIRAVAT <i>AI ke hisab se kab</i></span>
          <b>{aiFmtT(DIP_T)}{aiFmtD(DIP_T) !== d0 ? ` · ${aiFmtD(DIP_T)}` : ""}</b>
          <i>{aiInr(DIP_P)}{unit} tak</i>
        </div>
        <div className="ai-tg ral">
          <span>📈 UCHHAL <i>AI ke hisab se kab</i></span>
          <b>{aiFmtT(RAL_T)}{aiFmtD(RAL_T) !== d0 ? ` · ${aiFmtD(RAL_T)}` : ""}</b>
          <i>{aiInr(RAL_P)}{unit} tak</i>
        </div>
      </div>
      <div className="tick-time" style={{ marginTop: 8, lineHeight: 1.6 }}>
        Ye <b>AI ka estimate</b> hai — guarantee nahi, financial advice nahi. Shaded area = AI ki uncertainty.
      </div>
    </div>
  );
}

function OutlookCard({ item, nowGold, nowSilver }) {
  const o = item.outlook;
  return (
    <div className="panel ai-card rise">
      <div className="ai-top">
        <span className="ai-bias" style={{ borderColor: BIAS_COLOR[o.bias], color: BIAS_COLOR[o.bias] }}>
          {o.bias === "bullish" ? "▲ Bullish" : o.bias === "bearish" ? "▼ Bearish" : "● Neutral"}
        </span>
        <span className="tick-time">confidence {o.confidence}% · {new Date(item.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {item.model}</span>
      </div>
      <div className="conf-bar"><span style={{ width: `${o.confidence}%`, background: BIAS_COLOR[o.bias] }} /></div>
      <p className="ai-summary">{o.summary}</p>

      {o.pricePath && (
        <>
          <div className="ai-h">AI FUTURE PRICE <span className="tick-time">— agle 24h, AI ka estimate</span></div>
          <AiFutureChart outlook={o} nowGold={nowGold} nowSilver={nowSilver} />
        </>
      )}

      {o.factors?.length > 0 && (
        <>
          <div className="ai-h">KEY FACTORS</div>
          {o.factors.slice(0, 5).map((f, i) => (
            <div key={i} className="ai-factor">
              <span className="dot" style={{ background: BIAS_COLOR[f.impact] || "#999" }} />
              <div><b>{f.title}</b><span>{f.detail}</span></div>
            </div>
          ))}
        </>
      )}

      {o.jumpRisk && (
        <>
          <div className="ai-h">JUMP RISK <span className="tick-time">— tez uchhal/giravat ka khatra</span></div>
          <div className="ai-riskrow">
            <JumpMeter level={o.jumpRisk.level} />
            <b style={{ color: RISK_COLOR[o.jumpRisk.level] }}>{o.jumpRisk.label || `Level ${o.jumpRisk.level}/5`}</b>
          </div>
          {(o.jumpRisk.reasons || []).slice(0, 3).map((r, i) => (
            <div key={i} className="ai-reason">• {r}</div>
          ))}
        </>
      )}

      {o.scenarios?.length > 0 && (
        <>
          <div className="ai-h">SCENARIOS <span className="tick-time">— agle 24–48h</span></div>
          {o.scenarios.slice(0, 3).map((s, i) => (
            <div key={i} className="ai-scn">
              <div className="ai-scn-top"><b>{s.name}</b><span>{s.prob}%</span></div>
              <div className="conf-bar thin"><span style={{ width: `${Math.min(100, s.prob)}%` }} /></div>
              <div className="tick-time">
                Gold {Array.isArray(s.goldMovePct) ? `${s.goldMovePct[0]}% … ${s.goldMovePct[1]}%` : "—"} ·
                Silver {Array.isArray(s.silverMovePct) ? `${s.silverMovePct[0]}% … ${s.silverMovePct[1]}%` : "—"}
                {s.trigger ? ` · Trigger: ${s.trigger}` : ""}
              </div>
            </div>
          ))}
        </>
      )}

      {o.sources?.length > 0 && (
        <div className="tick-time" style={{ marginTop: 10 }}>Sources: {o.sources.slice(0, 4).join(" · ")}</div>
      )}
      <div className="ai-disc">
        Ye AI analyst ka read hai — guarantee nahi. Koi bhi AI black-swan jumps pakki tarah predict nahi kar sakta. Financial advice nahi hai.
      </div>
    </div>
  );
}

export default function AiOutlook({ tick, minutes, daily }) {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_LS) || "");
  const [keyIn, setKeyIn] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem(PROXY_URL_LS) || DEFAULT_PROXY_URL);
  const [proxySec, setProxySec] = useState(() => localStorage.getItem(PROXY_SEC_LS) || "");
  const [proxyUrlIn, setProxyUrlIn] = useState(DEFAULT_PROXY_URL);
  const [proxySecIn, setProxySecIn] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [hist, setHist] = useState(loadHist);
  const [cooldown, setCooldown] = useState(0); // seconds remaining

  const pack = useMemo(() => buildDataPack({ tick, minutes, daily }), [tick, minutes, daily]);
  const hasData = !!pack.current;
  const viaProxy = !!proxyUrl;
  const authed = viaProxy || !!key;

  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const saveKey = () => {
    const k = keyIn.trim();
    if (!k.startsWith("gsk_")) { setError("Key gsk_ se shuru honi chahiye."); return; }
    localStorage.setItem(KEY_LS, k);
    setKey(k); setKeyIn(""); setError("");
  };
  const clearKey = () => { localStorage.removeItem(KEY_LS); setKey(""); };
  const saveProxy = () => {
    const u = proxyUrlIn.trim().replace(/\/$/, ""), s = proxySecIn.trim();
    if (!/^https:\/\/.+\.workers\.dev$/.test(u)) { setError("Proxy URL workers.dev ka hona chahiye (https://…)."); return; }
    if (s.length < 8) { setError("Proxy secret kam se kam 8 characters ka rakho."); return; }
    localStorage.setItem(PROXY_URL_LS, u); localStorage.setItem(PROXY_SEC_LS, s);
    setProxyUrl(u); setProxySec(s); setProxyUrlIn(""); setProxySecIn(""); setError("");
  };
  const clearProxy = () => { localStorage.removeItem(PROXY_URL_LS); localStorage.removeItem(PROXY_SEC_LS); setProxyUrl(DEFAULT_PROXY_URL); setProxySec(""); setProxyUrlIn(DEFAULT_PROXY_URL); setProxySecIn(""); };

  const generate = async () => {
    setLoading(true); setError(""); setStage("Data pack ban raha hai…");
    try {
      const p = buildDataPack({ tick, minutes, daily });
      const { outlook, model } = await fetchAiOutlook({
        apiKey: key, pack: p, onStage: setStage,
        proxy: viaProxy ? { url: proxyUrl, secret: proxySec } : null,
      });
      const item = { at: Date.now(), model, outlook };
      const h = [item, ...hist].slice(0, 10);
      setHist(h);
      localStorage.setItem(HIST_LS, JSON.stringify(h));
      setCooldown(45); // free-tier bachao: 45s me ek hi outlook
    } catch (e) {
      setError(e.message || "Kuch gadbad hui.");
    } finally {
      setLoading(false); setStage("");
    }
  };

  useEffect(() => { setHist(loadHist()); }, []);

  return (
    <div className="section rise">
      <div className="sec-head">
        <div className="sec-title">AI MARKET <em>ANALYST</em></div>
        <div className="tick-time">Groq AI · news-aware</div>
      </div>

      <div className="panel ai-setup">
        <div className="ai-h" style={{ marginTop: 0 }}>AI PROXY <span className="tick-time">(auto · kuch dalne ki zaroorat nahi)</span></div>
        <div className="tick-time" style={{ lineHeight: 1.7 }}>
          ⚡ Auto-connected: <b>{proxyUrl.replace("https://", "")}</b> ✓<br />
          Key worker ke andar safe hai — tumhe koi key ya secret dalne ki zaroorat nahi.
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="tick-time" style={{ cursor: "pointer" }}>Advanced: apna proxy URL / secret</summary>
          <div className="ai-keyrow" style={{ marginTop: 8 }}>
            <input type="text" value={proxyUrlIn} onChange={(e) => setProxyUrlIn(e.target.value)}
              placeholder="https://….workers.dev" className="ai-keyinput" autoComplete="off" />
          </div>
          <div className="ai-keyrow" style={{ marginTop: 8 }}>
            <input type={showKey ? "text" : "password"} value={proxySecIn} onChange={(e) => setProxySecIn(e.target.value)}
              placeholder="Proxy secret (optional)" className="ai-keyinput" autoComplete="off" />
            <button className="ai-btn ghost" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button>
            <button className="ai-btn" onClick={saveProxy}>Save</button>
          </div>
          {(proxyUrl !== DEFAULT_PROXY_URL || proxySec) && (
            <div className="ai-keyrow" style={{ marginTop: 8 }}>
              <span className="tick-time">Custom: <b>{proxyUrl.replace("https://", "")}</b>{proxySec ? " + secret ✓" : ""}</span>
              <button className="ai-btn ghost" onClick={clearProxy}>Reset</button>
            </div>
          )}
        </details>

        <div className="ai-h">BACKUP — DIRECT KEY <span className="tick-time">(optional · sirf is phone me save hogi)</span></div>
        {!key ? (
          <>
            <div className="ai-keyrow">
              <input
                type={showKey ? "text" : "password"}
                value={keyIn}
                onChange={(e) => setKeyIn(e.target.value)}
                placeholder="gsk_… (ek se zyada hon to har line me ek)"
                className="ai-keyinput"
                autoComplete="off"
              />
              <button className="ai-btn" onClick={saveKey}>Save</button>
            </div>
          </>
        ) : (
          <div className="ai-keyrow">
            <span className="tick-time">Key saved: <b>gsk_…{key.slice(-4)}</b> (sirf is device me)</span>
            <button className="ai-btn ghost" onClick={clearKey}>Remove</button>
          </div>
        )}

        <button className="ai-btn big" disabled={loading || !authed || !hasData || cooldown > 0} onClick={generate} style={{ marginTop: 12 }}>
          {loading ? "AI soch raha hai…" : cooldown > 0 ? `${cooldown}s ruko…` : "AI Outlook Generate Karo"}
        </button>
        <div className="tick-time" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Ek se zyada keys hain to <b>har line me ek key</b> dalo — limit aane pe keys apne aap rotate hongi.
          429 = uss model/key ka free quota khatam; dusra model ya key try hota hai.
        </div>
        {!hasData && <div className="tick-time" style={{ marginTop: 6 }}>Pehle live ticks aane do, phir AI analysis chalegi.</div>}
        {loading && stage && <div className="tick-time" style={{ marginTop: 8 }}>{stage}</div>}
        {error && <div className="ai-error">{error}</div>}
        <div className="tick-time" style={{ marginTop: 8, lineHeight: 1.6 }}>
          AI pichle 48h ki web news (Fed/RBI, USD-INR, geopolitics, disasters, stock market) + live price data padh ke outlook banata hai.
          On-demand chalta hai taaki free tier ki limit (30 req/min) na ude.
        </div>
      </div>

      {hist.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="ai-h">LATEST OUTLOOK</div>
          <OutlookCard item={hist[0]} nowGold={pack.current?.gold24PerGram} nowSilver={pack.current?.silverPerKg} />
          {hist.length > 1 && (
            <>
              <div className="ai-h" style={{ marginTop: 16 }}>PEHLE KE OUTLOOKS</div>
              {hist.slice(1, 6).map((h, i) => (
                <OutlookCard key={i} item={h} nowGold={pack.current?.gold24PerGram} nowSilver={pack.current?.silverPerKg} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
