// Unit tests for the options math (Black-Scholes, Greeks, strategy payoffs).
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { bs, normCdf, analyzeStrategy, STRATEGIES } from "../src/lib/options.js";

const approx = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

test("normCdf: known points", () => {
  approx(normCdf(0), 0.5, 1e-9);
  approx(normCdf(1.96), 0.975, 1e-3);
  approx(normCdf(-1.96), 0.025, 1e-3);
});

test("bs: ATM call, r=0, 1y, 20% vol ≈ 7.9656", () => {
  approx(bs("call", 100, 100, 1, 0, 0.2).price, 7.9656, 1e-3);
});

test("bs: put-call parity  C - P = S - K e^(-rT)", () => {
  const S = 100, K = 95, T = 0.5, r = 0.05, sigma = 0.25;
  const c = bs("call", S, K, T, r, sigma).price;
  const p = bs("put", S, K, T, r, sigma).price;
  approx(c - p, S - K * Math.exp(-r * T), 1e-6);
});

test("bs: expiry (T=0) prices intrinsic value", () => {
  assert.equal(bs("call", 110, 100, 0, 0.05, 0.2).price, 10);
  assert.equal(bs("put", 90, 100, 0, 0.05, 0.2).price, 10);
  assert.equal(bs("call", 90, 100, 0, 0.05, 0.2).price, 0);
});

test("bs: Greek signs and delta relationship", () => {
  const c = bs("call", 100, 100, 0.5, 0.03, 0.3);
  const p = bs("put", 100, 100, 0.5, 0.03, 0.3);
  assert.ok(c.delta > 0 && c.delta < 1, "call delta in (0,1)");
  assert.ok(p.delta < 0 && p.delta > -1, "put delta in (-1,0)");
  approx(c.delta - p.delta, 1, 1e-6); // N(d1) - (N(d1)-1) = 1
  assert.ok(c.gamma > 0 && c.vega > 0, "gamma & vega positive");
  assert.ok(c.theta < 0, "long call theta negative (decay)");
});

test("strategy: long call — debit, capped loss, unlimited upside, BE = K + premium", () => {
  const prem = bs("call", 100, 100, 30 / 365, 0, 0.2).price;
  const a = analyzeStrategy("long_call", { S: 100, K1: 100, dte: 30, r: 0, sigma: 20, multiplier: 100 });
  approx(a.netCost, prem * 100, 0.01); // positive = debit paid
  approx(a.maxLoss, -prem * 100, 1); // can only lose the premium
  assert.equal(a.maxProfit, Infinity); // unlimited upside flagged
  approx(a.breakevens[0], 100 + prem, 0.3);
});

test("strategy: bull call spread — bounded both ways", () => {
  const p1 = bs("call", 100, 100, 30 / 365, 0, 0.2).price;
  const p2 = bs("call", 100, 110, 30 / 365, 0, 0.2).price;
  const debit = p1 - p2;
  const a = analyzeStrategy("bull_call", { S: 100, K1: 100, K2: 110, dte: 30, r: 0, sigma: 20, multiplier: 100 });
  approx(a.netCost, debit * 100, 0.01);
  assert.notEqual(a.maxProfit, Infinity);
  approx(a.maxProfit, (10 - debit) * 100, 2); // width minus debit
  approx(a.maxLoss, -debit * 100, 2);
});

test("every strategy analyzes without throwing and returns a payoff curve", () => {
  const inputs = { S: 100, K1: 95, K2: 105, W: 5, dte: 30, r: 4, sigma: 30, multiplier: 100 };
  for (const key of Object.keys(STRATEGIES)) {
    const a = analyzeStrategy(key, inputs);
    assert.ok(a.legs.length >= 1, `${key} has legs`);
    assert.ok(a.curve.length > 10, `${key} has a payoff curve`);
    assert.ok(Number.isFinite(a.netCost), `${key} netCost finite`);
    assert.ok(Number.isFinite(a.netGreeks.delta), `${key} delta finite`);
  }
});

test("strategy: iron condor — net credit, two breakevens, capped risk", () => {
  const a = analyzeStrategy("iron_condor", { S: 100, K1: 95, K2: 105, W: 5, dte: 30, r: 0, sigma: 20, multiplier: 100 });
  assert.ok(a.netCost < 0, "opens for a credit");
  approx(a.maxProfit, -a.netCost, 2); // keep the credit if it expires between shorts
  assert.ok(a.maxLoss !== -Infinity && a.maxLoss < 0, "loss is capped by the wings");
  assert.equal(a.breakevens.length, 2);
});
