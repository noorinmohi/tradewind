// Unit tests for the indicator math. Run with: npm test  (Node's built-in
// test runner — no extra dependencies).
//
// These pin the math down with hand-verified, deterministic cases so a future
// tweak that changes a formula fails loudly instead of silently shifting every
// signal and backtest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, ema, rsi, macd, atr, lastVal } from "../src/lib/indicators.js";

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("sma: aligns to input, nulls until enough data", () => {
  // mean of each trailing window of 3
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("ema: seeds with an SMA then smooths (k = 0.5 for period 3)", () => {
  // seed at idx2 = mean(1,2,3)=2; then x*0.5 + prev*0.5
  assert.deepEqual(ema([1, 2, 3, 4, 5, 6], 3), [null, null, 2, 3, 4, 5]);
});

test("rsi: 100 on a pure uptrend, 0 on a pure downtrend", () => {
  const up = Array.from({ length: 20 }, (_, i) => i + 1);
  const down = Array.from({ length: 20 }, (_, i) => 20 - i);
  approx(lastVal(rsi(up, 14)), 100);
  approx(lastVal(rsi(down, 14)), 0);
});

test("rsi: stays within [0, 100] on noisy data", () => {
  const noisy = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
    45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  for (const v of rsi(noisy, 14)) {
    if (v != null) assert.ok(v >= 0 && v <= 100, `RSI in range: ${v}`);
  }
});

test("atr: constant true range -> ATR equals that range", () => {
  const n = 30;
  const closes = Array(n).fill(100);
  const highs = Array(n).fill(100.5);
  const lows = Array(n).fill(99.5); // high-low = 1, gaps = 0 -> TR = 1 each bar
  approx(lastVal(atr(highs, lows, closes, 14)), 1);
});

test("macd: flat series -> zero line and zero histogram; hist = macd - signal", () => {
  const flat = Array(60).fill(100);
  const { macd: line, signal, hist } = macd(flat);
  approx(lastVal(line), 0);
  approx(lastVal(hist), 0);

  // Relationship holds bar-by-bar wherever all three are defined.
  const rising = Array.from({ length: 80 }, (_, i) => 100 + i);
  const m = macd(rising);
  for (let i = 0; i < rising.length; i++) {
    if (m.macd[i] != null && m.signal[i] != null) approx(m.hist[i], m.macd[i] - m.signal[i]);
  }
});

test("lastVal: returns the last non-null, or null when empty", () => {
  assert.equal(lastVal([null, 1, 2, null]), 2);
  assert.equal(lastVal([null, null]), null);
  assert.equal(lastVal([]), null);
});
