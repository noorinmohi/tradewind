// Unit tests for the backtest trade simulator and stats aggregator.
// Run with: npm test
//
// Each case hand-crafts OHLC bars with a known outcome so every exit path
// (target, stop, stop-first-when-ambiguous, timed) and the flat-to-flat
// sequencing are locked down. A signal is placed at bar index 1, so the trade
// enters at the open of bar 2 (the "next bar").

import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTrades, computeStats, PARAMS } from "../backtest.js";

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const bars = (open, high, low, close) => ({ open, high, low, close });

// Helpers: a long signal at bar 1, neutral elsewhere; flat ATR of 2 -> risk 3.
const longAt1 = [null, "long", null, null, null];
const shortAt1 = [null, "short", null, null, null];
const atr2 = [null, 2, 2, 2, 2];

test("long hits target -> +2R, exits on the bar that touched it", () => {
  // entry = open[2] = 100, risk = 3 -> stop 97, target 106
  const t = simulateTrades(
    bars([50, 60, 100, 100, 100], [51, 61, 107, 100, 100], [49, 59, 99, 100, 100], [50, 60, 105, 100, 100]),
    longAt1, atr2
  );
  assert.equal(t.length, 1);
  assert.equal(t[0].dir, 1);
  assert.equal(t[0].R, 2);
  assert.equal(t[0].entryIdx, 2);
  assert.equal(t[0].exitIdx, 2);
  assert.equal(t[0].barsHeld, 1);
});

test("long hits stop -> -1R", () => {
  const t = simulateTrades(
    bars([50, 60, 100, 100, 100], [51, 61, 102, 100, 100], [49, 59, 96, 100, 100], [50, 60, 98, 100, 100]),
    longAt1, atr2
  );
  assert.equal(t.length, 1);
  assert.equal(t[0].R, -1);
});

test("ambiguous bar (spans both) is counted as the stop -> -1R (conservative)", () => {
  // bar 2 low 95 <= stop 97 AND high 110 >= target 106; stop must win.
  const t = simulateTrades(
    bars([50, 60, 100, 100, 100], [51, 61, 110, 100, 100], [49, 59, 95, 100, 100], [50, 60, 103, 100, 100]),
    longAt1, atr2
  );
  assert.equal(t[0].R, -1);
});

test("short hits target -> +2R with stop above / target below", () => {
  // entry 100, risk 3 -> stop 103, target 94
  const t = simulateTrades(
    bars([50, 60, 100, 100, 100], [51, 61, 101, 100, 100], [49, 59, 93, 100, 100], [50, 60, 95, 100, 100]),
    shortAt1, atr2
  );
  assert.equal(t[0].dir, -1);
  assert.equal(t[0].R, 2);
});

test("timed exit after maxHold -> R measured from close", () => {
  // maxHold 2: never hits stop/target, exits at close[3]=103 -> R = (103-100)/3 = 1.0
  const t = simulateTrades(
    bars([50, 60, 100, 100, 100, 100], [51, 61, 104, 105, 100, 100], [49, 59, 99, 98, 100, 100], [50, 60, 102, 103, 100, 100]),
    [null, "long", null, null, null, null],
    [null, 2, 2, 2, 2, 2],
    { ...PARAMS, maxHold: 2 }
  );
  assert.equal(t.length, 1);
  approx(t[0].R, 1.0);
  assert.equal(t[0].exitIdx, 3);
  assert.equal(t[0].barsHeld, 2);
});

test("neutral / null bias produces no trades", () => {
  const t = simulateTrades(
    bars([50, 60, 70, 80, 90], [51, 61, 71, 81, 91], [49, 59, 69, 79, 89], [50, 60, 70, 80, 90]),
    [null, "neutral", null, null, null], atr2
  );
  assert.equal(t.length, 0);
});

test("trades never overlap: a signal during an open trade is skipped", () => {
  // Long signals at bars 1 AND 2. The first trade enters at bar 2 and exits at
  // bar 3 (target), so the loop jumps past bar 2 — its signal yields no trade.
  const t = simulateTrades(
    bars([50, 60, 100, 100, 100, 100], [51, 61, 103, 107, 100, 100], [49, 59, 99, 99, 100, 100], [50, 60, 102, 105, 100, 100]),
    [null, "long", "long", null, null, null],
    [null, 2, 2, 2, 2, 2]
  );
  assert.equal(t.length, 1);
  assert.equal(t[0].entryIdx, 2);
  assert.equal(t[0].exitIdx, 3);
});

test("computeStats: aggregates win rate, expectancy, profit factor, drawdown", () => {
  const trades = [
    { dir: 1, R: 2, barsHeld: 1 },
    { dir: 1, R: -1, barsHeld: 1 },
    { dir: -1, R: 2, barsHeld: 1 },
    { dir: 1, R: -1, barsHeld: 1 },
    { dir: -1, R: -1, barsHeld: 1 },
  ];
  const s = computeStats(trades);
  assert.equal(s.count, 5);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 3);
  approx(s.winRate, 0.4);
  approx(s.totalR, 1);
  approx(s.expectancy, 0.2);
  approx(s.profitFactor, 4 / 3); // grossWin 4 / grossLoss 3
  approx(s.maxDD, 2); // equity 2,1,3,2,1 -> peak 3, trough 1
  assert.equal(s.longs, 3);
});

test("computeStats: no trades -> null", () => {
  assert.equal(computeStats([]), null);
});
