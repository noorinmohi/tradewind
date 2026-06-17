// Options analysis — Black-Scholes pricing, Greeks, and payoff/risk for the
// strategies retail traders most commonly use. Pure math, no data feed: you
// supply the underlying, strike(s), days-to-expiry, implied volatility, and
// rate, and it returns theoretical premiums + Greeks + an expiration payoff.
//
// Premiums here are THEORETICAL (Black-Scholes from your IV), not live quotes —
// this is for understanding a structure's shape and risk, not a fill price.
// European-style, no dividends. As always: analysis only; you place the trade.

// Standard normal CDF (Abramowitz & Stegun 7.1.26 — ~1e-7 accuracy).
export function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Black-Scholes price + Greeks for one option, in trader-friendly units:
//   delta per $1 underlying, gamma per $1, theta per DAY, vega per 1 vol point
//   (1%), rho per 1% rate. T in years, sigma as a decimal (0.30 = 30%).
export function bs(type, S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const delta = type === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    return { price: intrinsic, delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = normPdf(d1);
  const disc = Math.exp(-r * T);
  const gamma = nd1 / (S * sigma * sqrtT);
  const vega = (S * nd1 * sqrtT) / 100;

  if (type === "call") {
    const Nd1 = normCdf(d1), Nd2 = normCdf(d2);
    return {
      price: S * Nd1 - K * disc * Nd2,
      delta: Nd1,
      gamma,
      theta: (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * disc * Nd2) / 365,
      vega,
      rho: (K * T * disc * Nd2) / 100,
    };
  }
  const Nmd1 = normCdf(-d1), Nmd2 = normCdf(-d2);
  return {
    price: K * disc * Nmd2 - S * Nmd1,
    delta: normCdf(d1) - 1,
    gamma,
    theta: (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * disc * Nmd2) / 365,
    vega,
    rho: (-K * T * disc * Nmd2) / 100,
  };
}

const yearsFromDTE = (dte) => Math.max(Number(dte) || 0, 0) / 365;

// Leg builders. `position` is +1 long / -1 short.
const optLeg = (type, position, K, i) => ({
  kind: "option",
  type,
  position,
  K,
  premium: bs(type, i.S, K, i.T, i.r, i.sigma).price,
});
const stockLeg = (position, entry) => ({ kind: "stock", position, entry });

// The strategies most people trade. `fields` tells the UI which strike inputs
// to show (K1 = lower/primary, K2 = higher, W = wing width for the condor).
export const STRATEGIES = {
  long_call: { label: "Long Call", fields: ["K1"], build: (i) => [optLeg("call", 1, i.K1, i)] },
  long_put: { label: "Long Put", fields: ["K1"], build: (i) => [optLeg("put", 1, i.K1, i)] },
  covered_call: { label: "Covered Call", fields: ["K2"], build: (i) => [stockLeg(1, i.S), optLeg("call", -1, i.K2, i)] },
  csp: { label: "Cash-Secured Put", fields: ["K1"], build: (i) => [optLeg("put", -1, i.K1, i)] },
  bull_call: { label: "Bull Call Spread", fields: ["K1", "K2"], build: (i) => [optLeg("call", 1, i.K1, i), optLeg("call", -1, i.K2, i)] },
  bear_put: { label: "Bear Put Spread", fields: ["K1", "K2"], build: (i) => [optLeg("put", 1, i.K2, i), optLeg("put", -1, i.K1, i)] },
  straddle: { label: "Long Straddle", fields: ["K1"], build: (i) => [optLeg("call", 1, i.K1, i), optLeg("put", 1, i.K1, i)] },
  strangle: { label: "Long Strangle", fields: ["K1", "K2"], build: (i) => [optLeg("put", 1, i.K1, i), optLeg("call", 1, i.K2, i)] },
  iron_condor: {
    label: "Iron Condor",
    fields: ["K1", "K2", "W"],
    build: (i) => [
      optLeg("put", 1, i.K1 - i.W, i),
      optLeg("put", -1, i.K1, i),
      optLeg("call", -1, i.K2, i),
      optLeg("call", 1, i.K2 + i.W, i),
    ],
  },
};

// Profit/loss of one leg at an expiration price P (per 1 unit, before multiplier).
function legPnL(leg, P) {
  if (leg.kind === "stock") return leg.position * (P - leg.entry);
  const intrinsic = leg.type === "call" ? Math.max(P - leg.K, 0) : Math.max(leg.K - P, 0);
  return leg.position * (intrinsic - leg.premium);
}

// Full analysis of a strategy: legs (with theoretical premiums + Greeks),
// net debit/credit, max profit/loss, breakeven(s), and the expiration payoff
// curve for charting.
export function analyzeStrategy(key, raw) {
  const strat = STRATEGIES[key];
  if (!strat) throw new Error(`unknown strategy "${key}"`);

  const i = {
    S: Number(raw.S),
    K1: Number(raw.K1),
    K2: Number(raw.K2),
    W: Number(raw.W),
    T: yearsFromDTE(raw.dte),
    r: Number(raw.r) / 100, // UI takes percent
    sigma: Number(raw.sigma) / 100, // UI takes percent
    multiplier: Number(raw.multiplier) || 1,
  };
  const m = i.multiplier;
  const legs = strat.build(i);

  // Net cash to open: >0 = debit (you pay), <0 = credit (you receive).
  const netCost =
    legs.reduce((s, l) => s + (l.kind === "stock" ? l.position * l.entry : l.position * l.premium), 0) * m;

  // Payoff curve over a strike-aware range.
  const ks = legs.filter((l) => l.kind === "option").map((l) => l.K).concat([i.S]);
  const lo = Math.max(0.01, Math.min(...ks) * 0.8);
  const hi = Math.max(...ks) * 1.2;
  const N = 161;
  const curve = [];
  for (let n = 0; n < N; n++) {
    const P = lo + ((hi - lo) * n) / (N - 1);
    const pnl = legs.reduce((s, l) => s + legPnL(l, P), 0) * m;
    curve.push({ price: P, pnl });
  }

  const pnls = curve.map((c) => c.pnl);
  const maxProfit = Math.max(...pnls);
  const maxLoss = Math.min(...pnls);
  // Unbounded? Check slope at the chart edges.
  const upUnbounded = pnls[N - 1] > pnls[N - 2] + 1e-9;
  const downUnbounded = pnls[0] > pnls[1] + 1e-9; // P&L still rising as price falls off the left

  // Breakevens: linear-interpolate zero crossings of the payoff.
  const breakevens = [];
  for (let n = 1; n < N; n++) {
    const a = curve[n - 1], b = curve[n];
    if ((a.pnl <= 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl <= 0)) {
      if (a.pnl === b.pnl) continue;
      breakevens.push(a.price + ((0 - a.pnl) / (b.pnl - a.pnl)) * (b.price - a.price));
    }
  }

  // Net Greeks at the current underlying (stock contributes delta = position).
  const netGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    if (l.kind === "stock") {
      netGreeks.delta += l.position * m;
      continue;
    }
    const g = bs(l.type, i.S, l.K, i.T, i.r, i.sigma);
    netGreeks.delta += l.position * g.delta * m;
    netGreeks.gamma += l.position * g.gamma * m;
    netGreeks.theta += l.position * g.theta * m;
    netGreeks.vega += l.position * g.vega * m;
  }

  return {
    legs,
    multiplier: m,
    netCost, // + debit / - credit
    maxProfit: upUnbounded ? Infinity : maxProfit,
    maxLoss: downUnbounded ? -Infinity : maxLoss,
    breakevens: [...new Set(breakevens.map((b) => Math.round(b * 100) / 100))],
    curve,
    netGreeks,
  };
}
