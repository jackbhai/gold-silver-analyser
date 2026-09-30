/**
 * aiAnalyst.js — Groq-powered news-aware market outlook (BYOK).
 *
 * SECURITY: the user's Groq key is NEVER bundled in the app. It is typed
 * into the app by the user and kept only in their own browser localStorage.
 * Hardcoding a key in a public GitHub Pages site = key theft + quota drain.
 *
 * What this honestly does:
 *  - Packs REAL app data (live ticks, intraday stats, IBJA daily history).
 *  - Asks Groq (compound = built-in web search, else gpt-oss-20b/qwen3.8-27b)
 *    for a structured analyst outlook: bias, factors, JUMP-RISK read,
 *    probability-weighted scenarios.
 *  - It is an analyst BRIEF, not a crystal ball. No AI can guarantee a
 *    prediction of black-swan jumps — the UI says so explicitly.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !b) return null;
  return ((a - b) / b) * 100;
}

/** Nearest tick at/before (t - msAgo). */
function tickAgo(minutes, msAgo) {
  if (!minutes.length) return null;
  const target = Date.now() - msAgo;
  let best = null;
  for (const m of minutes) {
    if (m.t <= target) best = m;
    else break;
  }
  return best || minutes[0];
}

function intradayStats(minutes, key) {
  const vals = minutes.map((m) => m[key]).filter(Number.isFinite);
  if (vals.length < 3) return { stdPct: null, maxJumpPct: null };
  const rets = [];
  for (let i = 1; i < vals.length; i++) rets.push(((vals[i] - vals[i - 1]) / vals[i - 1]) * 100);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  // max absolute move inside any rolling 60-minute window
  let maxJump = 0;
  for (let i = 0; i < vals.length; i++) {
    const t0 = minutes[i].t;
    const win = vals.filter((_, j) => minutes[j].t >= t0 && minutes[j].t <= t0 + 3600e3);
    if (win.length > 1) {
      const j = (Math.max(...win) - Math.min(...win)) / win[0] * 100;
      if (j > maxJump) maxJump = j;
    }
  }
  return { stdPct: r2(std), maxJumpPct: r2(maxJump) };
}

/** Build the honest data pack the LLM reasons over. */
export function buildDataPack({ tick, minutes, daily }) {
  const last = tick || minutes[minutes.length - 1] || null;
  const t5 = tickAgo(minutes, 5 * 60e3), t60 = tickAgo(minutes, 60 * 60e3);
  const g = intradayStats(minutes, "gold24"), s = intradayStats(minutes, "silver");
  const d7 = (daily || []).slice(-7).map((d, i, arr) => ({
    date: d.date,
    gold24: Math.round(d.gold24),
    silverKg: Math.round(d.silver),
    goldChgPct: i ? r2(pct(d.gold24, arr[i - 1].gold24)) : null,
    silverChgPct: i ? r2(pct(d.silver, arr[i - 1].silver)) : null,
  }));
  return {
    generatedAt: new Date().toISOString(),
    current: last ? {
      gold24PerGram: r2(last.gold24),
      silverPerKg: Math.round(last.silver),
      asOf: new Date(last.t).toISOString(),
      source: last.via || "live",
    } : null,
    movesPct: {
      gold5m: last && t5 ? r2(pct(last.gold24, t5.gold24)) : null,
      gold1h: last && t60 ? r2(pct(last.gold24, t60.gold24)) : null,
      silver5m: last && t5 ? r2(pct(last.silver, t5.silver)) : null,
      silver1h: last && t60 ? r2(pct(last.silver, t60.silver)) : null,
    },
    volatility: {
      gold1mStdPct: g.stdPct, silver1mStdPct: s.stdPct,
      max1hJumpPctGold: g.maxJumpPct, max1hJumpPctSilver: s.maxJumpPct,
      ticksUsed: minutes.length,
    },
    last7Sessions: d7,
    currency: "INR",
  };
}

const SYSTEM = `You are a bullion market analyst assistant for Indian retail gold/silver prices. Use web search for gold/silver market news from the LAST 48 HOURS: central bank moves (RBI/Fed), USD/INR, geopolitics, wars, natural disasters, equity market moves, ETF flows. Combine that with the price data provided.

CRITICAL HONESTY RULES:
- You CANNOT predict black-swan jumps with certainty. Assess jump RISK (1=calm … 5=extreme event risk), never promise a jump will happen.
- Scenario probabilities must sum to ~100. Keep ranges realistic for 24-48h moves.
- Keep it compact: summary 1-2 lines, max 4 factors, max 3 scenarios.
- Write summary, factors, reasons, triggers in Hinglish (Roman script, casual Indian tone).
- Return ONLY valid JSON, no markdown fences, no extra text. Schema:
{"bias":"bullish"|"bearish"|"neutral","confidence":0-100,"summary":"...","factors":[{"title":"...","impact":"bullish"|"bearish"|"neutral","detail":"..."}],"jumpRisk":{"level":1-5,"label":"...","reasons":["..."]},"scenarios":[{"name":"...","prob":0-100,"goldMovePct":[lo,hi],"silverMovePct":[lo,hi],"trigger":"..."}],"sources":["headline or outlet names"]}`;

