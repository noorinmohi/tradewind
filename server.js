// Tradewind backend.
//
// Responsibilities:
//   1. Hold the Anthropic API key (from env) so it is NEVER exposed to the
//      browser, and proxy the optional AI "read".
//   2. Fetch market data server-side (avoids browser CORS and keeps the data
//      source swappable in ONE place — see fetchSeries).
//   3. Compute indicators + the rule-based signal + the risk plan, and return
//      a single JSON payload to the UI.
//   4. In production, serve the built React app from /dist.
//
// Tradewind is an ANALYSIS tool. It never connects to a broker and never places
// an order. Every output is for the human to review and act on themselves.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sma, ema, rsi, macd, atr, lastVal } from "./src/lib/indicators.js";
import { buildSignal, buildRisk } from "./src/lib/signal.js";
import { CONTRACTS, TIMEFRAMES } from "./src/lib/contracts.js";
import { fetchSeries, activeProvider } from "./src/lib/data.js";
import { aiEnabled, aiProvider, generateRead } from "./src/lib/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;

if (aiEnabled()) {
  console.log(`✓ AI read enabled via "${aiProvider()}".`);
} else {
  console.warn(`⚠  AI read is off — provider "${aiProvider()}" has no key configured. Indicators, signal, and risk plan still work. See README to enable it.`);
}

// Optional passcode gate for the AI read (see /api/analyze). If AI_PASSCODE is
// set, the AI summary only runs for requests that send the matching code — so a
// shared/public URL can offer the AI read to people you give the code to,
// without letting the open internet spend your AI quota. The free analysis
// (signals + risk plan) is never gated.
const AI_PASSCODE = process.env.AI_PASSCODE || "";
if (aiEnabled() && AI_PASSCODE) console.log("  ↳ AI read is passcode-gated (AI_PASSCODE is set).");

// Light per-IP rate limit on AI reads (fixed 1-minute window), so even a leaked
// passcode can't run up unlimited calls.
const AI_RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 20);
const aiHits = new Map();
function aiRateOk(ip) {
  const now = Date.now();
  let e = aiHits.get(ip);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + 60000 };
  e.count += 1;
  aiHits.set(ip, e);
  return e.count <= AI_RATE_PER_MIN;
}

const app = express();
app.set("trust proxy", 1); // Render runs behind a proxy; needed for real client IPs
app.use(express.json({ limit: "1mb" }));

// Market data lives in src/lib/data.js behind a provider switch (DATA_PROVIDER).

// ── Optional AI read ────────────────────────────────────────────
const SYSTEM = `You are a futures-market analyst embedded in a personal analysis tool called Tradewind. You receive pre-computed technical indicators, a transparent rule-based signal, and an ATR-based risk plan for one futures contract. Your job is to explain, in plain language, what the data currently shows so the trader can judge it themselves.

Rules:
- 3 to 6 sentences. Plain English, calm and neutral. No hype, no emojis.
- Use ONLY the numbers provided. Never invent prices, levels, indicator values, or news.
- Name the single strongest factor supporting the bias AND the single biggest conflicting/risk factor.
- State what would invalidate the setup (e.g. a close back below the stop level).
- Never use language implying certainty ("will", "guaranteed", "definitely"). Use "suggests", "leans", "if".
- Do NOT tell the trader to buy or sell. Describe what the setup shows; the decision is theirs.
- End with one short sentence reminding them this is delayed, continuous-contract data for analysis only, and that they place and own any trade.`;

async function aiRead(payload) {
  const userMsg =
    "Here is the current snapshot. Explain what it shows.\n\n" +
    JSON.stringify(payload, null, 2);

  try {
    const text = await generateRead(SYSTEM, userMsg);
    return text || "AI read returned empty; rely on the computed signal above.";
  } catch (err) {
    console.error("AI read failed", err);
    return "AI read unavailable (the model request failed). The computed signal and risk plan above still stand.";
  }
}

