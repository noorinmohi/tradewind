// Turns a snapshot of indicator values into (a) a transparent, rule-based
// directional signal and (b) a risk/position-sizing plan.
//
// The scoring is deliberately simple and auditable: each rule adds or subtracts
// a fixed number of points, and `reasons` records exactly which rules fired.
// Nothing here is a prediction — it's a structured summary of what the
// indicators currently say, for a human to weigh.

export function buildSignal(ind) {
  const reasons = [];
  const cautions = [];
  let score = 0;

  // Trend: where price sits relative to the slow average.
  if (ind.price != null && ind.sma50 != null) {
    if (ind.price > ind.sma50) {
      score += 25;
      reasons.push("Price is above the 50-period SMA (broader trend up).");
    } else {
      score -= 25;
      reasons.push("Price is below the 50-period SMA (broader trend down).");
    }
  }

  // Trend structure: fast average vs slow average.
  if (ind.sma20 != null && ind.sma50 != null) {
    if (ind.sma20 > ind.sma50) {
      score += 20;
      reasons.push("20-SMA is above the 50-SMA (medium-term momentum up).");
    } else {
      score -= 20;
      reasons.push("20-SMA is below the 50-SMA (medium-term momentum down).");
    }
  }

  // Short-term trend: EMA crossover.
  if (ind.ema9 != null && ind.ema21 != null) {
    if (ind.ema9 > ind.ema21) {
      score += 15;
      reasons.push("9-EMA is above the 21-EMA (short-term trend up).");
    } else {
      score -= 15;
      reasons.push("9-EMA is below the 21-EMA (short-term trend down).");
    }
  }

  // Momentum: MACD histogram.
  if (ind.macdHist != null) {
    if (ind.macdHist > 0) {
      score += 20;
      reasons.push("MACD histogram is positive (momentum building up).");
    } else {
      score -= 20;
      reasons.push("MACD histogram is negative (momentum building down).");
    }
  }

  // Momentum confirmation + stretch warnings: RSI.
  if (ind.rsi14 != null) {
    const r = ind.rsi14.toFixed(0);
    if (ind.rsi14 >= 55) {
      score += 10;
      reasons.push(`RSI is ${r} (momentum favors buyers).`);
    } else if (ind.rsi14 <= 45) {
      score -= 10;
      reasons.push(`RSI is ${r} (momentum favors sellers).`);
    } else {
      reasons.push(`RSI is ${r} (neutral momentum).`);
    }
    if (ind.rsi14 >= 70) cautions.push(`RSI ${r} is overbought — chasing a long here risks buying the top.`);
    if (ind.rsi14 <= 30) cautions.push(`RSI ${r} is oversold — chasing a short here risks selling the bottom.`);
  }

  score = Math.max(-100, Math.min(100, score));

  let bias = "neutral";
  if (score >= 20) bias = "long";
  else if (score <= -20) bias = "short";

  const mag = Math.abs(score);
  const confidence = mag >= 60 ? "high" : mag >= 30 ? "medium" : "low";

  // Flag when trend and RSI disagree — the most common trap.
  if (bias === "long" && ind.rsi14 != null && ind.rsi14 >= 70) {
    cautions.push("Trend is up but RSI is stretched — signals partly conflict.");
  }
  if (bias === "short" && ind.rsi14 != null && ind.rsi14 <= 30) {
    cautions.push("Trend is down but RSI is washed out — signals partly conflict.");
  }

  return { bias, score, confidence, reasons, cautions };
}

// Build an ATR-based risk plan. Stops are placed a multiple of ATR away from
// price (volatility-aware), targets are expressed in R-multiples (multiples of
// the risk distance), and position size comes from fixed-fractional risk:
// risk no more than `riskPct` of the account on the trade.
export function buildRisk({ price, atr, bias, spec, accountSize, riskPct, atrMult = 1.5 }) {
  const isReference = bias === "neutral";
  const dir = bias === "short" ? -1 : 1; // neutral -> show a long-side reference plan
  const roundTick = (p) => Math.round(p / spec.tick) * spec.tick;

  const stopDist = atrMult * atr;
  const entry = roundTick(price);
  const stop = roundTick(price - dir * stopDist);
  const target1 = roundTick(price + dir * stopDist * 2);
  const target2 = roundTick(price + dir * stopDist * 3);

  const riskPerContract = stopDist * spec.pointValue;
  const dollarRisk = accountSize * (riskPct / 100);
  const suggestedContracts = riskPerContract > 0 ? Math.floor(dollarRisk / riskPerContract) : 0;

  return {
    direction: bias === "short" ? "short" : "long",
    isReference,
    atrMult,
    stopDistancePts: stopDist,
    entry,
    stop,
    target1,
    target2,
    rMultiples: { target1: 2, target2: 3 },
    pointValue: spec.pointValue,
    tickSize: spec.tick,
    riskPerContract,
    dollarRisk,
    suggestedContracts,
  };
}
