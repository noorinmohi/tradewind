// Tradewind backtester.
//
// Replays historical bars through the SAME pure signal functions the live desk
// uses (src/lib/indicators.js + src/lib/signal.js), so what you measure here is
// exactly what the desk would have flagged. The point is to judge whether the
// rules have any edge BEFORE trusting them — not to promise returns.
//
// Trade model (deliberately simple, and lookahead-free):
//   • At each bar's close, compute the signal from data up to THAT bar only.
//   • On a non-neutral bias while flat, enter at the NEXT bar's open.
//   • Stop = 1.5 x ATR (that distance is "1R"). Target = 2R.
//   • Walk forward bar by bar: exit on stop or target (stop assumed first if a
//     single bar spans both — conservative), else exit at close after maxHold.
//   • One position at a time. No commissions, no slippage, no rollover cost.
//
// Usage:  node backtest.js [SYMBOL] [TIMEFRAME]
//   e.g.  node backtest.js ES=F daily
//         node backtest.js MNQ=F hourly
//
// The simulation + stats are exported as pure functions and unit-tested in
// test/backtest.test.js. Results depend on the data provider (DATA_PROVIDER).

import { pathToFileURL } from "node:url";
import { sma, ema, rsi, macd, atr } from "./src/lib/indicators.js";
import { buildSignal } from "./src/lib/signal.js";
import { CONTRACTS } from "./src/lib/contracts.js";
import { fetchSeries, activeProvider } from "./src/lib/data.js";

// Longer ranges than the live desk so there are enough trades to mean anything.
const TF = {
  daily: { interval: "1d", range: "5y" },
  hourly: { interval: "1h", range: "2y" },
  intraday: { interval: "15m", range: "1mo" },
};

export const PARAMS = {
  atrMult: 1.5, // stop distance = 1R
  targetR: 2, // take profit at 2R
  maxHold: 20, // bars before a timed exit
};

// Compute the per-bar signal bias the live desk would have shown, using only
// data available up to each bar. Returns the bias array plus the ATR series the
// simulator needs for stop sizing.
export function signalsFor({ open, high, low, close }) {
  const sma20 = sma(close, 20);
  const sma50 = sma(close, 50);
  const ema9 = ema(close, 9);
  const ema21 = ema(close, 21);
  const rsi14 = rsi(close, 14);
  const macdHist = macd(close).hist;
  const atr14 = atr(high, low, close, 14);

  const biases = close.map((_, i) => {
    if (
      sma20[i] == null || sma50[i] == null || ema9[i] == null ||
      ema21[i] == null || rsi14[i] == null || macdHist[i] == null || atr14[i] == null
    ) {
      return null;
    }
    return buildSignal({
      price: close[i],
      sma20: sma20[i], sma50: sma50[i], ema9: ema9[i], ema21: ema21[i],
      rsi14: rsi14[i], macdHist: macdHist[i],
    }).bias;
  });

  return { biases, atr14 };
}

// Pure trade simulator. Given OHLC arrays, a per-bar bias, and a per-bar ATR,
// walk the rules and return the list of closed trades. No I/O, fully testable.
export function simulateTrades({ open, high, low, close }, biases, atrArr, params = PARAMS) {
  const { atrMult, targetR, maxHold } = params;
  const n = close.length;
  const trades = [];

  let i = 1;
  while (i < n - 1) {
    const bias = biases[i];
    const a = atrArr[i];
    if (bias == null || bias === "neutral" || a == null) {
      i++;
      continue;
    }

    const dir = bias === "long" ? 1 : -1;
    const entry = open[i + 1]; // act on the NEXT bar's open — no lookahead
    const risk = atrMult * a;
    if (!(risk > 0) || entry == null) {
      i++;
      continue;
    }

    const stop = entry - dir * risk;
    const target = entry + dir * targetR * risk;
    const maxJ = Math.min(i + maxHold, n - 1);

    let exitIdx = -1;
    let R = 0;
    for (let j = i + 1; j <= maxJ; j++) {
      if (dir === 1) {
        if (low[j] <= stop) { R = -1; exitIdx = j; break; } // stop first if both
        if (high[j] >= target) { R = targetR; exitIdx = j; break; }
      } else {
        if (high[j] >= stop) { R = -1; exitIdx = j; break; }
        if (low[j] <= target) { R = targetR; exitIdx = j; break; }
      }
      if (j === maxJ) { R = (dir * (close[j] - entry)) / risk; exitIdx = j; } // timed exit
    }

    trades.push({ dir, R, entryIdx: i + 1, exitIdx, barsHeld: exitIdx - (i + 1) + 1 });
    i = exitIdx + 1; // stay flat until the trade closes
  }

  return trades;
}