function extractJSON(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("AI ne valid JSON nahi diya — dobara try karo.");
  // truncation salvage: pichle kuch closing braces try karo, pehla valid parse jeetega
  let end = text.length;
  for (let i = 0; i < 6; i++) {
    end = text.lastIndexOf("}", end - 1);
    if (end <= start) break;
    try {
      const o = JSON.parse(text.slice(start, end + 1));
      if (o && typeof o === "object") return o;
    } catch { /* chhota slice try karo */ }
  }
  throw new Error("AI ne valid JSON nahi diya — dobara try karo.");
}

function validate(o) {
  if (!o || typeof o !== "object") throw new Error("bad outlook");
  if (!["bullish", "bearish", "neutral"].includes(o.bias)) o.bias = "neutral";
  o.confidence = Math.max(0, Math.min(100, Number(o.confidence) || 50));
  if (!Array.isArray(o.factors)) o.factors = [];
  if (!o.jumpRisk || typeof o.jumpRisk.level !== "number") o.jumpRisk = { level: 3, label: "Medium", reasons: [] };
  o.jumpRisk.level = Math.max(1, Math.min(5, Math.round(o.jumpRisk.level)));
  if (!Array.isArray(o.scenarios)) o.scenarios = [];
  if (!Array.isArray(o.sources)) o.sources = [];
  // AI future price path — validate strictly, never invent
  if (Array.isArray(o.pricePath)) {
    const pts = [];
    for (const p of o.pricePath) {
      const t = p && typeof p.t === "string" ? Date.parse(p.t) : NaN;
      if (!Number.isFinite(t) || !Number.isFinite(p.gold) || !Number.isFinite(p.silver)) continue;
      if (p.gold <= 0 || p.silver <= 0 || t < Date.now() - 3600e3 || t > Date.now() + 30 * 3600e3) continue;
      pts.push({
        t,
        gold: Math.round(p.gold),
        goldLo: Number.isFinite(p.goldLo) ? Math.round(p.goldLo) : Math.round(p.gold),
        goldHi: Number.isFinite(p.goldHi) ? Math.round(p.goldHi) : Math.round(p.gold),
        silver: Math.round(p.silver),
        silverLo: Number.isFinite(p.silverLo) ? Math.round(p.silverLo) : Math.round(p.silver),
        silverHi: Number.isFinite(p.silverHi) ? Math.round(p.silverHi) : Math.round(p.silver),
      });
      if (pts.length >= 16) break;
    }
    pts.sort((a, b) => a.t - b.t);
    o.pricePath = pts.length >= 4 ? pts : null;
  } else {
    o.pricePath = null;
  }
  const tg = o.targets && typeof o.targets === "object" ? o.targets : null;
  const num = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  const ist = (v) => {
    const t = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(t) && t > Date.now() - 3600e3 && t < Date.now() + 30 * 3600e3 ? t : null;
  };
  o.targets = tg ? {
    goldHigh24h: num(tg.goldHigh24h), goldHighAt: ist(tg.goldHighAt),
    goldLow24h: num(tg.goldLow24h), goldLowAt: ist(tg.goldLowAt),
    silverHigh24h: num(tg.silverHigh24h), silverHighAt: ist(tg.silverHighAt),
    silverLow24h: num(tg.silverLow24h), silverLowAt: ist(tg.silverLowAt),
    goldDipAt: ist(tg.goldDipAt), goldDipPrice: num(tg.goldDipPrice),
    goldRallyAt: ist(tg.goldRallyAt), goldRallyPrice: num(tg.goldRallyPrice),
    silverDipAt: ist(tg.silverDipAt), silverDipPrice: num(tg.silverDipPrice),
    silverRallyAt: ist(tg.silverRallyAt), silverRallyPrice: num(tg.silverRallyPrice),
  } : null;
  return o;
}

