// Unit tests for the rule-based signal and the risk/position-sizing plan.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignal, buildRisk } from "../src/lib/signal.js";

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const ES = { pointValue: 50, tick: 0.25 };

const bull = { price: 110, sma20: 105, sma50: 100, ema9: 108, ema21: 104, macdHist: 0.5, rsi14: 60 };
const bear = { price: 90, sma20: 95, sma50: 100, ema9: 92, ema21: 96, macdHist: -0.5, rsi14: 40 };

test("buildSignal: aligned bullish inputs -> long, high confidence, max score", () => {
  const s = buildSignal(bull);
  assert.equal(s.bias, "long");
  assert.equal(s.score, 90); // 25 + 20 + 15 + 20 + 10
  assert.equal(s.confidence, "high");
  assert.equal(s.cautions.length, 0);
  assert.ok(s.reasons.length >= 5);
});

test("buildSignal: aligned bearish inputs -> short, score -90", () => {
  const s = buildSignal(bear);
  assert.equal(s.bias, "short");
  assert.equal(s.score, -90);
  assert.equal(s.confidence, "high");
});

test("buildSignal: conflicting inputs net to neutral", () => {
  // +25 (price>sma50) -20 (sma20<sma50) +15 (ema9>ema21) -20 (macd<0) +0 (rsi 50)
  const s = buildSignal({ price: 110, sma20: 95, sma50: 100, ema9: 108, ema21: 104, macdHist: -0.5, rsi14: 50 });
  assert.equal(s.score, 0);
  assert.equal(s.bias, "neutral");
});

test("buildSignal: overbought RSI raises cautions even when trend is up", () => {
  const s = buildSignal({ ...bull, rsi14: 75 });
  assert.equal(s.bias, "long");
  assert.ok(s.cautions.some((c) => /overbought/i.test(c)));
  assert.ok(s.cautions.some((c) => /conflict/i.test(c)));
});

test("buildSignal: score never escapes [-100, 100]", () => {
  for (const snap of [bull, bear, { ...bull, rsi14: 75 }]) {
    const s = buildSignal(snap);
    assert.ok(s.score >= -100 && s.score <= 100);
  }
});

test("buildRisk: long plan puts stop below and targets above, in order", () => {
  const r = buildRisk({ price: 100, atr: 2, bias: "long", spec: ES, accountSize: 100000, riskPct: 1 });
  assert.equal(r.direction, "long");
  assert.equal(r.isReference, false);
  assert.equal(r.stopDistancePts, 3); // 1.5 * ATR
  assert.ok(r.stop < r.entry);
  assert.ok(r.target1 > r.entry && r.target2 > r.target1);
  assert.equal(r.riskPerContract, 150); // 3 pts * $50
  assert.equal(r.dollarRisk, 1000); // 1% of 100k
  assert.equal(r.suggestedContracts, 6); // floor(1000 / 150)
});

test("buildRisk: short plan flips stop above and targets below", () => {
  const r = buildRisk({ price: 100, atr: 2, bias: "short", spec: ES, accountSize: 100000, riskPct: 1 });
  assert.equal(r.direction, "short");
  assert.ok(r.stop > r.entry);
  assert.ok(r.target1 < r.entry && r.target2 < r.target1);
});

test("buildRisk: neutral bias is flagged as a long-side reference", () => {
  const r = buildRisk({ price: 100, atr: 2, bias: "neutral", spec: ES, accountSize: 100000, riskPct: 1 });
  assert.equal(r.isReference, true);
  assert.equal(r.direction, "long");
});

test("buildRisk: prices snap to the contract tick", () => {
  const r = buildRisk({ price: 100.13, atr: 2, bias: "long", spec: ES, accountSize: 100000, riskPct: 1 });
  assert.equal(r.entry, 100.25); // nearest 0.25
  approx(r.stop % 0.25, 0);
});