// Pure stats aggregator. Returns null when there were no trades.
export function computeStats(trades) {
  if (!trades.length) return null;

  const wins = trades.filter((t) => t.R > 0);
  const losses = trades.filter((t) => t.R <= 0);
  const totalR = trades.reduce((s, t) => s + t.R, 0);
  const grossWin = wins.reduce((s, t) => s + t.R, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.R, 0));

  let peak = 0, equity = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.R;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / trades.length,
    totalR,
    expectancy: totalR / trades.length,
    profitFactor: grossLoss === 0 ? Infinity : grossWin / grossLoss,
    maxDD,
    avgHold: trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length,
    longs: trades.filter((t) => t.dir === 1).length,
  };
}

// ── CLI plumbing (only runs when executed directly) ─────────────
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const r2 = (n) => (n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

function report(trades, rows) {
  const s = computeStats(trades);
  if (!s) {
    console.log("\nNo trades generated over this window.\n");
    return;
  }

  const span =
    rows.length > 1
      ? `${new Date(rows[0].t).toISOString().slice(0, 10)} → ${new Date(rows[rows.length - 1].t).toISOString().slice(0, 10)}`
      : "n/a";

  const row = (k, v) => console.log("  " + k.padEnd(22) + v);
  console.log(`  window                ${span}  (${rows.length} bars)`);
  console.log("  " + "-".repeat(40));
  row("trades", `${s.count}  (${s.longs} long / ${s.count - s.longs} short)`);
  row("win rate", `${pct(s.winRate)}  (${s.wins}W / ${s.losses}L)`);
  row("total return", `${r2(s.totalR)} R`);
  row("expectancy / trade", `${r2(s.expectancy)} R`);
  row("profit factor", s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2));
  row("max drawdown", `${s.maxDD.toFixed(2)} R`);
  row("avg bars held", s.avgHold.toFixed(1));
  console.log("  " + "-".repeat(40));
  console.log(
    "\n  ⚠ Hypothetical. Continuous-contract data, no commissions/slippage/rollover,\n" +
      "    fixed 1.5×ATR stop and 2R target. Past behavior of the rules ≠ future results.\n" +
      "    Use this to compare rule variants, not to size real expectations.\n"
  );
}

async function main() {
  const symbol = process.argv[2] || "ES=F";
  const tfKey = process.argv[3] || "daily";

  const spec = CONTRACTS[symbol];
  if (!spec) {
    console.error(`Unknown symbol "${symbol}". Known: ${Object.keys(CONTRACTS).join(", ")}`);
    process.exit(1);
  }
  const tf = TF[tfKey];
  if (!tf) {
    console.error(`Unknown timeframe "${tfKey}". Use one of: ${Object.keys(TF).join(", ")}`);
    process.exit(1);
  }

  console.log(`\nTradewind backtest — ${symbol} (${spec.name}) · ${tfKey} · provider: ${activeProvider()}`);

  const { rows } = await fetchSeries(spec, tf.interval, tf.range);
  const bars = {
    open: rows.map((r) => r.o),
    high: rows.map((r) => r.h),
    low: rows.map((r) => r.l),
    close: rows.map((r) => r.c),
  };

  const { biases, atr14 } = signalsFor(bars);
  const trades = simulateTrades(bars, biases, atr14);
  report(trades, rows);
}

// Run main() only when invoked directly (node backtest.js …), NOT when imported
// by the test runner — otherwise importing this file would fire a data fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("\nBacktest failed:", err.message, "\n");
    process.exit(1);
  });
}
