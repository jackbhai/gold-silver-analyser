/**
 * groq-proxy.js — Cloudflare Worker (FREE tier kaafi hai).
 *
 * Tumhari Groq key server-side (worker secrets) me rehti hai.
 * App se koi key/secret dalne ki zaroorat NAHI — browser khud
 * Origin header bhejta hai, worker usi se pehchanta hai ki request
 * tumhari site (jackbhai.github.io) se aa rahi hai.
 *
 * Safety (bina user input ke):
 *  - Sirf allow-listed Origin/Referer se requests (spoed header
 *    aasani se fake hota hai, isliye ye casual misuse rokta hai,
 *    determined attacker nahi — uske liye PROXY_SECRET wala
 *    header ab bhi supported hai).
 *  - Sirf allow-listed models, max_tokens clamp.
 *  - Per-IP throttle: 30 req/min (quota udne se bachao).
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const ALLOW_MODELS = ["groq/compound", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const ALLOW_ORIGINS = ["https://jackbhai.github.io", "http://localhost"];

// simple per-isolate throttle
const HITS = new Map();
function throttled(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 30;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "https://jackbhai.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Proxy-Secret",
  };
}
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { ...cors(), "Content-Type": "application/json" },
  });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    if (throttled(ip)) return json({ error: "too many requests" }, 429);

    // zero-input auth: browser ka Origin header hi pehchan hai
    const origin = req.headers.get("Origin") || "";
    const referer = req.headers.get("Referer") || "";
    const originOk = ALLOW_ORIGINS.some(
      (o) => origin.startsWith(o) || referer.startsWith(o)
    );
    // optional upgrade: shared secret header bhi chalega
    const envSecret = env.PROXY_SECRET;
    const secretOk =
      !!envSecret && req.headers.get("X-Proxy-Secret") === envSecret;
    if (!originOk && !secretOk) return json({ error: "forbidden" }, 403);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (!ALLOW_MODELS.includes(body.model)) {
      return json({ error: "model not allowed" }, 403);
    }
    body.max_tokens = Math.min(Number(body.max_tokens) || 1200, 2500);
    if (Array.isArray(body.messages)) body.messages = body.messages.slice(-4);
    delete body.stream;

    const groqKeys = [];
    for (let i = 1; i <= 10; i++) {
      const k = env[`GROQ_API_KEY_${i}`];
      if (k) groqKeys.push(k);
    }
    if (env.GROQ_API_KEY) groqKeys.unshift(env.GROQ_API_KEY);
    if (!groqKeys.length) return json({ error: "GROQ_API_KEY not set" }, 500);

    // 429/401 aaye to agli key se retry — 10 keys = 10x daily quota
    let r = null;
    for (let i = 0; i < groqKeys.length; i++) {
      r = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKeys[i]}`,
        },
        body: JSON.stringify(body),
      });
      if (r.status !== 429 && r.status !== 401) break;
    }
    const data = await r.text();
    return new Response(data, {
      status: r.status,
      headers: { ...cors(), "Content-Type": "application/json" },
    });
  },
};