const PRICE_SYSTEM = `You are a bullion price path estimator for Indian retail gold/silver. The user message gives you EXACTLY 6 future timestamps — use them verbatim, in order, as the "t" values. You only estimate the PRICES: a smooth, realistic 24-hour path anchored near the given current price, no crazy spikes. YOUR estimate, not a guarantee. No step-by-step thinking, output ONLY the JSON.

Rules:
- "t": copy the 6 timestamps from the user message EXACTLY (do not change, do not reorder).
- gold = INR per gram, silver = INR per kg.
- goldLo/goldHi, silverLo/silverHi = your uncertainty band for that point.
- targets = where YOU expect the 24h high/low to land and when (use timestamps from the list), plus nearest dip (giravat) and rally (uchhal) timing per metal.
- Return ONLY valid JSON, no markdown fences, no extra text. Schema:
{"pricePath":[{"t":"<timestamp 1>","gold":14600,"goldLo":14550,"goldHi":14650,"silver":222000,"silverLo":221000,"silverHi":223000}],"targets":{"goldHigh24h":14700,"goldHighAt":"<one of the timestamps>","goldLow24h":14500,"goldLowAt":"<one of the timestamps>","silverHigh24h":223000,"silverHighAt":"<one of the timestamps>","silverLow24h":221000,"silverLowAt":"<one of the timestamps>","goldDipAt":"<one of the timestamps>","goldDipPrice":14550,"goldRallyAt":"<one of the timestamps>","goldRallyPrice":14680,"silverDipAt":"<one of the timestamps>","silverDipPrice":221200,"silverRallyAt":"<one of the timestamps>","silverRallyPrice":222800}}`;

/** "2026-10-01T04:00:00+05:30" jaisa IST ISO stamp banao. */
function istStamp(ms) {
  const d = new Date(ms + 5.5 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+05:30`;
}

function validatePricePath(o) {
  if (!o || typeof o !== "object" || !Array.isArray(o.pricePath)) throw new Error("no pricePath");
  const pts = [];
  for (const p of o.pricePath) {
    const t = p && typeof p.t === "string" ? Date.parse(p.t) : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(p.gold) || !Number.isFinite(p.silver)) continue;
    if (p.gold <= 0 || p.silver <= 0 || t < Date.now() - 3600e3 || t > Date.now() + 30 * 3600e3) continue;
    pts.push({
      t,
      gold: Math.round(p.gold),
      goldLo: Number.isFinite(p.goldLo) ? Math.round(p.goldLo) : Math.round(p.gold),
      goldHi: Number.isFinite(p.goldHi) ? Math.round(p.goldHi) : Math.round(p.gold),
      silver: Math.round(p.silver),
      silverLo: Number.isFinite(p.silverLo) ? Math.round(p.silverLo) : Math.round(p.silver),
      silverHi: Number.isFinite(p.silverHi) ? Math.round(p.silverHi) : Math.round(p.silver),
    });
    if (pts.length >= 10) break;
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length < 4) throw new Error("pricePath too short");
  const tg = o.targets && typeof o.targets === "object" ? o.targets : null;
  const num = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  const ist = (v) => {
    const t = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(t) && t > Date.now() - 3600e3 && t < Date.now() + 30 * 3600e3 ? t : null;
  };
  const targets = tg ? {
    goldHigh24h: num(tg.goldHigh24h), goldHighAt: ist(tg.goldHighAt),
    goldLow24h: num(tg.goldLow24h), goldLowAt: ist(tg.goldLowAt),
    silverHigh24h: num(tg.silverHigh24h), silverHighAt: ist(tg.silverHighAt),
    silverLow24h: num(tg.silverLow24h), silverLowAt: ist(tg.silverLowAt),
    goldDipAt: ist(tg.goldDipAt), goldDipPrice: num(tg.goldDipPrice),
    goldRallyAt: ist(tg.goldRallyAt), goldRallyPrice: num(tg.goldRallyPrice),
    silverDipAt: ist(tg.silverDipAt), silverDipPrice: num(tg.silverDipPrice),
    silverRallyAt: ist(tg.silverRallyAt), silverRallyPrice: num(tg.silverRallyPrice),
  } : null;
  return { pricePath: pts, targets };
}

async function callPricePath(apiKey, model, pack, outlook, proxy) {
  const url = proxy?.url || GROQ_URL;
  const headers = { "Content-Type": "application/json" };
  if (proxy?.url) {
    if (proxy.secret) headers["X-Proxy-Secret"] = proxy.secret;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  // time axis app khud banata hai — AI sirf prices estimate karta hai (AI aksar aadhi raat ke baad ki date bigaad deta hai)
  const slots = [4, 8, 12, 16, 20, 24].map((h) => istStamp(Date.now() + h * 3600e3));
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2200, // worker 1200 pe clamp karta hai; reasoning models ke hidden tokens ke liye headroom chahiye
        reasoning_effort: "none",
        messages: [
          { role: "system", content: PRICE_SYSTEM },
          {
            role: "user",
            content: `Abhi (IST): ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Current: gold ₹${pack.current.gold24PerGram}/g, silver ₹${pack.current.silverPerKg}/kg. Market view: ${outlook.bias} (confidence ${outlook.confidence}%). Summary: ${outlook.summary || "—"}\n\nYe 6 timestamps EXACTLY use karo, same order:\n${slots.join("\n")}\n\nIn pe 24h pricePath + targets ka JSON do.`,
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`path ${r.status}`);
    const body = await r.json().catch(() => ({}));
    const text = body?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("empty path");
    return validatePricePath(extractJSON(text));
  } finally {
    clearTimeout(timer);
  }
}
async function callGroq(apiKey, model, pack, proxy) {
  const url = proxy?.url || GROQ_URL;
  const headers = { "Content-Type": "application/json" };
  if (proxy?.url) {
    if (proxy.secret) headers["X-Proxy-Secret"] = proxy.secret;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2200,
        reasoning_effort: "none",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Aaj ki date: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Price data (JSON):\n${JSON.stringify(pack)}\n\nIs data + last 48h ki web news ke basis pe outlook JSON me do.` },
        ],
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("Key invalid hai (401) — Groq key dobara check karo.");
    if (r.status === 403 && proxy?.url) throw new Error("Proxy secret galat hai (403) — app me secret dobara dalo.");
    if (r.status === 429) throw new Error("Rate limit hit (429) — thodi der ruk ke try karo. Free tier: ~30 req/min.");
    if (!r.ok) throw new Error(body?.error?.message || `AI error ${r.status}`);
    const text = body?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("AI se khaali jawab aaya.");
    return validate(extractJSON(text));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns { outlook, model }. Throws with a human (Hinglish) message.
 * onStage(stageText) reports progress for the UI.
 * proxy = { url, secret } → key server-side rehti hai, app me key nahi chahiye.
 *
 * Rate-limit strategy: 429 aane pe agla (model, key) combo try hota hai —
 * har model ka apna limit bucket hota hai, aur ek se zyada keys hon to
 * keys bhi rotate hoti hain. Sirf tab haarte hain jab sab combos 429 dein
 * (matlab aaj ka free quota khatam).
 */