// ── Routes ──────────────────────────────────────────────────────
app.get("/api/contracts", (_req, res) => {
  res.json({ contracts: CONTRACTS, timeframes: TIMEFRAMES });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const {
      symbol,
      timeframe = "daily",
      accountSize = 25000,
      riskPct = 1,
      accessCode = "",
    } = req.body || {};

    const spec = CONTRACTS[symbol];
    if (!spec) return res.status(400).json({ error: "unknown symbol" });

    const tf = TIMEFRAMES[timeframe];
    if (!tf) return res.status(400).json({ error: "unknown timeframe" });

    const acct = Number(accountSize);
    const risk = Number(riskPct);
    if (!Number.isFinite(acct) || acct <= 0) return res.status(400).json({ error: "account size must be a positive number" });
    if (!Number.isFinite(risk) || risk <= 0 || risk > 100) return res.status(400).json({ error: "risk % must be between 0 and 100" });

    const { rows, meta } = await fetchSeries(spec, tf.interval, tf.range);

    const closes = rows.map((r) => r.c);
    const highs = rows.map((r) => r.h);
    const lows = rows.map((r) => r.l);

    const sma20 = lastVal(sma(closes, 20));
    const sma50 = lastVal(sma(closes, 50));
    const ema9 = lastVal(ema(closes, 9));
    const ema21 = lastVal(ema(closes, 21));
    const rsi14 = lastVal(rsi(closes, 14));
    const macdAll = macd(closes);
    const macdHist = lastVal(macdAll.hist);
    const macdLine = lastVal(macdAll.macd);
    const macdSignal = lastVal(macdAll.signal);
    const atr14 = lastVal(atr(highs, lows, closes, 14));

    const price = meta.price ?? closes[closes.length - 1];
    // Change vs the PRIOR BAR's close (the move for this timeframe), not vs the
    // start of the whole range.
    const prevClose = closes[closes.length - 2] ?? price;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    const indSnapshot = { price, sma20, sma50, ema9, ema21, rsi14, macdHist };
    const signal = buildSignal(indSnapshot);

    const riskPlan = atr14
      ? buildRisk({ price, atr: atr14, bias: signal.bias, spec, accountSize: acct, riskPct: risk })
      : null;

    // Compact series for the sparkline (last 80 closes).
    const series = rows.slice(-80).map((r) => ({ t: r.t, c: r.c }));

    const indicators = {
      sma20, sma50, ema9, ema21, rsi14,
      macd: { macd: macdLine, signal: macdSignal, hist: macdHist },
      atr14,
    };

    const aiPayload = {
      symbol,
      name: spec.name,
      timeframe: tf.label,
      price, change, changePct,
      indicators,
      signal,
      risk: riskPlan,
      dataNote: "Yahoo continuous front-month future, delayed ~10-15 min.",
    };

    // Decide whether to run the (cost-bearing) AI read for this request:
    //   off          — no AI provider key on the server (analysis-only deploy)
    //   locked       — AI available, but this request lacks the passcode
    //   rate_limited — passed the gate, but over the per-IP per-minute limit
    //   on           — run it
    let aiStatus = "off";
    if (aiEnabled()) {
      if (AI_PASSCODE && accessCode !== AI_PASSCODE) aiStatus = "locked";
      else if (!aiRateOk(req.ip)) aiStatus = "rate_limited";
      else aiStatus = "on";
    }
    const explanation = aiStatus === "on" ? await aiRead(aiPayload) : null;

    res.json({
      symbol,
      name: spec.name,
      timeframe: tf.label,
      interval: tf.interval,
      provider: activeProvider(),
      aiStatus,
      aiEnabled: aiStatus === "on",
      aiProvider: aiProvider(),
      asOf: meta.asOf || Date.now(),
      currency: meta.currency || "USD",
      price, change, changePct,
      bars: rows.length,
      spec: { pointValue: spec.pointValue, tick: spec.tick },
      series,
      indicators,
      signal,
      risk: riskPlan,
      explanation,
    });
  } catch (err) {
    console.error("analyze failed", err);
    res.status(502).json({ error: err.message || "analysis failed" });
  }
});

// ── Static frontend (production) ────────────────────────────────
const dist = path.join(__dirname, "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(PORT, () => console.log(`Tradewind server on http://localhost:${PORT}`));