export async function fetchAiOutlook({ apiKey, pack, onStage, proxy }) {
  const viaProxy = !!(proxy?.url);
  const keys = viaProxy
    ? ["__proxy__"]
    : String(apiKey || "").split(/[\n,]+/).map((s) => s.trim()).filter((s) => s.startsWith("gsk_"));
  if (!viaProxy && !keys.length)
    throw new Error("Pehle apni Groq API key dalo (gsk_ se shuru hoti hai) — ek se zyada hon to har line me ek key. Ya Worker Proxy lagao.");
  if (!pack.current) throw new Error("Abhi live price data nahi hai — pehle ticks aane do.");

  const combos = [];
  for (const m of MODELS) for (const k of keys) combos.push({ m, k });

  let lastErr = null, saw429 = false, saw401 = false;
  for (let i = 0; i < combos.length; i++) {
    const { m, k } = combos[i];
    try {
      const tag = viaProxy ? "proxy" : keys.length > 1 ? `key ${keys.indexOf(k) + 1}/${keys.length}` : "key";
      onStage?.(`AI soch raha hai… (${m} · ${tag})`);
      const outlook = await callGroq(viaProxy ? "" : k, m, pack, viaProxy ? proxy : null);
      const modelTag = m + (viaProxy ? " · proxy" : keys.length > 1 ? ` · key ${keys.indexOf(k) + 1}` : "");
      // Step 2: 24h future price path — alag chhota call (reasoning models ka token budget chhota hota hai).
      // Fail ho to outlook bina chart ke bhi kaam karega — koi fake path nahi banayenge.
      try {
        onStage?.("AI future price path bana raha hai…");
        const pp = await callPricePath(viaProxy ? "" : k, m, pack, outlook, viaProxy ? proxy : null);
        outlook.pricePath = pp.pricePath;
        outlook.targets = pp.targets;
      } catch (e) {
        outlook.pricePath = null;
        outlook.targets = null;
        outlook._pathError = e.message;
      }
      return { outlook, model: modelTag };
    } catch (e) {
      lastErr = e;
      if (/401/.test(e.message)) { saw401 = true; continue; } // ye key kharab — agli key try karo
      if (/429/.test(e.message)) { saw429 = true; continue; } // limit — agla model/key try karo
      if (/403/.test(e.message)) throw e; // proxy secret galat — retry bekaar
      // timeout / network / bad JSON — agla combo try karo
    }
  }
  if (saw429 && !saw401)
    throw new Error("Aaj ka free Groq quota khatam lag raha hai (1000 req/day). Kal reset hoga — ya ek aur key add karo, keys rotate ho jayengi.");
  if (saw401 && !saw429)
    throw new Error("Saari keys invalid hain (401) — console.groq.com se nayi key banao.");
  throw lastErr || new Error("AI se connect nahi ho paya.");
}
